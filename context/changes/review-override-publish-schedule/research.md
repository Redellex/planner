---
date: 2026-10-06T22:06:28+02:00
researcher: Claude (Opus 5.5) for Redellex
git_commit: ba2d5548b067d7bc55d14268e16482b839b2f0b8
branch: review-override-publish-schedule
repository: Planner
topic: "S-04: what the S-03 draft gives a review/override/publish workflow, and what is missing"
tags: [research, schedule, schedule_shifts, schedules, rls, schedule-summary, manager-schedule, s-04]
status: complete
last_updated: 2026-10-06
last_updated_by: Claude (Opus 5.5)
---

# Research: S-04 review, override and publish on top of the S-03 draft

**Date**: 2026-10-06T22:06:28+02:00
**Researcher**: Claude (Opus 5.5) for Redellex
**Git Commit**: ba2d5548b067d7bc55d14268e16482b839b2f0b8 (working tree: only this change folder is new)
**Branch**: review-override-publish-schedule
**Repository**: Planner

## Research Question

Roadmap S-04 (`context/foundation/roadmap.md:126-143`): a manager reviews the generated draft, overrides any assignment before publishing (FR-004: warn on a conflict with availability and require explicit confirmation; FR-005: adjust or override; FR-006: publish), and cannot accept or publish while any station day has no one assigned (`prd.md:103`). What do the database, the pure libraries and the `/manager/schedule` UI provide today, which S-03 handoff claims still hold, and what must S-04 add or decide?

## Summary

- **Database.** There is no update path and no published state.
  - Both schedule tables have no update policy, and table-level UPDATE is revoked (`supabase/migrations/20261006140000_revoke_schedule_updates.sql:5-6`).
  - `schedules` has only `month`, `generated_at` and `generated_by` (`20261006120000_create_schedules.sql:7-11`).
  - Overrides need a manager `for update` policy on `schedule_shifts` plus `grant update (employee_id)`.
  - Publishing needs a new column (or status) on `schedules` with its own write path.
  - **Today a regenerate or a discard would erase a published schedule.** `replace_schedule_draft` deletes the row and re-inserts it (`create_schedules.sql:105-129`), and discard is a plain delete (`src/pages/api/manager/schedule/discard.ts:28`). Nothing guards either one.
- **Validation.** `summarizeSchedule` already covers FR-004 and the publish blocker:
  - `outsideAvailability` (`src/lib/schedule-summary.ts:126-128`)
  - the 12h and night fairness breaks (`:131-149`)
  - `daysWithNoOne` (`:110,118,171`)
  - the M−1 → M boundary (`touchesPreviousNight`, `:157-166`)

  It does **not** check three per-person hard rules that an override can break:
  - one shift per station day
  - back-to-back (touching) shifts inside the month
  - M's last night touching the **M+1** draft's day-1 06:00 shift

  No loader reads that M+1 shift (`src/lib/schedule.ts:203-282` reads only M−1's last night). The database does not catch any of the three either. `schedule_shifts_no_overlap` is station-wide and ignores `employee_id` (`create_schedules.sql:43-44`).
- **UI.** `/manager/schedule` already renders everything a review needs, and the summary already shows an "Assigned outside availability" alert (`src/components/schedule/ScheduleSummary.astro:120-134`).
  - Shift ids are loaded (`src/pages/manager/schedule.astro:92`), but `ScheduleDayPanel` types its shifts as `SummaryShift`, which has no `id` (`src/components/schedule/ScheduleDayPanel.astro:3,9`).
  - Patterns to reuse:
    - the `confirm=replace` two-step for FR-004's explicit confirmation (`ScheduleActions.astro:357-388`, `generate.ts:38-40`)
    - the per-row feedback of `/manager/users` (`&user=<id>`) for per-shift results
    - `RoleSelect.tsx` (a `NativeSelect` wrapper with no hydration) for an assignee select
- **Open product decisions**:
  - whether "accept" is a separate state from "publish"
  - what a published month allows: override, regenerate, discard, unpublish, unlock
  - whether override is assignee-only or can also change the day's pattern
  - whether hard-rule breaks from an override warn or block
  - whether to fix the employee and anon profile-name read for S-05 now or later

## Detailed Findings

### 1. Database layer

**Tables** (`supabase/migrations/20261006120000_create_schedules.sql`)

- **`schedules`** (L7-11):
  - `month date primary key references availability_locks(month) on delete restrict`
  - `generated_at timestamptz default now()`
  - `generated_by uuid default auth.uid() references profiles(id) on delete set null`
  - No status, accepted or published column. `src/db/database.types.ts:144-176` confirms the same columns.
- **`schedule_shifts`** (L19-45):
  - `id uuid default gen_random_uuid()`
  - `month` references `schedules(month) on delete cascade`
  - `starts_at` and `ends_at` (wall-clock)
  - `employee_id` references `profiles(id) on delete set null`
- **Checks:**
  - `schedule_shifts_allowed_shape`: 9 shapes (L27-38)
  - `schedule_shifts_month_matches_station_day` (L39-40)
  - `schedule_shifts_no_overlap`: a station-wide `tsrange` exclusion that does not involve `employee_id` (L43-44)
- **Indexes:** only the primary keys and the GiST index behind the exclusion. There is no index on `schedule_shifts(month)` or `schedule_shifts(employee_id)`.

**RLS and privileges**

- **Policies:** select, insert and delete for `authenticated` with `public.is_manager()` on both tables (L53-90). No update policy, no anon policy.
- **Insert:** the table-level privilege is revoked. Column grants allow `insert (month)` on `schedules` and `insert (month, starts_at, ends_at, employee_id)` on `schedule_shifts` (L96-100).
- **Update:** revoked on both tables from `authenticated` and `anon` (`20261006140000_revoke_schedule_updates.sql:5-6`). Its comment (L1-4) anticipates `grant update (employee_id) on public.schedule_shifts`.
- **pgTAP (`supabase/tests/database/schedules.test.sql`):**
  - It asserts `has_table_privilege(..., 'UPDATE') = false` for `authenticated` and `anon` on both tables (L322-330). A column-level grant does not change table-level privilege, so these asserts should still pass and keep guarding against a table-wide grant. Inferred from `has_table_privilege` semantics; not run.
  - S-04 would add `has_column_privilege` asserts: true for `employee_id`, false for `month`, `starts_at` and `ends_at`. The file is `plan(50)` (L8).

**Replace and discard**

- `replace_schedule_draft(target_month, shifts jsonb)` is SECURITY INVOKER and executable by `authenticated` only (L105-129).
- It deletes the month's `schedules` row (the shifts cascade), inserts a new row (fresh `generated_at` and `generated_by`), then inserts the shifts.
- Every shift id is new after a call. pgTAP asserts this (`schedules.test.sql:141-177`). **Any override or published flag stored on these rows is lost on regenerate.**
- The only caller is `src/pages/api/manager/schedule/generate.ts:67`.
- Discard is `.delete().eq("month", …)` on `schedules` (`discard.ts:28`).

**Locks**

- `schedules.month → availability_locks(month) on delete restrict`, so unlocking a month with a draft fails with 23503 (pgTAP L288-319). A published state stored on the same `schedules` row keeps the month locked by the same foreign key, with no extra rule.
- The roadmap leaves "what a published month's lock means" open (`roadmap.md:138`).
- Nothing in the database bounds which months can have a draft. `generatableMonths()` is enforced only by the generate endpoint (impl review F9; CLAUDE.md Schedule → RLS).

**What employees can read** (relevant to S-05, which follows S-04)

- Nothing schedule-related: both tables are manager-only on select (`schedules.test.sql:97-104`).
- Of `profiles`, employees can read only their own row (`20260925120000_create_profiles_and_roles.sql:64-68`).
- A published grid that shows other people's names therefore needs a new profiles read path (a policy, a view or an RPC) in addition to a published-read policy on both schedule tables.
- A `schedule_shifts` policy that checks `schedules` through a subquery is itself subject to RLS on `schedules`.

**Test-data fragility.** Two existing pgTAP files delete `availability_locks` rows without first deleting `schedules`:

- `availability_month_lock.test.sql:27` (months m_prev, m_cur, m1, m3)
- `availability_ownership.test.sql:20` (m1)

With a local draft in one of those months, these deletes fail with 23503. One such draft is the November 2026 draft recorded in `generate-monthly-schedule/change.md` "Phase 3 notes"; November is m1 when the station month is October 2026. `availability_station_night.test.sql:22` deletes drafts first. If a published schedule becomes harder to delete, this gets worse.

### 2. Validation libraries

**`summarizeSchedule`** (`src/lib/schedule-summary.ts:77-176`)

- **Input:** `{ month, members, windows, shifts, previousNight? }`. `SummaryShift` is `{ starts_at, ends_at, employee_id }` with no `id` (L19-23). The function is generic over `S extends SummaryShift`, so rows that carry `id` come back in the output with it.
- **Availability:** the windows are merged and clipped to `[M-01 06:00, M+1-01 06:00)` (L89-92).
- **Output fields:**
  - `uncovered`: shifts with `employee_id === null` (L114-116)
  - `outsideAvailability`: an assigned shift not contained in one merged span of its assignee, including an assignee with no windows, such as a manager (L126-128)
  - `daysWithNoOne`: station days on which no assigned shift starts (L110, 118, 171)
  - `ruleBreaks` (L131-149): for each assigned 12h or night shift, a break is reported when the assignee's count is greater than the minimum count among the people whose availability contains the shift, plus 1.
    - It is skipped when no one's availability contains the shift.
    - One shift can produce both a `long` and a `night` entry.
  - `perMember`: counts (shifts, minutes, `longCount`, `nightCount`) including shifts outside availability, plus `hasAvailability` and `zeroShifts` (L151-155)
  - `touchesPreviousNight`: M shifts held by M−1's last-night assignee that start at `previousNight.ends_at` (L157-166)

**How the summary behaves after an override**

- **Fairness breaks are recomputed for the whole month.** Moving a 12h shift from A to B changes the counts and can add or remove breaks on a third person's shifts. To show only what an override introduced, S-04 has to compare the summary before the override with the summary after it.
- **Eligibility in `ruleBreaks` ignores hard-rule blocking.** The minimum count can come from someone who already works that day. This is consistent with the generator's own `breaksOf` (`schedule-generator.ts:312-319`).
- **An override onto a slot nobody is available for** skips the fairness check (eligible is empty), but `outsideAvailability` still flags it.
- **Even total hours (priority 4) is never reported as a warning.** Only `perMember.minutes` is available for one.

**Hard rules that the summary and the database do not check.** An assignee-only override can break all of these:

1. two shifts for one person on the same station day;
2. touching shifts inside the month (night of D, then 06:00 on D+1; or 06–12, then 12–18 on the same day, which rule 1 also covers);
3. M's last night touching the M+1 draft's 06:00 shift on day 1. Nothing reads the M+1 draft:
   - `loadScheduleInputs` loads only M−1's last night (`src/lib/schedule.ts:253-263`).
   - `summarizeSchedule` and `generateSchedule` accept only `previousNight`.

   The conflict appears today only on M+1's page, as its `touchesPreviousNight`.

In the generator these rules are private closures:

- `blocked` (`schedule-generator.ts:329-330`)
- `free` (`:434-435`)
- `clearOfNeighbours` (`:438-443`)

The property-test oracles implement them independently (`schedule-generator.property.test.ts:287-308`).

**Reusable exports**

- From `schedule-generator.ts`: `mergeAvailability`, `clipSpans`, `stationDays`, `isNightShape`, `isLongShape`, `SHIFT_SHAPES` and `STATION_DAY_PATTERNS`.
- From `schedule.ts`: `stationDayOf` and `shiftsByStationDay` (`:287-304`).
- The containment helper `contains` is private to the summary (`schedule-summary.ts:68-70`).

### 3. `/manager/schedule` page and endpoints

**Page** (`src/pages/manager/schedule.astro`)

- **Params:**
  - `month` must be in `scheduleMonths()`, the current station month plus the next 3 (L46-50).
  - `day` must be a date in that month (L51-53).
  - `confirm=replace` is honoured only when a draft exists and the month can be generated (L141).
- **Loads:** one `Promise.all` (L85-100):
  - `loadScheduleInputs`
  - the `schedules` row
  - `schedule_shifts` (`id, starts_at, ends_at, employee_id`), paged
  - the locks
- **Unknown state:** any failed read shows only the load error, the month tabs and the lock status (L117-119, 181, 193).
- **Summary:** computed at L126.
- **Feedback:** there is one slot, built from `?error=` (passed through the allow-list), `generated=1` or `discarded=1` (L56-64). It renders at the top of the Draft card (`ScheduleActions.astro:341-352`). Nothing renders feedback per shift.
- **Day panel** (`ScheduleDayPanel.astro`):
  - On day 1, M−1's night is shown read-only (L35-41).
  - Each shift shows its time, its duration and either `accountLabel(member)` or an "Uncovered" pill (L46-72).
  - Its props are typed `SummaryShift[]` (L9). To put a shift id into a form, the type must be widened.
- **Summary card** (`ScheduleSummary.astro`):
  - the per-member table with "No shifts" and "No availability" (L35-89)
  - fairness exceptions (L91-118)
  - "Assigned outside availability" (L120-134)
  - "touches previous night" (L136-151)

**Endpoints**

- **Generate** (`generate.ts`):
  1. validates the month (L20-24)
  2. checks the client (L27-30)
  3. refuses an existing draft without `confirm=replace` (L33-40)
  4. upserts the lock (L43-50)
  5. a full read that comes back unknown gives `GENERATE_LOAD_ERROR` (L53-56)
  6. generates and calls the RPC (L59-74)
  7. redirects to `managerScheduleUrl({ month, generated: true })` (L76)
- **Discard** (`discard.ts:14-31`): validates against `scheduleMonths()` and deletes with `.select("month")`. Zero rows means `NO_DRAFT_ERROR`, because an RLS refusal is a silent 0 rows.
- **Messages** (`src/lib/schedule.ts`):
  - message constants at L22-41
  - the `SCHEDULE_FEEDBACK_ERRORS` allow-list at L44-53, with `resolveScheduleFeedbackError` at L59-64
  - `describeScheduleWriteError` at L73-87: 42501, 23503 and 23505 map to messages, and anything else is logged and shown as the generic message
- **`managerScheduleUrl`** (L89-125) always puts the status param first. Smoke matches the generate and discard `Location` headers exactly (`scripts/smoke.mjs:297-303, 320-325`), so those outputs must not change. New flags such as `overridden` or `published`, or a kept `day`, are additions.
- **Legacy path, not to copy:** `/api/manager/months/lock.ts:42` redirects a raw `error.message`, and `months.astro:8,23,44-47` renders `?error=` unfiltered.

**Patterns to reuse for override and publish**

- **Explicit confirmation (FR-004):**
  - Today: the Regenerate link goes to `?confirm=replace`, which shows a panel whose POST form carries a hidden `confirm=replace`, with a Cancel link (`ScheduleActions.astro:357-388`). The endpoint re-checks the condition and refuses without the confirm (`generate.ts:38-40`).
  - The override analogue: the server recomputes containment. When the shift is outside availability and no confirm was sent, it redirects with an allow-listed message plus `month`, `day` and the shift id, and the page shows a confirm panel that posts again.
- **Per-row feedback:** `/manager/users` puts `&user=<uuid>` after the status param. `parseFeedbackUser` validates it, and `users.astro:44-51,85` renders the feedback inside that row. `users.astro:101+` also disables the clicked button during the POST.
- **Assignee select:**
  - `src/components/ui/native-select.tsx`, wrapped like `src/components/manager/RoleSelect.tsx:1-25` and rendered without `client:*`.
  - The options are the page's `members` (`id`, `email`, `role`; every profile, managers included; `schedule.ts:207-216`).
  - An empty value would mean Uncovered (null).
- **Stale ids:** after a regenerate every id changes, so an override posted from an old page updates 0 rows. It needs the same `.select()` row-count check discard uses, plus an allow-listed message.
- **Route rules:**
  - New endpoints under `/api/manager/` are manager-only through `MANAGER_ROUTES` (`src/lib/route-access.ts:6`).
  - Each one needs a row in `src/lib/route-inventory.test.ts` (L53-79). A `[param]` path fails that test (L111-116), so ids go in form fields.
- **Colour literals:** the colour-literal check already covers `src/pages/manager/schedule.astro`, `src/components/schedule/` and `src/pages/dev/schedule-states.astro` (`scripts/check-ui-literals.mjs:24-26`).
- **Kitchen sink:** `src/pages/dev/schedule-states.astro` lists every allow-listed message (L190-200) and the confirm panel state (L178-188). New states belong there.

### 4. Smoke constraints

- The schedule block runs on station month + 3:
  1. a gate step: no draft and the month is open (`smoke.mjs:285-296`)
  2. generate, then the page shows `data-schedule-draft`
  3. unlock is refused with `UNLOCK_WITH_DRAFT_ERROR`
  4. discard, then unlock
- New override or publish steps belong between generate and discard and depend on the same gate.
- If publishing blocks discard or unlock, the smoke teardown needs a path back. One option is to unpublish, then discard. Otherwise smoke does not publish. Without one of these, a run leaves station month + 3 locked, and the next run fails.

## Code References

- `supabase/migrations/20261006120000_create_schedules.sql:7-11` - `schedules` (no status column; lock FK restrict)
- `supabase/migrations/20261006120000_create_schedules.sql:19-45` - `schedule_shifts`, shape/month checks, station-wide overlap exclusion
- `supabase/migrations/20261006120000_create_schedules.sql:53-100` - manager-only select/insert/delete policies, insert column grants
- `supabase/migrations/20261006120000_create_schedules.sql:105-129` - `replace_schedule_draft` (delete + re-insert, new ids)
- `supabase/migrations/20261006140000_revoke_schedule_updates.sql:1-6` - UPDATE revoked; S-04 column grant anticipated
- `supabase/tests/database/schedules.test.sql:8,97-104,141-177,288-319,322-330` - plan count, employee read refusal, replace semantics, unlock/discard, privilege asserts
- `supabase/tests/database/availability_month_lock.test.sql:27`, `availability_ownership.test.sql:20` - lock deletes that a local draft would block
- `src/lib/schedule-summary.ts:19-23,68-70,77-176` - summary types, private `contains`, the summary
- `src/lib/schedule-generator.ts:312-319,329-330,434-443` - `breaksOf`, private hard-rule closures
- `src/lib/schedule-generator.property.test.ts:287-308` - independent one-per-day / touching oracles
- `src/lib/schedule.ts:22-125,203-304` - messages, allow-list, error mapping, URL builder, loader, station-day helpers
- `src/pages/manager/schedule.astro:46-141` - params, loads, unknown state, summary
- `src/components/schedule/ScheduleDayPanel.astro:3,9,35-72` - `SummaryShift` props, day rows
- `src/components/schedule/ScheduleActions.astro:34,341-388` - draft marker, feedback slot, confirm panel
- `src/components/schedule/ScheduleSummary.astro:120-151` - outside-availability and previous-night alerts
- `src/pages/api/manager/schedule/generate.ts:20-76`, `discard.ts:14-31` - endpoint patterns
- `src/components/manager/RoleSelect.tsx:1-25`, `src/pages/manager/users.astro:44-51,85,101` - select wrapper, per-row feedback, submit guard
- `src/lib/route-inventory.test.ts:53-79,111-116`, `src/lib/route-access.ts:6` - route rows, no dynamic segments
- `scripts/smoke.mjs:285-331` - schedule smoke block and exact redirect matches

## Architecture Insights

- **Two enforcement layers.** Postgres enforces shift shape, month, station-wide overlap, the lock FK and the manager role. Per-person rules (containment, one per day, touching, fairness) live only in TypeScript. FR-004 asks for a warning, not a block, on availability, so containment cannot become a database constraint. Inferred from `prd.md:73-74`. Whether the other per-person rules move into SQL is a design choice.
- **The summary is computed from the stored rows.** It is recomputed from the stored shifts and raw windows, and nothing derived is stored. Warnings for an override fit the same model: the endpoint recomputes the summary from a full read, and the publish endpoint recomputes `daysWithNoOne`. Neither trusts the page.
- **Form POST and redirect.** Writes are form POST + redirect with allow-listed `?error=`. Confirmations are two-step pages, and there is no client-side state. A per-shift override fits this pattern without hydrating anything.
- **Replace-as-a-whole is the draft lifecycle.** A regenerate drops overrides by design (`roadmap.md:137`). Publish has to define whether regenerate and discard remain possible afterwards.

## Historical Context (from prior changes)

S-03 change folder `context/changes/generate-monthly-schedule/`, status `impl_reviewed`; the roadmap records it as done.

- `plan.md:61` said that a cross-month touching check is "left to S-04 overrides". This is **partially superseded**:
  - Impl review F1 added the M−1 → M direction: a generate-time block plus `touchesPreviousNight` (`reviews/impl-review.md` F1 decision; `change.md` "Impl review F1").
  - The M → M+1 direction is still unchecked (§2 above).
- `plan.md:64` and `plan-brief.md:66` scoped overrides, accept, publish and employee visibility out of S-03. **Supported:** none of them exists in the code (§1).
- Roadmap S-04 handoff "Overrides need an update policy … grant update (employee_id)" (`roadmap.md:139`). **Supported:** it matches the revoke migration and its comment.
- Roadmap handoff "summarizeSchedule … does not check one-shift-per-station-day or touching shifts" (`roadmap.md:140`). **Supported:** confirmed by reading `schedule-summary.ts:77-176`.
- Roadmap handoff "Overrides of day 1 06:00 or of M's last night must re-check it" (`roadmap.md:141`). **Partially supported:**
  - For day 1 06:00, the existing `previousNight` input is enough.
  - For M's last night, a new read of the M+1 draft is needed.
- Impl review F4 (UPDATE revoke) and F9 (draft months are an app-level rule) are fixed or documented. Both shape the S-04 grants.
- `generate-monthly-schedule/change.md` follow-ups:
  - Short availability windows leave every shift Uncovered.
  - The gaps fixture reports 8 night breaks.

  Both mean that drafts reaching S-04 will contain Uncovered shifts and fairness breaks that the manager fixes by override.

## Related Research

- `context/changes/generate-monthly-schedule/research.md` - S-03 research (station day, patterns, persistence choice)
- `context/archive/2026-09-29-manager-availability-visibility/` - S-02 team view and the `loadAllPages` honest-read pattern

## Open Questions

For `/10x-plan`; product decisions belong to the user.

1. **Accept and publish.** Is "accept" (PRD `prd.md:103`, roadmap `:135`) a separate state from "publish", or the same action? Nothing defines "accept".
2. **What a published month allows.** Can a published month still be overridden, regenerated, discarded, unpublished or unlocked? Today regenerate and discard would delete it silently (§1). Any rule that blocks discard needs a smoke teardown path (§4).
3. **Scope of an override.** Is it the assignee only (null allowed, so a shift can be cleared to Uncovered), or can the manager also change a station day's pattern or shift times? The constraints allow any of the 9 shapes, but a pattern change would mean deleting and inserting shifts, not updating `employee_id`.
4. **Hard-rule breaks caused by an override.** These are one per station day, touching shifts and the M → M+1 boundary. Should they warn and require confirmation (like FR-004) or block? The PRD addresses only availability conflicts (warn, `prd.md:73-74`).
5. **Who can be assigned.** Should managers appear in the assignee list? `members` includes every profile, and the summary treats an assignee with no windows as outside availability.
6. **Where the publish blocker is enforced.** Is `daysWithNoOne` enforced in the app only (the publish endpoint recomputes it from a full read) or also in the database (an RPC or check)?
7. **S-05 reads.** Should S-04's migration already add the published-read policies and a way for employees to read other people's names, or should S-05 add them?
8. **Audit.** Store who published and when, and who overrode a shift? The PRD declines override reasons (`prd.md:76`). No audit columns exist.
