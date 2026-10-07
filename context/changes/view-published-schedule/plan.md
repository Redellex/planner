# View Published Schedule Implementation Plan

## Overview

S-05 (FR-007, issue #6): every signed-in user, employee or manager, opens `/schedule` and sees a published month as a station-day grid of who works when. Their own shifts are marked "You" and highlighted. Drafts, availability windows, emails and roles never reach employees.

Names come from a new self-chosen display name, set on a new `/account` page. While it is empty, the grid falls back to the email prefix (the same rule as `calendarName`).

## Current State Analysis

From `context/changes/view-published-schedule/research.md`, re-checked in this planning session:

- **Schedule tables are manager-only to read.** `schedules_select_manager` and `schedule_shifts_select_manager` (`supabase/migrations/20261006120000_create_schedules.sql:53-57,74-78`). An employee reading a draft gets nothing (`supabase/tests/database/schedules.test.sql:95-104`). Publishing has no effect employees can see yet.
- **`profiles` has `id, email, role, created_at`** (`20260925120000_create_profiles_and_roles.sql:8-13`) and no name column.
  - Employees read only their own row (`:64-74`).
  - `authenticated` holds `grant update (role)` (`:87-88`), and managers update through `profiles_update_manager`.
  - So any new self-update policy on `profiles` would let a user change their own role.
- **`calendarName`** (`src/lib/manager-users.ts:85-89`) returns the email before `@` when `@` is past position 0. Otherwise it returns the whole email, or the id's first 8 characters when the email is empty.
- **`ScheduleCalendar.astro` is close to reusable.**
  - Every cell links to `managerScheduleUrl` (`:89`).
  - Names come from a `members: Map<id, {id, email}>` prop through `calendarName`, with the full email as `title` (`:136,149`).
  - `outsideAvailability` can be `[]`, and `daysWithNoOne(month, shifts)` needs no windows (`src/lib/schedule-summary.ts:263-265`).
- **`ScheduleDayPanel.astro` is built around overrides.** Its read-only rows show the full email (`accountLabel`, `:7,219-234`), and the day-1 line says "draft" (`:116-122`).
- **`loadScheduleInputs` must not back an employee page.** It reads every profile and window (`src/lib/schedule.ts:279-373`). Under employee RLS those reads succeed with only the employee's own rows, which is silently partial.
- **Routing.**
  - `PROTECTED_ROUTES = ["/dashboard", "/availability", "/api/availability"]` (`src/lib/route-access.ts:5`).
  - Every `src/pages` file needs an `EXPECTED_ACCESS` row (`src/lib/route-inventory.test.ts:15-44`).
  - The decision table lives in `src/lib/route-access.test.ts:34-70`.
- **Write-endpoint pattern.** Form POST, then redirect with `?error=` from an allow-list and `?updated=1` (`src/pages/api/manager/users/role.ts`, `src/lib/manager-users.ts:5-89`).
- **Tokens are neutral grey.** S-04 added `--warning` in `:root`, `.dark` and `@theme inline` (`src/styles/global.css:24,60,99`) without changing existing values.
- **The legacy dashboard** links each page per role (`src/pages/dashboard.astro:27-65`).
- **Smoke never publishes successfully** (`scripts/smoke.mjs:55-56`). The schedule steps run on `crudMonth` behind the `scheduleMonthClean` gate (`:342`). `asSmokeUser` runs a step as the fresh employee (`:156-170`).

## Desired End State

- **`/schedule`** (any signed-in user, `?month=YYYY-MM&day=YYYY-MM-DD`) shows:
  - Month tabs for the current station month plus the next 3 (`scheduleMonths()`).
  - For a published month: "Published — <month>" and the publish time, the station-day calendar (from `lg` each cell lists hours plus the name; Uncovered in red), and a read-only day panel.
  - On both, the viewer's own shifts are marked "You" and coloured with the new `--highlight` token.
  - A month that is not published (a draft or no schedule) shows "Not published yet" for everyone, managers included. Managers also get a link to `/manager/schedule`.
  - A failed read shows only the load error and the tabs.
  - An unpublished month disappears on the next load.
- **`/account`** (any signed-in user) shows the user's email and a display-name form. Saving trims the name and accepts 1–40 characters. An empty value clears it, so colleagues see the email prefix again.
- **`get_published_schedule(target_month)`** returns rows only while the month is published. It returns shift id, times, `employee_id`, a derived `assignee_name` (display name, else email prefix, else id prefix; null when uncovered) and `published_at`. It never returns emails, roles or windows. Execute: `authenticated` only.
- **`set_display_name(new_name)`** writes only the caller's own `display_name`. No table policy or column grant lets anyone write `display_name` directly.
- The dashboard links "Schedule" (`/schedule`) and "Account" for every signed-in user. Its manager-only schedule link reads "Manage schedule". The published card on `/manager/schedule` links to `/schedule?month=…`.
- Verify with `npm run test:db`, `npm test`, `npm run lint`, `npx astro check`, `npm run check:ui` and `npm run smoke`, plus the manual walkthrough in Testing Strategy.

### Key Discoveries:

- `schedule_shifts.employee_id` references `public.profiles (id) on delete set null` (`20261006120000_create_schedules.sql:25`). Every non-null assignee therefore has a profile row, and a deleted account's shifts come back as Uncovered (null name).
- A published month has at least one assigned shift per station day when it is published (`20261007120000_publish_and_override_schedules.sql:155-163`). Its shifts cannot be deleted while it is published (RLS plus the `schedule_shifts_published_guard` trigger). So an empty result from `get_published_schedule` reliably means "not published".
- At most 31 × 4 = 124 shifts per month, well under PostgREST `max_rows = 1000` (`supabase/config.toml:18`). A single function call is never truncated, and it reads in one snapshot.
- The SECURITY DEFINER pattern to copy is `publish_schedule` (`20261007120000:126-176`): `set search_path = ''`, execute revoked from `public, anon` and granted to `authenticated`.

## What We're NOT Doing

- No change to `/manager/schedule`, `/manager/users` or `/manager/availability` names: managers keep full emails and email prefixes there. The only manager-page change is the "View published schedule" link.
- No previous month's last night on day 1 of `/schedule`. Each tab shows only its own station days, and the 00:00–06:00 shift on day 1 appears on the previous month's last-day cell.
- No months outside `scheduleMonths()`: no past-month archive.
- No manager editing of other people's display names, and no display name at signup.
- No "my shifts only" filter, no notifications (FR-009) and no export or print (FR-008).
- No new select policies on `schedules`, `schedule_shifts` or `profiles`.
- No successful publish in smoke. The published view is covered by pgTAP and the manual walkthrough.

## Implementation Approach

The database is the enforcement layer, as in S-01 to S-04. Two SECURITY DEFINER functions are the only new access paths:

- **One read:** a published month's shifts with derived names.
- **One write:** the caller's own name.

Both functions use one statement, so a read never straddles an unpublish. The app gets one ready / not-published / unknown loader in a small pure module, reuses `ScheduleCalendar` through three new props (`/manager/schedule` renders the same), and adds a small read-only day panel. `/account` copies the role endpoint's form-post, redirect and allow-list pattern.

## Critical Implementation Details

- **Never add an update policy for own rows on `profiles`.** `grant update (role) on public.profiles to authenticated` already exists, so such a policy would let an employee promote themselves. `display_name` gets no column grant. Only `set_display_name` writes it, and only `where id = auth.uid()`. pgTAP must prove both that an employee's direct `update ... set display_name` is refused and that their role is unchanged after calling the function.
- **The name rule exists twice: in SQL, and in TS for the manager pages.** The SQL fallback must match `calendarName` exactly. pgTAP pins the three cases with the same inputs as `src/lib/manager-users.test.ts:7-14`: an email with a prefix, an email whose `@` is at position 0, and the id fallback when the email is `''`. A comment in each place points to the other.

## Phase 1: Database read and write paths

### Overview

One migration adds the display name and both functions. Types are regenerated and the database rules are proved in pgTAP before any UI uses them.

### Changes Required:

#### 1. Migration

**File**: `supabase/migrations/20261007140000_published_schedule_and_display_names.sql`

**Intent**: Add a self-owned display name, plus a single published-only read of a month's shifts that resolves names without opening `profiles`, availability or drafts.

**Contract**:

- `alter table public.profiles add column display_name text null`, with check `display_name is null or (display_name = btrim(display_name) and char_length(display_name) between 1 and 40)`.
  - No column grant for `display_name`. The existing `revoke update ... from authenticated, anon` plus `grant update (role)` stay as they are.
  - Add a column comment.
- `public.set_display_name(new_name text) returns void`: `language plpgsql security definer set search_path = ''`.
  - Raise `42501` when `auth.uid()` is null.
  - Normalise with `nullif(btrim(new_name), '')`.
  - Raise `22001` when the result is longer than 40 characters, so the app can map it.
  - `update public.profiles set display_name = <normalised> where id = auth.uid()`.
  - Execute revoked from `public, anon`, granted to `authenticated`.
- `public.get_published_schedule(target_month date) returns table (id uuid, starts_at timestamp, ends_at timestamp, employee_id uuid, assignee_name text, published_at timestamptz)`: `language sql stable security definer set search_path = ''`.
  - Joins `schedule_shifts` to its `schedules` row on `month` where `published_at is not null`, and left-joins `profiles` for the name.
  - Orders by `starts_at, id`.
  - `assignee_name` is null when `employee_id` is null. Otherwise it is `coalesce(display_name, <calendarName rule>)`, where the rule is the part before `@` when `position('@' in email) > 1`, else `email` when it is not `''`, else `left(employee_id::text, 8)`.
  - Execute revoked from `public, anon`, granted to `authenticated`.
  - It needs no `is_manager()` check, because a published schedule is readable by every signed-in user (`prd.md:110`).
- Comments on both functions, in the style of `publish_schedule`'s.

#### 2. Generated types

**File**: `src/db/database.types.ts`

**Intent**: Regenerate with `npx supabase gen types typescript --local` after the migration applies. Never hand-edit it.

**Contract**: `profiles.Row.display_name: string | null`. `Functions.get_published_schedule` returns `{ id; starts_at; ends_at; employee_id; assignee_name; published_at }[]`. `Functions.set_display_name: { Args: { new_name: string }; Returns: undefined }`.

#### 3. pgTAP: published read

**File**: `supabase/tests/database/schedules.test.sql`

**Intent**: Prove the published read path in the file that owns these tables (`test-plan.md` §6.2), and bump `plan(98)` to match.

**Contract**: New asserts, using fixture users `10000000-…@db-rules.test` (no seed accounts as actors), with every refusal paired with a control:

- An employee calls `get_published_schedule` on a draft month: empty. Control: the manager still reads that draft's shifts through the table.
- After `publish_schedule`, the employee gets every shift of the month, including other people's and Uncovered ones, with `assignee_name` set and `published_at` not null. A manager gets the same rows.
- After `unpublish_schedule`: empty again for the employee.
- The result's column set is exactly `id, starts_at, ends_at, employee_id, assignee_name, published_at` (no email or role column).
- Name rule:
  - A fixture with a display name returns it.
  - `x.y@db-rules.test` returns `x.y`.
  - An email whose `@` is at position 0 returns the whole email.
  - An email of `''` returns the id's first 8 characters.
  - An unassigned shift returns null.
- `has_function_privilege`: `anon` has no execute, `authenticated` does.
- Employee table reads stay refused after publish: a direct `select` on `schedules` and `schedule_shifts` is still empty.

#### 4. pgTAP: display name

**File**: `supabase/tests/database/profiles_roles.test.sql`

**Intent**: Prove the name write cannot escalate a role or touch another user, and bump `plan(21)` to match.

**Contract**: Asserts:

- An employee's `set_display_name('  Ann  ')` stores `Ann` on their own row only. Another fixture's `display_name` is unchanged, and the caller's `role` is still `employee`.
- `set_display_name('')` stores null.
- A 41-character name throws `22001`.
- An employee's direct `update public.profiles set display_name = …` on their own row throws `42501`. Control: the same employee can still read their own row.
- A manager's direct `update … set display_name` on another profile throws `42501`. Control: the manager's role update still works.
- `has_column_privilege('authenticated', 'public.profiles', 'display_name', 'UPDATE')` is false.
- `has_function_privilege('anon', 'public.set_display_name(text)', 'EXECUTE')` is false.

### Success Criteria:

#### Automated Verification:

- Migration applies on a fresh local stack: `npx supabase db reset`
- Database rules tests pass, including the new asserts: `npm run test:db`
- Generated types contain `display_name`, `get_published_schedule` and `set_display_name`, and `npx astro check` passes
- Lint and unit tests still pass: `npm run lint` and `npm test`

#### Manual Verification:

- A sabotage pass (`test-plan.md` §6.2 item 11): temporarily drop the `published_at is not null` filter from `get_published_schedule` and confirm the draft-read assert fails, then revert.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Display name on /account

### Overview

A signed-in user sets or clears the name colleagues see, through a form-post endpoint that copies the role endpoint pattern.

### Changes Required:

#### 1. Account helpers

**File**: `src/lib/account.ts` (new), `src/lib/account.test.ts` (new)

**Intent**: Keep validation, messages and URLs in one pure module, as in `manager-users.ts`.

**Contract**:

- `DISPLAY_NAME_MAX = 40`.
- `parseDisplayName(value: unknown): { ok: true; name: string | null } | { ok: false; error: string }`. It trims, maps empty to null, and rejects non-strings and names over 40 characters.
- Messages: `DISPLAY_NAME_TOO_LONG_ERROR`, `GENERIC_DISPLAY_NAME_WRITE_ERROR`, `SUPABASE_NOT_CONFIGURED_ERROR`, `DISPLAY_NAME_UPDATED_MESSAGE` and `ACCOUNT_LOAD_ERROR`.
- `ACCOUNT_FEEDBACK_ERRORS` and `resolveAccountFeedbackError(param)`: unknown text becomes the generic message.
- `accountUrl(result)`: the status param comes first, i.e. `/account?updated=1` or `/account?error=…`.
- `describeDisplayNameWriteError(error)`: `22001` maps to the too-long message, anything else is logged and becomes the generic message.
- `logAccountError`.
- Unit tests cover:
  - trimming, empty to null, exactly 40 versus 41 characters, and a non-string;
  - the allow-list falling back on unknown text;
  - the URL param order.

#### 2. Endpoint

**File**: `src/pages/api/account/display-name.ts` (new)

**Intent**: Save the caller's name through `set_display_name`. It never touches other columns.

**Contract**:

- `POST` with form `display_name`.
  - Invalid input (`parseDisplayName`) redirects to `accountUrl({ error })` without writing.
  - When Supabase is not configured, it redirects to the not-configured error.
- Otherwise it calls `supabase.rpc("set_display_name", { new_name: name ?? "" })`. An error redirects to `describeDisplayNameWriteError`, and success to `/account?updated=1`.

#### 3. Page

**File**: `src/pages/account.astro` (new)

**Intent**: A small clean view on design tokens where the user sees their email and edits their display name.

**Contract**:

- Reads its own row with `profiles.select("email, display_name").eq("id", user.id).maybeSingle()`. On an error or a missing row it shows `ACCOUNT_LOAD_ERROR` and no form.
- Shows "Colleagues see you as <name>", using the display name, else the email prefix (`calendarName`).
- The form has a labelled `Input` (`maxlength=40`), a Save `Button`, and the hint "Leave empty to show your email prefix".
- Feedback (an `Alert` with `role="status"`, or destructive) comes from the redirect params via the allow-list.
- Page layout follows the role map in CLAUDE.md, ending with a "Back to dashboard" outline button.

#### 4. Routing, inventory, UI scope, dashboard

**Files**: `src/lib/route-access.ts`, `src/lib/route-access.test.ts`, `src/lib/route-inventory.test.ts`, `scripts/check-ui-literals.mjs`, `src/pages/dashboard.astro`, `src/pages/dev/account-states.astro` (new)

**Intent**: Gate the new paths for signed-in users, keep the inventory complete, keep the new view literal-free, and make it reachable.

**Contract**:

- `PROTECTED_ROUTES` gains `"/account"` and `"/api/account"`.
- Decision-table rows: `/account` and `/api/account/display-name` are signed-in, and the lookalike `/accounts` stays public.
- `EXPECTED_ACCESS`:
  - `"/account": "signed-in"`;
  - `"/api/account/display-name": "signed-in"`;
  - `"/dev/account-states": "public"`.
- `SCOPE` gains `src/pages/account.astro` and `src/pages/dev/account-states.astro`.
- The dashboard gets an "Account" link for every signed-in user, in the legacy markup already used there.
- Kitchen sink (404 outside dev, fixtures only, forms inert): states for a name set, no name, saved, too long, generic error and load error.

### Success Criteria:

#### Automated Verification:

- Unit tests pass, including `account.test.ts`, the route-access rows and the route inventory: `npm test`
- Lint and type-check pass: `npm run lint` and `npx astro check`
- No colour literals in the new view: `npm run check:ui`

#### Manual Verification:

- As `employee@example.com`, `/account` saves "  Ann  " as "Ann" with a success notice. A 41-character paste is cut at 40 by the field, and a crafted 41-character POST shows the too-long error. Clearing the field brings back "employee".
- `/dev/account-states` shows every state legibly in the dark theme.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Published schedule on /schedule

### Overview

The shared read-only grid for every role is built from one function call, reusing the manager calendar and adding a small day panel and the highlight token.

### Changes Required:

#### 1. Loader and URLs

**File**: `src/lib/published-schedule.ts` (new), `src/lib/published-schedule.test.ts` (new)

**Intent**: Turn one function call into a state the page renders honestly (§6.4): published, not published, or unknown. A failed read never shows as "Not published yet".

**Contract**:

- `PublishedShift = { id; starts_at; ends_at; employee_id: string | null; assignee_name: string | null }`.
- `buildPublishedSchedule(result: { data: Row[] | null; error: unknown }): { kind: "unknown" } | { kind: "notPublished" } | { kind: "published"; publishedAt: string; shifts: PublishedShift[] }`.
  - An error, or `data === null`, gives unknown.
  - `[]` gives not published.
  - Otherwise it is published, with `publishedAt` from the first row.
  - A row with a non-null `employee_id` but a null name also gives unknown (the read is inconsistent).
- `loadPublishedSchedule(supabase, month)`: calls `rpc("get_published_schedule", { target_month: monthStart(month) })`, logs any error and returns `buildPublishedSchedule(...)`.
- `publishedScheduleUrl({ month, day? })`: `/schedule?month=…&day=…`.
- `PUBLISHED_SCHEDULE_LOAD_ERROR` and `NOT_PUBLISHED_MESSAGE`.
- Unit tests:
  - each of the three states;
  - the inconsistent row;
  - URL building.

#### 2. Highlight token

**File**: `src/styles/global.css`

**Intent**: Give the viewer's own shifts a colour on a token, as `--warning` was added, without changing any existing value.

**Contract**: `--highlight` in `:root` = `oklch(0.6 0.118 184.704)` and in `.dark` = `oklch(0.696 0.17 162.48)` (the existing `--chart-2` values, so no new hue enters the palette). Add `--color-highlight: var(--highlight)` in `@theme inline`.

#### 3. Calendar props

**File**: `src/components/schedule/ScheduleCalendar.astro`, `src/pages/manager/schedule.astro`, `src/pages/dev/schedule-states.astro`

**Intent**: Let the viewer page reuse the grid. The manager page passes what it shows today, so its output does not change.

**Contract**:

- Replace `members` with `labels: Map<string, { name: string; title?: string }>` (employee id to cell name and an optional `title`).
- Add `hrefFor: (day: string) => string` and `ownEmployeeId?: string | null`.
- The manager page and its kitchen sink build `labels` from members (`name: calendarName(member)`, `title: email`) and pass `hrefFor = (day) => managerScheduleUrl({ month, day })`.
- When `ownEmployeeId` matches a shift:
  - its `lg` list item gets a `bg-highlight/20` fill and a "You" text suffix;
  - an unselected cell containing one gets a `border-highlight` border;
  - the cell's `aria-label` gains ", your shift".
- The Uncovered and outside-availability colouring keeps precedence over the highlight border.

#### 4. Read-only day panel

**File**: `src/components/published-schedule/PublishedDayPanel.astro` (new)

**Intent**: The selected station day's shifts with names, readable by anyone, and no email anywhere.

**Contract**:

- Props: `selectedLabel`, `shifts: PublishedShift[]` (in start order) and `ownEmployeeId`.
- Each row shows `formatWindow`, the duration, then `assignee_name`, or the Uncovered marker styled as in `ScheduleDayPanel`.
- An own row adds the "You" pill (the role-map marker classes) and a `border-l-2 border-highlight` accent.
- "No shifts on this day." when empty.
- Each row has `data-shift-id`.

#### 5. Page

**File**: `src/pages/schedule.astro` (new)

**Intent**: The FR-007 grid for every signed-in user.

**Contract**:

- Month from `?month` within `scheduleMonths()`, defaulting to `currentStationMonth()`. Day from `?day` within that month, defaulting to day 1 (the same parsing as `/manager/schedule:56-62`).
- `MonthTabs` with `hrefFor = publishedScheduleUrl` and an empty `lockedMonths`.
- One `loadPublishedSchedule` call:
  - **Unknown** shows only `PUBLISHED_SCHEDULE_LOAD_ERROR` and the tabs.
  - **Not published** shows `NOT_PUBLISHED_MESSAGE` ("Not published yet"). When `locals.role === "manager"`, it adds a link to `managerScheduleUrl({ month })`.
  - **Published** shows a `data-schedule-published` section headed "Published — <month>" with `formatStationInstant(publishedAt)`.
- The published state also renders `ScheduleCalendar`:
  - `labels` from rows (`name: assignee_name`, no title);
  - `uncoveredCount` and `daysWithNoOne(month, shifts)`;
  - `outsideAvailability = []`;
  - `ownEmployeeId = locals.user.id`.
- Below the calendar, `PublishedDayPanel` for the selected day (`shiftsByStationDay`).
- The page ends with a "Back to dashboard" button. Layout widths match `/manager/schedule`.

#### 6. Routing, inventory, scope, links, kitchen sink

**Files**: `src/lib/route-access.ts`, `src/lib/route-access.test.ts`, `src/lib/route-inventory.test.ts`, `scripts/check-ui-literals.mjs`, `src/pages/dashboard.astro`, `src/components/schedule/ScheduleActions.astro`, `src/pages/dev/published-schedule-states.astro` (new)

**Intent**: Gate `/schedule` for signed-in users, make it reachable from both sides, and give the view its state page.

**Contract**:

- `PROTECTED_ROUTES` gains `"/schedule"`.
- Decision rows: `/schedule` is signed-in, the lookalike `/schedules` is public, and `/manager/schedule` stays manager-only.
- `EXPECTED_ACCESS`: `"/schedule": "signed-in"` and `"/dev/published-schedule-states": "public"`.
- `SCOPE` gains `src/pages/schedule.astro`, `src/components/published-schedule/` and the new kitchen sink.
- Dashboard:
  - "Schedule" (`/schedule`) for every signed-in user;
  - the manager link to `/manager/schedule` renamed "Manage schedule".
- The published card in `ScheduleActions.astro` adds a "View published schedule" link to `publishedScheduleUrl({ month })`.
- Kitchen-sink states:
  - load error;
  - not published, for an employee and for a manager;
  - fully covered, with own shifts on several days;
  - a day that has gained Uncovered after an account was deleted;
  - a selected day with an own shift.

### Success Criteria:

#### Automated Verification:

- Unit tests pass, including `published-schedule.test.ts`, the route-access rows, the route inventory and the existing schedule tests: `npm test`
- Lint and type-check pass: `npm run lint` and `npx astro check`
- No colour literals, including on the edited `ScheduleCalendar`: `npm run check:ui`
- Production build succeeds: `npm run build`

#### Manual Verification:

- Publish the seeded month on `/manager/schedule` (generate station month + 1, override one shift each on days 10 and 20 with "Assign anyway", Publish).
  - As `employee@example.com`, `/schedule?month=<that month>` shows every shift with names.
  - Own shifts carry "You" and the highlight colour.
  - No email appears anywhere on the page or in its HTML.
- Unpublish as the manager. The employee's reload shows "Not published yet". The manager sees the same notice plus the link to `/manager/schedule`.
- `/manager/schedule` looks unchanged apart from the "View published schedule" link on a published month.
- `/dev/published-schedule-states` shows every state legibly in the dark theme, at phone width and from `lg`.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 4: Smoke steps and documentation

### Overview

The HTTP smoke proves the new pages, the name write and draft invisibility end to end, and CLAUDE.md records the new paths.

### Changes Required:

#### 1. Smoke

**File**: `scripts/smoke.mjs`

**Intent**: Cover the new write endpoint (`test-plan.md` §6.3: a write endpoint needs a smoke step), and show that an employee never sees the smoke draft.

**Contract**: New steps, plus an updated header comment:

- After the fresh user signs in:
  - `/schedule` renders 200;
  - `/account` renders 200;
  - `POST /api/account/display-name` with `display_name = "Smoke User"` redirects to `/account?updated=1`, and `/account` then contains "Smoke User";
  - a 41-character name redirects to `/account?error=` with the too-long message.
- An anonymous `POST /api/account/display-name` is sent to `/auth/signin`.
- After "schedule page shows the draft", behind `needs: "scheduleMonthClean"`: `asSmokeUser` loads `/schedule?month=${crudMonth}`, which shows "Not published yet", no `data-schedule-published` and no `data-shift-id`.
- The schedule steps add no successful publish.

#### 2. Docs

**File**: `CLAUDE.md`

**Intent**: Keep the architecture notes true.

**Contract**:

- **Schedule section:** replace "Employees cannot see a published month yet (S-05)" with the `/schedule` description and `get_published_schedule`.
- **Auth/roles section:** add `display_name`, `set_display_name`, `/account` and the warning against a self-update policy on `profiles`.
- **UI section:** add the `--highlight` token.
- **Commands section:** add the new smoke steps and the new pgTAP coverage to the `npm run smoke` and `npm run test:db` descriptions.
- Add `src/lib/published-schedule.ts` and `src/lib/account.ts`.

### Success Criteria:

#### Automated Verification:

- The smoke run passes against a local preview with a freshly reset local stack: `npm run smoke`
- Lint, unit tests and type-check still pass: `npm run lint`, `npm test` and `npx astro check`

#### Manual Verification:

- CLAUDE.md's Schedule, Auth and UI sections describe `/schedule`, `/account`, both functions and `--highlight` correctly.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Testing Strategy

### Unit Tests:

- `account.test.ts`:
  - `parseDisplayName` trims, maps empty to null, accepts exactly 40 characters, rejects 41 and rejects non-strings;
  - the allow-list falls back on unknown text;
  - URL param order.
- `published-schedule.test.ts`:
  - error or null gives unknown, `[]` gives not published, and rows give published;
  - an assigned row with no name gives unknown;
  - URLs.
- Route-access and route-inventory rows for every new path, including the `/accounts` and `/schedules` lookalikes.

### Integration Tests:

- pgTAP (Phase 1): published-only reads for an employee and a manager, unpublish hiding the month again, the name fallback cases, the exact column set, no anon execute, a self-only name write that never changes a role, and direct column updates refused.
- Smoke (Phase 4): the page renders, the name is saved and the too-long name is refused, the anonymous POST is sent to sign-in, and the draft stays invisible to the employee.

### Manual Testing Steps:

1. Reset the local stack, generate station month + 1, override days 10 and 20, then publish.
2. Sign in as `employee@example.com` and set the display name "Ewa" on `/account`.
3. Open `/schedule` for that month. Check names, "You" plus the highlight on own shifts, and a selected-day panel with no emails.
4. As the manager, open `/schedule`. The employee's shifts read "Ewa", and the manager's own shifts are highlighted.
5. Unpublish. Both roles see "Not published yet" on reload.

## Performance Considerations

- One SQL function call per page load, over at most 124 shifts. The `schedules` lookup is by primary key and the shift scan uses the month filter.
- No paging is needed, because the count stays well under PostgREST's `max_rows`.

## Migration Notes

- `display_name` is nullable, so existing accounts need no backfill: they show their email prefix until they set a name.
- The migration is additive. Rolling back means dropping both functions and the column.
- Hosted: `npx supabase db push`, then deploy.

## References

- Research: `context/changes/view-published-schedule/research.md`
- Roadmap S-05 and its S-04 handoff: `context/foundation/roadmap.md:153-168`
- SECURITY DEFINER pattern: `supabase/migrations/20261007120000_publish_and_override_schedules.sql:126-205`
- Form-post endpoint pattern: `src/pages/api/manager/users/role.ts`, `src/lib/manager-users.ts`
- Calendar to reuse: `src/components/schedule/ScheduleCalendar.astro`
- Token precedent: `context/archive/2026-10-06-review-override-publish-schedule/plan.md:626`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Database read and write paths

#### Automated

- [x] 1.1 Migration applies on a fresh local stack: `npx supabase db reset` — bb05260
- [x] 1.2 Database rules tests pass, including the new asserts: `npm run test:db` — bb05260
- [x] 1.3 Generated types contain `display_name`, `get_published_schedule` and `set_display_name`, and `npx astro check` passes — bb05260
- [x] 1.4 Lint and unit tests still pass: `npm run lint` and `npm test` — bb05260

#### Manual

- [ ] 1.5 Sabotage pass: dropping the published filter fails the draft-read assert, then reverted

### Phase 2: Display name on /account

#### Automated

- [x] 2.1 Unit tests pass, including `account.test.ts`, the route-access rows and the route inventory: `npm test`
- [x] 2.2 Lint and type-check pass: `npm run lint` and `npx astro check`
- [x] 2.3 No colour literals in the new view: `npm run check:ui`

#### Manual

- [ ] 2.4 `/account` saves a trimmed name, refuses 41 characters, and clearing restores the email prefix
- [ ] 2.5 `/dev/account-states` shows every state legibly in the dark theme

### Phase 3: Published schedule on /schedule

#### Automated

- [ ] 3.1 Unit tests pass, including `published-schedule.test.ts`, the route-access rows, the route inventory and the existing schedule tests: `npm test`
- [ ] 3.2 Lint and type-check pass: `npm run lint` and `npx astro check`
- [ ] 3.3 No colour literals, including on the edited `ScheduleCalendar`: `npm run check:ui`
- [ ] 3.4 Production build succeeds: `npm run build`

#### Manual

- [ ] 3.5 Employee sees a published month with names, "You" plus the highlight on own shifts, and no email in the HTML
- [ ] 3.6 After unpublish both roles see "Not published yet"; the manager also gets the link
- [ ] 3.7 `/manager/schedule` unchanged apart from the "View published schedule" link
- [ ] 3.8 `/dev/published-schedule-states` legible in dark theme at phone width and from `lg`

### Phase 4: Smoke steps and documentation

#### Automated

- [ ] 4.1 The smoke run passes against a local preview with a freshly reset local stack: `npm run smoke`
- [ ] 4.2 Lint, unit tests and type-check still pass: `npm run lint`, `npm test` and `npx astro check`

#### Manual

- [ ] 4.3 CLAUDE.md describes `/schedule`, `/account`, both functions and `--highlight` correctly
