# Database Rules: Ownership, Month Lock and Roles — Plan Brief

> Full plan: `context/changes/testing-database-rules/plan.md`
> Research: `context/changes/testing-database-rules/research.md`

## What & Why

Rollout Phase 2 of the test plan adds pgTAP tests proving that a forged or direct write cannot:
- touch another employee's availability (risk #2);
- reach a locked, current or past month (risk #3);
- escalate a role or demote the last manager (risk #4, database half).

Postgres is the single source of truth for access control, and the endpoints filter only by `id`. So these rules are the only defence, and today only smoke and one-off manual checks cover them.

## Starting Point

The guarantees live in 4 migrations: RLS policies, column grants, the range check, the per-employee no-overlap constraint, `is_availability_month_editable` and the last-manager trigger. There is no `supabase/tests/` directory and no rules step in CI. Smoke checks only that a create into a locked month is refused. On 2026-10-03, against the running local stack, we confirmed that `supabase test db` works on this machine and that every assertion pattern the plan uses works under pg_prove.

## Desired End State

`npm run test:db` runs three transactional pgTAP files that leave no data behind. They run locally and in the CI smoke job before smoke itself. Every scenario from research §3 asserts the outcome its oracle requires: an error code, or zero rows with the target row checked intact as `postgres`. A manual sabotage pass shows each test turns red when its rule is reverted. The test plan (§4, §5, §6.2, §6.6) and CLAUDE.md describe the harness.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Test layer | pgTAP via `supabase test db` on the local stack | The rules are SQL; a stub would lie about RLS and constraints. | Research / test-plan §2 |
| Denial shape per operation | 42501 for insert, update new-row and grant refusals; zero rows + intact row for update/delete `using` refusals; 23P01, 23514, P0001 + message for the rest | Postgres semantics, and the app maps exactly these codes. | Research |
| `anon` expectations | Asserted from outcomes observed on the stack (select empty; insert/update 42501; delete empty) | Research had only inferred them; the probe closed that question. | Plan (probe) |
| CI placement | New step in the smoke job right after "Start local Supabase" | Reuses the running stack, fails fast and runs on clean seed data. | Plan |
| CLI version | Pin `setup-cli` to 2.117.0 (= devDependency) | Same CLI and pg_prove image locally and in CI. | Plan |
| Concurrent last-manager demotion | Accepted gap, recorded in §6.6 | A single-session pgTAP file cannot run two transactions; the likelihood is low. | Plan |
| Proof the tests catch regressions | Manual sabotage pass (revert one rule at a time, record the red test, `db reset`) | Stryker cannot mutate SQL, and structural pgTAP checks would mirror the implementation. | Plan |
| Zone literal in test files | Extend `src/lib/station-time-zone.test.ts` to `supabase/tests/database/*.sql` | Cookbook §6.1 item 8 says to extend the guard, not add a new one. | Test plan |
| Fixtures | Inline per file: fixed UUIDs, `@db-rules.test` emails, months via `\gset`, locks set or cleared inside the transaction | Shared DB with seed and smoke data; no extra helper dependency. | Research / Plan |

## Scope

**In scope:**
- Three pgTAP files: ownership, month lock, roles.
- The `test:db` npm script.
- The zone-guard extension.
- The CI step and CLI pin.
- The manual sabotage pass.
- Test-plan and CLAUDE.md updates.

**Out of scope:**
- A concurrent-demotion test.
- The SQL midnight/DST boundary.
- Asserting whether a current or past month may be locked.
- A forward month cap.
- Structural policy/grant checks.
- Endpoint and route tests and the `lock.ts` fixes (Phase 3).
- Any production or migration change.
- `--linked` runs.

## Architecture / Approach

Each file runs in its own transaction: `begin; plan(n); … finish(); rollback;`.
- Setup runs as `postgres`: derive months from `now() at time zone 'Europe/Warsaw'` once, create users with a minimal `auth.users` insert (the signup trigger makes their profiles), promote managers, and set or clear locks.
- Each actor block uses `set local role authenticated` and JWT claims, or `anon`, and mirrors the app's write shapes.
- Intactness checks go back to `postgres` with `reset role`.
- Each refusal sits next to an allow control on the same kind of write.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Harness, ownership tests, CI step | `test:db`, ownership file (~20 assertions), zone guard, smoke-job step on CLI 2.117.0 | CI stack started with `-x` may behave differently from local |
| 2. Month lock and editability | Lock file: current, past and locked months for every write path, spill, weekday batch, lock-row writers, range edges | A batch row overlapping another fixture window turns 42501 into 23P01 |
| 3. Role rules | Roles file: no self-promotion, `role`-only updates, last-manager guard by every path | The guard counts every manager, so the seed manager must be demoted in-transaction |
| 4. Sabotage pass and cookbook | Reversal → red-test table, §6.2 cookbook, §6.6 notes, CLAUDE.md | A reversal that stays green needs a new assertion or a recorded second-layer reason |

**Prerequisites:** Docker running, `npx supabase start` with seed applied, CLI 2.117.0.
**Estimated effort:** ~3–4 sessions across 4 phases.

## Open Risks & Assumptions

- `now()` is fixed per transaction. A run that straddles Warsaw midnight at a month boundary is still self-consistent within each file.
- If a test exposes a real rule bug, implementation stops and asks; no migration change is planned.
- The sabotage pass resets the local DB, which wipes local smoke data. The seed is re-applied.

## Success Criteria (Summary)

- Removing or weakening any ownership, lock or role rule turns a named test red, locally and in CI.
- The suite leaves the shared database exactly as it found it, so smoke still passes after it.
- Someone adding a new table can follow §6.2 to write its rules test without this plan.
