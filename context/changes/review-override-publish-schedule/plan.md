# S-04: Review, override and publish schedule — Implementation Plan

## Overview

The manager reviews the S-03 draft on `/manager/schedule`, changes the assignee of any shift (FR-005), and publishes the month (FR-006). Every override first shows what it would break and needs an explicit confirmation (FR-004, extended to hard rules and fairness). Publishing is refused while any station day has no one assigned (`prd.md:103`), and a published month is frozen until the manager unpublishes it.

## Current State Analysis

From `research.md`, checked against the code:

- **No update path and no published state in the database.** Both schedule tables have no update policy, and table-level UPDATE is revoked (`supabase/migrations/20261006140000_revoke_schedule_updates.sql:5-6`). `schedules` holds only `month, generated_at, generated_by` (`20261006120000_create_schedules.sql:7-11`).
- **A published month would be erased silently today.** `replace_schedule_draft` deletes the month's `schedules` row and re-inserts it, so every shift id changes (`create_schedules.sql:105-129`). Discard is a plain delete (`src/pages/api/manager/schedule/discard.ts:28`).
- **`summarizeSchedule` already finds most problems** (`src/lib/schedule-summary.ts:77-176`): `outsideAvailability`, `ruleBreaks` (12h and night fairness), `daysWithNoOne` and `touchesPreviousNight`.
  - It does not check one shift per person per station day.
  - It does not check back-to-back shifts inside the month.
  - It does not check whether M's last night touches M+1's 06:00 shift on day 1. No loader reads that M+1 shift (`src/lib/schedule.ts:203-282`).
  - The database misses these three as well: `schedule_shifts_no_overlap` is station-wide and ignores `employee_id`.
- **The page already loads what a review needs.** `/manager/schedule` loads shift ids (`src/pages/manager/schedule.astro:92`), but `ScheduleDayPanel` types its shifts as `SummaryShift`, which has no `id` (`ScheduleDayPanel.astro:3,9`). There is a single feedback slot, in `ScheduleActions.astro:40-51`.
- **Smoke matches some redirects exactly.** The generate and discard `Location` headers are matched exactly (`scripts/smoke.mjs:298-325`), so the URLs they produce must not change.
- **Two pgTAP files delete lock rows without first deleting drafts.** `availability_month_lock.test.sql:27` and `availability_ownership.test.sql:20` fail with 23503 when the local database holds a draft in those months. `availability_station_night.test.sql:22` already deletes drafts first.

## Desired End State

On `/manager/schedule`, a draft month shows a "Who" select on every shift of the selected day. Saving a change that introduces no problem updates the shift at once, and the result shows in that shift's row. Saving a change that introduces a problem first shows a confirm panel at the shift that lists every new problem:

- outside the person's availability
- a second shift that station day
- back to back with their other shift, including across a month boundary
- a new 12h or night fairness break
- a day left with no one

"Assign anyway" saves the change, "Cancel" leaves the shift as it was.

The draft card offers **Publish**. It is refused, with a message, while any day has no one assigned. Once a month is published:

- the card reads "Published <time>" and offers only **Unpublish**
- the shift selects disappear
- generate, regenerate, discard and override are refused by both the app and Postgres
- the month cannot be unlocked

Unpublish returns the month to a draft. The summary card also lists the hard-rule exceptions: same-day pairs, back-to-back pairs and touches with the next month's first morning.

Verification: `npm test`, `npm run test:db`, `npm run lint`, `npx astro check`, `npm run check:ui`, `npm run smoke` (local stack), and the manual walkthrough under Testing Strategy.

### Key Discoveries:

- `replace_schedule_draft` is SECURITY INVOKER (`create_schedules.sql:105-110`), so a published guard inside it applies to every caller. Its only caller is `generate.ts:67`.
- `schedules.month` references `availability_locks(month) on delete restrict` (`create_schedules.sql:8`). A published row keeps its month locked with no new rule. `/api/manager/months/lock.ts:41-49` already maps 23503 on unlock.
- `generateSchedule` reads only `previousNight` (`generate.ts:59-63`). Adding `nextMorning` to `ScheduleInputs` leaves the generator unchanged.
- Patterns to follow:
  - the two-step confirm in `ScheduleActions.astro:55-81` and `generate.ts:38-40`
  - per-row feedback in `/manager/users` (`&user=<id>`, `users.astro:44-51,85`)
  - the `NativeSelect` wrapper in `src/components/manager/RoleSelect.tsx` (rendered with no `client:*`)
  - the row-count check that discard uses (`discard.ts:28-34`)
- `route-inventory.test.ts` needs a row for every new file under `src/pages` and rejects `[param]` routes (L111-116), so a shift id travels in a form field.
- The test plan says "A policy change on an existing table goes into that table's file" (`test-plan.md` §6.2), so the new pgTAP asserts go into `supabase/tests/database/schedules.test.sql` (`plan(50)` today).

## What We're NOT Doing

- **No separate "accepted" state.** Publishing is the accept. There are two states: draft and published.
- **No pattern changes.** An override changes only `employee_id`. Using a different split for a day means regenerating.
- **No employee read path.** No published-read policies and no way to read other people's names. S-05 adds both. Publishing has no effect employees can see until then.
- **No override audit.** No `overridden_at`/`overridden_by` and no "Edited" marker. The PRD also declines override reasons (`prd.md:76`).
- **No generator changes.** The generator does not read M+1's draft. A regenerate of M after M+1 exists can still give M's last night to M+1's day-1 06:00 assignee. The summary now reports it as `touchesNextMorning`, and an override can fix it.
- **No live edits on a published month.** The manager unpublishes, overrides and republishes.
- **No confirm panel for Publish.** Publish is one click, because Unpublish reverses it. FR-006 leaves the confirmation UX open.
- **No successful publish in smoke.** The smoke month's draft is almost all Uncovered, so smoke checks only the refusal. pgTAP and the manual walkthrough cover publish and unpublish.
- **No change to the generate and discard redirects that smoke matches**, and no cleanup of the legacy `/manager/months` view beyond one new allow-listed message.

## Implementation Approach

Build the database guarantees first, then the pure validation, then the two UI flows. Each layer can be tested on its own.

- **Postgres is the real enforcement**, as in every earlier slice:
  - RLS keeps writes out of a published month.
  - `replace_schedule_draft` raises a dedicated SQLSTATE for a published month.
  - Publish and unpublish are SECURITY DEFINER RPCs that check `is_manager()`. `publish_schedule` also checks coverage, so no UPDATE grant on `schedules` is ever needed.
- **The app checks first, for clear messages.** Endpoints run the same checks before writing so they can redirect with allow-listed messages, then map the database codes as a backstop.
- **Override warnings are a pure diff of two summaries.** `summarizeSchedule` runs on the stored shifts (before) and on the same shifts with the one change applied (after). The diff keeps only what the change introduces and what involves the overridden shift, and the endpoint and the page compute it the same way from their own full reads. Neither trusts the URL beyond the shift id and the assignee id.

## Critical Implementation Details

- **The publish coverage rule must match `daysWithNoOne` exactly.**
  - In the app, a station date D counts as covered when some assigned shift starts in `[D 06:00, D+1 06:00)`.
  - In SQL, the equivalent is `count(distinct (starts_at - interval '6 hours')::date)` over the month's assigned shifts, compared with the number of days in the month. This holds because `schedule_shifts_month_matches_station_day` already keeps every shift inside the month's station days.
  - pgTAP must cover the boundary row: a month whose only gap is the last station day, covered only by an assigned 00:00–06:00 shift on day 1 of M+1. That shift counts as covered.
- **Freezing uses RLS, not triggers.**
  - The pgTAP fixtures and the two fixed availability tests run as the superuser and delete drafts during setup.
  - `on delete set null` (a deleted account) and `on delete cascade` must keep working.
  - A trigger would block all of these. RLS does not apply to superuser cleanup or to foreign-key actions.
- **Recompute confirm-panel warnings at save time; don't reuse old ones.**
  - With `confirm=override`, the endpoint saves without comparing against what the panel showed.
  - A warning that appeared in between is still listed by the summary after the redirect.

## Phase 1: Database — publish state and override path

### Overview

Add the published state and the override privilege, freeze a published month in Postgres, add the publish and unpublish RPCs, and prove all of it in pgTAP.

### Changes Required:

#### 1. Migration

**File**: `supabase/migrations/20261007120000_publish_and_override_schedules.sql` (new)

**Intent**: Store who published a month and when. Let managers change only a shift's assignee while the month is unpublished. Make every other write to a published month fail.

**Contract**:

- **`schedules`:** add `published_at timestamptz null` (null means draft) and `published_by uuid null references profiles(id) on delete set null`. Insert stays column-granted to `month` only, and there is no UPDATE grant or update policy on `schedules`.
- **`schedules_delete_manager`:** recreate it with `using (public.is_manager() and published_at is null)`.
- **`schedule_shifts` policies:**
  - Insert: recreate it so `with check` also requires the month's `schedules` row to be unpublished. Use an `exists (select 1 from public.schedules s where s.month = schedule_shifts.month and s.published_at is null)` subquery; managers can read `schedules`, so RLS on that table does not hide the row.
  - Delete: recreate it with the same requirement.
  - Update: a new `schedule_shifts_update_manager` with the same `using` and `with check`.
- **`grant update (employee_id) on public.schedule_shifts to authenticated;`** keeps the table-level UPDATE revoked.
- **`replace_schedule_draft`:** `create or replace` it so that it starts by raising `errcode 'SP001'` (message "schedule is published") when the target month's row has `published_at is not null`. The rest is unchanged.
- **New `public.publish_schedule(target_month date) returns void`:**
  - SECURITY DEFINER, `set search_path = ''`, execute granted to `authenticated` only.
  - Not a manager: raise `42501`.
  - No `schedules` row: raise `SP002`.
  - Already published: no-op.
  - Coverage incomplete (see Critical Implementation Details): raise `SP003`.
  - Otherwise: `update ... set published_at = now(), published_by = auth.uid() where month = target_month and published_at is null`.
- **New `public.unpublish_schedule(target_month date) returns void`:**
  - The same security and grants.
  - Not a manager: raise `42501`.
  - No row: raise `SP002`.
  - Otherwise set `published_at` and `published_by` to null (a no-op when already a draft).
- **Comments:** comment on both functions and the new columns, in the style of the existing migration.

#### 2. Database rules tests

**File**: `supabase/tests/database/schedules.test.sql`

**Intent**: Prove the new guarantees in the existing file for the table, and bump its `plan(N)` count.

**Contract**: Asserts. Each refusal has a control:

- **Override:**
  - A manager updates `employee_id` on a draft shift, including setting it to null.
  - Updating `starts_at`, `month` or `ends_at` is refused (no column privilege).
  - `has_column_privilege` is true for `employee_id` and false for the other three columns. The existing table-level `UPDATE = false` asserts still pass.
  - An employee's update affects 0 rows.
- **Publish:**
  - Refused with `SP003` when one day has no one assigned, including when the only gap is a day whose shifts are all uncovered.
  - The boundary case passes: the last station day covered only by the 00:00–06:00 shift on day 1 of M+1.
  - Sets `published_at` and `published_by` (`auth.uid()`).
  - An employee gets `42501`.
  - A missing draft gets `SP002`.
  - Publishing again is a no-op that keeps the original `published_at`.
- **A published month is frozen:**
  - An update, insert or delete on its shifts affects 0 rows or is refused.
  - Deleting its `schedules` row affects 0 rows.
  - `replace_schedule_draft` raises `SP001` and leaves the shifts unchanged.
  - Unlocking the month still fails with 23503.
- **Unpublish:**
  - Clears both columns, after which update, discard and replace work again.
  - An employee gets `42501`.

#### 3. Drafts no longer break the availability tests

**Files**: `supabase/tests/database/availability_month_lock.test.sql`, `supabase/tests/database/availability_ownership.test.sql`

**Intent**: Delete the affected months' `schedules` rows before deleting their locks, as `availability_station_night.test.sql:22` does, so a local draft or published month cannot fail the suite with 23503.

**Contract**: One `delete from public.schedules where month in (...)` line before each existing `delete from public.availability_locks`, covering the same months. Plan counts don't change.

#### 4. Regenerated types

**File**: `src/db/database.types.ts`

**Intent**: Pick up the new columns and the two RPCs.

**Contract**: `npx supabase gen types typescript --local`; never hand-edit the file.

### Success Criteria:

#### Automated Verification:

- Migrations apply cleanly on a reset: `npx supabase db reset`
- Database rules tests pass, including the new override, publish, freeze and unpublish asserts: `npm run test:db`
- Types regenerated and type check passes: `npx astro check`
- Unit tests still pass: `npm test`

#### Manual Verification:

- In Studio, with a local draft in station month + 1, `npm run test:db` still passes (the availability tests now delete drafts first)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Validation library

### Overview

Teach the summary the three missing hard rules, load M+1's first morning shift, add the pure override-warning diff, and extend the messages and URL builder. Everything here is pure and unit-tested.

### Changes Required:

#### 1. Hard-rule checks in the summary

**File**: `src/lib/schedule-summary.ts`

**Intent**: Report the per-person rules the generator keeps but an override can break, so that both the confirm panel and the summary card can show them.

**Contract**:

- **New optional input:** `nextMorning?: SummaryShift | null`, M+1's draft shift starting at 06:00 on M+1 day 1.
- **New `ScheduleSummary` fields:**
  - `sameDay: { assignee: string; shifts: [S, S] }[]`: two shifts of one person in one station day, one entry per pair, ordered by start.
  - `backToBack: { assignee: string; first: S; second: S }[]`: one shift of a person ends exactly when another of theirs starts, inside the month. A pair that is also `sameDay` is reported in both.
  - `touchesNextMorning: S[]`: M's shifts that end at `nextMorning.starts_at` and are held by `nextMorning.employee_id`. This is the mirror of `touchesPreviousNight`.
- **Uncovered shifts** never appear in these lists. Existing fields and their behaviour are unchanged.

#### 2. Override warnings

**File**: `src/lib/schedule-override.ts` (new)

**Intent**: Turn "summary before" and "summary after" into the list of problems this one change introduces. The endpoint and the page then agree on when a confirmation is needed and what it says.

**Contract**:

- **Two pure functions:**
  - `applyOverride(shifts, shiftId, employeeId | null)` returns a copy of the shifts with that one assignee replaced.
  - `overrideWarnings({ before, after, shiftId })` returns `OverrideWarning[]`. `before` and `after` are both `ScheduleSummary<S extends SummaryShift & { id: string }>`.
- **`OverrideWarning`** is a discriminated union:
  - `outside`: the shift is in `after.outsideAvailability`.
  - `sameDay`: a pair in `after.sameDay` contains the shift.
  - `backToBack`: a pair in `after.backToBack` contains the shift.
  - `previousNight` and `nextMorning`: the shift is in the matching `touches*` list.
  - `fairness`: a `{kind, shift id}` in `after.ruleBreaks` that is not in `before.ruleBreaks`. It can be on another shift; it carries that shift and its assignee.
  - `noOne`: a date in `after.daysWithNoOne` that is not in `before.daysWithNoOne`.
- **When there are no warnings:**
  - An empty array means no confirmation is needed.
  - Unchanged assignees produce no warnings, because `after` equals `before`.

#### 3. Loader, messages and URLs

**File**: `src/lib/schedule.ts`

**Intent**: Read M+1's first morning shift with the other inputs, and give the new endpoints their messages and redirect shapes without changing the existing outputs.

**Contract**:

- **`ScheduleInputs` ready state:** gains `nextMorning: ScheduleShiftRow | null`.
  - `loadScheduleInputs` adds one `loadAllPages` read: `schedule_shifts` with `month = M+1-01` and `starts_at = M+1-01T06:00:00`.
  - `buildScheduleInputs` returns `unknown` when that read fails.
  - `generate.ts` ignores the field.
- **New messages:**
  - `SCHEDULE_PUBLISHED_ERROR` = "Unpublish the schedule before changing it."
  - `PUBLISH_GAPS_ERROR` = "Assign someone on every day before publishing."
  - `STALE_SHIFT_ERROR` = "This shift is no longer in the draft. Reload and try again."
  - `INVALID_ASSIGNEE_ERROR` = "Invalid assignee"
  - `NO_SCHEDULE_ERROR` = "No schedule for this month"
  - `OVERRIDDEN_MESSAGE` = "Shift updated."
  - `PUBLISHED_MESSAGE` = "Schedule published."
  - `UNPUBLISHED_MESSAGE` = "Schedule unpublished. It is a draft again."
  - `UNLOCK_WITH_PUBLISHED_ERROR` = "Unpublish and discard this month's schedule before unlocking it."
  - The new error texts join `SCHEDULE_FEEDBACK_ERRORS`, except `UNLOCK_WITH_PUBLISHED_ERROR`, which is shown on `/manager/months` only.
- **`describeScheduleWriteError`** maps `SP001` to `SCHEDULE_PUBLISHED_ERROR`, `SP002` to `NO_SCHEDULE_ERROR` and `SP003` to `PUBLISH_GAPS_ERROR`.
- **`managerScheduleUrl` new params:**
  - status flags `overridden`, `published` and `unpublished`, which stay first, like `generated` and `discarded`
  - `shift` (a uuid) and `employee` (a uuid, or `none` for Uncovered), both kept only together with `month`
  - `confirm` widens to `"replace" | "override"`; `confirm: true` callers move to `"replace"`
- **Param order:** status, `month`, `day`, `confirm`, `shift`, `employee`. Existing outputs stay byte-identical; existing tests prove it.
- **`parseShiftParam`** is a new helper that accepts a UUID only.

#### 4. Unit tests

**Files**: `src/lib/schedule-summary.test.ts`, `src/lib/schedule-override.test.ts` (new), `src/lib/schedule.test.ts`

**Intent**: Pin every new rule with literal-valued fixtures, following test-plan §6.1.

**Contract**: Cases:

- **`sameDay`:** a pair, and a three-shift day for one person (it gives the pairs).
- **`backToBack`:**
  - inside a day (06–12 then 12–18)
  - across days (18–06 then 06:00 the next day)
  - not reported for two different people at a touching point
- **`touchesNextMorning`:**
  - same person: reported
  - another person: not reported
  - `nextMorning` null or uncovered: not reported
- **`overrideWarnings`:**
  - each kind on its own
  - a fairness break that lands on a third person's shift
  - an unchanged assignee gives no warnings
  - clearing the last assigned shift of a day gives `noOne`
  - clearing a shift that is outside availability removes a problem and adds no warning
- **URL builder:**
  - existing outputs unchanged
  - the new status flags come first
  - `employee=none`
  - `shift` dropped without `month`
- **`resolveScheduleFeedbackError`** accepts the new messages.
- **`buildScheduleInputs`** returns `unknown` when `nextMorning` fails.

### Success Criteria:

#### Automated Verification:

- Unit tests pass, including the new summary, override and URL cases: `npm test`
- Lint passes: `npm run lint`
- Type check passes: `npx astro check`

#### Manual Verification:

- Stryker on `src/lib/schedule-override.ts`: survivors that would change a manager's warnings are killed or recorded

  (Run `npx stryker run --mutate "src/lib/schedule-override.ts"`. For each survivor that would change which warnings a manager sees, add a literal assertion, or record why it is harmless, per test-plan §6.1 step 9.)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Override — endpoint and day panel

### Overview

Let the manager change a shift's assignee from the day panel, with the warn-and-confirm step and per-shift feedback. Show the hard-rule exceptions in the summary card.

### Changes Required:

#### 1. Override endpoint

**File**: `src/pages/api/manager/schedule/override.ts` (new)

**Intent**: Save one assignee change after recomputing its warnings from a full read. Refuse it without the confirm when there are warnings.

**Contract**: `POST` form fields `month`, `day`, `shift`, `employee` (`""` or a uuid) and `confirm` (optional, `"override"`). Steps:

1. **Validate the form:**
   - `month` must be in `scheduleMonths()`; otherwise `INVALID_MONTH_ERROR`.
   - `shift` must be a uuid; otherwise `STALE_SHIFT_ERROR`.
   - `day` is kept only when it is a date of the month.
2. **Check the client:** a null client gives `SUPABASE_NOT_CONFIGURED_ERROR`.
3. **Read in parallel:** `loadScheduleInputs`, the `schedules` row and all the month's shifts (paged, as on the page).
   - Any read unknown: `GENERIC_SCHEDULE_WRITE_ERROR` (logged).
   - No draft: `NO_SCHEDULE_ERROR`.
   - Published: `SCHEDULE_PUBLISHED_ERROR`.
   - Shift not among the shifts read: `STALE_SHIFT_ERROR`.
   - `employee` neither `""` nor a loaded member id: `INVALID_ASSIGNEE_ERROR`.
4. **Compute the warnings.** Unchanged assignee: redirect `overridden=1` with no write. Otherwise compute `overrideWarnings` from `summarizeSchedule` before and after.
5. **Warnings present and no confirm:** redirect to `managerScheduleUrl({ month, day, confirm: "override", shift, employee })`. This is not an error status.
6. **Write:** `update({ employee_id }).eq("id", shift).eq("month", monthStart(month)).select("id")`.
   - Error: `describeScheduleWriteError`.
   - 0 rows: `STALE_SHIFT_ERROR`. This covers an RLS refusal on a month published in between, and a regenerate.
7. **Success:** redirect `managerScheduleUrl({ month, day, overridden: true, shift })`.

Every error redirect carries `month`, `day` and `shift`, so the feedback renders in the shift's row.

#### 2. Assignee select

**File**: `src/components/schedule/AssigneeSelect.tsx` (new)

**Intent**: A server-rendered `NativeSelect` of "Uncovered" plus every member, with the current assignee selected, the same way `RoleSelect.tsx` is built.

**Contract**: Props `{ id, name, value: string | null, options: { value: string; label: string }[] }`. Rendered with no `client:*`. The option for Uncovered has the value `""`. Labels come from `accountLabel(member).text`, computed by the caller.

#### 3. Day panel with override forms, feedback and confirm panel

**File**: `src/components/schedule/ScheduleDayPanel.astro`

**Intent**: Each shift row keeps its time and duration, and gains a "Who" select with a Save button while the month is an unpublished draft. The overridden shift's row shows its feedback, or the confirm panel that lists the warnings.

**Contract**:

- **Props:**
  - `shifts` widens to `ScheduleShiftRow[]` (with `id`).
  - New props: `month`, `day`, `editable: boolean`, `members` (for the options), `feedback: { shiftId, kind, message } | null` and `confirm: { shiftId, employee: string | null, warnings: OverrideWarning[] } | null`.
- **Read-only rendering:** when not `editable`, rows render as today.
- **Form:** each row's form posts to `/api/manager/schedule/override` with hidden `month`, `day` and `shift`. Each select has a `<label for>`, following the `UserRoleRow.astro` pattern.
- **Confirm panel:**
  - Lists one plain-English line per warning, for example "Outside alice@…'s availability", "Second shift on 12 Nov for alice@…", "Back to back with alice@…'s 18:00–06:00", "Gives bob@… 3 nights, lowest available 1", "No one assigned on 14 Nov".
  - "Assign anyway" posts the same fields plus `confirm=override`.
  - "Cancel" links to `managerScheduleUrl({ month, day })`.
- **Uncovered marker:** unchanged.
- **Tokens:** design tokens only. The colour-literal check covers this folder.

#### 4. Page wiring

**File**: `src/pages/manager/schedule.astro`

**Intent**:

- Pass `nextMorning` to `summarizeSchedule`.
- Derive the per-shift feedback from `?error=`/`?overridden=1` together with `&shift=`, which is valid only when it is a loaded shift id. With no valid shift, the feedback stays in the card slot as today.
- Rebuild the confirm state from `?confirm=override&shift=&employee=` by recomputing `overrideWarnings` from the page's own reads. The panel is shown only when the draft is unpublished, the shift and the employee are known and the warnings are non-empty.
- Set `editable` to a draft that is unpublished and has no unknown read.

**Contract**: The draft query also selects `published_at, published_by`, which the page needs in Phase 4. `confirm=replace` handling is unchanged.

#### 5. Summary card hard-rule section

**File**: `src/components/schedule/ScheduleSummary.astro`

**Intent**: Show the hard-rule exceptions next to the fairness exceptions, so the manager sees everything that will be published.

**Contract**:

- **New "Hard-rule exceptions" block:** "None" or one line per `sameDay`/`backToBack` entry, plus a destructive alert for `touchesNextMorning`, mirroring the existing `touchesPreviousNight` alert.
- **Alert wording:** both cross-month alerts now say the conflict can be fixed by an override or a regenerate.

#### 6. Kitchen sink, route row, smoke

**Files**: `src/pages/dev/schedule-states.astro`, `src/lib/route-inventory.test.ts`, `scripts/smoke.mjs`

**Intent**: Every new state is visible in the dev page, the endpoint is listed in the route inventory, and the warn → confirm → saved path runs end to end.

**Contract**:

- **Kitchen sink:** editable rows, a row with success feedback, a row with an error, the confirm panel with one warning of each kind, the hard-rule section with entries, and the next-morning alert.
- **Route inventory:** `"/api/manager/schedule/override": "manager"`.
- **Smoke:** after "schedule page shows the draft", all steps `needs: "scheduleMonthClean"`:
  1. The employee's POST to `/override` gets the 403 page.
  2. The manager reads the day-1 page and takes the first shift id from a `data-shift-id` attribute added to each row.
  3. The manager POSTs that shift assigned to the manager with no confirm. Expected: 302 to `/manager/schedule?month=<m>&day=<m>-01&confirm=override&shift=<id>&employee=<managerId>`. The manager has no windows in that month, so this is an `outside` warning. The manager id comes from the seed constant.
  4. The same POST with `confirm=override` gives 302 `?overridden=1&month=…&day=…&shift=<id>`.
  5. The day-1 page shows the manager on that shift.

  The existing discard and unlock steps then clean up as today.

### Success Criteria:

#### Automated Verification:

- Unit tests pass, including the route inventory row: `npm test`
- Lint and type check pass: `npm run lint`, `npx astro check`
- Colour-literal check passes on the schedule views: `npm run check:ui`
- Smoke passes against a local stack and build, including the new override steps: `npm run smoke`

#### Manual Verification:

- A clean override saves at once and shows "Shift updated." in that row
- Outside-availability and same-day overrides open the confirm panel; Cancel keeps, "Assign anyway" saves
- Assigning someone on days 10 and 20 clears them from the "days with no one" notice
- Keyboard: selects labelled with visible focus, confirm buttons reachable
- `/dev/schedule-states` shows every new override state in the dark theme

  (Use station month + 1 with the demo team. A clean override is a covered shift moved to another person who is available. In the confirm panel, check that the lines match the warnings.)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 4: Publish and unpublish

### Overview

Add the publish and unpublish endpoints and the published state of the draft card, refuse generate and discard on a published month with a clear message, and update the docs.

### Changes Required:

#### 1. Publish and unpublish endpoints

**Files**: `src/pages/api/manager/schedule/publish.ts`, `src/pages/api/manager/schedule/unpublish.ts` (new)

**Intent**: Publish refuses a month with a day that has no one, from the app's own full read, and then lets the RPC re-check. Unpublish returns the month to a draft.

**Contract**:

- **Form:** `POST` with field `month`, which must be in `scheduleMonths()`.
- **Publish:**
  1. Read the inputs, the shifts and the draft row in full.
     - Unknown: `GENERIC_SCHEDULE_WRITE_ERROR`.
     - No draft: `NO_SCHEDULE_ERROR`.
     - Already published: redirect `published=1` (idempotent).
     - `summarizeSchedule(...).daysWithNoOne` non-empty: `PUBLISH_GAPS_ERROR`.
  2. Call `supabase.rpc("publish_schedule", { target_month })`. Errors go through `describeScheduleWriteError`.
  3. Redirect `managerScheduleUrl({ month, published: true })`.
- **Unpublish:** call `rpc("unpublish_schedule")`, map its errors the same way, then redirect `unpublished: true`.

#### 2. Generate and discard refuse a published month

**Files**: `src/pages/api/manager/schedule/generate.ts`, `src/pages/api/manager/schedule/discard.ts`

**Intent**: A published month gets `SCHEDULE_PUBLISHED_ERROR`, not "Confirm replacing" or "No draft to discard".

**Contract**:

- **Generate:** the existing-draft read also selects `published_at`. When it is set, redirect with `SCHEDULE_PUBLISHED_ERROR` before the confirm check and the lock upsert.
- **Discard:** on 0 deleted rows, read the row. If it exists and is published, use `SCHEDULE_PUBLISHED_ERROR`; otherwise `NO_DRAFT_ERROR` as today.
- **Smoke-matched URLs:** the success redirects are unchanged.

#### 3. Draft card published state

**File**: `src/components/schedule/ScheduleActions.astro` (and `src/pages/manager/schedule.astro` for props and feedback)

**Intent**:

- Show whether the month is a draft or published.
- Offer **Publish** only on a draft, with a notice instead of the button while days have no one.
- Offer only **Unpublish** once published.

**Contract**:

- **Props:**
  - `draft` gains `publishedAt: string | null`.
  - New prop `daysWithNoOne: number`.
- **Published card:**
  - Heading "Published — <month>".
  - The line "Published <formatStationInstant>".
  - An Unpublish form. Regenerate and Discard are hidden.
  - The section carries `data-schedule-published` as well as `data-schedule-draft`, so the existing smoke marker still matches.
- **Draft card:**
  - A Publish form next to Regenerate and Discard while `daysWithNoOne === 0`.
  - Otherwise the muted line "Assign someone on every day to publish (N days have no one)."
- **Page feedback:** the page maps `published=1` and `unpublished=1` to the new messages.
- **Months-page copy:** the "Discarding keeps the month locked" note mentions that a published month must be unpublished first.

#### 4. Unlock message for a published month

**File**: `src/pages/api/manager/months/lock.ts`, `src/pages/manager/months.astro` if it needs nothing more

**Intent**: Unlocking a published month says to unpublish and discard first.

**Contract**:

- **On 23503 during unlock:** read `schedules.published_at` for the month.
  - Set: redirect with `UNLOCK_WITH_PUBLISHED_ERROR`.
  - Otherwise: `UNLOCK_WITH_DRAFT_ERROR`, unchanged, because smoke matches it.
- **Raw `error.message` fallback:** the legacy path stays out of scope.

#### 5. Kitchen sink, route rows, smoke, docs

**Files**: `src/pages/dev/schedule-states.astro`, `src/lib/route-inventory.test.ts`, `scripts/smoke.mjs`, `CLAUDE.md`

**Intent**: The new states are visible, the routes are inventoried, publish is guarded end to end, and the docs describe the lifecycle.

**Contract**:

- **Kitchen sink:** a published card, a draft card with the "days have no one" notice, a draft card with Publish, and every new allow-listed message.
- **Route inventory:** rows for `/api/manager/schedule/publish` and `/unpublish` as `"manager"`.
- **Smoke, before the generate:** the employee's POST to `/publish` gets the 403 page, and an anonymous one is sent to sign-in, both with no effect (the existing gate step proves it).
- **Smoke, after the override steps:** the manager's publish of the mostly Uncovered smoke month gets 302 `?error=<PUBLISH_GAPS_ERROR>&month=…`. The page still shows no `data-schedule-published`. Discard and unlock then run as today.
- **`CLAUDE.md` Schedule section:**
  - the published state and the freeze, with the SQLSTATEs
  - the publish and unpublish RPCs and the coverage rule
  - the override endpoint and warnings
  - the new `summarizeSchedule` fields and `nextMorning`
  - the lifecycle (generate → override → publish → unpublish → discard → unlock)
  - the updated smoke description in Commands

### Success Criteria:

#### Automated Verification:

- Unit tests pass, including the route inventory rows: `npm test`
- Database rules tests still pass: `npm run test:db`
- Lint, type check and colour literals pass: `npm run lint`, `npx astro check`, `npm run check:ui`
- Production build succeeds: `npm run build`
- Smoke passes against the local stack, including the publish refusal and the employee 403: `npm run smoke`

#### Manual Verification:

- Publish is blocked by the "days have no one" notice until days 10 and 20 are covered, then publishing shows Published with only Unpublish
- A published month has no selects, no Regenerate or Discard, and refuses crafted discard/override and unlock with the published messages
- Unpublish restores the draft; discard then unlock works
- `/dev/schedule-states` shows the published and blocked cards in the dark theme

  (A crafted discard or override POST shows "Unpublish the schedule before changing it.", and the unlock on `/manager/months` shows the published message.)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Testing Strategy

### Unit Tests:

- **`schedule-summary.test.ts`:** `sameDay`, `backToBack` and `touchesNextMorning`, with literal fixtures for a day-boundary touch, an intra-day touch, two different people at the touching point, and a null or uncovered `nextMorning`.
- **`schedule-override.test.ts`:** each warning kind on its own; a fairness break on a third person's shift; no warnings for an unchanged assignee; `noOne` when clearing a day's last assigned shift; and no new warning when an override removes a problem.
- **`schedule.test.ts`:** URL order, existing outputs unchanged, the new allow-list entries, the SQLSTATE mapping, and `buildScheduleInputs` with a failed `nextMorning` read.
- **`route-inventory.test.ts`:** three new endpoint rows.

### Integration Tests:

- **pgTAP (`schedules.test.sql`):**
  - the override column grant and policy
  - publish coverage, including the 00:00–06:00 boundary
  - the freeze on update, insert, delete, discard, replace and unlock
  - unpublish
  - role refusals
- **Smoke:**
  - override warn → confirm → saved
  - publish refused while days have no one
  - the employee's override and publish get 403, and the anonymous publish is sent to sign-in

### Manual Testing Steps:

1. `npx supabase db reset` (seeds the demo team in station month + 1), `npm run dev`, then sign in as `manager@example.com`.
2. Generate station month + 1. Days 10 and 20 have no one, and Publish shows the notice.
3. On day 10, assign `demo-full-a@` to the 06:00 shift. Expect the confirm panel with "Outside … availability". Confirm, and day 10 leaves the notice.
4. On a covered day, give someone a second shift. Expect the "Second shift" (and, if they touch, "Back to back") lines. Cancel.
5. Cover day 20 the same way, then Publish. The card shows Published, and the selects are gone.
6. Try Discard by POSTing it from the dev tools, and try Unlock on `/manager/months`. Both are refused with the published messages.
7. Unpublish, Discard, Unlock.

## Performance Considerations

- **Override and publish reads.** Each override or publish request does the same full reads as the page: profiles, windows, carry-overs, the two boundary shifts and the month's shifts. It then runs `summarizeSchedule` twice. At station scale (around 90 shifts and a few hundred windows) this costs about a millisecond of CPU and stays within Workers Free (the project stays on the Free plan). No caching.
- **New read.** The `nextMorning` read is one equality query on `schedule_shifts`. No new index is needed at this scale.

## Migration Notes

- **Existing drafts.** The migration adds nullable columns, so existing local and hosted drafts become unpublished drafts with no backfill.
- **Hosted.** Apply with `npx supabase db push` after the PR merges, as for earlier slices.
- **Rollback.** A follow-up migration that drops both RPCs, both columns and the update policy and grant, and restores the original policies and `replace_schedule_draft`. No data needs converting.

## References

- Research: `context/changes/review-override-publish-schedule/research.md`
- PRD: `context/foundation/prd.md` FR-004–FR-006, Business Logic "Insufficient coverage"
- Roadmap: `context/foundation/roadmap.md` S-04 handoff
- S-03 change: `context/changes/generate-monthly-schedule/` (plan, impl review F1/F4/F9)
- Patterns:
  - `src/pages/api/manager/schedule/generate.ts:33-40` (confirm two-step)
  - `src/pages/api/manager/schedule/discard.ts:28-34` (row-count check)
  - `src/components/manager/RoleSelect.tsx` (select wrapper)
  - `src/pages/manager/users.astro:44-51,85` (per-row feedback)
  - `supabase/tests/database/availability_station_night.test.sql:22` (delete drafts before locks)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Database — publish state and override path

#### Automated

- [x] 1.1 Migrations apply cleanly on a reset: `npx supabase db reset` — 0e1296f
- [x] 1.2 Database rules tests pass, including the new override, publish, freeze and unpublish asserts: `npm run test:db` — 0e1296f
- [x] 1.3 Types regenerated and type check passes: `npx astro check` — 0e1296f
- [x] 1.4 Unit tests still pass: `npm test` — 0e1296f

#### Manual

- [ ] 1.5 In Studio, with a local draft in station month + 1, `npm run test:db` still passes (the availability tests now delete drafts first)

### Phase 2: Validation library

#### Automated

- [x] 2.1 Unit tests pass, including the new summary, override and URL cases: `npm test` — 08be8a8
- [x] 2.2 Lint passes: `npm run lint` — 08be8a8
- [x] 2.3 Type check passes: `npx astro check` — 08be8a8

#### Manual

- [ ] 2.4 Stryker on `src/lib/schedule-override.ts`: survivors that would change a manager's warnings are killed or recorded

### Phase 3: Override — endpoint and day panel

#### Automated

- [x] 3.1 Unit tests pass, including the route inventory row: `npm test` — 504e714
- [x] 3.2 Lint and type check pass: `npm run lint`, `npx astro check` — 504e714
- [x] 3.3 Colour-literal check passes on the schedule views: `npm run check:ui` — 504e714
- [x] 3.4 Smoke passes against a local stack and build, including the new override steps: `npm run smoke` — 504e714

#### Manual

- [ ] 3.5 A clean override saves at once and shows "Shift updated." in that row
- [ ] 3.6 Outside-availability and same-day overrides open the confirm panel; Cancel keeps, "Assign anyway" saves
- [ ] 3.7 Assigning someone on days 10 and 20 clears them from the "days with no one" notice
- [ ] 3.8 Keyboard: selects labelled with visible focus, confirm buttons reachable
- [ ] 3.9 `/dev/schedule-states` shows every new override state in the dark theme

### Phase 4: Publish and unpublish

#### Automated

- [x] 4.1 Unit tests pass, including the route inventory rows: `npm test` — 166119a
- [x] 4.2 Database rules tests still pass: `npm run test:db` — 166119a
- [x] 4.3 Lint, type check and colour literals pass: `npm run lint`, `npx astro check`, `npm run check:ui` — 166119a
- [x] 4.4 Production build succeeds: `npm run build` — 166119a
- [x] 4.5 Smoke passes against the local stack, including the publish refusal and the employee 403: `npm run smoke` — 166119a

#### Manual

- [ ] 4.6 Publish is blocked by the "days have no one" notice until days 10 and 20 are covered, then publishing shows Published with only Unpublish
- [ ] 4.7 A published month has no selects, no Regenerate or Discard, and refuses crafted discard/override and unlock with the published messages
- [ ] 4.8 Unpublish restores the draft; discard then unlock works
- [ ] 4.9 `/dev/schedule-states` shows the published and blocked cards in the dark theme
