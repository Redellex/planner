# Manager Availability Visibility Implementation Plan

## Overview

Add a manager-only page, `/manager/availability`, that shows every account's availability for one month in one place (roadmap S-02, PRD FR-002). The page is a Monday-first calendar with per-day counts of available people, a day panel that lists everyone's windows for the selected day, a lock-status line, and a team summary with hour totals, a "no availability submitted" flag and a one-employee filter. The page is read-only and needs no migration.

## Current State Analysis

- Managers can already read every window and every profile. RLS allows it through `availability_windows_select_manager` (`supabase/migrations/20260926130000_create_availability.sql:87`) and `profiles_select_manager` (`supabase/migrations/20260925120000_create_profiles_and_roles.sql:70`). The earlier availability change added that read access ahead of this slice and left the view to S-02.
- Every route under `/manager` is gated by `MANAGER_ROUTES` (`src/middleware.ts:6`). Anonymous users are redirected to sign-in, and non-managers are rewritten to `/403`.
- `src/lib/availability.ts` holds the station-month logic (`currentStationMonth`, `upcomingMonths`, `addMonths`), parsing (`parseMonth`, `parseDate`), `calendarWeeks`, window labels (`formatWindow`, `formatWindowCompact`, `timeOf`, `dateOf`), `formatDay`/`formatMonth`, `formatStationInstant` and `logAvailabilityError`.
- `/availability` (`src/pages/availability.astro`) is the pattern to mirror. It loads data with `Promise.all`, has a separate query for an overnight window running into day 1 from the previous month (`:63-69`), fails closed on lock rows, shows a load-error `Alert`, groups windows by the date they start (`:97-101`) and uses shadcn tokens. `AvailabilityCalendar.astro` and `MonthTabs.astro` hard-code `/availability?month=` links.
- `profiles` has only `id`, `email`, `role` and `created_at`, with no display name, so email is the label for each person.
- `/manager/users` and `/manager/months` still use the old purple "cosmic" styling, and navigation links for managers sit in `src/pages/dashboard.astro` and `src/components/Topbar.astro`.
- `availability_windows` has no index on `starts_at` (open question handed over from S-01). At one station (a handful of accounts, a few hundred windows a month), a month-wide scan across all employees is trivial.

## Desired End State

A signed-in manager opens `/manager/availability` (linked from the dashboard and the top bar) and sees:

- Month tabs for the current station month plus the next 3, with next month selected by default. The tab links keep the employee filter.
- A lock-status line. For the current month it reads "In progress — employees can no longer edit this month". For an upcoming month it reads "Locked since …" or "Open — employees can still edit", followed by a link to `/manager/months`.
- A calendar where each day shows how many distinct accounts have a window starting that day. On day 1 this also counts windows from the previous month that run past midnight into it.
- A day panel for the selected day listing every account's windows, sorted by start time and then email, followed by a "No windows on this day" list of the other accounts.
- A team summary listing every profile (employees and managers) with the number of windows and total hours in the month, or "No availability submitted", plus "Show only" and "Show everyone" links.
- With `?employee=<id>` set to a listed account, the calendar cells show that person's windows in the same compact format as `/availability`, and the day panel lists only that person.

Employees get 403 on the page, and anonymous users are redirected to sign-in. `npm run smoke` proves both, and proves that the manager sees an employee's window.

### Key Discoveries:

- Read access already exists in RLS, so the page is a set of plain `select`s. Unlike `/availability`, it must **not** filter by `employee_id` (`src/pages/availability.astro:58-59`).
- A window belongs to the month of its `starts_at` (`supabase/migrations/20260926130000_create_availability.sql:30-31`), which is also the day it is grouped under. Overnight windows show `(+1)` on the day they start.
- Timestamps are Europe/Warsaw wall-clock strings and must never go through `new Date(...)`. Durations are wall-clock differences with no DST correction (CLAUDE.md, Availability).
- `MonthTabs.astro:18` and `AvailabilityCalendar.astro:52` build `/availability` links, so reusing `MonthTabs` needs a link-builder prop.

## What We're NOT Doing

- No migration and no `starts_at` index. At single-station scale a month-wide scan is trivial; revisit if S-03's generator reads show up as slow.
- No write actions on this page. Locking and unlocking stay on `/manager/months`, and managers still cannot edit other people's windows.
- No restyle of `/manager/users`, `/manager/months` or the dashboard, beyond adding one link that matches each file's existing style.
- No employees × days matrix view, and no per-person month calendar outside the filter.
- No past months beyond the current station month, and no `?month=` values outside the 4 offered months.
- No splitting of overnight windows across months or days for totals: a window counts toward the month and day it starts.
- No display names or other profile fields. Email is the label.
- No unit-test runner. The repo has none; verification is lint, `astro check`, build, smoke and manual checks.

## Implementation Approach

Server-render one Astro page under `src/pages/manager/`, which inherits the manager gate from the middleware. Load four things in parallel: profiles, windows that start in the month, windows from the previous month that run into day 1, and the month's lock row. Group the windows in the page frontmatter by day and by employee. Rendering lives in small new Astro components under `src/components/team-availability/`, with the same shadcn tokens and `cn()` usage as the `/availability` components. The small pure helpers (the manager's month list, window duration, duration label, page URL, load-error message) go in `src/lib/availability.ts` next to the rules they depend on. `MonthTabs` gets an optional link builder so both pages share it without changing `/availability`'s output.

## Critical Implementation Details

- **Overnight windows running into day 1:** `/availability` fetches at most one because a single employee's windows never overlap. The team query must drop the `.limit(1)`, since there can be one per employee. These windows are shown and counted only on day 1. They do **not** count toward the month's hour totals or the "submitted" flag, because they belong to the previous month.
- **Untrusted `?employee=`:** honour it only when it equals the `id` of a profile the page loaded. Otherwise ignore it and show everyone. Never put an unmatched value into a query or into rendered text.

## Phase 1: Team calendar page

### Overview

Deliver `/manager/availability` with month tabs, lock status, the per-day count calendar and the day panel for all accounts.

### Changes Required:

#### 1. Month list, URL and error helpers

**File**: `src/lib/availability.ts`

**Intent**: Add the manager page's month rule (current station month plus the upcoming months), a URL builder that keeps month, day and employee together, and a manager-specific load-error message, so the page and components never assemble these by hand.

**Contract**:
- `teamAvailabilityMonths(): string[]`: `[currentStationMonth(), ...upcomingMonths()]`, as `YYYY-MM`.
- `teamAvailabilityUrl(params: { month: string; day?: string | null; employee?: string | null }): string`: `/manager/availability?month=…[&day=…][&employee=…]`.
- `TEAM_LOAD_ERROR = "Could not load team availability. Reload the page."` The raw error is logged with `logAvailabilityError` and never shown.

#### 2. Shared row types

**File**: `src/components/availability/types.ts`

**Intent**: Type the rows the team page reads, in the same way as the existing `WindowRow`.

**Contract**: `TeamWindowRow = Pick<Tables<"availability_windows">, "id" | "employee_id" | "starts_at" | "ends_at">` and `TeamMember = Pick<Tables<"profiles">, "id" | "email" | "role">`.

#### 3. Reusable month tabs

**File**: `src/components/availability/MonthTabs.astro`

**Intent**: Let the manager page point the tabs at its own URL (keeping the employee filter), while `/availability` renders exactly as before.

**Contract**: New optional prop `hrefFor?: (month: string) => string`, defaulting to `` (m) => `/availability?month=${m}` ``. Markup and classes are otherwise unchanged.

#### 4. Team calendar component

**File**: `src/components/team-availability/TeamCalendar.astro` (new)

**Intent**: Monday-first month grid that mirrors `AvailabilityCalendar`'s cell styling (selected, has-windows and focus-ring states). Each day links to `teamAvailabilityUrl({ month, day, employee })` and shows the number of distinct accounts available that day.

**Contract**: Props are `month`, `weeks`, `selectedDay`, `employee: string | null` and a per-day map of entries (`Map<string, DayEntry[]>`, where a `DayEntry` pairs a `TeamMember` with a window and a `carryOver` flag). Each cell's `aria-label` reads like `"Thu 1 Oct: 3 people available"` / `"…: no one available"`. On phones it shows a count dot, as the employee calendar does; from the `sm` breakpoint up it shows `"3 available"`.

#### 5. Team day panel component

**File**: `src/components/team-availability/TeamDayPanel.astro` (new)

**Intent**: Show the selected day's windows for every account (email and `formatWindow` text), then list the accounts with no window that day.

**Contract**: Props are `selectedLabel`, `entries: DayEntry[]` (already sorted by start time, then email) and `withoutWindows: TeamMember[]`. A window from the previous month is labelled `00:00 – HH:MM (from <formatDay of its start>)`, the same wording as `/availability`. An empty day reads "No one has availability on this day."

#### 6. Page

**File**: `src/pages/manager/availability.astro` (new)

**Intent**: Resolve the month, day and employee from the URL, load the data in parallel, group it, and render the header, load-error alert, `MonthTabs`, lock-status line, `TeamCalendar` and `TeamDayPanel` inside the same `Layout`/`bg-background` shell as `/availability`.

**Contract**:
- `month`: `parseMonth(?month)` if it is in `teamAvailabilityMonths()`, otherwise `upcomingMonths()[0]` (next month). `day`: `parseDate(?day)` if it falls in `month`, otherwise `monthStart(month)`.
- Queries (`Promise.all`):
  - `profiles` (`id, email, role`, ordered by email).
  - `availability_windows` (`id, employee_id, starts_at, ends_at`) with `starts_at` in `[monthStart(month), monthStart(month + 1))`, ordered by `starts_at`.
  - Windows that started before the month and run into it: `starts_at < monthStart(month)` and `ends_at > monthStart(month)`, with no limit.
  - `availability_locks` (`month, locked_at`) for this month.
- Any query error: log it and show the `TEAM_LOAD_ERROR` destructive `Alert`. If the lock read fails, the lock-status line says the lock state is unknown.
- Lock line: the current month reads "In progress — employees can no longer edit this month". A locked upcoming month reads "Locked since {formatStationInstant}", and an open one reads "Open — employees can still edit". Upcoming months get a "Manage month locks" link to `/manager/months`.
- A "Back to dashboard" button matches `/availability`.

### Success Criteria:

#### Automated Verification:

- Lint passes: `npm run lint`
- Type check passes: `npx astro check`
- Production build succeeds: `npm run build`
- Existing smoke steps still pass: `npm run smoke`

#### Manual Verification:

- As the seeded manager, `/manager/availability` defaults to next month and shows the correct per-day counts for windows created by two different accounts
- The day panel lists each account's windows sorted by start time, marks overnight windows `(+1)`, and lists the accounts without a window that day
- An overnight window created on the last day of the previous month shows on day 1 as `00:00 – HH:MM (from …)` and counts toward day 1
- The current month tab reads "In progress"; locking and unlocking an upcoming month in `/manager/months` changes its status line; `/availability` month tabs look and link exactly as before
- As the seeded employee, `/manager/availability` returns the 403 page

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Team summary and employee filter

### Overview

Add the per-account summary (window count, hour totals, "No availability submitted") and the `?employee=` filter that narrows the calendar and day panel to one person.

### Changes Required:

#### 1. Duration helpers

**File**: `src/lib/availability.ts`

**Intent**: Compute a window's length and format a total, using the wall-clock rules (no `new Date` on wall-clock strings, no DST correction).

**Contract**:
- `windowMinutes(row: WindowTimes): number`: the difference between `Date.UTC` of the start and end date and time parts, in minutes.
- `formatDuration(minutes: number): string`: `"0h"`, `"8h"`, `"37h 20m"`.

#### 2. Team summary component

**File**: `src/components/team-availability/TeamSummary.astro` (new)

**Intent**: List every loaded profile with its role, its window count and total hours for the month, and link it to the filtered view, so the manager can spot who hasn't submitted before locking.

**Contract**: Props are `members: TeamMember[]`, `totals: Map<string, { windows: number; minutes: number }>`, `month`, `day` and `employee: string | null`. A member with 0 windows reads "No availability submitted" (muted text plus a warning-style badge using existing tokens). Each row links "Show only" to `teamAvailabilityUrl({ month, day, employee: id })`, and the active row is marked with `aria-current`. A "Show everyone" link appears while filtered.

#### 3. Filtered mode

**Files**: `src/pages/manager/availability.astro`, `src/components/team-availability/TeamCalendar.astro`, `src/components/team-availability/TeamDayPanel.astro`

**Intent**: Resolve `?employee=` against the loaded profiles, compute totals from windows that start in the month only, and while filtered narrow the per-day entries to that person. Filtered cells show `formatWindowCompact` text (and `…–HH:MM` for a window from the previous month, as in `AvailabilityCalendar`) instead of a count.

**Contract**:
- `employee`: the matching profile's `id`, otherwise `null`. It is passed to `MonthTabs` through `hrefFor` and to every calendar and summary link.
- Totals: key `employee_id`, value `{ windows, minutes }`, built only from the in-month query (windows from the previous month are excluded).
- The heading shows "Showing: <email>" while filtered. The summary is always rendered for all members, under the calendar and day panel.

### Success Criteria:

#### Automated Verification:

- Lint passes: `npm run lint`
- Type check passes: `npx astro check`
- Production build succeeds: `npm run build`

#### Manual Verification:

- The summary lists every account (including the manager), with window counts and totals matching the created windows (e.g. 08:00–16:00 plus 22:00–06:00 (+1) = "16h")
- An account with no window in the month shows "No availability submitted"; an account whose only window is a previous-month overnight window running into day 1 is also flagged
- "Show only" narrows the calendar cells to that person's compact windows and the day panel to that person; switching months and days keeps the filter; "Show everyone" clears it
- A bogus `?employee=` value (random text or an unknown uuid) is ignored and the page shows everyone without an error

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Navigation, smoke coverage and docs

### Overview

Make the page reachable, cover it in the smoke script, and document it.

### Changes Required:

#### 1. Navigation links

**Files**: `src/pages/dashboard.astro`, `src/components/Topbar.astro`

**Intent**: Add a manager-only "Team availability" link next to the existing Users and Months links, in each file's current style.

**Contract**: `href="/manager/availability"`, rendered only when `role === "manager"`.

#### 2. Smoke steps

**File**: `scripts/smoke.mjs`

**Intent**: Prove that the manager page is gated and that it shows another account's window.

**Contract**: Three new steps:
- After "availability delete removes the window", add "availability create leaves a window for the manager view". It POSTs `/api/availability/create` with `{ date: `${crudMonth}-02`, start: "10:00", end: "12:00" }` and expects 302 to `/availability?month=${crudMonth}&day=${crudMonth}-02&updated=1`. The window is left in place; the smoke user is fresh on every run.
- Before the employee signout, add "team availability forbidden for employee": GET `/manager/availability`, expect 403.
- After the manager signs in, add "team availability shows the employee's window": GET `/manager/availability?month=${crudMonth}&day=${crudMonth}-02`, expect 200, with the body containing the smoke user's email and `10:00`.

#### 3. Documentation

**File**: `CLAUDE.md`

**Intent**: Keep the architecture notes and smoke description accurate.

**Contract**:
- The Availability "Routes" bullet gains `/manager/availability`: the manager-only team view of the current plus the next 3 months, with `?month`, `?day` and `?employee`, no `employee_id` filter, read-only.
- The `npm run smoke` description mentions the manager view steps and that each run leaves a window on day 2 of station month + 3.

### Success Criteria:

#### Automated Verification:

- Lint passes: `npm run lint`
- Type check passes: `npx astro check`
- Production build succeeds: `npm run build`
- Smoke passes including the new team-availability steps: `npm run smoke`

#### Manual Verification:

- The dashboard and the top bar show "Team availability" for the manager only, and the link opens the page
- CLAUDE.md describes the new route and the updated smoke steps

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful.

---

## Testing Strategy

### Unit Tests:

- None. The repo has no unit-test runner (CLAUDE.md). `windowMinutes`/`formatDuration` are covered by the Phase 2 manual totals check.

### Integration Tests:

- `npm run smoke`: employee gets 403 on `/manager/availability`; the manager sees the smoke user's window on the right day.

### Manual Testing Steps:

1. `npx supabase db reset`, `npm run dev`. As `employee@example.com`, add 08:00–16:00 on day 3 and 22:00–06:00 on day 5 of next month.
2. As `manager@example.com`, add 10:00–14:00 on day 3 of next month. Open `/manager/availability`: day 3 shows 2 available, and day 5 shows the employee with `22:00 – 06:00 (+1)`.
3. Check next month's summary: the employee shows 2 windows / 16h and the manager 1 window / 4h. A freshly signed-up account shows "No availability submitted".
4. As a second fresh account, add 20:00–04:00 on the last day of next month. Open the month after next: day 1 counts that account and shows `00:00 – 04:00 (from …)`, and the summary still flags it as "No availability submitted" for that month.
5. Click "Show only" for the employee, switch months and days, then "Show everyone".
6. Lock next month in `/manager/months` and confirm the status line. Unlock it again.
7. Try `?month=2020-01`, `?day=bogus` and `?employee=not-a-uuid`: the page falls back to the defaults without errors.

## Performance Considerations

Four small queries per render, at single-station scale. The only full scan is the month-wide `starts_at` range over a few hundred rows, which is why no index is added (see "What We're NOT Doing").

## Migration Notes

None. No schema changes; `src/db/database.types.ts` is unchanged.

## References

- Roadmap item: `context/foundation/roadmap.md` (S-02)
- PRD: `context/foundation/prd.md` (FR-002, NFR on availability visibility)
- Prior change (RLS for manager reads, overnight windows, month rules): `context/archive/2026-09-26-employee-availability-management/plan.md`
- Pattern to mirror: `src/pages/availability.astro:50-101`, `src/components/availability/AvailabilityCalendar.astro`
- Manager gate: `src/middleware.ts:6`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Team calendar page

#### Automated

- [x] 1.1 Lint passes: `npm run lint` — 8a2f32d
- [x] 1.2 Type check passes: `npx astro check` — 8a2f32d
- [x] 1.3 Production build succeeds: `npm run build` — 8a2f32d
- [x] 1.4 Existing smoke steps still pass: `npm run smoke` — 8a2f32d

#### Manual

- [x] 1.5 As the seeded manager, `/manager/availability` defaults to next month and shows the correct per-day counts for windows created by two different accounts — 8a2f32d
- [x] 1.6 The day panel lists each account's windows sorted by start time, marks overnight windows `(+1)`, and lists the accounts without a window that day — 8a2f32d
- [x] 1.7 An overnight window created on the last day of the previous month shows on day 1 as `00:00 – HH:MM (from …)` and counts toward day 1 — 8a2f32d
- [x] 1.8 The current month tab reads "In progress"; locking and unlocking an upcoming month in `/manager/months` changes its status line; `/availability` month tabs look and link exactly as before — 8a2f32d
- [x] 1.9 As the seeded employee, `/manager/availability` returns the 403 page — 8a2f32d

### Phase 2: Team summary and employee filter

#### Automated

- [x] 2.1 Lint passes: `npm run lint` — 40d5527
- [x] 2.2 Type check passes: `npx astro check` — 40d5527
- [x] 2.3 Production build succeeds: `npm run build` — 40d5527

#### Manual

- [x] 2.4 The summary lists every account (including the manager), with window counts and totals matching the created windows (e.g. 08:00–16:00 plus 22:00–06:00 (+1) = "16h") — 40d5527
- [x] 2.5 An account with no window in the month shows "No availability submitted"; an account whose only window is a previous-month overnight window running into day 1 is also flagged — 40d5527
- [x] 2.6 "Show only" narrows the calendar cells to that person's compact windows and the day panel to that person; switching months and days keeps the filter; "Show everyone" clears it — 40d5527
- [x] 2.7 A bogus `?employee=` value (random text or an unknown uuid) is ignored and the page shows everyone without an error — 40d5527

### Phase 3: Navigation, smoke coverage and docs

#### Automated

- [x] 3.1 Lint passes: `npm run lint` — 8da5b5a
- [x] 3.2 Type check passes: `npx astro check` — 8da5b5a
- [x] 3.3 Production build succeeds: `npm run build` — 8da5b5a
- [x] 3.4 Smoke passes including the new team-availability steps: `npm run smoke` — 8da5b5a

#### Manual

- [x] 3.5 The dashboard and the top bar show "Team availability" for the manager only, and the link opens the page — 8da5b5a
- [x] 3.6 CLAUDE.md describes the new route and the updated smoke steps — 8da5b5a
