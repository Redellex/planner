---
date: 2026-10-08T19:18:36+02:00
researcher: Claude (Opus 5.5) with Redellex
git_commit: 5acb371
branch: master
repository: Planner
topic: "What does S-08 (one Save per station day for manual assignments) have to change, and what constrains it?"
tags: [research, codebase, schedule, override, manager-schedule, rpc, pgtap, smoke]
status: complete
last_updated: 2026-10-08
last_updated_by: Claude (Opus 5.5)
---

# Research: one Save per station day for manual assignments (S-08)

**Date**: 2026-10-08T19:18:36+02:00
**Researcher**: Claude (Opus 5.5) with Redellex
**Git Commit**: 5acb371 (master; PR #51, the S-09 archive, still open)
**Branch**: master
**Repository**: Planner

## Research Question

Roadmap S-08 / MS-03 (`context/foundation/roadmap.md:31`, `:108-120`): "Manager changes who works several shifts of one station day on `/manager/schedule` and saves them all with one Save for that day; any warnings are shown once for the combined change before 'Assign anyway'." Which code, database rules, tests and earlier decisions does that touch, and what must a plan settle?

## Summary

- **Today's contract handles one shift per request in every layer.** The day panel renders one `<form>` per shift row (`src/components/schedule/ScheduleDayPanel.astro:151-162`). The endpoint reads one `shift` field (`src/pages/api/manager/schedule/override.ts:34`). The warnings are a diff keyed on one `shiftId` (`src/lib/schedule-override.ts:34-68`, `:94-101`). The confirm step travels as `?confirm=override&shift=&employee=` (`src/lib/schedule.ts:127-141`, `:173-180`) and is rebuilt per shift on the page (`src/pages/manager/schedule.astro:179-207`). The write is one PostgREST `update … .eq("id", shift).eq("month", …)` (`override.ts:120-125`).
- **An all-or-nothing day save needs a new SQL function.** Separate PostgREST updates are separate transactions (roadmap risk, `roadmap.md:119`). The database's only update path is `grant update (employee_id)` plus the manager-only `schedule_shifts_update_manager` policy (`supabase/migrations/20261007120000_publish_and_override_schedules.sql:61-86`). The precedent for an atomic multi-row write is `replace_schedule_draft`: SECURITY INVOKER, `search_path = ''`, it raises SP001 up front when the month is published, and one bad row rolls back the call (`20261007120000…:89-116`).
- **Inference, not tested:** a PostgREST bulk upsert cannot stand in for the new function. The insert grant leaves out `id` (`CLAUDE.md` Schedule bullet: "insert only … `month, starts_at, ends_at, employee_id` on `schedule_shifts`").
- **Silent 0-row updates are the main pitfall for the new function.** For a published month, a regenerated shift id or a wrong month, the RLS USING clause filters the row and the UPDATE affects 0 rows with no error (`schedules.test.sql:528-531` per the DB worker; the policy at `20261007120000…:61-82`). The function therefore has to (a) check the published state first and raise SP001, as `replace_schedule_draft` does, and (b) compare the number of rows it updated with the number requested and raise when they differ. The next free custom code is SP004 (codes in use: SP001–SP003, `src/lib/schedule.ts:107-112`).
- **"Stale" needs the values the manager saw, not just shift ids.** A day form posts every row of the day. If the endpoint wrote every posted row whose value differs from the stored one, a row this manager left alone would undo another manager's concurrent change to it. Today's single-row endpoint has no expected-old check either (`override.ts:97-125`). The way out: post each row's rendered assignee as a hidden field, treat only rows where `posted ≠ rendered` as changes, and refuse the whole day when a stored value no longer matches what the manager saw (roadmap default b, `roadmap.md:118`).
- **Combined warnings come down to generalizing one function.** `candidates()` keeps hard-rule warnings only for the one `shiftId` (`schedule-override.ts:36-60`). It keeps fairness and `noOne` for any shift (`:61-66`). With a set of changed ids and `applyOverride` applied once per change, a same-day or back-to-back pair between two changed shifts is caught (roadmap default a, `roadmap.md:117`). Per-person warning keys stay as they are (`:71-86`). The cost is still two `summarizeSchedule` calls per request, the figure S-04 sized for Workers Free (S-04 plan.md:605).
- **What has to change:** the endpoint (new or replaced), `schedule-override.ts` and its 17 tests, the URL contract in `schedule.ts` and its tests, the page's confirm rebuild, the day panel (one form, one confirm panel per day), the kitchen sink's override section, a new migration plus pgTAP section, the smoke override steps (`scripts/smoke.mjs:470-532`), the `route-inventory.test.ts` row (`:50`), and CLAUDE.md (`:15-16`, `:57`, `:62-63`, `:65`).

## Detailed Findings

### Current per-shift override flow

- **Endpoint** (`src/pages/api/manager/schedule/override.ts`):
  - It parses `month`, `day`, `shift` (UUID via `parseShiftParam`) and `employee` (`""` means Uncovered) (`:30-50`).
  - In parallel, it reads the schedule inputs, the `schedules` row and every shift of the month (`:57-71`). If any read is incomplete it writes nothing (`:78-81`).
  - It refuses: no draft (`:82-84`); published (`:85-87`); a shift not in the draft, i.e. stale (`:89-92`); an assignee who isn't a loaded member (`:93-95`).
  - An unchanged assignee redirects straight to `overridden` (`:97-98`).
  - It computes warnings as `overrideWarnings({ before: summarizeSchedule(stored), after: summarizeSchedule(applyOverride(...)), shiftId })` (`:108-112`).
  - With warnings and no `confirm=override`, it redirects to the confirm step without writing (`:113-116`).
  - The write is a single-row update; 0 rows means stale (`:120-132`).
  - Every redirect keeps `shift`, so the result renders in that row (`:35-36`).
- **Warnings** (`src/lib/schedule-override.ts`):
  - `applyOverride` replaces one id's assignee (`:25-31`).
  - `candidates(summary, shiftId)` keeps `outside`, `sameDay`, `backToBack`, `previousNight` and `nextMorning` only when they involve `shiftId` (`:36-60`), and takes every `ruleBreaks` and `daysWithNoOne` entry (`:61-66`).
  - `warningKey` includes the assignee, so a problem the old assignee already had is warned again for the new one (`:71-86`; S-04 impl-review F6).
  - `overrideWarnings` = after minus before, by key (`:94-101`).
- **Page** (`src/pages/manager/schedule.astro`):
  - Rows are `editable` only on an unpublished draft that was read in full (`:170`).
  - Per-row feedback is used only when `?shift=` is on the selected day (`:174-175`).
  - The confirm panel is rebuilt from `?confirm=override&shift=&employee=` (`employee=none` means Uncovered). Its warnings are recomputed from the page's own reads, never taken from the URL (`:179-207`).
  - A confirm URL that builds no panel shows `OVERRIDE_NOT_SAVED_ERROR`, or `SCHEDULE_PUBLISHED_ERROR` when the month is published (`:210-216`).
- **Day panel** (`src/components/schedule/ScheduleDayPanel.astro`):
  - Props `feedback` and `confirm` are each keyed to one `shiftId` (`:25-34`).
  - Each editable row is an `<li data-shift-id>` with its own form: hidden `month`/`day`/`shift`, an `AssigneeSelect name="employee"`, and Save (`:145-162`).
  - The per-row confirm panel has "Assign anyway", which re-posts with `confirm=override`, and a Cancel link (`:176-217`).
  - `warningText(warning, shiftId)` picks "the other" shift relative to the one changed shift (`:76-95`). With two changed shifts in one pair, that wording has to be rethought.
  - All fairness warnings fold into one "Check fairness" line that links to the summary (`:101-108`, `:188-196`).
- **Select** (`src/components/schedule/AssigneeSelect.tsx:18-28`): a stateless `NativeSelect` rendered on the server with no hydration. `defaultValue` marks the current assignee `selected`, and Uncovered is `""`.
- **A station day has at most 4 shifts** (the 6×4 pattern; `CLAUDE.md` Schedule "Station model"). A day's change set therefore has 1–4 entries, so URL size is not a concern for carrying them. This is an inference from the pattern list.

### Database (from the DB worker; decisive lines re-read)

- **Update path:**
  - Table-level UPDATE is revoked (`20261006140000_revoke_schedule_updates.sql:5-6`). Only `update (employee_id)` is granted (`20261007120000…:86`).
  - The `schedule_shifts_update_manager` USING and WITH CHECK clauses both require `is_manager()` and an unpublished `schedules` row for the shift's month (`20261007120000…:61-82`, re-read).
- **Guard trigger** (`20261007130000_guard_published_schedule_shifts.sql:21-41`, re-read):
  - It is BEFORE INSERT/UPDATE/DELETE, per row, and SECURITY DEFINER.
  - It skips FK actions (`pg_trigger_depth() > 1`). An UPDATE inside a plpgsql function is still depth 1, so the guard fires for it (the worker's reading; not tested).
  - It locks the month's `schedules` row FOR SHARE and raises SP001 if it is published.
  - On a published month, an ordinary UPDATE is filtered by RLS first and affects 0 rows with no error (`schedules.test.sql:528-531`). SP001 on an update appears only when it races a publish (untested, `:791-793`).
- **`replace_schedule_draft`** (`20261007120000…:89-116`):
  - SECURITY INVOKER with `search_path = ''`. It raises SP001 when the month is published.
  - It parses `jsonb_to_recordset(shifts) as s (starts_at timestamp, ends_at timestamp, employee_id uuid)` with no validation beyond the casts and constraints.
  - Execute is revoked from public and anon and granted to authenticated (`20261006120000_create_schedules.sql:128-129`).
  - Each function has a `comment on function` that lists its SQLSTATEs.
- **`publish_schedule` / `unpublish_schedule`** (`20261007120000…:126-205`): SECURITY DEFINER, with their own `is_manager()` check (42501). Publish takes `FOR UPDATE` on the `schedules` row, which serializes against the guard's FOR SHARE.
- **Assignee FK:**
  - `employee_id … references public.profiles (id) on delete set null` (`20261006120000…:25`). A non-existent id raises 23503.
  - `describeScheduleWriteError` maps 23503 to `MONTH_UNLOCKED_ERROR` (`src/lib/schedule.ts:102-103`, re-read). That message is wrong for an assignee error.
  - Today's endpoint avoids the case by checking the assignee against the loaded members first (`override.ts:93-95`). A deleted account between the read and the write would still surface as "The month was unlocked; generate again".
- **No per-person rule exists in the database.** `schedule_shifts_no_overlap` is station-wide and ignores `employee_id` (`20261006120000…:41-44`). Same-day, back-to-back and outside-availability are app-level warnings only.
- **Latest migration:** `20261007160000_published_schedule_is_own.sql`. A new one sorts after it. Regenerate `src/db/database.types.ts` afterwards (`CLAUDE.md` Key conventions).

### Tests, smoke, kitchen sink and gates that depend on the contract (from the tests worker)

- **Unit tests:**
  - `src/lib/schedule-override.test.ts` has 17 `it`s in 5 `describe`s (`:48`, `:68`, `:187`, `:285`, `:326`). All of them go through the helper `warningsFor({ windows, shifts, shiftId, employeeId, … })` (`:25-46`), which assumes one change.
  - `src/lib/schedule.test.ts` pins the URL order `…&confirm=override&shift=&employee=` (`:149-161`), `employee=none` (`:163-169`), `overridden=1…&shift=` (`:137-147`), the message texts `STALE_SHIFT_ERROR` / `INVALID_ASSIGNEE_ERROR` / `OVERRIDDEN_MESSAGE = "Shift updated."` (`:61-81`), and `parseShiftParam` (`:181-196`).
  - No component test covers `ScheduleDayPanel` or `AssigneeSelect`.
- **pgTAP** (`supabase/tests/database/schedules.test.sql`):
  - The file uses `plan(120)` (`:7-8`).
  - The override section (`:417-484`), the freeze section (`:525-567`) and the after-unpublish section (`:601-625`) use single-row updates.
  - The atomicity pattern is a `string_agg` snapshot before and after a refused call, compared as the owner (`:520-523`, `:557-562`).
  - User A is deleted at `:807`, so a new section that uses A must come before `:788`.
  - test-plan §6.2 (`context/foundation/test-plan.md:138-156`) asks for:
    - pairing every refusal with a control;
    - checking as `postgres` that a refused write left the rows intact;
    - testing a multi-row write so that one refused row rejects the whole batch (`:155`).
- **Smoke** (`scripts/smoke.mjs`):
  - It reads the first `data-shift-id` of day 1 (`:470-481`).
  - It sends the employee's POST to `/api/manager/schedule/override` and expects 403 (`:484-495`).
  - The manager's POST for themselves must redirect to exactly `…&confirm=override&shift=<id>&employee=<id>` (`:496-511`). The confirmed POST must redirect to `…?overridden=1&month=…&day=…&shift=<id>` (`:512-526`). Locations are compared with `startsWith` (`:595`).
  - `selectedAssignee(html, shiftId)` slices from `data-shift-id="<id>"` to the next `data-shift-id=` or `</ul>` and reads the `selected` `<option>` (`:159-169`, `:527-532`). It depends on one `<li data-shift-id>` per row with its select inside and the list ending in `</ul>`.
  - Publish being refused right after (`:533-544`) relies on the draft still having gaps.
- **Kitchen sink** (`src/pages/dev/schedule-states.astro`):
  - Section `states-override` (`:567-641`) shows four states: success in a row, an error in a row, the confirm panel (`confirmWarnings`: one warning of each kind, `:236-266`), and read-only rows.
  - Day-panel calls are at `:501`, `:511`, `:544`, `:553`.
  - Forms are inert (`:673-678`).
- **Route inventory:** `src/lib/route-inventory.test.ts:50` has `"/api/manager/schedule/override": "manager"`. The set of keys must equal the files under `src/pages` exactly (`:81`). A new endpoint needs a row; a removed one must lose its row. `route-access.ts` needs nothing, because the `/api/manager` prefix gates it.
- **Gates that will run:**
  - pre-commit (`lint-staged.config.mjs`): `vitest related` on staged ts/tsx/astro; `check:ui` on astro/tsx, whose scope includes `src/pages/manager/schedule.astro`, `src/components/schedule/` and `src/pages/dev/schedule-states.astro`; the station-time test on a new migration or a smoke edit; the route-inventory and navigation tests on any `src/pages/**` file.
  - Agent hooks (`.claude/hooks/*`): ESLint plus `check:ui` and related tests per edit; on Stop, the full unit suite plus `astro check`.

### Requirements and earlier decisions (from the history worker)

- **PRD:**
  - FR-004 (`context/foundation/prd.md:73-74`): warn, don't block, and require an explicit confirmation.
  - FR-005 (`:75-76`): the manager can adjust any assignment before publishing; no reason is captured.
  - Guardrail (`:46`): never silently assign outside availability.
  - Publish is refused while a day has no one (`:42`, `:103`).
  - MS-03 lives only in the roadmap (`roadmap.md:31`). The user's own words: "one save button for that day so i don't need to save 2-3 times" (`roadmap.md:26`).
- **UI constraints come from CLAUDE.md, not PRD NFRs:**
  - no hydration, and `<option>`s come from a React wrapper (`CLAUDE.md` UI "No hydration by default");
  - results shown next to the control, from an allow-list only;
  - a kitchen sink for the view.
  - S-04's accessibility check was "selects labelled with visible focus, confirm buttons reachable" (S-04 `plan.md:441`).
- **S-04 decisions** (`context/archive/2026-10-06-review-override-publish-schedule/`):
  - Warnings are recomputed at save time and never taken from the panel. `confirm=override` accepts whatever warnings exist at that moment (`plan.md:91-93`).
  - The URL order is status first, then month, day, confirm, shift, employee (`plan.md:268`), and smoke matches it.
  - One shift per request was never argued as a decision; it is simply how S-04 was built (`plan-brief.md:40`, `plan.md:227`, `:334`, `:376`).
  - Ids travel in form fields because `route-inventory.test.ts` rejects `[param]` routes (`plan.md:55`).
- **Accepted concurrency limit:** two clean overrides together can create an unwarned pair (impl-review F4, `reviews/impl-review.md:88-96`). The version token is parked (`roadmap.md:156`).
  - Inference: a day save does not close that gap between two different days. It closes the gap within one day for one manager's own changes, which are now checked together.
- **Submit guard precedent:** `/manager/users` disables the clicked button during the POST (S-04 `research.md:214`).
- **No lessons file:** `context/foundation/lessons.md` does not exist.

## Code References

- `src/pages/api/manager/schedule/override.ts:28-135` — the single-shift endpoint, to be replaced or extended.
- `src/lib/schedule-override.ts:25-101` — `applyOverride`, `candidates`, `warningKey`, `overrideWarnings`.
- `src/pages/manager/schedule.astro:65-81` — status params; `:170-217` — editable, per-row feedback, the confirm rebuild, unsaved override.
- `src/components/schedule/ScheduleDayPanel.astro:12-44` (props), `:145-217` (row form, feedback, confirm panel).
- `src/components/schedule/AssigneeSelect.tsx:18-28` — the select.
- `src/lib/schedule.ts:44-61` (messages), `:98-117` (`describeScheduleWriteError`), `:121-186` (`managerScheduleUrl`), `:189` (`parseShiftParam`).
- `supabase/migrations/20261007120000_publish_and_override_schedules.sql:61-116` — update policy, grant, `replace_schedule_draft`.
- `supabase/migrations/20261007130000_guard_published_schedule_shifts.sql:15-55` — the guard trigger.
- `supabase/tests/database/schedules.test.sql:417-484`, `:520-567`, `:601-625` — override, freeze and after-unpublish sections.
- `scripts/smoke.mjs:60-63`, `:159-169`, `:470-544` — the override smoke steps.
- `src/pages/dev/schedule-states.astro:236-266`, `:567-641` — the confirm fixture and override states.
- `src/lib/route-inventory.test.ts:50` — the endpoint's access row.

## Architecture Insights

- **Every write is form POST + redirect + recompute.** The redirect carries only ids, and both the endpoint and the page rebuild everything else from full reads. A day save fits this pattern if the confirm URL carries the day's change set: 1–4 `(shift, employee)` pairs, plus the values the manager saw if the stale check should survive the confirm round trip. Both the page and the endpoint can then run the same pure diff.
- **The database is the enforcement and the app is the explanation.** RLS and grants decide what lands. The pure summary and diff decide what to warn about. A new SQL function should keep SECURITY INVOKER, so the existing policy, grant and guard trigger still apply, and add only what PostgREST cannot express: a single transaction, a row-count check and an expected-old-value check.
- **Feedback anchoring moves from a row to the day.** Today it is keyed to `?shift=` and rendered in that row. A day save's result belongs to the day panel. Whether `data-shift-id` stays on each `<li>` matters to smoke's `selectedAssignee` and to `/schedule`'s published panel, which shares the marker (`PublishedDayPanel.astro:34`).

## Historical Context (from prior changes)

- `context/archive/2026-10-06-review-override-publish-schedule/plan.md:91-93` — warnings recomputed at save time; still holds and carries over.
- `…/plan.md:268` — the URL parameter order; still holds; the day save has to extend it.
- `…/reviews/impl-review.md:34-60` (F1) — the publish/override race, fixed by the guard trigger; still holds, and every row a new function updates goes through it.
- `…/reviews/impl-review.md:62-74` (F2) — a confirm URL that no longer builds a panel shows `OVERRIDE_NOT_SAVED_ERROR`; still holds; the same case exists per day.
- `…/reviews/impl-review.md:88-96` (F4) — concurrent overrides, accepted; still holds across days (see Requirements above).
- `…/plan.md:605` — about 1 ms of CPU per override with two summaries; still holds for one combined diff (inference: same number of `summarizeSchedule` calls).
- `context/archive/2026-10-06-generate-monthly-schedule/plan.md:604` and memory "Stay on Cloudflare Free" — no paid CPU tier.

## Related Research

- `context/archive/2026-10-06-review-override-publish-schedule/research.md` — the original override research (S-04).
- `context/archive/2026-10-07-view-published-schedule/research.md:131-132` — `AssigneeSelect` and the override forms are manager-only and appear only when the draft is `editable`.

## Open Questions

Choices for `/10x-plan`. None is a missing fact.

1. **Warnings for the whole day at once** (roadmap unknown a, default yes). Supported by generalizing `candidates()` to a set of shift ids. Open: how `warningText` describes a pair when both of its shifts changed.
2. **Stale handling** (roadmap unknown b, default refuse the whole day). Requires the rendered assignee per row as a hidden field and an expected-old check inside the function. Open: a new SP004 code with its own message, or reuse of `STALE_SHIFT_ERROR`'s wording for the day ("This day changed since you opened it. Reload and try again.").
3. **Keep or remove the per-shift endpoint.** Removing it means rewriting smoke `:484-532`, the `route-inventory` row and CLAUDE.md. Keeping it leaves two write paths with different stale semantics.
4. **URL contract for the day confirm.** Options include repeated `shift=…&employee=…` pairs, or `assign=<shift>:<employee|none>` entries, plus the rendered (`was`) values or not. `managerScheduleUrl`, `schedule.test.ts` and smoke all pin the current form.
5. **Assignee FK error mapping.** The new function should validate assignees itself, or the endpoint should map a 23503 from it to `INVALID_ASSIGNEE_ERROR` rather than `MONTH_UNLOCKED_ERROR`.
6. **Saving with nothing changed.** Today an unchanged assignee redirects with "Shift updated." (`override.ts:97-98`). For a day with no changes: the same success message, or a neutral "Nothing to save"?
