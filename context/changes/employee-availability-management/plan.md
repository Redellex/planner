# Employee Availability Management Implementation Plan

## Overview

Roadmap S-01 (FR-001): every signed-in user can create, edit and delete their own dated availability windows for any future month that is not locked. A manager can lock and unlock a month ("start scheduling"). Once a month is locked, the database refuses every write to that month's windows. S-03 will later set the same lock when it generates a schedule. Postgres (RLS + constraints) enforces the rules, and the UI is server-rendered Astro forms following the existing form-POST → redirect convention.

## Current State Analysis

- F-01 phases 1–3 are implemented. `public.app_role`, `public.profiles`, the `public.is_manager()` SECURITY DEFINER helper and the `<table>_select_own` / `<table>_select_manager` policy pattern exist (`supabase/migrations/20260925120000_create_profiles_and_roles.sql:5-13`, `:43-59`, `:62-81`). F-01 Phase 4 (role smoke steps, CLAUDE.md docs) is still open.
- The middleware sets `locals.user` / `locals.role` and fails closed (`src/middleware.ts:15-31`). `PROTECTED_ROUTES = ["/dashboard"]` is matched with a raw `startsWith` (`src/middleware.ts:33`). `MANAGER_ROUTES` uses the segment-safe `matchesRoute` (`src/middleware.ts:6-10`, `:39-45`).
- There are no domain tables. Nothing models availability, a month or a lock (`context/changes/role-aware-access-control/plan.md:43`).
- API convention: a form POST, hand validation, `createClient` with null handling, RLS as the enforcement, `data.length === 0` meaning "not found or not permitted", then a redirect with `?error=` / `?updated=1` (`src/pages/api/manager/users/role.ts:11-39`). Pages build their own client and render `error`/`updated` banners (`src/pages/manager/users.astro:12-26`, `:34-48`).
- Navigation entries live in two places: `src/components/Topbar.astro:24-28` and `src/pages/dashboard.astro:22-29` (F-01 plan-review F3).
- Seed has only `manager@example.com` (`supabase/seed.sql:1-18`). The smoke script signs up a fresh user, who becomes an employee, and has no role steps (`scripts/smoke.mjs:39-60`).
- Types are generated into `src/db/database.types.ts` and committed. The strict type-checked lint rejects untyped rows.

## Desired End State

- `public.availability_windows` holds one row per window: `employee_id`, and `starts_at` / `ends_at` as **station-local wall-clock** `timestamp` values (Europe/Warsaw). A window lasts more than 0 and at most 24 hours, may cross midnight, and never overlaps another window of the same employee. A window belongs to the month of its `starts_at`.
- `public.availability_locks(month)`: a row means the month is locked. Managers insert (lock) and delete (unlock). Every signed-in user can read.
- RLS: a user reads their own windows and a manager reads all. A user inserts, updates and deletes only their own windows, and only when `public.is_availability_month_editable(month)` is true: the month is after the current station month and has no lock row.
- `/availability` (any signed-in user) lets the user:
  - pick one of the next 3 months;
  - see every day of that month with its windows;
  - add a window (date, start, end, with an optional "repeat every <weekday> this month" checkbox);
  - edit a window's times and delete a window.
  A locked month renders read-only with a "Locked — scheduling has started" notice.
- `/manager/months` (manager only) lists the next 3 months with their lock state and a Lock / Unlock button.
- Topbar and dashboard show "Availability" to every signed-in user and "Months" to managers.
- `supabase/seed.sql` also seeds `employee@example.com`. `npm run smoke` covers adding a window, overlap rejection, and a manager lock blocking writes and then unlocking.

**Verify:** after `npx supabase db reset`, `npm run lint`, `npx astro check`, `npm run build` and `npm run smoke` pass. Manual impersonation SQL and UI walkthroughs in each phase confirm the RLS and lock behaviour.

### Key Discoveries:

- `supabase/migrations/20260925120000_create_profiles_and_roles.sql:43-59` — reuse `is_manager()` for manager policies; do not inline subqueries on `profiles`.
- `supabase/migrations/20260925120000_create_profiles_and_roles.sql:87-88` — column-level update grant pattern to copy for `availability_windows`.
- `src/pages/api/manager/users/role.ts:28-36` — RLS is the enforcement, and a zero-row result means "not found or not permitted".
- `src/middleware.ts:8-10` — `matchesRoute` gives segment-safe matching. Reuse it for the new signed-in gate.
- `supabase/config.toml:60-65` + `.github/workflows/ci.yml` smoke job — CI applies migrations and the seed on every run.
- `prd.md:62` (lock rule), `:86` (visibility), `:104` (no time-off modelling), `roadmap.md:91` (keep the schema minimal).

## What We're NOT Doing

- No manager view of other employees' availability. That is S-02; this plan only adds the RLS that will allow it.
- No schedule generation, and no automatic lock on "generate". S-03 inserts into `availability_locks` itself.
- No explicit "submit month" state. Zero windows for a month means unavailable, and the rows are the only signal.
- No weekly template entity and no "copy previous month". Bulk entry is only the repeat-same-weekday checkbox.
- No editing a window's date. To move a window, delete it and add a new one. Edit changes the start/end times only.
- No manager entering or editing availability on another user's behalf.
- No sick leave / vacation modelling (PRD non-goal).
- No configurable timezone. Europe/Warsaw is a constant in SQL and TS.
- No cap on how far ahead a month may be written at the DB level. The UI offers only the next 3 months.
- No production migration pipeline (`supabase db push`). This is an open gap (Open Risks), and applying the migration to the hosted project stays a manual step.
- No test runner. Verification is lint/check/build, SQL impersonation and the HTTP smoke script.
- No completion of F-01 Phase 4. This plan adds its own smoke steps independently.

## Implementation Approach

Database first, because RLS, the constraints and the lock are the real boundary. Then the employee page and endpoints on top of it, then the manager lock UI that exercises the lock end-to-end, and finally smoke coverage and docs. Each phase leaves the app working:
- After Phase 1 nothing in the UI changes.
- After Phase 2 employees can manage availability, but no month can be locked except through SQL.
- After Phase 3 the full FR-001 loop works through the app.

Bulk "repeat weekday" entry is a single `.insert([...])` call, which is one SQL statement, so an overlap or lock on any date rejects the whole batch.

## Critical Implementation Details

- **Wall-clock timestamps, never `Date`.** `starts_at` / `ends_at` are `timestamp without time zone` holding Europe/Warsaw wall-clock time. PostgREST returns them as `"2026-10-03T19:00:00"`. Format and compare them as strings or calendar parts. Passing them through `new Date(...)` on a UTC Worker shifts them. The same applies when building insert values: send `"YYYY-MM-DDTHH:MM:00"` strings.
- **Station "now" lives in two places.** SQL uses `date_trunc('month', now() at time zone 'Europe/Warsaw')`, and TS uses `Intl.DateTimeFormat` with `timeZone: STATION_TIME_ZONE`. Both literals must stay `Europe/Warsaw`. Comment each one to point at the other.
- **Managers read everyone's windows.** `availability_windows_select_manager` returns all rows to a manager, so the `/availability` query must filter `.eq("employee_id", user.id)`. Otherwise a manager would see coworkers' windows as their own.
- **Update policy checks both rows.** `using` guards the old row's month and `with check` guards the new row's month. This covers a time edit that moves a window across a month boundary into a locked or past month. Policies compute the month from `starts_at` (`date_trunc('month', starts_at)::date`) rather than relying on a generated column.
- **`btree_gist` is required** for the exclusion constraint on `(employee_id with =, tsrange(starts_at, ends_at) with &&)`. Create it `with schema extensions`. Ranges are half-open `[)`, so back-to-back windows (…–07:00, 07:00–…) are allowed.
- **Lock race is accepted.** RLS reads the lock at statement time. A write that commits just before the lock row is inserted is kept. S-03 reads availability after locking, so this needs no extra locking.

## Phase 1: Availability schema and RLS

### Overview

Add the availability migration, seed an employee, and regenerate types. No app code changes in this phase.

### Changes Required:

#### 1. Availability migration

**File**: `supabase/migrations/20260926120000_create_availability.sql`

**Intent**: Introduce availability windows and the per-month lock as Postgres-enforced rules, so no crafted API call can write another user's windows, overlap windows, or change a past or locked month.

**Contract**:
- `create extension if not exists btree_gist with schema extensions;`
- `public.availability_locks`:
  - `month date primary key`, `locked_at timestamptz not null default now()`;
  - check `month = date_trunc('month', month)::date`;
  - RLS enabled, all policies `to authenticated`: `availability_locks_select_all` (select, `using (true)`), `availability_locks_insert_manager` (insert, `with check (public.is_manager())`), `availability_locks_delete_manager` (delete, `using (public.is_manager())`);
  - no update policy.
- `public.availability_windows`:
  - `id uuid primary key default gen_random_uuid()`;
  - `employee_id uuid not null default auth.uid() references public.profiles (id) on delete cascade`;
  - `starts_at timestamp not null`, `ends_at timestamp not null`;
  - `created_at timestamptz not null default now()`;
  - constraints:
    - `availability_windows_valid_range check (ends_at > starts_at and ends_at - starts_at <= interval '24 hours')`;
    - `availability_windows_no_overlap exclude using gist (employee_id with =, tsrange(starts_at, ends_at) with &&)`;
  - comment on the table stating that times are Europe/Warsaw wall-clock.
- `public.is_availability_month_editable(target_month date) returns boolean`:
  - `stable security definer set search_path = ''`;
  - true when `target_month > date_trunc('month', now() at time zone 'Europe/Warsaw')::date` and no `public.availability_locks` row has `month = target_month`;
  - `revoke execute … from public, anon`, `grant execute … to authenticated`.
- RLS on `availability_windows`, all policies `to authenticated`:
  - `availability_windows_select_own` (`employee_id = (select auth.uid())`);
  - `availability_windows_select_manager` (`public.is_manager()`);
  - `availability_windows_insert_own` (`with check` own id and editable month of `starts_at`);
  - `availability_windows_update_own` (`using` and `with check` both require own id and editable month of `starts_at`);
  - `availability_windows_delete_own` (`using` own id and editable month).
- Column privileges: `revoke update on public.availability_windows from authenticated, anon; grant update (starts_at, ends_at) on public.availability_windows to authenticated;`.

#### 2. Seeded employee

**File**: `supabase/seed.sql`

**Intent**: Give local dev and manual RLS checks a known employee without having to sign up.

**Contract**: append `employee@example.com` / `Employee-Passw0rd!` with id `00000000-0000-4000-8000-000000000002`, in the same GoTrue-shaped `auth.users` + `auth.identities` form as the manager. No role update is needed, because the signup trigger makes it `employee`. Update the header comment to list both accounts.

#### 3. Generated types

**File**: `src/db/database.types.ts`

**Intent**: Keep the new tables typed for the strict lint.

**Contract**: regenerate with `npx supabase gen types typescript --local > src/db/database.types.ts` after `db reset`, and commit the result.

### Success Criteria:

#### Automated Verification:

- `npx supabase db reset` applies both migrations and the seed without errors
- `npx supabase db lint` reports no errors for the `public` schema
- `src/db/database.types.ts` contains `availability_windows` and `availability_locks`, and `npx astro check` passes
- SQL constraint check via `docker exec -i supabase_db_planner psql -U postgres`, run as one `begin; … rollback;` block that inserts directly as `postgres` for the seeded employee: a 19:00→07:00 next-day window inserts; a 25h window and a zero-length window fail the check constraint; a window overlapping the first fails with `availability_windows_no_overlap`

#### Manual Verification:

- Employee impersonation (`begin; set local role authenticated; set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000002","role":"authenticated"}'; …; rollback;`):
  - an insert without `employee_id` for next month succeeds and defaults to their id;
  - an insert into the current month fails with an RLS violation;
  - an insert with the manager's `employee_id` fails;
  - a select returns only their own rows;
  - an update of `employee_id` is refused (column privilege).
- Lock check in one block: as `postgres`, insert an `availability_locks` row for next month. Then, impersonating the employee, an insert, an update and a delete in that month are all refused or affect 0 rows. An insert into the month after still succeeds.
- Manager impersonation (`sub` = `…0001`):
  - selects all windows;
  - can insert and delete an `availability_locks` row;
  - the employee cannot insert a lock row (RLS violation).

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Employee availability page

### Overview

Gate the new routes, add a small helper module, build `/availability` with three POST endpoints, and link to it from both nav locations.

### Changes Required:

#### 1. Middleware gate

**File**: `src/middleware.ts`

**Intent**: Require sign-in (any role) for the availability page and API. Also move the existing dashboard gate onto the segment-safe matcher so `/dashboard-foo` style paths no longer match.

**Contract**:
- `PROTECTED_ROUTES = ["/dashboard", "/availability", "/api/availability"]`, checked with `matchesRoute`.
- An anonymous request redirects to `/auth/signin`.
- `MANAGER_ROUTES` is unchanged.

#### 2. Availability helpers

**File**: `src/lib/availability.ts` (new)

**Intent**: Keep the station-time and window-shaping rules in one pure module, shared by the page and the endpoints.

**Contract**:
- `STATION_TIME_ZONE = "Europe/Warsaw"`, with a comment that the SQL helper in the migration must match.
- `currentStationMonth(): string` returns `YYYY-MM` via `Intl.DateTimeFormat`.
- `upcomingMonths(count = 3): string[]` returns the months after the current station month.
- `parseMonth(value: unknown): string | null` accepts `YYYY-MM`. `parseDate` accepts `YYYY-MM-DD`, and `parseTime` accepts `HH:MM` (00–23, 00–59).
- `monthStart(month)` returns `YYYY-MM-01`.
- `buildWindow(date, start, end): { starts_at: string; ends_at: string }` returns wall-clock strings. When `end <= start`, `ends_at` falls on the next calendar day, so `00:00`–`00:00` is a full 24h day.
- `sameWeekdayDatesInMonth(date): string[]` returns every date in that date's month with the same weekday.
- `daysInMonth(month): string[]`.
- `formatWindow(row)` returns `"19:00 – 07:00 (+1)"` style text.
- Calendar math uses `Date.UTC` on the date parts only, never local-time `Date` parsing.

#### 3. Availability page

**File**: `src/pages/availability.astro` (new)

**Intent**: The employee's single screen for FR-001. It works without JS and stays usable on a phone.

**Contract**:
- `?month=YYYY-MM` is clamped to `upcomingMonths()`, defaulting to the first entry. `?error=` / `?updated=1` banners follow `manager/users.astro`.
- Queries:
  - own windows: `.eq("employee_id", user.id)`, `starts_at` in `[monthStart, nextMonthStart)`, ordered by `starts_at`;
  - the lock row for that month from `availability_locks`.
- Renders:
  - month tabs as links, each marked "Locked" when a lock row exists;
  - an add form (`date` input limited to the month, `start` and `end` time inputs, and a `repeat` checkbox labelled "Repeat every <weekday> this month");
  - a list of every day in the month with its windows. Each window has an inline edit form (`id`, hidden `date`, `start`, `end`) and a delete form (`id`, `month`). Days with no windows show "—".
- When the month is locked, the forms are not rendered and a notice explains that scheduling has started.

#### 4. Availability endpoints

**Files**: `src/pages/api/availability/create.ts`, `src/pages/api/availability/update.ts`, `src/pages/api/availability/delete.ts` (new)

**Intent**: Follow the `role.ts` pattern. Validate the shape by hand, then let RLS and the constraints decide.

**Contract**:
- Every endpoint redirects to `/availability?month=<YYYY-MM>&updated=1` or `…&error=<msg>`. The month comes from the submitted `date`/`month`; an unparsable month redirects to `/availability?error=…`.
- `create`: fields `date`, `start`, `end`, optional `repeat`. It builds one window, or one per same-weekday date when `repeat` is set, and sends a single `.insert([...])` without `employee_id`.
- `update`: fields `id` (UUID), `date`, `start`, `end`. `.update({ starts_at, ends_at }).eq("id", id).select("id")`. Zero rows means "Not found, locked or not permitted".
- `delete`: fields `id`, `month`. `.delete().eq("id", id).select("id")`, with the same zero-row message.
- Error mapping by PostgREST `code`:

  | Code | Message |
  |---|---|
  | `23P01` | "Overlaps an existing window" |
  | `23514` | "Invalid window (must be at most 24h)" |
  | `42501` | "This month is locked or no longer editable" |
  | other | `error.message` |

- The null Supabase client is handled as in `role.ts`.

#### 5. Navigation

**Files**: `src/components/Topbar.astro`, `src/pages/dashboard.astro`

**Intent**: Make the page reachable for every signed-in user in both places links live.

**Contract**: an "Availability" link to `/availability` whenever `user` is set, styled like the existing links.

### Success Criteria:

#### Automated Verification:

- `npm run lint` passes
- `npx astro check` passes
- `npm run build` passes

#### Manual Verification:

- Anonymous `GET /availability` redirects to `/auth/signin`, and `/dashboard` still redirects when signed out
- As the seeded employee, a window is added on a date of next month:
  - 08:00–16:00 shows on its day;
  - 19:00–07:00 shows as "(+1)";
  - an overlapping add shows "Overlaps an existing window";
  - editing times works;
  - deleting works.
- With "repeat" checked, a Monday 06:00–14:00 add creates a window on every Monday of that month. If one of those Mondays already overlaps, nothing is inserted and the overlap error is shown.
- After locking next month via SQL (`insert into public.availability_locks (month) values ('<YYYY-MM>-01')`), `/availability` for that month is read-only with the notice. A replayed create/update/delete POST for that month returns the locked/not-permitted error. The following month is still editable.
- Signed in as the seeded manager, `/availability` shows only the manager's own windows, not the employee's
- Topbar and dashboard both show "Availability" for employee and manager

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Manager month lock

### Overview

Give managers an in-app "start scheduling" lock and unlock for upcoming months.

### Changes Required:

#### 1. Months page

**File**: `src/pages/manager/months.astro` (new)

**Intent**: A manager-only list of `upcomingMonths()` with each month's lock state and one action button.

**Contract**:
- Reads `availability_locks` for those months.
- Each row shows the month name, "Open" or "Locked since <locked_at>", and a form posting `month` plus `action=lock|unlock`.
- `?error=` / `?updated=1` banners.
- Gated by the existing `MANAGER_ROUTES`.

#### 2. Lock endpoint

**File**: `src/pages/api/manager/months/lock.ts` (new)

**Intent**: Toggle a month's lock through RLS-protected writes.

**Contract**:
- Fields `month` (`YYYY-MM`) and `action`.
- `lock`: `.upsert({ month: monthStart }, { onConflict: "month", ignoreDuplicates: true })`, so it is idempotent.
- `unlock`: `.delete().eq("month", monthStart)`, which is also idempotent. Zero rows is still success.
- Redirects to `/manager/months?updated=1` or `?error=`.

#### 3. Navigation

**Files**: `src/components/Topbar.astro`, `src/pages/dashboard.astro`

**Intent**: Surface the page to managers next to "Users".

**Contract**: a "Months" link to `/manager/months`, rendered only when `role === "manager"`, in both places.

### Success Criteria:

#### Automated Verification:

- `npm run lint` passes
- `npx astro check` passes
- `npm run build` passes

#### Manual Verification:

- As an employee, `/manager/months` returns the 403 page and no "Months" link is shown
- As the manager, locking next month shows "Locked since …". In a second browser session the employee's `/availability` for that month is then read-only. Unlocking makes it editable again, with the existing windows intact.
- Locking an already-locked month and unlocking an open month both succeed without error

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 4: Smoke coverage and docs

### Overview

Prove the availability flow and the lock over HTTP in CI, and document the new tables and conventions.

### Changes Required:

#### 1. Smoke script

**File**: `scripts/smoke.mjs`

**Intent**: Cover FR-001 end-to-end with the fresh smoke user (an employee) and the seeded manager, without leaving state that breaks later local runs.

**Contract**:
- The smoke month `M` is the current station month + 12, as `YYYY-MM`. It is far from the months used manually.
- The existing steps stay unchanged.
- Before "signout clears session", as the fresh user:
  - `GET /availability` → 200;
  - `POST /api/availability/create` (`date=M-01`, `start=08:00`, `end=16:00`) → 302 `/availability?month=M&updated=1`;
  - the same POST again → 302 `/availability?month=M&error=`.
- After the existing final step:
  - sign in as the manager (`SMOKE_MANAGER_EMAIL` / `SMOKE_MANAGER_PASSWORD`, defaulting to the seed credentials, which is the same convention F-01 Phase 4 plans) → 302 `/`;
  - `POST /api/manager/months/lock` (`month=M`, `action=lock`) → 302 `/manager/months?updated=1`;
  - `POST /api/availability/create` as the manager in `M` → 302 `/availability?month=M&error=`;
  - `POST /api/manager/months/lock` (`action=unlock`) → 302 `/manager/months?updated=1`;
  - sign out.
- If F-01 Phase 4 has already added a manager sign-in, reuse it instead of duplicating it.

#### 2. Docs

**File**: `CLAUDE.md`

**Intent**: Keep agent onboarding accurate.

**Contract**:
- Add an availability subsection under Architecture covering:
  - both tables and the lock semantics (a row means locked, and S-03 inserts it);
  - the `is_availability_month_editable` helper;
  - wall-clock Europe/Warsaw timestamps with the two-place constant;
  - `src/lib/availability.ts`;
  - routes `/availability`, `/api/availability/*`, `/manager/months`.
- In Environment, list the seeded `employee@example.com`.
- Mention the availability steps in the smoke description.
- Remove or adjust the line saying no custom tables exist, if it is still present.

### Success Criteria:

#### Automated Verification:

- `npm run smoke` passes against a freshly reset local Supabase (`npx supabase db reset`, then `npm run build && npm run preview`)
- `npm run smoke` passes a second time against the same database without a reset
- `npm run lint` and `npx astro check` pass
- CI `smoke` job passes on the branch

#### Manual Verification:

- `CLAUDE.md` accurately describes the availability model, the lock and the station timezone rule

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful.

---

## Testing Strategy

### Unit Tests:

- None. The repo has no test runner. The pure helpers in `src/lib/availability.ts` are exercised through the manual and smoke steps: overnight rule, 24h day, same-weekday expansion, month clamping.

### Integration Tests:

- SQL impersonation blocks (Phase 1) for RLS, constraints and the lock.
- HTTP smoke (Phase 4): create, overlap rejection, lock blocks writes, unlock.

### Manual Testing Steps:

1. As the seeded employee, add 19:00–07:00 on the last day of next month. It shows on that day as "(+1)" and belongs to that month.
2. Add a repeating Monday window and confirm every Monday gets one. Then try a repeating add that clashes on one date and confirm nothing is inserted.
3. As the manager, lock next month. Confirm the employee view is read-only and a replayed POST is refused. Unlock and confirm editing resumes.
4. As the manager, confirm `/availability` lists only the manager's own windows.

## Performance Considerations

Single-station scale (a handful of users, a few hundred rows per month). The exclusion constraint's GiST index also serves the per-employee range queries. No further indexing or caching is needed.

## Migration Notes

The new migration is additive and runs automatically in local `db reset` and CI. The hosted Supabase project has no documented migration path (the F-01 migration shares this gap). Applying both migrations to production is a manual step outside this plan (see the brief's Open Risks).

## References

- Research: `context/changes/employee-availability-management/research.md`
- PRD: `context/foundation/prd.md:62-63` (FR-001), `:86` (visibility NFR)
- Roadmap: `context/foundation/roadmap.md:81-92` (S-01)
- RLS / helper pattern: `supabase/migrations/20260925120000_create_profiles_and_roles.sql:43-88`
- API pattern: `src/pages/api/manager/users/role.ts:11-39`
- Page pattern: `src/pages/manager/users.astro:1-26`
- Middleware: `src/middleware.ts:5-45`
- F-01 plan and review: `context/changes/role-aware-access-control/plan.md`, `context/changes/role-aware-access-control/reviews/plan-review.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Availability schema and RLS

#### Automated

- [x] 1.1 `npx supabase db reset` applies both migrations and the seed without errors
- [x] 1.2 `npx supabase db lint` reports no errors for the `public` schema
- [x] 1.3 `src/db/database.types.ts` contains the new tables and `npx astro check` passes
- [x] 1.4 SQL constraint check: overnight window inserts; 25h, zero-length and overlapping windows fail

#### Manual

- [x] 1.5 Employee impersonation: own-row insert/select only, current month and foreign `employee_id` refused, `employee_id` not updatable
- [x] 1.6 Lock check: locked month refuses employee insert/update/delete; following month still writable
- [x] 1.7 Manager impersonation reads all windows and can lock/unlock; employee cannot insert a lock

### Phase 2: Employee availability page

#### Automated

- [ ] 2.1 `npm run lint` passes
- [ ] 2.2 `npx astro check` passes
- [ ] 2.3 `npm run build` passes

#### Manual

- [ ] 2.4 Anonymous `/availability` redirects to sign-in; `/dashboard` still gated
- [ ] 2.5 Employee adds, edits and deletes windows incl. overnight "(+1)" and overlap error
- [ ] 2.6 Repeat-weekday add creates all matching windows; a clash inserts nothing
- [ ] 2.7 SQL-locked month is read-only in the UI and replayed POSTs are refused; next month editable
- [ ] 2.8 Manager's `/availability` shows only the manager's own windows
- [ ] 2.9 "Availability" link shows in Topbar and dashboard for both roles

### Phase 3: Manager month lock

#### Automated

- [ ] 3.1 `npm run lint` passes
- [ ] 3.2 `npx astro check` passes
- [ ] 3.3 `npm run build` passes

#### Manual

- [ ] 3.4 Employee gets 403 on `/manager/months` and sees no "Months" link
- [ ] 3.5 Manager lock makes employee view read-only; unlock restores editing with windows intact
- [ ] 3.6 Repeated lock and unlock are idempotent without errors

### Phase 4: Smoke coverage and docs

#### Automated

- [ ] 4.1 `npm run smoke` passes against a freshly reset local Supabase
- [ ] 4.2 `npm run smoke` passes a second time without a reset
- [ ] 4.3 `npm run lint` and `npx astro check` pass
- [ ] 4.4 CI `smoke` job passes on the branch

#### Manual

- [ ] 4.5 `CLAUDE.md` accurately describes the availability model, lock and station timezone rule
