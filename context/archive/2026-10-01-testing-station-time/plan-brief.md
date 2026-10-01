# Test Runner and Station-Time Logic — Plan Brief

> Full plan: `context/changes/testing-station-time/plan.md`
> Research: `context/changes/testing-station-time/research.md`

## What & Why

Rollout Phase 1 of the test plan, risk #1. Availability times are Europe/Warsaw wall-clock strings, but the app runs on a UTC Worker. A date bug there puts a window on the wrong day or month, generates wrong weekday repeats, or makes the wrong months editable around midnight or a DST change. Today none of this has an automated test, and the dev machine runs in CET, so a zone bug would pass locally.

## Starting Point

The repo has no unit runner, only the HTTP smoke script. All station-time logic sits in `src/lib/availability.ts`, a module with no imports. `currentStationMonth()` is its only clock read. The station zone literal is copied in TS, in one SQL migration and in `scripts/smoke.mjs`, and only comments keep them in sync.

## Desired End State

`npm test` runs Vitest in UTC on any OS, and CI requires it. Each station-time helper is pinned to literal calendar facts: the Warsaw-midnight month flips, both 2026 DST days, overnight windows into the next month and year, leap February 2028, weekday repeats and the Monday-first grid. Guard tests fail if the process zone isn't UTC or if any zone literal drifts. A one-off Stryker run has shown the assertions catch broken date maths.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Runner config | Plain `vitest.config.ts`, not Astro `getViteConfig` | The module imports nothing from Astro, and `getViteConfig` would load the Cloudflare plugin, which has no VITEST guard. | Research → Plan |
| Forcing UTC | `process.env.TZ = "UTC"` first in the config | An npm-script prefix fails on Windows cmd, and `test.env` does not reach worker threads. | Research |
| Time zones covered | UTC only, plus a guard test that the zone really is UTC | The Worker only runs in UTC; the guard closes the "passes in CET" trap at no CI cost. | Plan |
| Freezing the clock | `vi.useFakeTimers({ toFake: ["Date"] })` + `setSystemTime` | It freezes `currentStationMonth()` without changing production code. | Plan |
| Oracle | Literal values from the calendar and the EU DST rule; DST durations from the CLAUDE.md wall-clock rule | Expected values computed with the helper under test would mirror its bugs. | Test plan §2 / Research |
| Zone-literal sync | Guard test: every SQL `at time zone '…'` and smoke `timeZone: "…"` equals `STATION_TIME_ZONE` | A drift flips the station month at the wrong moment, and today only comments prevent it. | Plan |
| Mutation testing | One manual Stryker 10 run on `availability.ts`, kept as devDeps and config, not in CI | It proves the assertions bite, as a selective gate rather than a per-commit cost. | Plan |
| Label assertions | Avoid September | `en-GB` short September is `Sept` on ICU 78.3, and CI's ICU wasn't checked. | Research |

## Scope

**In scope:**

- Vitest + `@types/node`, `vitest.config.ts`, the `npm test` script and a CI step
- UTC guard test, station-time helper tests, zone-literal guard test
- Stryker setup, one run and survivor triage
- test-plan §3/§4/§5/§6.1/§6.6 and CLAUDE.md updates

**Out of scope:**

- SQL editability, the `ends_at - 1µs` spill rule and RLS (rollout Phase 2, pgTAP)
- A second-zone run, `getViteConfig` / Container API
- Refactoring the `.slice(0, 7)` month keys in pages
- Error/URL helpers, an offset-less `formatStationInstant` input
- Stryker in CI, pre-commit test hooks, coverage thresholds

## Architecture / Approach

Tests sit next to the module in `src/lib/*.test.ts` and use relative imports and explicit `vitest` imports, and they are checked by `astro check` and strict ESLint like any other source. A standalone Vitest config forces UTC before workers start. Repeated fact shapes use `it.each` tables with literal expected values. The runner is proven on a guard test first, then the real tests land, then Stryker checks them, and the docs are written last from real results.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Runner bootstrap | Vitest, a UTC config, `npm test`, a UTC guard test, the CI step | Vitest 5 is about a month old (fallback 4.1.11) |
| 2. Station-time tests + zone guard | Calendar-fact tests for every date helper; zone-literal guard | ICU label differences on CI Node 22 |
| 3. Mutation gate | Stryker setup, one run, survivors killed or recorded as equivalent | Chasing score with implementation-pinned assertions |
| 4. Test-plan and docs sync | §3–§6 updated, cookbook pattern, CLAUDE.md commands | Docs drifting from what shipped |

**Prerequisites:** Node 22.14 (`.nvmrc`), npm registry access. No Supabase stack or secrets needed.
**Estimated effort:** ~1–2 sessions across 4 small phases.

## Open Risks & Assumptions

- PostgREST is assumed to send an offset for timestamptz (`locked_at`). The tests cover only offset-carrying input.
- If a test exposes a real bug in `availability.ts`, implementation stops and asks before changing production code.
- Stryker 10 with Vitest 5 is untested here; the peer range (`vitest >=2`) allows it.

## Success Criteria (Summary)

- A zone or calendar regression in the station-time helpers fails `npm test` locally and in CI, whatever the dev machine's zone.
- Changing the station zone in only one of TS, SQL and smoke fails a test.
- test-plan §6.1 gives the next contributor a ready recipe for date tests.
