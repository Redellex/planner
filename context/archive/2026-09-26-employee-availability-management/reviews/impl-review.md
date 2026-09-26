<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Employee Availability Management

- **Plan**: context/changes/employee-availability-management/plan.md
- **Scope**: Phases 1–3 of 4 (completed phases; Phase 4 has 4.4 still unchecked)
- **Reviewed phases**: 1, 2, 3
- **Date**: 2026-09-26
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 6 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | PASS    |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | PASS    |
| Success Criteria    | PASS    |

## Success criteria evidence

- `npm run lint`: pass. `npx astro check`: 0 errors, 0 warnings, 0 hints. `npm run build`: pass.
- `npx supabase db lint --schema public`: no schema errors.
- SQL constraint block, run as `postgres` and rolled back: the overnight window inserts. The 25h and zero-length windows fail `availability_windows_valid_range`. An overlapping window fails `availability_windows_no_overlap`. As the impersonated employee, an insert into the current month fails RLS.
- PR #12 CI: `ci` passed, `smoke` passed, Workers Build passed (run 36237447766). This satisfies Phase 4 item 4.4, which is still `[ ]` in Progress.
- Manual items 1.5–1.7, 2.4–2.9 and 3.4–3.6 are ticked with phase SHAs. The diff has code for each one. The documented calendar-grid deviation (change.md) matches the code.
- Plan drift: every planned file is present and matches the plan. The only deviations are the two documented ones: the migration was renamed to `20260926130000_…`, and the calendar grid replaces the per-day list. There are no unplanned source files. The extra helpers in `src/lib/availability.ts` support the calendar grid or centralize contract behaviour.

## Findings

### F1 — An overnight window can reach into a locked month

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260926130000_create_availability.sql:90-127
- **Detail**: The insert, update and delete policies check only `date_trunc('month', starts_at)`. With 2026-11 locked and 2026-10 open, the employee could insert `2026-10-31 19:00 → 2026-11-01 07:00` (verified on the local stack, rolled back). A window starting on 2026-11-02 was refused. This means an employee can still add, change or delete availability for the early hours of 1 Nov after November is locked. `/manager/months` says "employees can no longer change their availability for it", so this breaks that promise. It is reachable because managers can lock months in any order.
- **Fix A ⭐ Recommended**: Add a migration so the insert and update `with check` policies and the update/delete `using` policies also require `is_availability_month_editable(date_trunc('month', ends_at - interval '1 microsecond')::date)`.
  - Strength: The database keeps the "locked means frozen" rule whatever order months are locked in. The fix stays in RLS, where every other rule lives.
  - Tradeoff: One new migration, and CLAUDE.md needs one line. A window that crosses into a locked month can no longer be added or edited, which is the intended behaviour.
  - Confidence: HIGH. It uses the same helper and the same expression pattern that the policies already use.
  - Blind spot: This has not been checked against how S-03 will assign spilled hours. S-03 still has to decide which month owns 00:00–07:00 on day 1.
- **Fix B**: Keep the schema. Document that a window belongs to its `starts_at` month, including the spilled hours, and that S-03 must read them that way.
  - Strength: No migration. It matches the rule "a window belongs to the month of its starts_at" that is already in CLAUDE.md.
  - Tradeoff: Employees can still change hours that fall on a locked month's first day. The "no longer change" wording on the months page stays inaccurate.
  - Confidence: MED. It depends on S-03 following a convention the database does not enforce.
  - Blind spot: How managers will actually order locks in practice.
- **Decision**: FIXED (Fix A). New migration `supabase/migrations/20260926140000_harden_availability_writes.sql` makes the insert, update and delete policies also check the month of `ends_at - 1µs`. The CLAUDE.md Availability section is updated. Verified after `db reset`: with Nov locked, a spill insert or update is refused, a delete of a spilled window affects 0 rows, Oct 31 00:00→Nov 1 00:00 is allowed, and generated types are unchanged.

### F2 — A spilled window is hidden on day 1 of the next month

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/availability.astro:49-55
- **Detail**: The page only fetches windows whose `starts_at` falls in the month. A window from 31 Oct 19:00 to 1 Nov 07:00 appears only on 31 Oct. In the November view, 1 Nov shows "— No windows", but adding 00:00–08:00 there fails with "Overlaps an existing window" and nothing on screen explains why.
- **Fix**: Also fetch windows with `starts_at < monthStart(month)` and `ends_at > monthStart(month)`, and show them read-only on day 1 marked "(from previous day)".
- **Decision**: FIXED. `availability.astro` now also fetches the user's own window that starts before the month and ends after its first instant (at most one). Day 1's cell shows it as `…–HH:MM` and counts it. Day 1's panel lists it read-only as `00:00 – HH:MM (from <day>)`. Verified with lint, prettier and astro check, and the filter was checked in SQL as the employee. It was not rendered over HTTP, because `.env`/`.dev.vars` point to the hosted project.

### F3 — The update endpoint trusts the client-sent `date`, so a window's date can be changed

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/availability/update.ts:16,39
- **Detail**: `update.ts` rebuilds `starts_at`/`ends_at` from the hidden `date` field. A crafted POST can move a window to any other date in an editable month. The plan says "No editing a window's date", but only the UI enforces that. RLS still checks that both the old and the new month are editable, and the overlap constraint still applies, so this is not a security hole. The plan's own contract specifies the hidden `date` field.
- **Fix**: Read the window's current `starts_at` (`.select("starts_at").eq("id", id).single()`, RLS limits it to the user's own rows) and build the new times from that date instead of the form field.
- **Decision**: FIXED. `update.ts` now reads the row's `starts_at` (`maybeSingle`, "Not found, locked or not permitted" when there is no row) and builds the new times on that date. The form `date` is only used for early-error redirects. Verified with lint, prettier and astro check.

### F4 — The page fails open when the lock query errors

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/availability.astro:64-70
- **Detail**: If the `availability_locks` select fails, `lockedMonths` stays empty and a locked month shows the add, edit and delete forms. Because of `error ??=`, an `?error=` already in the URL also hides the lock-query error. RLS still refuses the writes, so the only effect is on the UI.
- **Fix**: When `locksResult.error` is set, render the month read-only (fail closed), matching how the middleware handles roles.
- **Decision**: FIXED. A failed lock query now sets `lockStateUnknown`, which renders the month read-only with a notice that the lock state could not be checked. Verified with lint, prettier and astro check.

### F5 — Clients can set `created_at` on insert

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260926130000_create_availability.sql:128-131
- **Detail**: Update is limited to `starts_at` and `ends_at` by a column grant, but `authenticated` keeps table-level INSERT on every column. A direct PostgREST insert with `created_at = '2000-01-01'` succeeded (verified, rolled back). `employee_id` is safe because RLS pins it to `auth.uid()`. This only matters if `created_at` is later used for audit or a "submitted before lock" rule.
- **Fix**: In a migration, `revoke insert on public.availability_windows from authenticated, anon; grant insert (starts_at, ends_at) on public.availability_windows to authenticated;` (`employee_id` still takes its `auth.uid()` default).
- **Decision**: FIXED. `20260926140000_harden_availability_writes.sql` revokes table INSERT and grants `insert (starts_at, ends_at)` to `authenticated`. CLAUDE.md is updated. Verified through PostgREST with the employee JWT: a times-only bulk insert returns 201, and an insert that sets `created_at` returns 403 (42501).

### F6 — The wall-clock DST behaviour is not documented

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260926130000_create_availability.sql:24; src/lib/availability.ts:106
- **Detail**: The 24h cap and window lengths are measured in wall-clock time. On 2026-10-25, when DST ends, `00:00→00:00` is stored as 24h but is 25h of real time. Times that happen twice or don't exist on DST days are accepted. This is reasonable for availability, but S-03 needs to know that hour counts are wall-clock.
- **Fix**: Add one sentence to the CLAUDE.md Availability section: durations are wall-clock, so DST days are not corrected.
- **Decision**: FIXED. CLAUDE.md Availability section now says durations are wall-clock differences with no DST correction (00:00–00:00 counts as 24h on a DST day).

### F7 — Notes for S-03: cascade delete and indexing

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260926130000_create_availability.sql:19
- **Detail**: With `employee_id … on delete cascade`, deleting a user also drops their windows in locked months, which feed a schedule. There is no `starts_at` index for the manager-wide month queries that S-02 and S-03 will run; the GiST index is led by `employee_id`. Neither matters at MVP scale, but both become relevant once schedules are stored. The lock race is already accepted in the plan.
- **Fix**: Record both as notes on S-02/S-03 in `context/foundation/roadmap.md`, and revisit `on delete` behaviour and a `starts_at` index when S-03 is planned.
- **Decision**: FIXED. `context/foundation/roadmap.md` has "Handoff from S-01" notes: a `starts_at` index under S-02, and under S-03 the cascade delete, the index, the spill semantics and wall-clock durations.
