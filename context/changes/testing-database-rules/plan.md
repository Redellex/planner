# Database Rules: Ownership, Month Lock and Roles — Implementation Plan

## Overview

Rollout Phase 2 of `context/foundation/test-plan.md`, covering risks #2 (an employee reads, edits or deletes another employee's availability), #3 (an availability write reaches a locked, current or past month) and the database half of #4 (role escalation, last manager demoted). This plan adds pgTAP rules tests under `supabase/tests/database/`, run by `supabase test db` against the local stack, locally as `npm run test:db` and in the CI smoke job. Each test pins a guarantee to the outcome its oracle requires: an error code, or zero rows plus an intact target row. A manual sabotage pass then reverts each rule once and confirms that a test turns red. The test-plan cookbook and gates are filled in last.

## Current State Analysis

- **All enforcement lives in 4 migrations** (`supabase/migrations/`): RLS policies, column grants, `availability_windows_valid_range`, `availability_windows_no_overlap`, `is_availability_month_editable(date)` and the `prevent_last_manager_demotion` trigger (research §1). Endpoints send no ownership field. Window update and delete filter on `id` only (`src/pages/api/availability/update.ts:63-68`, `delete.ts:39`), so RLS alone stands between a forged id and another employee's row.
- **No rules tests exist.** There is no `supabase/tests/` directory and no `supabase test db` step in `.github/workflows/ci.yml`. Smoke covers the refusal of a create into a locked month only (`scripts/smoke.mjs:194-198`). The overnight spill rule (archive impl review F1) and the update/delete refusals (phase-4 review F2) have only been checked by hand.
- **Denials take two shapes** (research Summary): a failed `with check` on insert, or on the new row of an update, raises 42501, and so does a write to a column without a grant. A failed `using` on update or delete silently matches 0 rows. Overlap raises 23P01, an invalid range 23514, and the last-manager guard P0001 with `Cannot demote the last manager`. The app maps these codes and that message (`src/lib/availability.ts:296-308`, `src/lib/manager-users.ts:52-59`), so they are part of the contract.
- **Observed on the running stack (2026-10-03, CLI 2.117.0)**:
  - `supabase test db <path>` runs pg_prove 3.36 on this Windows machine, and pgTAP is available.
  - Both JWT-claim impersonation forms resolve `auth.uid()`.
  - `\gset` psql variables survive role switches.
  - A minimal `insert into auth.users (id, email)` fires `handle_new_user` and creates an `employee` profile.
  - `is_empty($$ update|delete … returning id $$)` works.
  - `throws_ok(…, 'P0001', 'Cannot demote the last manager', …)` works.
  - After rollback the database is unchanged.
  - The spill rule refuses with 42501, and a window ending exactly at 00:00 on the 1st is accepted.
- **Observed `anon` outcomes** (research open question 6, now closed):

  | `anon` action | Result |
  | --- | --- |
  | select on windows, profiles or locks | 0 rows |
  | insert a window | 42501 (no grant) |
  | insert a lock | 42501 (RLS: `anon` still holds table grants on `availability_locks`) |
  | update a role | 42501 (no grant) |
  | delete windows | 0 rows, no error |
  | call `is_availability_month_editable` | 42501 |

- **Shared, non-empty database.** `supabase/seed.sql` adds one manager (`…0001`) and one employee (`…0002`). Smoke runs leave windows in station month + 3 and may leave a stale lock in month + 12. The local DB currently also holds a lock for the current month (`2026-10-01`).
- **The SQL clock cannot be frozen**: `is_availability_month_editable` calls `now()` (`20260926130000_create_availability.sql:43`). Months must be derived in SQL from `now() at time zone 'Europe/Warsaw'`.

## Desired End State

- `npm run test:db` runs three pgTAP files against the local stack and exits non-zero on any failure. CI's smoke job runs it right after starting Supabase, on CLI 2.117.0.
- Every scenario in research §3 has a test with the outcome its oracle requires. Every refused write on an existing row is followed by a check, run as `postgres`, that the target row is unchanged. Every refusal is paired with a control showing the same kind of write succeeds in an open month or for the right actor.
- `src/lib/station-time-zone.test.ts` also checks the zone literal in `supabase/tests/database/*.sql`.
- The sabotage pass maps each guarded rule to the test that turned red when the rule was reverted. The mapping is recorded in test-plan §6.6.
- Test-plan §4, §5, §6.2 and §6.6 and CLAUDE.md describe the real harness.

Verify with `npm run test:db`, `npm test`, `npm run lint`, `npx astro check` and a green CI run.

### Key Discoveries:

- Insert and update grants cover only `(starts_at, ends_at)` (`20260926140000_harden_availability_writes.sql:38-39`, `20260926130000_create_availability.sql:130-131`). A forged `employee_id` is refused by both the grant and RLS, so only a `created_at` write (archive F5) shows whether the grant still holds on its own.
- `is_manager()` and `is_availability_month_editable()` are `security definer`, so lock checks see every lock row whatever the caller's select policy (`20260926130000_create_availability.sql:36-49`).
- The last-manager guard counts every manager row and fires for `postgres` too (`20260925120000_create_profiles_and_roles.sql:97-111`). The fixture manager must be made the only manager inside the transaction.
- A weekday repeat reaches another month only when an overnight window on the month's last same-weekday date spills into the next month. The app sends it as one multi-row insert (`src/pages/api/availability/create.ts:30-44`), so one refused row must reject the whole batch.
- pg_prove only picks up `.sql`/`.pg` files. With no tests found, `supabase test db` exits 1 (research §5).

## What We're NOT Doing

- **No concurrent last-manager test** (two sessions demoting the only two managers at once). A single-session pgTAP file cannot exercise it. The guard's `for update` lock is standard Postgres, and with one or two managers the likelihood is low. Accepted gap, recorded in §6.6.
- **No test of the SQL midnight/DST boundary.** `now()` cannot be frozen without changing the function. The TS side was covered in Phase 1.
- **No assertion on locking a current or past month.** No source decides it, and editability is already false there (research open question 1).
- **No forward cap on editable months.** The 3-month limit is UI only (research open question 2).
- **No structural pgTAP checks** (`policies_are`, `table_privs_are`). They mirror the implementation. The sabotage pass proves the tests catch regressions instead.
- **No endpoint or route tests**, and no fixes to `lock.ts` rendering raw `error.message` or treating a zero-row unlock as success. That is rollout Phase 3.
- **No production change** to migrations or app code. If a test exposes a real bug, stop and ask before fixing it.
- **No `supabase test db --linked`**: the tests run against the local stack only, never the hosted project.
- **No committed sabotage scripts and no dbdev/basejump test helpers.** Fixtures are inline per file.

## Implementation Approach

There are three test files, one per risk, each wrapped in `begin; select plan(n); … select * from finish(); rollback;`. Setup runs as `postgres`:
- derive the station months once with `\gset`;
- create fixture users with a minimal insert into `auth.users` and fixed UUIDs;
- promote fixture managers with a plain update;
- clear any lock on the months the file needs open;
- insert target windows directly with an explicit `employee_id`.

Each actor block switches with `set local role authenticated` + `set local request.jwt.claims = '{"sub":"<id>","role":"authenticated"}'`, or `set local role anon`. It returns to `postgres` with `reset role` for intactness checks. Write shapes mirror what the app sends (research §2). Expected outcomes come from the oracles in research §3, never from re-reading the policy text. CI is wired in Phase 1, so phases 2 and 3 land already gated.

## Critical Implementation Details

- **Derive months once, before any role switch.** Use one `select … \gset` at the top of each file, computing `m_prev`, `m_cur`, `m1`, `m2` (and more as needed) from `date_trunc('month', now() at time zone 'Europe/Warsaw')`. `now()` is fixed for the transaction, so every assertion sees the same station month. Pass the values into dynamic SQL with `format(…, :'m1')`; a psql variable is not expanded inside a `$$…$$` body.
- **Intactness checks run as `postgres`** (after `reset role`). Run as the denied actor, RLS would hide the row and the check would pass whether or not the row survived. Scope every check to the fixture row id or fixture user ids, never to "everything the role can see" (smoke data and the seed share the database).
- **Open months must be cleared, locked months set, inside the transaction.** Delete any `availability_locks` row for months used as "open" and insert the lock for months used as "locked", both as `postgres`. Never assume the local or CI state.
- **Fixture identity.** Use fixed UUIDs distinct from the seed (e.g. prefix `10000000-…`) and emails on a reserved domain (`@db-rules.test`). After a run, no row with that domain may remain.
- **Keep the weekday batch clear of other fixture windows.** In a multi-row insert, earlier rows are inserted before the spill row's policy check runs. If one of them overlaps another M+1 window of A, the statement fails with 23P01 instead of 42501. Place the other month-lock windows on dates or hours the batch cannot touch, or delete them before the batch.
- **Role-file ordering.** Run the promote/demote controls before the last-manager section, then demote every other manager (seed included) as `postgres` while the fixture manager stays manager. The guard allows each of those demotions because the fixture manager remains.

## Phase 1: Harness, Ownership Tests and CI Step

### Overview

Stand up the harness, prove risk #2 in `availability_ownership.test.sql`, extend the zone guard, and run the suite in CI on a pinned CLI.

### Changes Required:

#### 1. Script

**File**: `package.json`

**Intent**: One command for humans and CI to run the rules tests against the local stack.

**Contract**: `"test:db": "supabase test db"` in `scripts` (uses the devDependency binary).

#### 2. Ownership tests

**File**: `supabase/tests/database/availability_ownership.test.sql` (new)

**Intent**: Prove employee B gets no rows and no effect on A's window, and that a manager can read but not write others' windows. Every refused write leaves A's row intact. Oracles: PRD NFR `prd.md:86`, Access Control `prd.md:98-99`; "no manager editing on another user's behalf" (archived availability `plan.md:50`); archive impl review F5 for `created_at`.

**Contract**: Fixtures: employees A and B, manager Mg (promoted). A's target window sits in open month M+1, inserted as `postgres`. Scenarios and expected outcomes:

| Actor → target | Operation | Expected |
| --- | --- | --- |
| B → A's window | select by id | empty |
| B → A's window | update times by id | empty; A's row unchanged |
| B → A's window | delete by id | empty; A's row unchanged |
| B | insert with `employee_id = A` | 42501; A's window count unchanged |
| A → own window | update `employee_id` to B | 42501; row unchanged |
| A | insert own window setting `created_at` | 42501 |
| A → own window | update `created_at` | 42501; row unchanged |
| Mg → A's window | select by id | not empty |
| Mg → A's window | update / delete by id | empty; A's row unchanged |
| Mg | insert, update, delete own window in M+1 | succeed |
| A | insert own window in M+1 (no `employee_id` sent), select it, update times, delete | succeed; the inserted row's `employee_id` is A |
| `anon` → A's window | select / delete by id | empty; A's row unchanged |
| `anon` | insert a window / update times | 42501 |
| B | insert a window with exactly A's times | succeeds (overlap is per employee) |
| A | insert a window overlapping own | 23P01 |
| A | insert a window starting exactly at own window's end | succeeds (half-open) |

#### 3. Zone guard

**File**: `src/lib/station-time-zone.test.ts`

**Intent**: The new test files carry the `'Europe/Warsaw'` literal. Following cookbook §6.1 item 8, extend the existing guard instead of writing a new one.

**Contract**: A third entry in `sources` covering `supabase/tests/database/*.sql` with the `at time zone '…'` pattern; it requires at least one match, like the others.

#### 4. CI

**File**: `.github/workflows/ci.yml`

**Intent**: Run the rules tests on the clean seeded stack before smoke mutates it, and pin the CLI so local and CI use the same pg_prove image.

**Contract**: In the `smoke` job: `supabase/setup-cli@v1` `version: 2.117.0` (matching the devDependency); a new step `Database rules tests` running `supabase test db`, placed right after "Start local Supabase" and before "Configure secrets for build and preview".

### Success Criteria:

#### Automated Verification:

- `npm run test:db` passes with the ownership file only (all ownership scenarios green)
- `npm test` passes, including the extended zone guard
- `npm run lint` and `npx astro check` pass
- After the run, `select count(*) from auth.users where email like '%@db-rules.test'` returns 0 on the local DB

#### Manual Verification:

- The CI run for this phase shows the "Database rules tests" step green in the smoke job, with CLI 2.117.0 in the setup step log

**Implementation Note**: After automated verification passes, pause for confirmation of the CI run before Phase 2.

---

## Phase 2: Month Lock and Editability Tests

### Overview

Prove risk #3 in `availability_month_lock.test.sql`. Cover every write path into a current, past or locked month: create, update (old row and new row), delete, overnight spill and a weekday-repeat batch, each paired with an open-month control. Also cover who may write lock rows, and the window range constraint.

### Changes Required:

#### 1. Month-lock tests

**File**: `supabase/tests/database/availability_month_lock.test.sql` (new)

**Intent**: Pin the editability rule and the spill rule to their oracles: PRD FR-001 `prd.md:62`; CLAUDE.md Availability; archive impl review F1 and its manual check "Oct 31 00:00→Nov 1 00:00 still allowed"; migration intent `20260926140000_harden_availability_writes.sql:1-4`.

**Contract**: Fixtures: employee A, manager Mg. Setup clears locks on M+1 and M+3 and inserts a lock on M+2. Some target windows are inserted as `postgres` in M−1, M and M+2. Scenarios and expected outcomes:

| Scenario | Expected |
| --- | --- |
| `is_availability_month_editable` (as A) for M−1, M / M+1 / locked M+2 | false, false / true / false |
| A inserts into M−1 or M | 42501 |
| A inserts into locked M+2 | 42501 |
| A inserts into open M+1 or M+3 | succeeds (control) |
| A inserts overnight from last day of M+1 22:00 to M+2 day 1 02:00 | 42501 (spill) |
| A inserts last day of M+1 20:00 → M+2 day 1 00:00 | succeeds (half-open edge) |
| A updates own window in M or in locked M+2 | empty; row unchanged |
| A deletes own window in M or in locked M+2 | empty; row unchanged |
| A moves own M+1 window to a day in locked M+2 | 42501; row unchanged |
| A extends own window on last day of M+1 so `ends_at` falls in locked M+2 | 42501; row unchanged |
| A updates and deletes own window in M+1 | succeed (control) |
| A inserts a weekday-repeat batch: every M+1 date with the weekday of M+1's last day, each 22:00 → next day 02:00, as one multi-row statement | 42501; A has no rows from the batch afterwards |
| A selects `availability_locks` for M+2 | not empty |
| A inserts a lock / deletes the M+2 lock / updates the M+2 lock | 42501 / empty, lock remains / empty |
| Mg updates the M+2 lock | empty (no update policy) |
| Mg inserts and deletes a lock for M+3 | succeed |
| Mg inserts a lock for a non-first day | 23514 |
| A inserts a window of exactly 24h in M+1 | succeeds |
| A inserts a window of 24h + 1 min / zero length in M+1 | 23514 / 23514 |

The weekday-repeat dates are generated in SQL from M+1 (e.g. `generate_series` filtered by weekday), not hard-coded, so the file works in any station month.

### Success Criteria:

#### Automated Verification:

- `npm run test:db` passes with the ownership and month-lock files
- `npm test` passes (zone guard covers the new file)
- After the run, no `@db-rules.test` users remain and no lock row was added or removed outside the transaction (lock list before = after)

#### Manual Verification:

- CI smoke job's "Database rules tests" step is green for this phase

**Implementation Note**: Pause for confirmation of the CI run before Phase 3.

---

## Phase 3: Role Rule Tests

### Overview

Prove the database half of risk #4 in `profiles_roles.test.sql`: an employee cannot change any role, including their own; managers change only `role`; the last manager cannot be demoted by any path.

### Changes Required:

#### 1. Role tests

**File**: `supabase/tests/database/profiles_roles.test.sql` (new)

**Intent**: Pin role control to roadmap F-01 "the last Manager can never be demoted" (`context/foundation/roadmap.md:75`), CLAUDE.md Auth flow (managers update only `role`; the trigger rejects demoting the last manager) and test-plan §2 row #4.

**Contract**: Fixtures: employees E1, E2, E3 and manager M1 (promoted). Scenarios in this order, with expected outcomes:

| Actor → target | Operation | Expected |
| --- | --- | --- |
| E1 → own profile | `update role = 'manager'` | empty; role still `employee` |
| E1 → E2 | `update role = 'manager'` | empty; E2 unchanged |
| E1 | select fixture profiles | only E1's row |
| M1 | select fixture profiles | all four rows |
| M1 → E2 | `update email` | 42501; email unchanged |
| M1 → E3 | `update role = 'manager'` | not empty; E3 is manager (control) |
| M1 → E3 | `update role = 'employee'` | not empty; E3 is employee (one of two managers demotes the other) |
| `anon` | select fixture profiles / `update role` | empty / 42501 |
| E1 | insert a profile / delete own profile | 42501 / empty, row remains |
| `postgres` setup | demote every manager except M1 (seed included) | — |
| M1 → own profile | `update role = 'employee'` | P0001 `Cannot demote the last manager`; still manager |
| `postgres` → M1 | `update role = 'employee'` | P0001 `Cannot demote the last manager`; still manager |

### Success Criteria:

#### Automated Verification:

- `npm run test:db` passes with all three files
- After the run, the local DB still has exactly the managers it had before (seed manager `…0001` is still `manager`) and no `@db-rules.test` users

#### Manual Verification:

- CI smoke job's "Database rules tests" step is green, and the smoke step after it still passes (the seeded manager was not demoted)

**Implementation Note**: Pause for confirmation of the CI run before Phase 4.

---

## Phase 4: Sabotage Pass and Cookbook

### Overview

Show that each test would catch its regression, then record the harness, the results and the accepted gaps in the test plan and CLAUDE.md.

### Changes Required:

#### 1. Sabotage pass (manual, scratchpad only)

**Intent**: The SQL counterpart of the Phase 1 Stryker step. Apply one rule reversal at a time as `postgres` from a scratch script (never committed), run `npm run test:db`, record which test went red, then restore with `npx supabase db reset` (which wipes local smoke data; the seed is re-applied).

**Contract**: At minimum these reversals, each expected to turn the named test red:

| Reversal | Expected red test |
| --- | --- |
| Insert/update/delete policies back to the `starts_at`-only form (pre-`20260926140000`) | spill insert, extend-into-locked update, weekday batch |
| `grant insert, update on availability_windows to authenticated` (whole table) | `created_at` insert and update |
| `select_own` policy `using (true)` | B select of A's window |
| A manager `for update`/`for delete` policy on windows using `is_manager()` | manager update/delete of A's window |
| `is_availability_month_editable` compares `>=` instead of `>` | insert into current month M |
| Update policy `with check` reduced to the ownership clause | move into locked month |
| Drop `availability_windows_no_overlap` | own-overlap 23P01 |
| Drop trigger `prevent_last_manager_demotion` | both last-manager tests |
| `grant update on profiles to authenticated` (whole table) | manager `email` update |
| `profiles_update_manager` without `is_manager()` | employee self-promotion |

A reversal that leaves every test green either gets a new assertion that kills it, or is recorded as covered by a second layer, with the reason (e.g. a forged `employee_id` is refused by both the grant and RLS).

#### 2. Test plan

**File**: `context/foundation/test-plan.md`

**Intent**: Turn the planned database-rules layer into the documented, wired one.

**Contract**:
- §4: the "Test base today" line, and the database rules row with version 2.117.0, `supabase/tests/database/`, `npm run test:db`, and a `checked:` date.
- §5: the database rules gate becomes `required (wired)`.
- §6.2: the cookbook, covering:
  - file skeleton and naming;
  - month derivation with `\gset`;
  - fixture users;
  - impersonation and `reset role`;
  - "refused write leaves the row intact" checked as `postgres`;
  - choosing a code assertion vs `is_empty` per operation;
  - the open-month control pairing;
  - when a new table needs a file;
  - running the sabotage check.
- §6.6: a Phase 2 entry with test counts, the sabotage table with results, and the accepted gaps (concurrent demotion, SQL midnight/DST, locking a current or past month).

#### 3. CLAUDE.md

**File**: `CLAUDE.md`

**Intent**: Keep the command list and CI description true.

**Contract**:
- Commands: add `npm run test:db` (needs the local stack; files in `supabase/tests/database/`; transactional, leaves no data).
- Drop "there are no database rules tests yet" from the smoke entry.
- The CI bullet mentions the rules step in the smoke job and the pinned CLI.

### Success Criteria:

#### Automated Verification:

- `npm run test:db` passes after the final `db reset` (sabotage fully reverted)
- `npm test`, `npm run lint`, `npx astro check` pass
- `npx prettier --check context/foundation/test-plan.md CLAUDE.md` passes

#### Manual Verification:

- Every reversal in the sabotage table turned at least one test red, or is recorded in §6.6 as covered by a second layer, with the reason
- §6.2 is enough for someone else to add a rules test for a new table without reading this plan

---

## Testing Strategy

### Database rules tests (pgTAP):

- Three files, one per risk, each transactional and rolled back; ~60 assertions in total.
- Every refusal is paired with an allow control on the same kind of write, so a 42501 from an unrelated cause (e.g. a grant) cannot pass for a lock refusal unnoticed.
- Every refused write on an existing row is followed by an intactness check as `postgres`.

### Unit tests:

- Only the extended zone guard; no new TS logic.

### Manual Testing Steps:

1. Run `npm run test:db` twice in a row locally; both runs pass and the DB is unchanged between them.
2. Run `npm run smoke` against `npm run dev` after `npm run test:db`; smoke still passes (the rules tests left no locks, users or demoted managers).
3. Execute the Phase 4 sabotage table and record the results.

## Performance Considerations

None. The suite runs in under a second locally. In CI it adds the pg_prove image pull (one-off per run) to the smoke job.

## Migration Notes

None. No schema change, and no change to `src/db/database.types.ts`.

## References

- Research: `context/changes/testing-database-rules/research.md`
- Test plan: `context/foundation/test-plan.md` §2 rows #2–#4, §3 Phase 2, §4, §5, §6.1 item 8
- Rules: `supabase/migrations/20260925120000_create_profiles_and_roles.sql`, `20260926130000_create_availability.sql`, `20260926140000_harden_availability_writes.sql`
- Prior manual checklists: `context/archive/2026-09-26-employee-availability-management/plan.md:143-158`, `context/archive/2026-09-25-role-aware-access-control/plan.md:128-131`
- Previous phase: `context/archive/2026-10-01-testing-station-time/plan.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Harness, Ownership Tests and CI Step

#### Automated

- [x] 1.1 `npm run test:db` passes with the ownership file only (all ownership scenarios green) — f5391c3
- [x] 1.2 `npm test` passes, including the extended zone guard — f5391c3
- [x] 1.3 `npm run lint` and `npx astro check` pass — f5391c3
- [x] 1.4 After the run, `select count(*) from auth.users where email like '%@db-rules.test'` returns 0 on the local DB — f5391c3

#### Manual

- [ ] 1.5 The CI run for this phase shows the "Database rules tests" step green in the smoke job, with CLI 2.117.0 in the setup step log

### Phase 2: Month Lock and Editability Tests

#### Automated

- [x] 2.1 `npm run test:db` passes with the ownership and month-lock files — de45257
- [x] 2.2 `npm test` passes (zone guard covers the new file) — de45257
- [x] 2.3 After the run, no `@db-rules.test` users remain and no lock row was added or removed outside the transaction (lock list before = after) — de45257

#### Manual

- [ ] 2.4 CI smoke job's "Database rules tests" step is green for this phase

### Phase 3: Role Rule Tests

#### Automated

- [x] 3.1 `npm run test:db` passes with all three files
- [x] 3.2 After the run, the local DB still has exactly the managers it had before (seed manager `…0001` is still `manager`) and no `@db-rules.test` users

#### Manual

- [ ] 3.3 CI smoke job's "Database rules tests" step is green, and the smoke step after it still passes (the seeded manager was not demoted)

### Phase 4: Sabotage Pass and Cookbook

#### Automated

- [ ] 4.1 `npm run test:db` passes after the final `db reset` (sabotage fully reverted)
- [ ] 4.2 `npm test`, `npm run lint`, `npx astro check` pass
- [ ] 4.3 `npx prettier --check context/foundation/test-plan.md CLAUDE.md` passes

#### Manual

- [ ] 4.4 Every reversal in the sabotage table turned at least one test red, or is recorded in §6.6 as covered by a second layer, with the reason
- [ ] 4.5 §6.2 is enough for someone else to add a rules test for a new table without reading this plan
