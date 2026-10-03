---
date: 2026-10-03T10:15:01+02:00
researcher: Claude (Opus 5.5) for Redellex
git_commit: e91a41e
branch: master
repository: Planner
topic: "Ground rollout Phase 2 of context/foundation/test-plan.md (database rules: ownership, lock, roles)"
tags: [research, test-plan, pgtap, rls, availability_windows, availability_locks, profiles]
status: complete
last_updated: 2026-10-03
last_updated_by: Claude (Opus 5.5)
---

# Research: Ground rollout Phase 2 — database rules for ownership, month lock and roles

**Date**: 2026-10-03T10:15:01+02:00
**Researcher**: Claude (Opus 5.5) for Redellex
**Git Commit**: e91a41e (working tree has uncommitted changes outside `supabase/` and `src/`; all cited source files are unchanged from that commit)
**Branch**: master
**Repository**: Planner

## Research Question

Ground §3 Phase 2 of `context/foundation/test-plan.md` ("Database rules: ownership, lock, roles", risks #2, #3 and the database half of #4): which rules in `supabase/migrations/` enforce each guarantee, what the app actually sends to the database, what each denied operation looks like (error vs. zero rows), what the oracle for each expected outcome is, and what the pgTAP / `supabase test db` harness and CI need.

## Summary

- **All enforcement for the three risks lives in 4 migrations** (`supabase/migrations/`, 304 lines total): RLS policies, column grants, the `availability_windows_valid_range` check, the `availability_windows_no_overlap` exclusion constraint, `is_availability_month_editable(date)` and the `prevent_last_manager_demotion` trigger. No endpoint sends an ownership field; window updates and deletes filter on `id` only (`update.ts:63-68`, `delete.ts:39`), so RLS is the only thing between a forged id and another employee's row. This makes the database layer the right place for these tests (test-plan §2 guidance for #2, #3).
- **Denials take two shapes, and tests must expect the right one per operation** (Postgres RLS semantics + the policies below): a failed `with check` on insert, or on the new row of an update whose old row passed `using`, raises **42501**; a failed `using` on update/delete **silently matches 0 rows**; a write to a column without a grant raises **42501** before RLS runs. Overlap raises **23P01**, an invalid range **23514**, the last-manager guard **P0001** with message `Cannot demote the last manager`. The app maps these codes in `describeWriteError` (`src/lib/availability.ts:296-308`) and the message in `describeRoleWriteError` (`src/lib/manager-users.ts:52-59`), so the codes are part of the app's contract, not just test detail.
- **No harness exists yet**: there is no `supabase/tests/` directory, CI (`.github/workflows/ci.yml`) has no `supabase test db` step, the Supabase CLI devDependency is `^2.117.0` (`package.json:57`, installed 2.117.0) while CI installs `version: latest` (`ci.yml:36-38`). The smoke job already starts the local stack (`ci.yml:40-42`), which is where test-plan §4 (line 89) says the rules tests should run.
- **The SQL "now" cannot be frozen**: `is_availability_month_editable` calls `now()` with `search_path = ''` (`20260926130000_create_availability.sql:36-49`), so tests must derive months relative to the station month computed in SQL (`date_trunc('month', now() at time zone 'Europe/Warsaw')`). The midnight/DST boundary of the SQL rule cannot be tested without changing the function; Phase 1 covered that boundary on the TS side only.
- **Oracles are available from sources for every intended assertion** except one: whether a current or past month may be locked has no decision (harmless — editability is already false there). See Open Questions.
- **Not observed on a running stack**: Docker was not running during research, so the outcomes for the `anon` role (which depend on Supabase's default table grants) are inferred from docs and migrations, not observed.

## Detailed Findings

### 1. Rules under test (the inventory)

**`public.availability_windows`** (`20260926130000_create_availability.sql:17-28`, hardened by `20260926140000_harden_availability_writes.sql`)

| Rule | Where | What it guarantees |
| --- | --- | --- |
| `employee_id default auth.uid()` | `…130000:19` | Inserts own the row without the client sending an id |
| Insert grant only on `(starts_at, ends_at)` | `…140000:38-39` | A client cannot set `employee_id`, `id`, `created_at` (archive F5) |
| Update grant only on `(starts_at, ends_at)` | `…130000:130-131` | A client cannot reassign `employee_id` |
| `availability_windows_valid_range` | `…130000:23-24` | `ends_at > starts_at` and length ≤ 24h |
| `availability_windows_no_overlap` | `…130000:26-27` | No overlapping windows per employee, half-open `[)` ranges |
| `availability_windows_select_own` | `…130000:81-85` | Own rows readable |
| `availability_windows_select_manager` | `…130000:87-91` | Manager reads all rows |
| `availability_windows_insert_own` (`with check`) | `…140000:6-12` | Own row, month of `starts_at` **and** month of `ends_at - 1µs` editable |
| `availability_windows_update_own` (`using` + `with check`) | `…140000:15-26` | Same predicate on old row (`using`) and new row (`with check`) |
| `availability_windows_delete_own` (`using`) | `…140000:28-34` | Same predicate on the row |
| No manager write policy | `…130000:126` | Manager cannot write others' windows |
| No `anon` policy | `…130000:127` | Anonymous gets nothing |

**`public.availability_locks`** (`…130000:8-12`, `:54-76`): `month date primary key` with check `month = date_trunc('month', month)::date` (first day only); select for all `authenticated` (`using (true)`); insert and delete only when `is_manager()`; no update policy ("unlock is a delete, relock is an insert", `:75`); no `anon` policy.

**`public.is_availability_month_editable(target_month date)`** (`…130000:36-52`): `security definer`, `stable`, `search_path = ''`; true when `target_month > date_trunc('month', now() at time zone 'Europe/Warsaw')::date` and no `availability_locks` row equals `target_month`. Execute revoked from `public, anon`, granted to `authenticated`.

**`public.profiles`** (`20260925120000_create_profiles_and_roles.sql`): select own (`:64-68`), select all for manager (`:70-74`), update only for manager in both `using` and `with check` (`:76-81`), no insert/delete policy (`:83`); update grant only on `role` (`:87-88`). `is_manager()` is `security definer` (`:43-59`). `prevent_last_manager_demotion` is a `before update of role` trigger that locks manager rows `for update`, then raises `Cannot demote the last manager` if no other manager exists (`:91-120`). `handle_new_user` creates an `employee` profile for every `auth.users` insert (`:18-33`, null email → `''` in `20260926120000_handle_new_user_null_email.sql:3-14`).

### 2. What the app sends (so tests mirror real write shapes)

- **Create** (`src/pages/api/availability/create.ts:30-44`): one multi-row `insert` of `{ starts_at, ends_at }` rows built by `buildWindow` (`src/lib/availability.ts:111-114`; `end <= start` rolls `ends_at` to the next day). No `employee_id`. With "repeat", the rows are every same-weekday date of that month (`sameWeekdayDatesInMonth`, `availability.ts:117-121`), all starting in the same month — so the only way a repeat reaches another month is an overnight window on the last such weekday spilling into month + 1. Because it is one statement, one refused row rejects the whole batch.
- **Update** (`update.ts:45-75`): reads the row's own `starts_at` under RLS (`maybeSingle`), rebuilds times on that date, then `update({ starts_at, ends_at }).eq("id", id).select("id")`. Zero rows → `NOT_FOUND_ERROR`; error → `describeWriteError`. Ownership is decided only by RLS (no `employee_id` filter). A manager passes the read step for someone else's window (select-manager policy) and then hits the zero-row branch.
- **Delete** (`delete.ts:38-46`): `delete().eq("id", id).select("id")`; zero rows → `NOT_FOUND_ERROR` (comment at `:38`: "a refused delete affects zero rows").
- **Lock / unlock** (`src/pages/api/manager/months/lock.ts:32-42`): `upsert({ month: "YYYY-MM-01" }, { onConflict: "month", ignoreDuplicates: true })` / `delete().eq("month", …)`, neither with `.select()`; a zero-row unlock is reported as success by design (`:33`). Any error is redirected as raw `error.message` (`:41-42`).
- **Role change** (`src/pages/api/manager/users/role.ts:32-39`): `update({ role }).eq("id", userId).select("id")`; zero rows → `USER_NOT_FOUND_ERROR`; the trigger's message is matched by text (`manager-users.ts:54-55`).

### 3. Expected outcome per scenario, with oracle source

Outcome shapes follow Postgres RLS semantics (insert/`with check` failure → 42501; `using` failure on update/delete → 0 rows; missing column privilege → 42501 before RLS). "Oracle" is the source that says the outcome is *required*, not the code that produces it.

**Risk #2 — ownership** (oracle: PRD NFR `prd.md:86` "visible only to that employee and the manager"; PRD Access Control `prd.md:98-99`; "No manager entering or editing availability on another user's behalf" `context/archive/2026-09-26-employee-availability-management/plan.md:50` and `context/archive/2026-09-29-manager-availability-visibility/plan.md:40`; test-plan §2 row #2)

| Actor → target | Operation | Expected |
| --- | --- | --- |
| Employee B → A's window | select | no rows |
| Employee B → A's window | update by id | 0 rows; A's row unchanged |
| Employee B → A's window | delete by id | 0 rows; A's row still exists |
| Employee B | insert with `employee_id = A` | 42501 (no insert grant on `employee_id`) |
| Employee A → own window | update `employee_id` | 42501 (no update grant on `employee_id`) |
| Manager → A's window | select | row visible |
| Manager → A's window | update / delete by id | 0 rows; A's row unchanged |
| Manager | own window in an open month | insert/update/delete succeed (managers submit their own availability, availability `plan-brief.md:25`) |
| Employee A → own window, open month | insert / select / update / delete | succeed (control case) |

**Risk #3 — month lock and editability** (oracle: PRD FR-001 `prd.md:62`; CLAUDE.md Availability; archive availability impl review F1 and its manual verification "Oct 31 00:00→Nov 1 00:00 still allowed", `context/archive/2026-09-26-employee-availability-management/reviews/impl-review.md:34-51`; migration intent comment `…140000:1-4`; test-plan §2 row #3)

Let M = current station month, M+1, M+2 … computed in SQL. "Locked" = an `availability_locks` row inserted inside the test transaction.

| Scenario | Expected |
| --- | --- |
| `is_availability_month_editable` for M−1, M | false |
| `is_availability_month_editable` for M+1 (unlocked) | true |
| `is_availability_month_editable` for locked M+k | false |
| Insert into M (current) or M−1 (past) | 42501 |
| Insert into locked M+k | 42501 |
| Insert into open M+k, unlocked | succeeds (control) |
| Overnight insert starting last day of open M+1, ending in locked M+2 | 42501 (spill rule) |
| Window ending exactly `M+2-01 00:00`, M+2 locked, M+1 open | succeeds (half-open; `ends_at - 1µs` is in M+1) |
| Update of own window in locked month (old row) | 0 rows; row unchanged |
| Update moving own window from open month into locked month (new row) | 42501; row unchanged |
| Update extending `ends_at` of an open-month window into a locked next month | 42501 |
| Delete of own window in locked month | 0 rows; row still exists |
| Delete of own window in open month | 1 row (control) |
| Multi-row insert (weekday repeat) whose last row spills into a locked month | 42501 and **no** rows from the batch inserted |
| Employee inserts an `availability_locks` row | 42501 |
| Employee deletes an `availability_locks` row | 0 rows; lock still exists |
| Employee / manager updates a lock row | 0 rows (no update policy) |
| Manager inserts and deletes a lock row | succeeds |
| Lock `month` not the first day | 23514 (`availability_locks_month_is_first_day`) |
| Employee selects `availability_locks` | allowed (`using (true)`; availability `plan.md:20`) |

Constraint edges (oracle: CLAUDE.md "longer than 0 and at most 24h", "half-open ranges, so back-to-back is fine"): exactly 24h succeeds; 24h + 1 min → 23514; zero length → 23514; overlap with own window → 23P01; back-to-back own windows succeed; overlapping windows of two *different* employees succeed (constraint is per employee).

**Risk #4 — roles, database half** (oracle: roadmap F-01 decision "the last Manager can never be demoted" `context/foundation/roadmap.md:75`; CLAUDE.md Auth flow "managers … update only the `role` column", "`prevent_last_manager_demotion` trigger rejects demoting the last manager"; test-plan §2 row #4)

| Actor → target | Operation | Expected |
| --- | --- | --- |
| Employee → own profile | `update role = 'manager'` | 0 rows; role still `employee` |
| Employee → other profile | `update role` | 0 rows; role unchanged |
| Employee | select profiles | own row only |
| Manager | select profiles | all rows |
| Manager → other employee | `update role = 'manager'` | 1 row (control) |
| Manager → any profile | `update email` | 42501 (no update grant on `email`) |
| Only manager → self or by another session | `update role = 'employee'` | P0001, message `Cannot demote the last manager`; role still `manager` |
| One of two managers | demote the other | succeeds (guard counts *other* managers, `…120000:104-111`) |
| Any authenticated | insert / delete a profile | refused (no insert/delete policy, `…120000:83`): insert 42501, delete 0 rows |

### 4. Test-data facts the plan must design around

- **Shared, non-empty database.** `supabase test db` runs against the local stack, which has `supabase/seed.sql` applied: one manager (`…0001`) and one employee (`…0002`) (`seed.sql:1-33`). Smoke runs leave windows on day 2 of station month + 3 and possibly a stale lock in station month + 12 (CLAUDE.md Commands; `scripts/smoke.mjs:30,37`). Consequences:
  - The last-manager test must first make its fixture manager the only manager inside the transaction (e.g. demote the seeded manager as `postgres` after promoting the fixture manager), because the guard counts every manager row.
  - "Open month" control cases must not assume a month is unlocked; delete any lock for that month as `postgres` inside the transaction (rolled back).
  - Use fixture users with their own UUIDs; overlap is per employee, so smoke windows do not collide with fixture windows.
  - Scope intactness checks to the target row id (Supabase guide: "a suite that asserts on everything a role can see breaks once the table holds more").
- **Creating users.** Inserting into `auth.users` (minimal `id, email` per the Supabase pgTAP guide) fires `handle_new_user`, so each fixture user gets an `employee` profile automatically; promote managers with an `update` as `postgres`.
- **Impersonation.** The project's established pattern (archive availability `plan.md:143-158`, role-aware `plan.md:128-131`) is `set local role authenticated; set local request.jwt.claims = '{"sub":"<id>","role":"authenticated"}'`. The Supabase guide shows `set local request.jwt.claim.sub = '<id>'`. Either reaches `auth.uid()` per the Supabase docs; pick one and use it consistently. Switching back to `postgres` for setup needs `reset role`.
- **Time.** `now()` is fixed per transaction, so one test file sees one station month. Months must be derived in SQL from `now() at time zone 'Europe/Warsaw'`. That literal in a test file is **not** covered by the zone guard: `src/lib/station-time-zone.test.ts:11-23` scans only `supabase/migrations/*.sql` and `scripts/smoke.mjs`. Test-plan §6.1 item 8 says to extend that guard if the zone is added in a new place.
- **Isolation.** Each file wraps in `begin; … rollback;`. The CLI runs `pg_prove` without `-j` (sequential), enables `pgtap` before the run and drops it afterwards if it was not already installed (Context7, supabase/cli `test-db.handler.ts`, `legacy-test-db.pg-prove-args.ts`).

### 5. Harness and CI

- **Command:** `supabase test db` runs pgTAP files (`.sql`/`.pg`) via `pg_prove`; `supabase test new <name>` creates a file under `supabase/tests/` (Context7, Supabase RLS testing guide). Exit code 1 on any failure and also when no tests are found (Context7, supabase/cli `commands/test/db/SIDE_EFFECTS.md`).
- **Local:** CLI 2.117.0 installed (`npx supabase --version`); a newer 2.119.0 exists. Needs Docker running and `npx supabase start`.
- **CI:** the `smoke` job already runs `supabase start` with most services excluded (`ci.yml:40-42`); `supabase test db` needs only the database, so a step after "Start local Supabase" fits test-plan §4 line 89 and §5 gate "required after §3 Phase 2". CI pins `supabase/setup-cli@v1` `version: latest` (`ci.yml:36-38`), not the devDependency version.
- **Tooling scope:** `lint-staged` and ESLint do not touch `.sql` files (`package.json:63-72`); Prettier's `*.{json,css,md}` glob does not include `.sql`.

## Code References

- `supabase/migrations/20260925120000_create_profiles_and_roles.sql:18-33` — `handle_new_user` signup trigger
- `supabase/migrations/20260925120000_create_profiles_and_roles.sql:43-59` — `is_manager()`
- `supabase/migrations/20260925120000_create_profiles_and_roles.sql:62-88` — profiles RLS + `role`-only update grant
- `supabase/migrations/20260925120000_create_profiles_and_roles.sql:91-120` — last-manager guard trigger
- `supabase/migrations/20260926130000_create_availability.sql:8-28` — lock and window tables, constraints
- `supabase/migrations/20260926130000_create_availability.sql:36-52` — `is_availability_month_editable`
- `supabase/migrations/20260926130000_create_availability.sql:54-131` — RLS policies and update grant
- `supabase/migrations/20260926140000_harden_availability_writes.sql:6-39` — spill rule and insert grant
- `supabase/seed.sql:1-33` — seeded manager/employee
- `src/pages/api/availability/create.ts:30-44` — multi-row insert
- `src/pages/api/availability/update.ts:45-75` — read-then-update by id, zero-row branch
- `src/pages/api/availability/delete.ts:38-46` — delete by id, zero-row branch
- `src/pages/api/manager/months/lock.ts:32-42` — idempotent lock/unlock
- `src/pages/api/manager/users/role.ts:32-39` — role update by id
- `src/lib/availability.ts:296-308` — `describeWriteError` code map (23P01, 23514, 42501)
- `src/lib/manager-users.ts:52-59` — last-manager message match
- `src/lib/station-time-zone.test.ts:11-23` — zone guard scope
- `.github/workflows/ci.yml:31-57` — smoke job with local Supabase

## Architecture Insights

- The project's stated design is "Postgres is the single source of truth for access control" (`…120000:1-2`, `…130000:1-2`); endpoints add no ownership filter. A database-layer test therefore covers the guarantee directly, and an endpoint test would only cover the mapping of codes to messages.
- The `42501` code means two different things to the user-facing mapper: an RLS `with check` refusal and a column-privilege refusal both become `MONTH_LOCKED_ERROR` (`availability.ts:303-304`). The app never writes a non-granted column, so this does not mislead users today; a test asserting only "42501" for a lock refusal would also pass if the refusal came from a grant. Pair lock-refusal tests with a control that the same write succeeds in an open month.
- `security definer` helpers (`is_manager`, `is_availability_month_editable`) read tables bypassing RLS; an employee's lock check therefore sees all lock rows regardless of the select policy.

## Historical Context (from prior changes)

- `context/archive/2026-09-26-employee-availability-management/reviews/impl-review.md:34-51` — F1: overnight window reached a locked month; fixed by `20260926140000_harden_availability_writes.sql`; verified by hand only. **Supported** (migration present). No automated test yet.
- same review `:63-71` — F3: `update.ts` trusted a client `date`; fixed in app code (reads `starts_at`). **Supported** (`update.ts:44-59`). Its DB-side backstop (old and new month checked) is untested.
- same review `:83-91` — F5: client could set `created_at`; fixed by the insert column grant. **Supported** (`…140000:36-39`).
- `context/archive/2026-09-26-employee-availability-management/reviews/impl-review-phase-4.md:52-60` — F2: update/delete had no automated coverage; smoke now covers the happy path only (`scripts/smoke.mjs:133-147`); smoke covers refusal for create into a locked month only (`smoke.mjs:194-198`). **Partial**: refusals for update/delete remain uncovered.
- `context/archive/2026-09-25-role-aware-access-control/reviews/impl-review.md:43-51` — F2: self-demotion redirect landed on 403. App routing, not a DB rule → Phase 3, not this phase.
- `context/archive/2026-09-25-role-aware-access-control/plan.md:44`, availability `plan.md:55`, visibility `plan.md:46`, testing-station-time `plan.md:24,52` — each deferred DB-rule tests; testing-station-time explicitly hands the SQL editability rule and the spill rule to this phase.
- Manual impersonation checklists that already state expected outcomes: availability `plan.md:143-158`, role-aware `plan.md:128-131`.

## Related Research

- `context/archive/2026-10-01-testing-station-time/research.md` — Phase 1; TS station-time helpers, defers SQL rules here (`:40-46`).

## Open Questions

1. **Locking a current or past month** — no decision exists; `lock.ts` accepts any `YYYY-MM` and the DB only enforces first-of-month. It changes nothing (editability is already false). Recommendation: do not assert either way; there is no oracle.
2. **"Upcoming month" (PRD FR-001, singular) vs. any future unlocked month** — the DB has no forward cap (availability `plan.md:53`; the 3-month limit is UI only). Tests should not assert a cap.
3. **CLI version for the CI step** — CI uses `latest`, the repo pins `^2.117.0`. A plan decision, not a product one.
4. **Concurrent last-manager demotion** — the trigger's `for update` lock is designed for it, but a single-session pgTAP file cannot exercise two transactions. Out of reach for this phase unless the plan adds a two-connection script.
5. **SQL midnight/DST boundary** — not testable while the function calls `now()` directly; accepted gap (TS side covered in Phase 1).
6. **`anon` outcomes** — inferred, not observed (stack was down). The first plan phase should probe them on the running stack before asserting exact codes.
7. **Out of scope here, noted for Phase 3**: `lock.ts` renders raw `error.message` and treats zero-row unlock as success; route-level gating of the lock and role endpoints.
