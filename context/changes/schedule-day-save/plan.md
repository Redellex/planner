# Day-level save for manual assignments (S-08) Implementation Plan

## Overview

On `/manager/schedule` the manager today saves each shift of a station day with its own Save. This change makes the day panel one form with one Save that stores every assignee change of that day at once: all-or-nothing, with the warnings of the combined change shown once before "Assign anyway" (roadmap S-08, MS-03: "one save button for that day so i don't need to save 2-3 times").

## Current State Analysis

Every layer handles one shift per request (research `context/changes/schedule-day-save/research.md`, Summary):

- The day panel renders one `<form>` per editable row, posting `month`, `day`, `shift`, `employee` (`src/components/schedule/ScheduleDayPanel.astro:151-162`). Feedback and the confirm panel are keyed to one `shiftId` (`:25-34`, `:132-133`).
- The endpoint reads one `shift` and does a single PostgREST update filtered by id and month; 0 rows means stale (`src/pages/api/manager/schedule/override.ts:34`, `:120-132`). It has no check against the value the manager saw.
- `overrideWarnings` diffs two summaries and keeps hard-rule warnings only for the one `shiftId` (`src/lib/schedule-override.ts:34-68`, `:94-101`). `applyOverride` replaces one assignee (`:25-31`).
- The confirm step travels as `?confirm=override&shift=&employee=` (`src/lib/schedule.ts:127-186`) and the page rebuilds the panel from its own reads (`src/pages/manager/schedule.astro:177-216`). Row placement of feedback depends on `?shift=` (`:170-175`).
- The database's only update path is `grant update (employee_id)` plus the manager-only, unpublished-month policy `schedule_shifts_update_manager` (`supabase/migrations/20261007120000_publish_and_override_schedules.sql:61-86`); the guard trigger locks the month's `schedules` row FOR SHARE on every direct shift write and raises SP001 on a published month (`20261007130000_guard_published_schedule_shifts.sql`). Separate PostgREST updates are separate transactions, so a multi-row day save cannot be atomic without a function.
- Smoke pins the single-shift contract (`scripts/smoke.mjs:470-532`), as do `schedule.test.ts` (`:61-81`, `:137-169`) and `schedule-override.test.ts` (17 tests through a one-change helper, `:25-46`).

## Desired End State

- An editable day panel is one form: each row keeps `<li data-shift-id>` with its "Who" select, and one Save at the bottom posts every row of the day.
- The endpoint `/api/manager/schedule/override` (same path) saves the day's changes in one database call, `public.save_schedule_day`, which writes all of them or none.
- Stale rule: if any stored shift of the day differs from what the manager saw (another assignee, or a different set of shifts after a regenerate), nothing is saved and the panel shows "This day changed since you opened it. Reload and try again."
- Warnings are the diff of the whole day's change set, so two changes that only conflict with each other (a same-day or back-to-back pair) are caught. One confirm panel per day lists the pending changes and every warning; the selects keep the manager's picks while it is open. "Assign anyway" saves exactly the listed set; a changed pick goes through the check again.
- Save with no changed select writes nothing and shows the neutral notice "No changes to save."; a real save shows "Day saved." in the day panel.
- pgTAP, unit tests, the kitchen sink and smoke cover the new contract; CLAUDE.md describes it.

Verify: `npm test`, `npm run test:db`, `npx astro check`, `npm run lint`, `npm run check:ui`, `npm run smoke` against a local build, plus the manual steps under Testing Strategy.

### Key Discoveries:

- `replace_schedule_draft` is the atomic multi-row precedent: SECURITY INVOKER, `search_path = ''`, SP001 before touching anything (`20261007120000_publish_and_override_schedules.sql:89-116`).
- On a published month an UPDATE is filtered by RLS to 0 rows with no error (`supabase/tests/database/schedules.test.sql:525-531`), so the function must check the published state itself and compare updated-row counts.
- `SELECT … FOR UPDATE` on `schedule_shifts` is allowed for a manager (they hold `update (employee_id)`); `FOR SHARE` on `schedules` is not (no UPDATE grant there), which is why the guard trigger is SECURITY DEFINER. The function locks the shifts only and leaves the `schedules` lock to the trigger.
- A day has at most 4 shifts (6×4 pattern), so a confirm URL carrying every row (id, seen assignee, new assignee) stays short.
- `describeScheduleWriteError` maps 23503 to `MONTH_UNLOCKED_ERROR` (`src/lib/schedule.ts:102-103`); for an `employee_id`-only update a 23503 can only be the assignee FK, so this call maps it to `INVALID_ASSIGNEE_ERROR`.
- Smoke's `request` passes `form` to `new URLSearchParams(...)` (`scripts/smoke.mjs:93`), so repeated fields work by passing an array of `[name, value]` pairs; `selectedAssignee` (`:159-169`) keeps working as long as each row's select stays inside its `<li data-shift-id>`.
- `PublishedDayPanel.astro:34` shares the `data-shift-id` marker; the published view is untouched.

## What We're NOT Doing

- No change to the generator, the summary rules, publish/unpublish, discard or the published `/schedule` view.
- No version token or cross-day concurrency guard: two managers saving clean changes on different days can still create an unwarned pair (S-04 impl-review F4, accepted; roadmap parks the version token).
- No per-row Save and no second write path: the single-shift contract is replaced, not kept beside the day save.
- No client-side hydration, no "unsaved changes" indicator and no submit-button disabling (no JS; a double submit is handled server-side, see Phase 3).
- No change to which months are editable or to RLS policies and grants on the existing tables.

## Implementation Approach

Bottom-up, keeping the app working after every phase: the database function first (unused until Phase 3), then the pure logic with its tests (the old endpoint keeps compiling against the generalized helpers), then the endpoint, page, day panel and kitchen sink swap together so the form and the endpoint never disagree, then smoke and docs.

The day form posts, per row, the shift id, the assignee the manager saw (`was`) and the chosen one (`to`). Only rows with `to ≠ was` are changes; the stale rule compares every row's `was` with the stored value, both in the endpoint (from its full read, to give the right message before computing warnings) and in the function (under row locks, for the race). The same row triple, encoded `<shift>:<was|none>:<to|none>`, is the confirm URL's `row=` parameter and the confirm form's `confirmed` field.

## Critical Implementation Details

- **Check order in the endpoint.** After the full reads: no draft → `NO_SCHEDULE_ERROR`; published → `SCHEDULE_PUBLISHED_ERROR`; no row changed (`to = was` everywhere) → `?unchanged=1`; every stored value already equals its `to` (a double submit after a successful save) → `?overridden=1`; posted shift set ≠ the day's stored shift set, or any stored value ≠ its `was` → `DAY_CHANGED_ERROR`; an unknown `to` → `INVALID_ASSIGNEE_ERROR`; then warnings. The idempotent check must come before the stale check, or the second click of a double submit reports "This day changed" although the first one saved.
- **Confirm acceptance.** `confirm=override` is honoured only when the posted rows equal the posted `confirmed` rows as a set (same shift, was, to). Otherwise the post is a plain Save: warnings are recomputed and, if any, the manager gets a fresh confirm step for the new set. This keeps FR-004 (explicit confirm of the warnings shown) while the selects stay editable during confirm.

## Phase 1: Database: atomic day save

### Overview

Add `public.save_schedule_day`, the only way a day's changes are written, with its own pgTAP file.

### Changes Required:

#### 1. Migration

**File**: `supabase/migrations/20261008120000_save_schedule_day.sql`

**Intent**: One transaction that verifies the manager saw the day as it is stored and then updates the changed assignees, so a day lands whole or not at all and a concurrent change is never overwritten.

**Contract**: `public.save_schedule_day(target_month date, station_day date, rows jsonb) returns integer` (number of shifts updated). `rows` = `[{ "id": uuid, "was": uuid|null, "employee_id": uuid|null }]`, one entry per shift of the station day. SECURITY INVOKER, `set search_path = ''`; execute revoked from `public`, `anon`, granted to `authenticated`; a `comment on function` listing the SQLSTATEs. In order:

- not `public.is_manager()` → 42501;
- duplicate ids in `rows` → 22023;
- no `schedules` row for `target_month` → SP002; `published_at` set → SP001;
- lock the day's stored shifts (`month = target_month and (starts_at - interval '6 hours')::date = station_day`) `FOR UPDATE`; if their id set ≠ the `rows` id set, or any stored `employee_id is distinct from` its `was` → SP004 (`'schedule day changed'`);
- update `employee_id` for the rows where `employee_id is distinct from was`, filtered by id and `target_month`; if the updated count ≠ the number of changed rows → SP004;
- an unknown `employee_id` fails on the existing FK (23503). Every update still passes RLS, the column grant and the guard trigger (depth 1 inside the function).

#### 2. Database rules tests

**File**: `supabase/tests/database/schedule_day_save.test.sql` (new, per `context/foundation/test-plan.md` §6.2)

**Intent**: Prove the function's refusals, its atomicity and that a refusal left the rows intact, each refusal paired with a control.

**Contract**: Own fixtures (`10000000-…` users on `@db-rules.test`: manager Mg, employees A and B; M+1 locked with a draft whose station day 1 is 8+8+8). Assertions at least:

- Mg saves two changes of day 1 in one call → returns 2, both stored (control); a call with `rows` equal to the stored state → returns 0, nothing changed;
- one stale `was` among two changes → SP004, and as `postgres` neither row changed (snapshot compare);
- `rows` missing one shift of the day, or holding a shift of another day → SP004;
- an unknown assignee among valid changes → 23503, nothing changed;
- duplicate id → 22023;
- A (employee) → 42501, rows intact;
- a month with no draft → SP002;
- the month published (set as owner) → SP001, rows intact; after unpublishing as owner the same call succeeds (control);
- anon cannot execute the function.

#### 3. Generated types

**File**: `src/db/database.types.ts`

**Intent**: Expose the new RPC to the typed client.

**Contract**: Regenerated with `npx supabase gen types typescript --local`; never hand-edited.

### Success Criteria:

#### Automated Verification:

- Migration applies on a fresh reset: `npx supabase db reset`
- Database rules tests pass, the new file included: `npm run test:db`
- `src/db/database.types.ts` contains `save_schedule_day` after regeneration
- Type check passes: `npx astro check`

#### Manual Verification:

- Sabotage check (§6.2 item 11): with the stale comparison removed from the live function, `npm run test:db` goes red; restored with `npx supabase db reset`

**Implementation Note**: After this phase and its automated verification pass, pause for manual confirmation before Phase 2.

---

## Phase 2: Pure logic: combined warnings, row codec, URL contract

### Overview

Generalize the warning diff to a set of changes and define the day row, its URL/form encoding, the comparisons and the new messages, all pure and unit-tested.

### Changes Required:

#### 1. Warning diff over a change set

**File**: `src/lib/schedule-override.ts`, `src/lib/schedule-override.test.ts`

**Intent**: The day's changes are checked together, so a hard-rule problem involving any changed shift (including a pair of two changed shifts) is warned once.

**Contract**: `applyOverrides(shifts, changes: ReadonlyMap<string, string | null>)` replaces `applyOverride`; `overrideWarnings({ before, after, shiftIds: ReadonlySet<string> })` replaces the single `shiftId`; `candidates` keeps `outside`/`sameDay`/`backToBack`/`previousNight`/`nextMorning` when they involve any id in the set; fairness and `noOne` unchanged; `warningKey` unchanged (a pair appears once). Tests: the existing 17 move to the set form (one-element set), plus: two changed shifts of one day to the same person → one `sameDay`; two changed touching shifts → one `backToBack`; a change that removes a problem while another adds one → only the added one; an empty change set → none.

#### 2. Day rows, URL contract and messages

**File**: `src/lib/schedule.ts`, `src/lib/schedule.test.ts`

**Intent**: The confirm URL carries the whole day's rows, the result statuses cover the new outcomes, and the messages match the day save.

**Contract**:

- `DayRow = { shift: string; was: string | null; to: string | null }`; `formatDayRow(row)` → `<shift>:<was|none>:<to|none>`; `parseDayRow(value)` → `DayRow | null` (shift and non-`none` parts must be UUIDs).
- `ManagerScheduleUrlParams`: drop `shift`/`employee`, add `rows?: DayRow[]` (repeated `row=` in the given order, only with `month`) and `unchanged?: boolean`. Order: status (`error=`, `generated=1`, `discarded=1`, `overridden=1`, `unchanged=1`, `published=1`, `unpublished=1`), `month`, `day`, `confirm`, `row`….
- Messages: `DAY_CHANGED_ERROR = "This day changed since you opened it. Reload and try again."` replaces `STALE_SHIFT_ERROR` (also in `SCHEDULE_FEEDBACK_ERRORS`); `OVERRIDE_NOT_SAVED_ERROR = "Nothing was saved. Choose the assignees again."`; `OVERRIDDEN_MESSAGE = "Day saved."`; new `NO_CHANGES_MESSAGE = "No changes to save."`.
- `describeScheduleWriteError`: SP004 → `DAY_CHANGED_ERROR`.
- Tests updated for the literals, the URL order with `row=` and `unchanged=1`, `none` encoding, the codec round trip and its rejects (non-UUID, wrong part count).

#### 3. Day form parsing and comparisons

**File**: `src/lib/schedule-day-save.ts`, `src/lib/schedule-day-save.test.ts` (new)

**Intent**: One tested place for reading the day form and for the rules the endpoint and the page share.

**Contract**:

- `parseDaySaveForm(form: FormData)` → `{ rows: DayRow[]; confirmed: DayRow[] | null } | null`: rows from repeated `shift` fields (UUIDs, unique) with `was-<id>` and `employee-<id>` (`""` = Uncovered); `confirmed` from repeated `confirmed` fields via `parseDayRow`, only when `confirm=override`; null when any row is missing or malformed.
- `changedRows(rows)` (rows with `to ≠ was`), `matchesStored(rows, dayShifts)` (same id set and every `was` equals the stored assignee), `alreadySaved(rows, dayShifts)` (same id set and every `to` equals the stored assignee), `sameRows(a, b)` (equal as sets).
- Tests cover each with literal fixtures, including Uncovered (`null`) on either side and a reordered set.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `npm test`
- Lint passes: `npm run lint`
- Type check passes: `npx astro check`

**Implementation Note**: `override.ts`, `schedule.astro` and `ScheduleDayPanel.astro` still use the old single-shift API at the end of this phase; adapt them minimally (a one-element change set, no `shift`/`employee` URL params) so the type check stays green until Phase 3 replaces them.

---

## Phase 3: Endpoint, page and day panel

### Overview

Swap the single-shift flow for the day save end to end and update the kitchen sink.

### Changes Required:

#### 1. Endpoint

**File**: `src/pages/api/manager/schedule/override.ts`

**Intent**: Save one station day's changes through `save_schedule_day`, asking for confirmation when the combined change introduces warnings.

**Contract**: Form `month` (in `scheduleMonths()`), `day` (a date of the month; required), the day rows (`parseDaySaveForm`), optional `confirm=override` + `confirmed`. Every redirect carries `month` and `day`. Reads in full as today (unknown → `GENERIC_SCHEDULE_WRITE_ERROR`), then the check order from Critical Implementation Details. Malformed rows → `DAY_CHANGED_ERROR`. Warnings: `overrideWarnings` over `applyOverrides` of the changed rows with their ids as the set. Warnings and no accepted confirm → `?month&day&confirm=override&row=…` for every row in start order, nothing written. Otherwise `rpc("save_schedule_day", { target_month, station_day, rows })`; error 23503 → `INVALID_ASSIGNEE_ERROR`, any other through `describeScheduleWriteError` (logged); success → `?overridden=1&month&day`.

#### 2. Page

**File**: `src/pages/manager/schedule.astro`

**Intent**: Place day results in the day panel and rebuild the confirm panel from `row=` params using the page's own reads.

**Contract**: A status (`error`, `overridden`, `unchanged`) with a `day` param on an editable draft renders in the day panel; otherwise in the draft card (as today without `shift`). `unchanged=1` → notice `NO_CHANGES_MESSAGE`. `?confirm=override&row=…`: every `row` parses, the rows' ids equal the selected day's shift ids and every `was` equals the stored value, else the day panel shows `DAY_CHANGED_ERROR`; every `to` is a loaded member or null and at least one row changed, and the recomputed warnings are non-empty, else `OVERRIDE_NOT_SAVED_ERROR` in the day panel; a published month shows `SCHEDULE_PUBLISHED_ERROR` in the card. A valid confirm passes the rows (pending picks) and warnings to the panel. Still two `summarizeSchedule` calls per request.

#### 3. Day panel

**File**: `src/components/schedule/ScheduleDayPanel.astro`

**Intent**: One form per editable day with one Save, day-level feedback and one confirm panel listing the pending changes and every warning.

**Contract**:

- Props: `feedback?: { kind: "error" | "success" | "notice"; message } | null` (day-level), `confirm?: { rows: DayRow[]; warnings: OverrideWarning[] } | null`.
- Editable: a `<form method="POST" action="/api/manager/schedule/override">` around the list with hidden `month`, `day`; each `<li data-shift-id>` holds hidden `shift` and `was-<id>` and `AssigneeSelect name="employee-<id>"` whose value is the pending pick while confirming, else the stored assignee. One Save under the list (`aria-label` naming the day). Feedback alert next to Save (error: destructive + `CircleAlert`; success: status + `CircleCheck`; notice: status + `Info`).
- Confirm panel inside the form: a heading ("Save these changes?"), one line per changed row ("06:00 – 14:00: Ann → Uncovered"), one line per non-fairness warning, the folded fairness line as today; hidden `confirmed` per row (`formatDayRow`), "Assign anyway" `type="submit" name="confirm" value="override"`, Cancel link to `managerScheduleUrl({ month, day })`.
- `warningText` drops its `shiftId` argument: each line names its shift(s) itself, since several shifts may have changed (e.g. "Ann has two shifts on Thu 12 Nov: 06:00 – 14:00 and 22:00 – 06:00 (+1)", "Back to back for Ann: Thu 12 Nov, 06:00 – 14:00, then 14:00 – 22:00", "Thu 12 Nov, 18:00 – 06:00 (+1) is outside Ann's availability").
- Read-only rows unchanged.

#### 4. Kitchen sink

**File**: `src/pages/dev/schedule-states.astro`

**Intent**: Show every day-panel state with fixtures.

**Contract**: The `states-override` section shows: day saved (success), no changes (notice), day changed (error), the confirm panel with two pending changes whose warnings include a `sameDay` pair of both changed shifts plus `outside`, `noOne` and fairness, and read-only rows. Forms stay inert.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `npm test`
- Lint passes: `npm run lint`
- Type check passes: `npx astro check`
- No colour literals in the scoped views: `npm run check:ui`
- Production build succeeds: `npm run build`

#### Manual Verification:

- On a generated draft, changing two shifts of one day and pressing Save once stores both and shows "Day saved." in the day panel
- Assigning one person to two shifts of the same day shows one confirm panel listing both changes and the same-day warning; "Assign anyway" saves both
- During the confirm, changing a pick and pressing Save rechecks: the panel updates, or the day saves when the new set is clean
- Save with nothing changed shows "No changes to save." and stores nothing
- With the day open in two tabs, saving in one and then in the other shows "This day changed since you opened it. Reload and try again." and the second tab's picks are not stored
- Kitchen sink `/dev/schedule-states` shows every state; the selects are labelled, focus is visible and Save, Assign anyway and Cancel are reachable by keyboard

**Implementation Note**: After this phase and its automated verification pass, pause for manual confirmation before Phase 4.

---

## Phase 4: Smoke and docs

### Overview

Move smoke's override steps to the day contract and update CLAUDE.md.

### Changes Required:

#### 1. Smoke

**File**: `scripts/smoke.mjs`

**Intent**: Walk the day save over HTTP: refusal for an employee, no changes, stale, confirm, confirmed save.

**Contract**: The "reads a shift id" step reads every `data-shift-id` of day 1 and its `selectedAssignee` (the day's rows, `""` for Uncovered). Day forms are arrays of `[name, value]` pairs (`month`, `day`, then per row `shift`, `was-<id>`, `employee-<id>`). Steps:

- employee's day save → 403 page;
- manager's save with nothing changed → `?unchanged=1&month=&day=`;
- manager's save of the first row to themselves with the day's last row left out (a shift set that no longer matches the stored day) → `?error=<DAY_CHANGED_ERROR>&month=&day=` (a wrong `was` alone is not enough here: with every `to` equal to the stored value the idempotent check answers `overridden=1` first);
- manager's save of the first row to themselves → exactly `…?month=&day=&confirm=override&row=…` for every row in order;
- the same post with `confirm=override` and the `confirmed` rows → `?overridden=1&month=&day=`;
- the page shows the manager selected on that shift (`selectedAssignee`).

The publish-refused step after them is unchanged.

#### 2. Docs

**File**: `CLAUDE.md`

**Intent**: Describe the day save where the single-shift override is described today.

**Contract**: The `npm run smoke` and `npm run test:db` command entries (the new pgTAP file and the day steps), the Schedule section's override bullet, the `managerScheduleUrl` contract (`unchanged=1`, `row=`, no `shift`/`employee`), the `/manager/schedule` route bullet (one form per day, combined confirm), `describeScheduleWriteError` (SP004), `schedule-override.ts` (set of changes) and the new `schedule-day-save.ts` and `save_schedule_day`.

### Success Criteria:

#### Automated Verification:

- Station-time guard still passes after the smoke edit: `npx vitest run src/lib/station-time-zone.test.ts`
- Smoke passes against a local build with the local database: `npm run smoke`
- Database rules tests still pass after smoke: `npm run test:db`

#### Manual Verification:

- CLAUDE.md reads correctly for the day save and names no removed symbol (`STALE_SHIFT_ERROR`, `applyOverride`, `shift=`/`employee=` URL params)

---

## Testing Strategy

### Unit Tests:

- `schedule-override.test.ts`: the set form of every existing case; a pair between two changed shifts warned once; removed-plus-added gives only the added warning; empty set gives none.
- `schedule.test.ts`: message literals, URL order with `row=` and `unchanged=1`, `none`, row codec round trip and rejects, SP004 mapping.
- `schedule-day-save.test.ts`: form parsing (missing `was-`/`employee-` field, non-UUID, duplicate shift, `confirmed` only with `confirm=override`), `changedRows`, `matchesStored`, `alreadySaved`, `sameRows` with Uncovered on both sides and reordered sets.

### Integration Tests:

- pgTAP `schedule_day_save.test.sql`: refusals with controls, atomicity checked as `postgres`, the stale set and value checks, published and unpublished, FK and duplicate ids.
- Smoke: employee 403, no changes, stale, confirm, confirmed save, page shows the result.

### Manual Testing Steps:

1. Generate a draft for an upcoming month, open a day with three shifts, change two and Save: both stored, "Day saved.".
2. Assign the same person to two shifts of one day: one confirm panel, both changes listed, the same-day warning once; Assign anyway saves.
3. In the confirm panel, change one pick back and press Save: the check runs again.
4. Open the same day in two tabs; save in the first, then in the second: "This day changed…", nothing from the second tab stored.
5. Publish a fully covered month, open a day: rows are read-only; unpublish and the day form returns.

## Performance Considerations

The endpoint and the page still run two `summarizeSchedule` calls per request, as S-04 sized for Workers Free (`context/archive/2026-10-06-review-override-publish-schedule/plan.md:605`); the change set adds only a map lookup per shift. The function locks at most 4 rows.

## Migration Notes

The migration only adds a function; no data changes. A deployed page with the old per-row forms posting to the new endpoint lacks the day rows and gets `DAY_CHANGED_ERROR` ("Reload and try again"), which is the right advice. Push with `npx supabase db push` before deploying the Worker.

## References

- Research: `context/changes/schedule-day-save/research.md`
- Roadmap: `context/foundation/roadmap.md` (S-08, MS-03)
- S-04 plan and review: `context/archive/2026-10-06-review-override-publish-schedule/plan.md:91-93`, `:268`; `reviews/impl-review.md` F1, F2, F4
- Atomic RPC precedent: `supabase/migrations/20261007120000_publish_and_override_schedules.sql:89-116`
- Database rules test guide: `context/foundation/test-plan.md` §6.2

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Database: atomic day save

#### Automated

- [x] 1.1 Migration applies on a fresh reset: `npx supabase db reset` — 9ef5a13
- [x] 1.2 Database rules tests pass, the new file included: `npm run test:db` — 9ef5a13
- [x] 1.3 `src/db/database.types.ts` contains `save_schedule_day` after regeneration — 9ef5a13
- [x] 1.4 Type check passes: `npx astro check` — 9ef5a13

#### Manual

- [ ] 1.5 Sabotage check (§6.2 item 11): with the stale comparison removed from the live function, `npm run test:db` goes red; restored with `npx supabase db reset`

### Phase 2: Pure logic: combined warnings, row codec, URL contract

#### Automated

- [x] 2.1 Unit tests pass: `npm test` — a686ada
- [x] 2.2 Lint passes: `npm run lint` — a686ada
- [x] 2.3 Type check passes: `npx astro check` — a686ada

### Phase 3: Endpoint, page and day panel

#### Automated

- [x] 3.1 Unit tests pass: `npm test`
- [x] 3.2 Lint passes: `npm run lint`
- [x] 3.3 Type check passes: `npx astro check`
- [x] 3.4 No colour literals in the scoped views: `npm run check:ui`
- [x] 3.5 Production build succeeds: `npm run build`

#### Manual

- [ ] 3.6 On a generated draft, changing two shifts of one day and pressing Save once stores both and shows "Day saved." in the day panel
- [ ] 3.7 Assigning one person to two shifts of the same day shows one confirm panel listing both changes and the same-day warning; "Assign anyway" saves both
- [ ] 3.8 During the confirm, changing a pick and pressing Save rechecks: the panel updates, or the day saves when the new set is clean
- [ ] 3.9 Save with nothing changed shows "No changes to save." and stores nothing
- [ ] 3.10 With the day open in two tabs, saving in one and then in the other shows "This day changed since you opened it. Reload and try again." and the second tab's picks are not stored
- [ ] 3.11 Kitchen sink `/dev/schedule-states` shows every state; the selects are labelled, focus is visible and Save, Assign anyway and Cancel are reachable by keyboard

### Phase 4: Smoke and docs

#### Automated

- [ ] 4.1 Station-time guard still passes after the smoke edit: `npx vitest run src/lib/station-time-zone.test.ts`
- [ ] 4.2 Smoke passes against a local build with the local database: `npm run smoke`
- [ ] 4.3 Database rules tests still pass after smoke: `npm run test:db`

#### Manual

- [ ] 4.4 CLAUDE.md reads correctly for the day save and names no removed symbol (`STALE_SHIFT_ERROR`, `applyOverride`, `shift=`/`employee=` URL params)
