---
date: 2026-10-07T19:34:19+02:00
researcher: Claude (Opus 5.5) for Redellex
git_commit: 77ca5ef67b3934d53ebd9ede650482986e998be0
branch: master
repository: Planner
topic: "S-05: what a read-only published-schedule grid for employees and managers needs on top of S-04"
tags: [research, schedule, schedule_shifts, schedules, profiles, rls, security-definer, route-access, schedule-calendar, s-05]
status: complete
last_updated: 2026-10-07
last_updated_by: Claude (Opus 5.5)
---

# Research: S-05 view published schedule

**Date**: 2026-10-07T19:34:19+02:00
**Researcher**: Claude (Opus 5.5) for Redellex
**Git Commit**: 77ca5ef67b3934d53ebd9ede650482986e998be0 (working tree: only this change folder is new)
**Branch**: master
**Repository**: Planner

## Research Question

Roadmap S-05 (`context/foundation/roadmap.md:153-168`, issue #6): "Employee and Manager can view the published schedule as a simple visual grid of who works when" (FR-007, `context/foundation/prd.md:79`). Employees see everyone's shifts (`prd.md:110`), drafts stay manager-only (`prd.md:80`), and availability stays visible only to its owner and the manager (`prd.md:92`). What do the database, libraries and UI give S-05 today, what must it add, and which decisions are still open?

## Summary

- **Employees can read no schedule data today.** Both select policies are manager-only: `schedules_select_manager` and `schedule_shifts_select_manager` (`supabase/migrations/20261006120000_create_schedules.sql:53-57`, `:74-78`). pgTAP pins this for a draft (`supabase/tests/database/schedules.test.sql:95-104`). No test covers employee reads of a *published* month or of a month after unpublish.
- **Employees can read only their own `profiles` row** (`20260925120000_create_profiles_and_roles.sql:64-74`). `profiles` has `id`, `email`, `role` and `created_at` and no display-name column (`:8-13`). The app name for a calendar cell is `calendarName`: the email before `@`, else the email, else the id's first 8 characters (`src/lib/manager-users.ts:85-89`).
- **Earlier decisions:**
  - F-01 decided that S-05 adds a narrow read path for names instead of widening `profiles_select_*` (`context/archive/2026-09-25-role-aware-access-control/plan.md:45`).
  - S-04 handed the employee read path and names to S-05 (`context/archive/2026-10-06-review-override-publish-schedule/plan.md:62`, `plan-brief.md:45,66`).
- **Recommended read path.** One SECURITY DEFINER RPC, e.g. `get_published_schedule(target_month)`, that returns the month's shifts plus a derived assignee name, and only while `published_at is not null`. It fits the existing pattern (`set search_path = ''`, execute revoked from `public, anon`, granted to `authenticated`; `20261007120000_publish_and_override_schedules.sql:126-176`). Reasons:
  - It reads the `schedules` row and the shifts in one statement, so one snapshot. An unpublish or regenerate cannot be seen half-applied.
  - It needs no new table policy and no `profiles` exposure.
  - It returns no availability.
  - The alternative is two new select policies. It works without recursion and leaves writes unaffected, but it still leaves names unresolved and needs two reads (see Detailed Findings §1).
- **UI reuse.**
  - `ScheduleCalendar.astro` can take data from a non-manager read, but every cell links to `managerScheduleUrl` (`src/components/schedule/ScheduleCalendar.astro:89`). It needs an `hrefFor`-style prop, which `MonthTabs` already has.
  - `ScheduleDayPanel.astro` renders read-only rows when `editable` is false. Its day-1 previous-night line says "draft" (`ScheduleDayPanel.astro:116-122`).
  - `loadScheduleInputs` must not back the employee page: it reads all profiles and availability windows (`src/lib/schedule.ts:279-373`). Under employee RLS those reads return a silently partial list, not "unknown".
- **Routing.**
  - A new signed-in page, e.g. `/schedule`, must be added to `PROTECTED_ROUTES` (`src/lib/route-access.ts:5`). It also needs an `EXPECTED_ACCESS` row (`src/lib/route-inventory.test.ts:15-44`).
  - There is no shared nav. The legacy dashboard links pages per role (`src/pages/dashboard.astro:27,59`).
- **Tests expected by the test plan.**
  - New pgTAP asserts in `schedules.test.sql` (`context/foundation/test-plan.md:142`). They must show: an employee reads a published month, does not read a draft, and stops reading once the month is unpublished; anon is refused; no email, role or availability leaks.
  - The route inventory row.
  - A `loadAllPages`/ready-unknown read (§6.4).
  - Smoke never publishes successfully (`scripts/smoke.mjs:55-56`). The cheap smoke addition is "the employee view does not show the smoke draft".
- **Open product choices:**
  - Which name employees see: the email prefix, which partly exposes emails, or a new name column.
  - Which months to offer.
  - Whether managers use the new page or keep `/manager/schedule`.
  - How to show M−1's last night on day 1.

## Detailed Findings

### 1. Database: current access and read-path options

**Current policies and grants (all policies `to authenticated`; no `anon` policy on either table)**

- `schedules`:
  - Select is `is_manager()` (`20261006120000_create_schedules.sql:53-57`).
  - Insert is `is_manager()` (`:59-63`).
  - Delete is `is_manager() and published_at is null` (`20261007120000_publish_and_override_schedules.sql:18-24`).
  - It has no update policy. `published_at`/`published_by` (`20261007120000:8-10`) are written only by `publish_schedule`/`unpublish_schedule` (`:126-205`).
- `schedule_shifts`:
  - Select is `is_manager()` (`20261006120000:74-78`).
  - Insert, delete and update require `is_manager()` plus an `exists` on an unpublished `schedules` row (`20261007120000:28-82`).
- Grants:
  - Insert is column-granted (`20261006120000:96-100`).
  - Table UPDATE is revoked from `authenticated, anon` (`20261006140000_revoke_schedule_updates.sql:5-6`). Only `update (employee_id)` on `schedule_shifts` is granted (`20261007120000:86`).
  - Anon's remaining select privilege is inferred from Supabase defaults and was not checked live. RLS returns no rows to anon (`schedules.test.sql:341-345`).
- The `schedule_shifts_published_guard` trigger function (SECURITY DEFINER, `20261007130000_guard_published_schedule_shifts.sql:11-55`) fires only on writes. It takes `FOR SHARE` on the `schedules` row, while `publish_schedule` takes `FOR UPDATE` (`20261007120000:140-144`). Neither affects plain reads.

**SECURITY DEFINER functions in migrations (6 inspected, all with `set search_path = ''`)**

| Function | Defined at | Execute |
|---|---|---|
| `handle_new_user` | `20260925120000:18-29`, `20260926120000:3-14` | trigger |
| `is_manager` | `20260925120000:43-59` | revoked from public, anon; granted to authenticated |
| `is_availability_month_editable` | `20260926130000_create_availability.sql:36-52` | revoked from public, anon; granted to authenticated |
| `publish_schedule` | `20261007120000:126-176` | revoked from public, anon; granted to authenticated |
| `unpublish_schedule` | `20261007120000:179-205` | revoked from public, anon; granted to authenticated |
| `guard_published_schedule_shift` | `20261007130000:11-51` | revoked from public, anon, authenticated |

No function or view exposes another user's name or email today.

**Option A: published-read select policies**

- The policies would be `schedules ... using (published_at is not null)` and `schedule_shifts ... using (exists (select 1 from public.schedules s where s.month = schedule_shifts.month and s.published_at is not null))`.
- The `exists` subquery runs under `schedules` RLS, so the `schedules` policy is required too (S-04 research, `context/archive/2026-10-06-review-override-publish-schedule/research.md:104-110`).
- There is no recursion, because no `schedules` policy references `schedule_shifts`.
- Permissive policies are OR'd, so managers are unchanged.
- An employee still has no insert, update or delete policy. Their writes keep matching 0 rows or failing the check, so the existing write tests (`schedules.test.sql:95-127`) are unaffected.
- **Gaps:**
  - Names do not resolve, because embedded `profiles` rows of other users are null under `profiles_select_own`.
  - Reading the `schedules` row and then the shifts takes two PostgREST requests. They can straddle an unpublish, which would show a published header over shifts that are no longer visible, or the reverse.

**Option B (recommended): SECURITY DEFINER RPC**

- Shape: `get_published_schedule(target_month date) returns table (id, starts_at, ends_at, employee_id, assignee_name)`, `stable`, `set search_path = ''`, execute revoked from `public, anon` and granted to `authenticated`.
- Behaviour:
  - It filters `published_at is not null` and joins `profiles` for a derived name only (no email, no role).
  - Uncovered shifts (`employee_id` null, including those from deleted accounts via `on delete set null`) come back with a null name. The roadmap asks the grid to show them (`roadmap.md:166`).
  - It can also return `published_at` for the header.
- Like option A, it does not by itself distinguish "draft or no schedule" from "published with zero shifts". A published month always has a shift on every station day at publish time (`20261007120000:155-163`), so an empty result means not published. A separate `published_at` column or row resolves it explicitly.
- `assignee_name` would have to repeat `calendarName`'s rule in SQL (`manager-users.ts:85-89`): `position('@' in email) > 1`, else email, else `left(id::text, 8)`. Otherwise it would return `email` to the app, which exposes every colleague's full address. Repeating the rule twice is a drift risk. A unit or pgTAP test could pin the SQL side to the same fixtures as `manager-users.test.ts:7-14`.
- Typing: `src/db/database.types.ts:194-206` lists `Functions` as `{ Args; Returns }`. A `returns table` RPC regenerates as `Returns: {…}[]` after `npx supabase gen types typescript --local`.
- Paging: `loadAllPages` (`src/lib/team-availability.ts:24`) pages with `range()` and `count: "exact"` and needs an `id` tiebreak. A month has at most 31 × 4 = 124 shifts (6×4 pattern every day), well under `max_rows = 1000` (`supabase/config.toml:18`) and `SCHEDULE_PAGE_SIZE = 1000` (`src/lib/schedule.ts:270`). Whether supabase-js `rpc(..., { count: "exact" })` with `.range()` works on a set-returning function was not verified. `/10x-plan` should confirm it in the docs or keep a single read and treat an error as unknown.

**Option C: a view.** An owner-rights view bypasses base-table RLS. Supabase's linter flags this as `security_definer_view`, and the view cannot take a month parameter. A `security_invoker` view (Postgres 17 here, `supabase/config.toml:36`) brings back the `profiles` RLS gap. Not recommended.

**Unpublish.** `unpublish_schedule` sets `published_at` back to null (`20261007120000:179-205`). Once that commits, both option A and option B hide the month from any later read. A page already rendered in a browser keeps showing the old data until reload. That is inherent to SSR and fine for MVP.

### 2. UI: what can be reused

- **`src/components/schedule/ScheduleCalendar.astro`** (props `:9-23`):
  - Props: `month`, `weeks`, `selectedDay`, `shiftsByDay` (`Map<day, {starts_at, ends_at, employee_id}[]>`), `members` (`Map<id, {id, email}>`), `uncoveredCount`, `daysWithNoOne`, `outsideAvailability`.
  - From `lg`, each cell lists hours plus `calendarName` (`:31-34`, `:149`). Uncovered is `text-destructive` (`:139`, `:147`), and a cell's `title` shows the full email (`:136`).
  - Manager-specific for a viewer:
    - The `managerScheduleUrl` link (`:89`).
    - `members` keyed on `{id, email}`. A viewer with only names needs a name map, or a `nameFor`-style prop.
    - `outsideAvailability`, which needs windows. Pass `[]`.
    - The "No one is assigned" alert (`:42`).
  - `daysWithNoOne(month, shifts)` needs no team or windows (`src/lib/schedule-summary.ts:263-265`).
- **`ScheduleDayPanel.astro`:**
  - With `editable` false it renders read-only rows: times, duration, the full email via `accountLabel` (`:7`) or an Uncovered marker, and `data-shift-id` (`:219-234`).
  - A viewer must not show the full email, so the label needs a name-based variant.
  - The day-1 line "(from <month>'s draft)" (`:116-122`) is wrong for a published view.
  - Override forms, `AssigneeSelect` and the confirm panel appear only when `editable`.
- **Manager-only, not reusable:** `AssigneeSelect.tsx`, `ScheduleActions.astro` (publish/regenerate/discard/unpublish), `ScheduleSummary.astro` (fairness and hard rules from windows).
- **Published header to mirror:** `ScheduleActions.astro:41-46,64` ("Published — <month>", `formatStationInstant(publishedAt)`, `data-schedule-published`).
- **`MonthTabs.astro`** (`src/components/availability/MonthTabs.astro:6-14`): props `months`, `current`, `lockedMonths`, `hrefFor?`. An empty set hides "(Locked)".
- **No shared grid component.** `ScheduleCalendar` and `TeamCalendar` each repeat the weekday headers and `grid-cols-7` markup (`ScheduleCalendar.astro:36,64-69`; `src/components/team-availability/TeamCalendar.astro:31,50-55`). Both use `calendarWeeks` (`src/lib/availability.ts:163`).
- **Helpers in `src/lib/schedule.ts`:**
  - `stationDayOf` (`:378`) and `shiftsByStationDay` (`:383`) put the 00:00–06:00 shift on M+1 day 1 onto M's last day.
  - That shift is stored with `month = M` (`schedule_shifts_month_matches_station_day`), so a read filtered by `month = M` includes it.
  - `ScheduleShiftRow` (`:208`), `SCHEDULE_LOAD_ERROR` (`:42`) and `logScheduleError` (`:92`) are also available.
  - `managerScheduleUrl` (`:151`) is hard-wired to `/manager/schedule`, so a viewer needs its own URL builder.
- **`loadScheduleInputs` (`src/lib/schedule.ts:279-373`) reads:** all profiles (`:283`), month windows, carry-overs, M+1 night windows (`:294-327`), and M−1/M+1 boundary shifts. For an employee, RLS trims these to their own rows without an error, so `buildScheduleInputs` would report `ready` on partial data. An employee page must use its own loader.

### 3. Routing, navigation, UI rules

- `PROTECTED_ROUTES = ["/dashboard", "/availability", "/api/availability"]` and `MANAGER_ROUTES = ["/manager", "/api/manager"]`, matched on segment boundaries (`src/lib/route-access.ts:5-13`).
  - A page at `/schedule` is public unless it is added to `PROTECTED_ROUTES`.
  - The inventory test fails for any `src/pages` file without an `EXPECTED_ACCESS` row (`src/lib/route-inventory.test.ts:15-44`; `/availability` is `"signed-in"` at `:29`; kitchen sinks are `"public"` at `:25-27`). §6.3 also asks for decision-table rows including a lookalike path (`test-plan.md:158-167`).
- No route reads `/schedule` today. `/manager/schedule` sits under `MANAGER_ROUTES`, and a top-level `/schedule` prefix does not match it.
- Navigation:
  - `Layout.astro` has no nav (`src/layouts/Layout.astro:36`).
  - The legacy dashboard links Availability for everyone (`src/pages/dashboard.astro:27`) and Schedule (`/manager/schedule`) for managers only (`:59`).
  - Clean pages end with "Back to dashboard" (`src/pages/manager/schedule.astro:308`).
- `scripts/check-ui-literals.mjs:17-27` `SCOPE` already includes `src/components/schedule/`. A new page and its kitchen sink need to be added. The kitchen sink pattern is `src/pages/dev/schedule-states.astro:44-48` (404 outside dev); it already has a published fixture (`:57-59`).

### 4. Which months exist to show

- Publish and unpublish accept `scheduleMonths()` = the current station month plus the next 3 (`src/lib/schedule.ts:194-197`; `src/pages/api/manager/schedule/publish.ts:25`, `unpublish.ts:19`).
- `publish_schedule` itself has no month-range check (`20261007120000:126-171`).
- No app page lists past months. After a month boundary, the previous month's schedule drops out of every tab list, including the manager's.
- So the natural default for a viewer is `scheduleMonths()`, filtered or marked by "published". Showing the month that just ended is a product choice.

### 5. Tests, smoke, seed

- **pgTAP (`test-plan.md` §6.2, `:138-156`):**
  - A policy or function on these tables goes into `supabase/tests/database/schedules.test.sql`, today `plan(98)` (`:8`).
  - Conventions:
    - Fixture users are `10000000-…@db-rules.test` inserted into `auth.users`, with no seed accounts as actors.
    - Roles are switched with `set local role authenticated; set local request.jwt.claims = '{"sub":…}'`.
    - Every refusal is paired with a control.
    - A sabotage pass is required.
  - The publish fixture pattern is at `schedules.test.sql:495-566`. Privilege asserts are at `:323-359`.
- **Read path (§6.4, `test-plan.md:169-176`):** use `loadAllPages` and a `ready | unknown` builder with a fake page function in unit tests. Show the load error, never an empty "no schedule" state.
- **Risks touched (`test-plan.md:42-49`):**
  - #2: a read without an ownership filter. Availability must stay closed, and the new path must return no windows.
  - #4: route and role gate.
  - #6: honest reads.
- **Smoke (`scripts/smoke.mjs`):**
  - The schedule steps run on station month + 3 behind the `scheduleMonthClean` gate (`:342`).
  - There is never a successful publish (`:55-56`), because that month is almost all Uncovered and publishing needs someone on every station day.
  - A cheap S-05 step: while the smoke draft exists, the fresh user's GET of the viewer for that month shows no shifts and no `data-shift-id`, i.e. no draft leak.
  - A real published-view smoke would need around 30 overrides plus an unpublish → discard → unlock teardown. A run that dies mid-way would also leave a frozen month.
- **Seed (`supabase/seed.sql`):**
  - The seed has no schedule data. The demo team A–E has windows in station month + 1 (`:35-84`).
  - Manual path: generate that month, override one shift on days 10 and 20 with "Assign anyway", publish, then sign in as `employee@example.com`.
  - A November 2026 draft may already exist locally (`context/archive/2026-10-06-review-override-publish-schedule/research.md:116-122`). This was not queried.

## Code References

- `supabase/migrations/20261006120000_create_schedules.sql:53-78,96-100` — manager-only select policies, insert column grants
- `supabase/migrations/20261007120000_publish_and_override_schedules.sql:8-10,18-86,126-205` — published state, write policies, publish/unpublish RPCs (the SECURITY DEFINER pattern to copy)
- `supabase/migrations/20261007130000_guard_published_schedule_shifts.sql:11-55` — write-only guard trigger
- `supabase/migrations/20260925120000_create_profiles_and_roles.sql:8-13,64-88` — profiles columns and own/manager-only RLS
- `supabase/tests/database/schedules.test.sql:8,95-104,323-359,495-566` — plan count, draft-read refusal, privilege asserts, publish fixtures
- `src/lib/manager-users.ts:72,85-89` — `accountLabel` (full email), `calendarName`
- `src/lib/schedule.ts:151,194-197,270,279-373,378-390` — URL builder, months, page size, manager loader, station-day grouping
- `src/lib/schedule-summary.ts:263-265` — `daysWithNoOne(month, shifts)`
- `src/lib/team-availability.ts:24,78` — `loadAllPages`, ready/unknown builder
- `src/components/schedule/ScheduleCalendar.astro:9-23,89,136,149` — grid props, manager link, email title, name
- `src/components/schedule/ScheduleDayPanel.astro:7,116-122,219-234` — email label, "draft" wording, read-only rows
- `src/components/schedule/ScheduleActions.astro:41-46,64` — published header and markers
- `src/components/availability/MonthTabs.astro:6-14` — tabs with `hrefFor`
- `src/lib/route-access.ts:5-13`, `src/lib/route-inventory.test.ts:15-44` — route gating and inventory
- `src/pages/dashboard.astro:27,59` — role-based links
- `scripts/check-ui-literals.mjs:17-27` — UI literal scope
- `scripts/smoke.mjs:55-56,342` — no successful publish, clean-month gate

## Architecture Insights

- Postgres is the enforcement layer. S-03/S-04 put every cross-role rule in RLS, column grants or SECURITY DEFINER RPCs that check roles themselves. An RPC for the published read follows the same pattern as `publish_schedule`.
- Every team read in the app goes through `loadAllPages` plus a `ready | unknown` builder, so a partial read never renders as "no one" or "no schedule". This holds for an employee read too. Here the danger is subtler: RLS trims rows without an error, so a loader written for managers reports success on partial data.
- Station-day grouping is centralised (`stationDayOf`, `shiftsByStationDay`). The month column already puts the 00:00–06:00 day-1 shift in M, so a viewer needs no boundary logic of its own for M's own shifts.

## Historical Context (from prior changes)

Each historical claim was checked against current code:

- `context/archive/2026-09-25-role-aware-access-control/plan.md:45`: S-05 should add a narrow names read path, not widen `profiles_select_*`. **Supported.** Profiles RLS is unchanged (`20260925120000:64-74`).
- `context/archive/2026-10-06-generate-monthly-schedule/plan.md:64`: employees cannot read the schedule tables. **Supported.** No later migration adds an employee select policy.
- `context/archive/2026-10-06-review-override-publish-schedule/plan.md:62`, `plan-brief.md:45,66`: the employee read path and names are left to S-05, and publishing has no visible effect for employees until then. **Supported.**
- `context/archive/2026-10-06-review-override-publish-schedule/research.md:104-110`: a `schedule_shifts` policy that checks `schedules` through a subquery is subject to `schedules` RLS. **Supported** (standard Postgres behaviour). It applies only to option A.
- `context/foundation/roadmap.md:163-167` (S-04 → S-05 handoff). **Supported** on each point: the published flag, the frozen month with its lock, manager-only RLS, Uncovered from deleted accounts, and reusable `shiftsByStationDay`/`calendarName`.
- CLAUDE.md, "Employees cannot see a published month yet (S-05)". **Supported.**

## Related Research

- `context/archive/2026-10-06-review-override-publish-schedule/research.md` — S-04 (published state, employee read gap)
- `context/archive/2026-10-06-generate-monthly-schedule/research.md` — S-03 (draft model, station day)

## Open Questions

1. **Name shown to employees.** The options are the email local part (`calendarName`, which partly reveals colleagues' emails) or a new display-name column (which needs signup or edit UI, out of the roadmap's scope). Either way, the RPC must not return full emails. This is a product and privacy decision.
2. **Months offered.** `scheduleMonths()` (current station month plus the next 3) with only published ones shown or flagged, or also the month that just ended.
3. **Manager view.** Do managers use the new page for published months too (FR-007 says "Employee and Manager"), and does `/manager/schedule` link to it? Should the RPC serve managers unchanged, or do managers keep the full-email view?
4. **Day 1's previous night.** Should M−1's last 00:00–06:00 shift be shown read-only on day 1 (as on `/manager/schedule`), and only when M−1 is published?
5. **Navigation.** There is no shared nav. Is a dashboard link for every signed-in user enough?
6. **Unverified:** supabase-js `rpc` + `count: "exact"` + `.range()` on a `returns table` function, for `loadAllPages` reuse. Confirm in the docs during `/10x-plan`.
7. **Unverified locally:** anon's exact remaining table privileges and whether a local November 2026 draft exists. Neither blocks planning.
