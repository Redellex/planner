# Test Plan

> Phased test rollout for this project. Strategy is frozen at the top
> (§1–§5); cookbook patterns at the bottom (§6) fill in as phases ship.
> Read before writing any new test.
>
> Refresh: re-run `/10x-test-plan --refresh` when stale (see §8).
>
> Last updated: 2026-10-01

## 1. Strategy

Tests follow three non-negotiable principles for this project:

1. **Cost × signal.** The cheapest test that gives a real signal for the
   risk wins. Do not promote to e2e because e2e "feels safer." Do not put a
   vision model on top of a deterministic visual diff that already catches
   the regression.
2. **User concerns are first-class evidence.** Risks anchored in "the
   team is worried about X, and the failure would surface somewhere in
   <area>" carry the same weight as PRD lines or hot-spot data.
3. **Risks are scenarios, not code locations.** This plan documents _what
   could fail_ and _why we believe it's likely_ — drawn from documents,
   interview, and codebase _signal_ (churn, structure, test base). It does
   NOT claim to know which line owns the failure. That knowledge is
   produced by `/10x-research` during each rollout phase. If the plan and
   research disagree about where the failure lives, research is the
   ground truth.

Hot-spot scope used for likelihood weighting: `src/`, `supabase/migrations/`, `supabase/seed.sql`, `scripts/` (excluding generated types, docs, `context/`, build output).

Vendor boundary: Supabase Auth, PostgREST, the Postgres engine and the Cloudflare runtime are not under test. Our own rules that run inside Supabase — RLS policies, constraints, functions and triggers from `supabase/migrations/` — are ours and are tested through their behaviour.

## 2. Risk Map

The top failure scenarios this project must protect against, ordered by
risk = impact × likelihood. Risks are failure scenarios in user / business
terms, not test names. The Source column cites the _evidence that surfaced
this risk_ — never a specific file as "where the failure lives" (that is
research's job, see §1 principle #3).

| #   | Risk (failure scenario)                                                                                                                                                                                                                                                                                                   | Impact | Likelihood             | Source (evidence — not anchor)                                                                                                                                                                                                                                                                                             |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Station wall-clock dates drift on the UTC Worker: a window lands on the wrong day or month, an overnight window is attributed to the wrong month, a weekday repeat generates wrong dates, or the "current station month" flips at the wrong moment around midnight or a DST change — so the wrong months become editable. | High   | High                   | interview Q2 (burned by timezone/DST), Q3; CLAUDE.md Availability: wall-clock timestamps with no DST correction, station time zone defined in two places that must agree; archive `2026-09-26-employee-availability-management` impl review F2, F6; hot-spot dir `src/lib/` — 11 commits/30d                               |
| 2   | (abuse) An employee reads, edits or deletes another employee's availability — by posting a forged form with someone else's window id, or by reading without an ownership filter.                                                                                                                                          | High   | Medium                 | PRD Non-Functional Requirements (availability visible only to the owner and the manager), PRD Access Control; interview Q1, Q3; archive `2026-09-26-employee-availability-management` impl review F3 (an endpoint trusted a client-sent field); hot-spot dirs `supabase/migrations/` — 5, `src/pages/api/` — 9 commits/30d |
| 3   | Availability changes after scheduling started: a create, edit or delete reaches a locked, current or past month — directly, through an overnight window spilling into it, by moving a window across months, or through a weekday repeat — and the schedule is built on stale data.                                        | High   | Medium                 | PRD FR-001; interview Q1, Q3; archive `2026-09-26-employee-availability-management` impl review F1 (overnight window reached a locked month) and phase-4 review F2 (update/delete had no automated coverage); roadmap S-03 (generation will set the lock)                                                                  |
| 4   | (abuse) Role and route control regresses after a middleware or role change: an anonymous user reaches a protected page, an employee reaches a manager page or manager action (lock a month, change a role) or promotes themselves, or managers are locked out (last manager demoted, manager served a 403).               | High   | Medium                 | interview Q2 (burned by a middleware/auth refactor); PRD Access Control; archive `2026-09-25-role-aware-access-control` impl review F2; hot-spot dirs `src/pages/manager/` — 9, `src/pages/api/` — 9 commits/30d                                                                                                           |
| 5   | The schedule generator assigns a shift outside an employee's availability, or leaves a shift without exactly one person, without surfacing it to the manager.                                                                                                                                                             | High   | High (once S-03 lands) | PRD Success Criteria Guardrail, US-01 acceptance criteria, FR-004; interview Q1; roadmap S-03 (north star, riskiest slice)                                                                                                                                                                                                 |
| 6   | A failed or truncated availability read is presented as "nobody submitted", so the manager (and later the generator) decides on incomplete data.                                                                                                                                                                          | Medium | Low                    | archive `2026-09-29-manager-availability-visibility` impl review F1 (1000-row read cap), F2; archive `2026-09-26-employee-availability-management` impl review F4 (lock read failed open); roadmap S-03 handoff (page month-wide reads)                                                                                    |

High-impact × low-likelihood scenarios such as a Supabase or Cloudflare outage are left to observability, not tests.

### Risk Response Guidance

| Risk | What would prove protection                                                                                                                                                                                                                                                                     | Must challenge                                                                                             | Context `/10x-research` must ground                                                                                                                                                                     | Likely cheapest layer                                                                           | Anti-pattern to avoid                                                                   |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| #1   | Correct day/month for independent calendar facts: DST days 2026-03-29 and 2026-10-25, an overnight window from the last day of a month into day 1, February in leap year 2028, the current station month just before and after midnight Warsaw time — all with the process running in `TZ=UTC`. | "Passes on my machine in CET, so it passes on the Worker."                                                 | Where station "now" is computed (TS and SQL), every date parse/format path, how weekday repeats and month boundaries are derived, whether any path goes through `new Date(...)` on a wall-clock string. | unit (frozen clock, forced UTC)                                                                 | Expected values computed with the helper under test instead of taken from the calendar. |
| #2   | Employee B gets no rows and no effect on A's window for read, update and delete; A's row is verified intact after every denied write. A manager can read but not write others' windows.                                                                                                         | "The page filters by employee, so the data is private" — the endpoints can be called directly with any id. | Which rules enforce ownership on each operation, which columns are writable, which fields endpoints take from the client, how a zero-row result is reported.                                            | database rules test per role (pgTAP on the local stack)                                         | Asserting only "no error" or "zero rows" without checking the target row survived.      |
| #3   | Every write path into a locked, current or past month is refused — create, update (old and new month), delete, overnight spill into a locked next month, weekday repeat crossing into one — and the open-month path still works.                                                                | "Smoke covers create into a locked month, so update and delete are safe too."                              | The editability rule and every place it is applied, how a window's month is derived from its start and end, lock rows and who can write them.                                                           | database rules test (pgTAP)                                                                     | Happy-path only, or create-only coverage.                                               |
| #4   | A route × role table: anonymous → sign-in, employee → 403 on manager pages and manager endpoints, manager → 200; an employee cannot change any role including their own; the last manager cannot be demoted.                                                                                    | "The page is gated, so the POST endpoint behind it is gated too."                                          | Route matching rules (segment boundaries, prefixes), how role is resolved and what happens when it is missing, the role-change rules and last-manager guard in the database.                            | unit on route/role decision + database rules for role changes; smoke keeps the end-to-end check | Mocking the whole Supabase client so the test only verifies the mock.                   |
| #5   | Invariants over generated inputs: every assignment falls inside that employee's availability, every shift has exactly one employee or is explicitly reported as uncovered, long shifts do not repeatedly land on one person by the agreed fairness metric.                                      | "One example schedule looks right, so the generator is right."                                             | The resolved definitions of fairness and the no-coverage fallback (roadmap S-03 unknowns), the generator's input/output contract, how conflicts are surfaced.                                           | property-based unit test                                                                        | Asserting a specific schedule copied from the generator's own output (oracle problem).  |
| #6   | A forced read error or a month with more rows than one page never renders "No availability submitted"; the user sees a load error instead.                                                                                                                                                      | "An empty list means there is no data."                                                                    | How month-wide reads page through results, how read errors reach the view, which views and (later) the generator share the read path.                                                                   | unit/integration on the read path with an injected failure                                      | An e2e test where a unit test on the read path catches the same regression.             |

## 3. Phased Rollout

Each row is a discrete rollout phase that will open its own change folder
via `/10x-new`. Status moves left-to-right through the values below; the
orchestrator updates Status as artifacts appear on disk.

| #   | Phase name                             | Goal (one line)                                                                                                                             | Risks covered | Test types                  | Status        | Change folder                                    |
| --- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | --------------------------- | ------------- | ------------------------------------------------ |
| 1   | Test runner and station-time logic     | Bootstrap the unit runner and prove dates, months and station "now" are correct on a UTC runtime and across DST                             | #1            | unit                        | complete      | context/archive/2026-10-01-testing-station-time/ |
| 2   | Database rules: ownership, lock, roles | Prove a forged or direct write cannot touch another employee's data or a non-editable month, and cannot escalate or remove the last manager | #2, #3, #4    | database rules (pgTAP)      | change opened | context/changes/testing-database-rules/          |
| 3   | Route gating and honest reads          | Prove the route × role decision holds after middleware changes, and a failed or truncated read never looks like "nobody submitted"          | #4, #6        | unit + targeted smoke steps | not started   | —                                                |
| 4   | Generator invariants (with S-03)       | Prove no assignment falls outside availability and no shift is silently left without exactly one person; starts once S-03 is planned        | #5            | property-based unit         | not started   | —                                                |

Phase 4 is gated on roadmap S-03 having a plan (its two blocking unknowns resolved); research cannot ground code that does not exist yet.

## 4. Stack

The classic test base for this project. AI-native tools (if any) carry a
`checked:` date so future readers can see which lines need re-verification.
Test base today: **unit runner** — Vitest via `npm test` (`vitest run`), tests in `src/**/*.test.ts`, run in CI after `astro check`; plus the HTTP smoke script run in CI. No database rules tests yet.

| Layer                | Tool                                                                           | Version                                  | Notes                                                                                                                                                                                                                                                                                                           |
| -------------------- | ------------------------------------------------------------------------------ | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| unit                 | Vitest (plain `vitest.config.ts`, no `getViteConfig`)                          | 5.0.3                                    | `process.env.TZ = "UTC"` is the config's first statement, so every OS runs like the Worker. Not `getViteConfig`: it runs the `@astrojs/cloudflare` hook, which adds `@cloudflare/vite-plugin` with no Vitest guard, and the station-time helpers need neither Astro nor the Worker runtime. checked: 2026-10-01 |
| mutation             | Stryker (`@stryker-mutator/core`, command runner over `npm test`)              | 10.0.0                                   | Selective and manual: `npx stryker run`, scoped with `--mutate`; not in CI or pre-commit, no break threshold. Report in `reports/mutation/` (gitignored). checked: 2026-10-01                                                                                                                                   |
| database rules       | pgTAP via `supabase test db`                                                   | Supabase CLI ^2.117 (repo devDependency) | Runs against the local stack the CI smoke job already starts; none yet — see Phase 2. checked: 2026-10-01 (Context7, Supabase testing guide)                                                                                                                                                                    |
| property-based       | fast-check (with Vitest)                                                       | none yet — see Phase 4                   | Generator invariants only. checked: 2026-10-01                                                                                                                                                                                                                                                                  |
| HTTP smoke           | `scripts/smoke.mjs` (existing)                                                 | n/a                                      | End-to-end auth, roles, availability, team view over HTTP; not a test suite.                                                                                                                                                                                                                                    |
| e2e (browser)        | none                                                                           | —                                        | Not planned: no risk needs a browser that smoke or cheaper layers do not cover.                                                                                                                                                                                                                                 |
| (optional) AI-native | `/10x-impl-review`, `security-review` on migration diffs — checked: 2026-10-01 | n/a                                      | Use for a second read of new RLS policies. When NOT to use: as a substitute for the Phase 2 rules tests, or on view-only changes.                                                                                                                                                                               |

**Stack grounding tools (current session):**

- Docs: Context7 — checked Supabase pgTAP RLS testing (`supabase test db`, role + JWT claim simulation) and Astro Vitest setup (`getViteConfig`, Container API); checked: 2026-10-01
- Search: Exa.ai — available, not used (official docs via Context7 were sufficient); checked: 2026-10-01
- Runtime/browser: no Playwright MCP; `claude-in-chrome` skill available — not used, no browser-only risk; checked: 2026-10-01
- Provider/platform: no Supabase or Cloudflare MCP; GitHub via `gh` CLI — not used; checked: 2026-10-01

## 5. Quality Gates

The full set of gates that must pass before a change reaches production.
"Required after §3 Phase <N>" means the gate is enforced once that rollout
phase lands; before that, the gate is `planned`.

| Gate                                             | Where                   | Required?                    | Catches                                                      |
| ------------------------------------------------ | ----------------------- | ---------------------------- | ------------------------------------------------------------ |
| lint + typecheck (`npm run lint`, `astro check`) | local + CI              | required (wired)             | syntactic / type drift                                       |
| colour-literal check (`npm run check:ui`)        | pre-commit              | required (wired)             | design-token regressions on cleaned views                    |
| unit tests (`npm test`)                          | local + CI              | required (wired)             | date/month logic, route/role decision, read-path regressions |
| database rules tests                             | CI (local Supabase job) | required after §3 Phase 2    | ownership, lock and role-rule regressions in migrations      |
| HTTP smoke                                       | CI (local Supabase job) | required (wired)             | broken critical flows end to end                             |
| property-based generator tests                   | local + CI              | required after §3 Phase 4    | generator guardrail violations                               |
| post-edit hook                                   | local (agent loop)      | recommended after §3 Phase 1 | regressions at edit time; not a CI substitute                |

## 6. Cookbook Patterns

How to add new tests in this project. Each sub-section is filled in once
the relevant rollout phase ships; before that, the sub-section reads
"TBD — see §3 Phase <N>."

### 6.1 Adding a unit test for date / station-time logic

Example: `src/lib/availability.test.ts`. Run with `npm test`.

1. **Where.** Put the test next to the module as `src/lib/<module>.test.ts` (`vitest.config.ts` only picks up `src/**/*.test.ts`). Import `describe`/`it`/`expect`/`vi` from `"vitest"` (no globals) and the module with a relative import.
2. **UTC is already forced.** `vitest.config.ts` sets `process.env.TZ = "UTC"` before the workers start, and `src/lib/test-runtime.test.ts` fails if the process is not in UTC. Do not set `TZ` in a test, in `test.env` or in an npm script: `test.env` works under the default `forks` pool but fails under `--pool=threads`, and `TZ=…` prefixes fail under cmd.exe. The config line works under every pool.
3. **Freeze "now" only through `Date`.** For anything that reads the station clock (`currentStationMonth`, `upcomingMonths`, `teamAvailabilityMonths`), call `vi.useFakeTimers({ toFake: ["Date"] })` and `vi.setSystemTime(new Date("<UTC instant>Z"))`, and restore with `vi.useRealTimers()` in `afterEach`. Pick instants one second either side of Warsaw midnight: `22:00Z` in summer (CEST) and `23:00Z` in winter (CET).
4. **Expected values are literals from the calendar or the DST rule, never helper output.** Look them up: which weekday a date falls on, how many days February has, the EU DST days (last Sunday of March and October, 01:00 UTC; 2026-03-29 and 2026-10-25). Never compute the expected value with the helper under test or a copy of its logic. Wall-clock durations ignore DST: 00:00–00:00 on a DST day is 1440 minutes (CLAUDE.md, Availability).
5. **One `describe` per behaviour, named after the regression it catches** (e.g. "station month flips at Warsaw midnight, not UTC midnight"), and an `it.each` table for a set of facts with the same shape (month flips, overnight windows, weekday repeats). Each row should catch a different mistake: a month boundary, a year boundary, leap February, a DST day, and one same-day control.
6. **Labels: avoid September in `en-GB`.** ICU versions differ on the short form ("Sep" vs "Sept"), so the test would depend on the Node build. Use another month.
7. **Wall-clock strings stay strings.** Pass `"YYYY-MM-DDTHH:MM:00"` straight to the helpers. Only `formatStationInstant` takes a real instant, and its inputs must carry an offset (`+00:00`).
8. **Zone literals.** A new `at time zone '…'` in a migration or a `timeZone: "…"` in `scripts/smoke.mjs` is checked against `STATION_TIME_ZONE` by `src/lib/station-time-zone.test.ts`. If you add the zone in a new place, extend that guard instead of writing a new one.
9. **Mutation check (optional, after a risk phase).** Run `npx stryker run --mutate "src/lib/<module>.ts"` and open `reports/mutation/mutation.html`. For each survivor ask "would this change hurt a user?" If yes, add a literal-valued assertion. If no (unreachable fallback, a guard the regex already covers), record it in §6.6. Do not chase 100%.

### 6.2 Adding a database rules test for a new table or policy

- TBD — see §3 Phase 2 (per-role allow/deny with "denied write left the row intact" pattern; lock/editability pattern).

### 6.3 Adding a test for a new protected route or endpoint

- TBD — see §3 Phase 3 (route × role decision table; when to add a smoke step instead).

### 6.4 Adding a test for a read path that feeds a decision

- TBD — see §3 Phase 3 (read error / truncation must not render as "empty" pattern).

### 6.5 Adding an invariant test for the schedule generator

- TBD — see §3 Phase 4 (property-based "never outside availability, never silently uncovered" pattern).

### 6.6 Per-rollout-phase notes

(Appended by each phase's final sub-phase.)

#### Phase 1: Test runner and station-time logic (2026-10-01, `context/archive/2026-10-01-testing-station-time/`)

- **Runner:** Vitest 5.0.3 with a plain `vitest.config.ts` (no `getViteConfig`), UTC forced in the config, `npm test` wired into the CI `ci` job between `astro check` and `build`. 74 tests: the UTC guard, the zone-literal guard and the station-time helpers in `src/lib/availability.test.ts`.
- **Stryker path:** Stryker 10.0.0 with `testRunner: "command"` (`npm test`, `coverageAnalysis: "off"`), the first fallback in the plan; Vitest stayed on 5.0.3. `@stryker-mutator/vitest-runner` was uninstalled as unused.
- **Mutation score** on `src/lib/availability.ts`: 279 mutants, 205 killed, 3 timeouts, 71 survived → **74.55%** total and **74.55%** of covered code (the command runner has no per-test coverage, so there is no "no coverage" bucket).
- **Accepted station-time survivors (9, all equivalent):**
  - `DATE_PATTERN` without its `$` anchor: `parseDate` also checks that the parsed date converts back to exactly the input string, so trailing characters are still rejected.
  - `currentStationMonth`, 5 mutants (`?.` → `.`, the `?? ""` fallback replaced, `part.type === "year"` → `true`): `Intl.DateTimeFormat("en-CA", { year, month })` always emits both parts with the year first, so the fallbacks and the first-match shortcut cannot change the result.
  - `parseMonth`, `parseDate` and `parseTime` with the `typeof value === "string"` guard forced: every caller passes `searchParams.get()` or `form.get()` (`string | File | null`), and `null` or a `File` becomes `"null"` or `"[object File]"` before the regex test, which fails the pattern, so the result is still `null`. Equivalent for every reachable input only: an array such as `["2026-10"]` would get through `parseMonth`, so a new caller that passes anything else needs the guard tested.
- **How the triage was checked:** each of the 9 mutants was applied to a scratch copy of the module and compared with the original on `null`, `undefined`, a number, an object, an array, a `Blob`, trailing-character and invalid-date strings, and frozen instants on both sides of Warsaw midnight. The test literals were cross-checked against GNU `date`, using a POSIX EU-DST rule (`CET-1CEST,M3.5.0/2,M10.5.0/3`) rather than ICU.
- **Out-of-scope survivors (62):** `formatDuration`, the error-message constants, `describeWriteError`, `logAvailabilityError`, `resolveFeedbackError`, `availabilityUrl` and `teamAvailabilityUrl`. They carry no station-time risk and are not tested in this phase.
- **Not covered here:** the SQL `is_availability_month_editable` rule and the `ends_at - 1µs` spill rule (rollout Phase 2, pgTAP).

## 7. What We Deliberately Don't Test

Exclusions agreed during the rollout (Phase 2 interview, Q5). Future
contributors should respect these unless the underlying assumption changes.

- **Visual / snapshot tests of views** — colours are guarded by `check:ui` and each `/10x-ui` change ships screenshots. Re-evaluate if a visual regression reaches production. (Source: Phase 2 interview Q5.)
- **Dev-only kitchen-sink pages and legacy `bg-cosmic` views** — not user-facing or scheduled for rework. Re-evaluate when a legacy view is moved onto tokens. (Source: Phase 2 interview Q5.)
- **Vendor platforms: Supabase (Auth, PostgREST, Postgres engine) and Cloudflare runtime** — the vendor's job; smoke covers the auth happy path. Our own migrations' rules stay in scope (§1 vendor boundary). Re-evaluate if we start depending on a vendor behaviour that broke once. (Source: Phase 2 interview Q5.)

## 8. Freshness Ledger

- Strategy (§1–§5) last reviewed: 2026-10-01
- Stack versions last verified: 2026-10-01
- AI-native tool references last verified: 2026-10-01

Refresh (`/10x-test-plan --refresh`) when:

- a new top-3 risk surfaces from the roadmap or archive,
- a recommended tool's `checked:` date is older than three months,
- the project's tech stack changes (new framework, new test runner),
- §7 negative-space no longer matches what the team believes.
