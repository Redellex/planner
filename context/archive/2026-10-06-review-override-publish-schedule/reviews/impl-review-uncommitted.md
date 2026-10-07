<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: S-04 — out-of-plan UI and dev fixes (uncommitted working tree)

- **Plan**: context/changes/review-override-publish-schedule/plan.md
- **Scope**: Uncommitted working-tree diff on `review-override-publish-schedule` (on top of d8425fb). These are changes from manual testing that are not in the plan. They were judged on correctness, CLAUDE.md conventions and regressions, not on drift.
- **Reviewed phases**: none (no plan phase was re-reviewed; phases 1–4 are covered by `impl-review.md`)
- **Date**: 2026-10-07
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 1 warning, 7 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | WARNING |
| Safety & Quality    | PASS    |
| Architecture        | PASS    |
| Pattern Consistency | WARNING |
| Success Criteria    | WARNING |

Automated checks run during the review (working tree): `npm run lint` clean, `npm run check:ui` clean, `npm test` 294/294 pass, `npx astro check` 0 errors/warnings/hints. `npm run test:db` and `npm run smoke` were not re-run. The diff adds no migrations or endpoints, and the smoke markers (`data-schedule-draft`, `data-shift-id`, `data-schedule-published`) are unchanged.

What checked out:

- Authorization is unchanged. The Topbar link is shown only to managers, and `/manager/schedule` stays guarded by `MANAGER_ROUTES`.
- All new colours use tokens: `--warning` in `:root`, `.dark` and `@theme inline`. No existing token value changed.
- `outsideStarts` keyed by `starts_at` is sound because `schedule_shifts_no_overlap` is station-wide.
- `groupRuleBreaks` dedupes and sorts days and is covered by 4 tests.
- `toSorted` is ES2023 and supported by both workerd and Node 22.
- Removing `confirm.perMember` left no dangling uses.

## Findings

### F1 — Out-of-plan additions not yet recorded in plan.md

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: context/changes/review-override-publish-schedule/plan.md:614 (Addendum)
- **Detail**: These changes are benign, but the plan does not describe them. "What We're NOT Doing" does not exclude any of them:
  - the dev-server `optimizeDeps` fix
  - the manager "Schedule" nav link
  - the `--warning` token
  - the calendar props change (`shiftsByDay` + `members` + `outsideAvailability`) and the outside-availability day marker
  - the desktop cell lists on both calendars (only the calendar widens from `lg`)
  - fairness exceptions grouped per person and kind (`groupRuleBreaks`, with day links)
  - the confirm panel folding fairness into one line, with `confirm.perMember` removed
  - `calendarName`
- **Fix**: Add a second Addendum block ("Manual-testing additions, 2026-10-07") listing the items above. Also record F6 as an accepted limit.
- **Decision**: FIXED (plan.md "Addendum (manual-testing additions, 2026-10-07)")

### F2 — Confirm panel's "Fairness exceptions" link is dead on the dev page

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/components/schedule/ScheduleDayPanel.astro:58
- **Detail**: `fairnessId` is hard-coded to `schedule-fairness-heading`, but `ScheduleSummary` prefixes it with `idPrefix`. On `/dev/schedule-states` the confirm panel (`override-confirm-`) links to `#schedule-fairness-heading`, and no element has that id: the summaries there are `covered-`, `gaps-` and `breaks-`. It works on `/manager/schedule`, where the summary has no prefix.
- **Fix**: Add an optional `summaryIdPrefix = ""` prop to `ScheduleDayPanel` and build `` `${summaryIdPrefix}schedule-fairness-heading` ``. The dev confirm state passes `summaryIdPrefix="breaks-"`, the rule-break summary on the same page.
- **Decision**: FIXED (`summaryIdPrefix` prop on `ScheduleDayPanel`; the dev confirm state passes `breaks-`, and the anchor resolves on `/dev/schedule-states`)

### F3 — `calendarName` lives in schedule.ts but is a profile-label helper used by the availability view

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/lib/schedule.ts:425, src/components/team-availability/TeamCalendar.astro:13
- **Detail**: `TeamCalendar` imports from `schedule.ts` only to get `calendarName`, so the availability view depends on the schedule module. `calendarName` is the short form of `accountLabel`, which lives in `src/lib/manager-users.ts` and is already the shared way to label a profile.
- **Fix**: Move `calendarName` next to `accountLabel` in `src/lib/manager-users.ts`, update both calendars' imports, and move its 3 tests to a new `src/lib/manager-users.test.ts`.
- **Decision**: FIXED (`calendarName` moved to `src/lib/manager-users.ts`, tests in the new `src/lib/manager-users.test.ts`, CLAUDE.md updated)

### F4 — The "days with no one" alert and the uncovered line widen with the calendar

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/components/schedule/ScheduleCalendar.astro:39-58
- **Detail**: The destructive `Alert` and the "N shifts are uncovered." paragraph are inside `ScheduleCalendar`. From `lg` they stretch to `max-w-6xl`, while the actions card above and the day panel below stay at `max-w-2xl`. CLAUDE.md and the page comment say only the calendar widens.
- **Fix**: Wrap the alert and the paragraph in `<div class="mx-auto w-full max-w-2xl">` inside the component.
- **Decision**: FIXED (the alert and the uncovered line are wrapped in `max-w-2xl` inside `ScheduleCalendar`)

### F5 — A full TeamCalendar cell is taller than `lg:min-h-28`, so week rows differ in height

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/components/team-availability/TeamCalendar.astro:58,82
- **Detail**: A cell at the cap is about 120px tall:
  - day number 16px + gap 2px
  - 5 lines × 16px + 4 gaps × 2px = 88px
  - `lg:p-1.5` 12px + border 2px

  `lg:min-h-28` is 112px, so a week holding a busy day is about 8px taller than the other weeks. Nothing clips, because the grid row grows. `ScheduleCalendar` holds at most 4 shifts (about 102px) and fits.

- **Fix**: Use `lg:min-h-30` (120px, on the spacing scale, not an arbitrary value) on the TeamCalendar day link and its blank spans.
- **Decision**: FIXED (`lg:min-h-30` on the TeamCalendar day link and blank spans)

### F6 — Desktop names are not exposed to screen readers

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/components/schedule/ScheduleCalendar.astro:87, src/components/team-availability/TeamCalendar.astro:80
- **Detail**: The day link's `aria-label` replaces its content, so the `lg` name lists are visual only. A screen-reader user hears the counts and gets the names from the day panel after selecting the day, the same as on a phone. Putting every name in the label would make each of the 28–31 links very long.
- **Fix**: Keep as is. Record it in the plan addendum as an accepted limit: the day panel is the accessible source of names.
- **Decision**: FIXED (accepted limit, recorded in the plan addendum)

### F7 — The `optimizeDeps` dev fix is unverified on a cold start

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: astro.config.mjs:15-22
- **Detail**: The environment name `ssr` matches the `deps_ssr` path in the error. `optimizeDeps` applies only to the dev server and does not change `npm run build`. The fix is only proven once the crash fails to come back with an empty Vite cache.
- **Fix**: Delete `node_modules/.vite`, start dev with `ASTRO_DEV_BACKGROUND=1 node node_modules/astro/astro.js dev`, load `/manager/schedule` as the first request, and confirm there is no "The file does not exist at …deps_ssr" error.
- **Decision**: FIXED (partly: the current `deps_ssr/_metadata.json` lists `astro/assets/services/noop` among 598 optimized deps, with 0 discovered at runtime. An empty-cache start was not run because a dev server was using the cache (PID on :4321) and deleting `node_modules/.vite` was denied earlier)

### F8 — The team-availability view has no kitchen sink and is outside `check:ui`, so the new desktop states have no fixture

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: scripts/check-ui-literals.mjs:17, src/components/team-availability/TeamCalendar.astro:97
- **Detail**: This predates the diff. `src/components/team-availability/` and `src/pages/manager/availability.astro` are not in the `check:ui` scope, and no `src/pages/dev/team-availability-states.astro` exists. The new `lg` states can only be seen against live data:
  - "+N more"
  - the carry-over line
  - the filtered view without names

  A manual grep finds no colour literals in these files. The one pre-existing arbitrary value is `text-[10px]` at line 97.

- **Fix**: Leave for a follow-up `/10x-ui` pass on `/manager/availability`: kitchen sink, scope entry, `text-[10px]`. Note it in the plan addendum.
- **Decision**: FIXED (recorded as a follow-up in the plan addendum)
