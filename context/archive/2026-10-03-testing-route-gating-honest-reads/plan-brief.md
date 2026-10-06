# Test Rollout Phase 3: Route Gating and Honest Reads — Plan Brief

> Full plan: `context/changes/testing-route-gating-honest-reads/plan.md`
> Research: `context/changes/testing-route-gating-honest-reads/research.md`

## What & Why

Rollout Phase 3 of `context/foundation/test-plan.md` protects against two risks. Risk #4: after a middleware or role change, an anonymous user or employee reaches a manager page **or endpoint**. Risk #6: a failed or truncated availability read shows up as "No availability submitted", so the manager decides on incomplete data. Neither has a unit test today, because the logic lives in files Vitest cannot load.

## Starting Point

- **Route decision.** It sits in `src/middleware.ts` (imports `astro:*`). Smoke checks employee GETs of manager pages but never sends a manager endpoint request as an employee or anonymous user.
- **Team read.** It is page-local in `src/pages/manager/availability.astro`. It stops at the first short page, so a lower `max_rows` would truncate silently. A failed profiles read and the calendar's "no one available" labels still make missing data look like "nobody".

## Desired End State

- **Route decision.** `src/lib/route-access.ts` owns the route lists and the allow / sign-in / 403 decision. Unit tests prove a route × actor table, and a guard fails whenever a `src/pages` file has no explicit expected access.
- **Team read.** `src/lib/team-availability.ts` pages every team list by count and returns ready-or-unknown. When the result is unknown, the team view shows only the error alert, month tabs and lock status.
- **Smoke.** It proves that employee POSTs to manager endpoints get the 403 page and have no effect.

## Key Decisions Made

| Decision          | Choice                                                                                                                                                | Why (1 sentence)                                                                                                   | Source   |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | -------- |
| Testability seam  | Extract the decision and the read path into import-free `src/lib` modules; the read helper takes a narrow `(from, to) → {data, error, count}` fetcher | Vitest can't load the middleware or `.astro` files, and the anti-pattern forbids mocking the whole Supabase client | Research |
| Defects found     | Fix the team view (profiles failure, calendar labels); record `/manager/months` fail-open as a gap                                                    | A test that pins the current behaviour would pin the defect, and §7 excludes legacy views                          | Plan     |
| Truncation        | Count-driven paging: advance by rows received, stop at `count`; an error, a missing count or a shortfall is a read error                              | A `max_rows` below the page size no longer truncates, and any shortfall becomes an error instead of "nobody"       | Plan     |
| Unknown state UI  | The alert replaces the calendar, day panel and summary (as in `manager/users.astro`)                                                                  | Nothing on the page can read as "no one available"; one state decides it                                           | Plan     |
| Smoke additions   | Employee lock and self-promotion POSTs → 403 with no effect; anonymous lock POST → sign-in                                                            | Only HTTP proves the middleware gates the endpoints and that the rewrite skips the handler                         | Plan     |
| Inventory guard   | A test walks `src/pages` and requires an explicit access class per route; lint-staged runs it on staged pages                                         | Catches a new endpoint placed outside the gated prefixes, at commit time                                           | Plan     |
| Role-change rules | Not re-tested at the unit layer                                                                                                                       | Phase 2 pgTAP already proves self-promotion and the last-manager guard                                             | Research |

## Scope

**In scope:**

- `route-access.ts` with decision and role tests, the route inventory guard, and its lint-staged entry
- `team-availability.ts` with read-path tests, and the team-view refactor including the unknown-state UI
- 5 smoke steps (4 employee, 1 anonymous)
- A Stryker pass on both new modules
- Test-plan §6.3, §6.4 and §6.6, and CLAUDE.md updates

**Out of scope:**

- `/manager/months` fail-open (legacy view)
- Percent-encoding and case variants of paths (Astro normalises them)
- Unit re-tests of role-change rules
- An e2e test or a forced-error smoke step
- Smoke GETs for the remaining page gaps
- Paging the lock reads
- The per-edit agent hook mapping
- The §3 Status column

## Architecture / Approach

`src/middleware.ts` keeps the Supabase calls (`getUser`, the profiles read). It feeds `roleFromProfile` and `routeAccess` and maps the result onto `next()`, `redirect("/auth/signin")` or `rewrite("/403")`. `/manager/availability` reads profiles, month windows and carry-overs through `loadAllPages` (`count: "exact"`, `id` tiebreak). `buildTeamView` returns `unknown`, or `ready` with totals, and the page renders the calendar, day panel and summary only when the view is ready. Unit tests feed both modules literal fixtures. Smoke proves the wiring over HTTP.

## Phases at a Glance

| Phase                         | What it delivers                                                                                                                | Key risk                                                                      |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| 1. Route Access Decision      | Extracted decision, middleware rewired with no behaviour change, decision table, role tests, inventory guard, lint-staged entry | The extraction subtly changes the order of the gates (smoke rerun catches it) |
| 2. Honest Team Read           | Count-driven paging, ready/unknown state, team-view refactor, read-path tests                                                   | An off-by-one in the loop requests past the end (PostgREST answers 416)       |
| 3. Smoke Endpoint Gates       | Employee POST → 403 with no effect; anonymous POST → sign-in                                                                    | Reading the employee id from the `@supabase/ssr` session cookie format        |
| 4. Mutation Pass and Cookbook | Stryker triage, test-plan §6.3, §6.4 and §6.6, CLAUDE.md                                                                        | Survivors that need judgement rather than an assertion                        |

**Prerequisites:** local Supabase stack (`npx supabase start`) with the seed applied, for smoke and the manual team-view checks.
**Estimated effort:** ~2–3 sessions across 4 phases.

## Open Risks & Assumptions

- The hosted project's `max_rows` was not checked. Count-driven paging makes the value irrelevant to correctness.
- The smoke id helper depends on the `@supabase/ssr` cookie format. It fails loudly if the format changes, and smoke is re-run after upgrades.
- Offset paging while windows are written during one load can, rarely, skip or repeat a row. This is recorded as best effort, not part of risk #6.
- POST → `rewrite("/403")` skipping the handler is inferred from source until the Phase 3 smoke step observes it.

## Success Criteria (Summary)

- Moving a manager endpoint outside the gates, or dropping a gate, turns `npm test` red (and blocks the commit for a staged page).
- No failed or truncated team read can render "No availability submitted" or "no one available". The manager sees a load error instead.
- Smoke shows that an employee cannot lock a month or promote themselves through the manager endpoints.
