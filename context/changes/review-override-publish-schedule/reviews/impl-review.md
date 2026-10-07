<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: S-04: Review, override and publish schedule

- **Plan**: context/changes/review-override-publish-schedule/plan.md
- **Scope**: Full plan (working tree included: uncommitted edits to `src/lib/schedule-override.test.ts` and `src/pages/manager/schedule.astro`)
- **Reviewed phases**: 1, 2, 3, 4
- **Date**: 2026-10-07
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 1 warning, 6 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | WARNING |

Automated checks run during the review (working tree): `npm test` 285/285 pass, `npm run lint` clean, `npm run check:ui` clean, `npm run test:db` 192 asserts in 5 files pass, `npx astro check` 0 errors/warnings/hints, `npm run build` succeeds. `npm run smoke` was not re-run: `.dev.vars` points at the hosted project. It was recorded as passing at 504e714 and 166119a.

Plan drift: all four phases MATCH. There are no MISSING items and no violation of "What We're NOT Doing". The non-code files outside the plan are only change, plan and roadmap tracking. Small, benign EXTRAs:
- the `perMember` counts in the confirm panel
- the `asSmokeUser` smoke helper
- a hint line on the published card
- the smoke shift-id read now runs before the employee 403 step

Out of scope and pre-existing: `/manager/months` and `months/lock.ts:67` still pass raw `error.message` through `?error=` (legacy view, explicitly left alone by the plan).

## Findings

### F1 — Override and direct shift writes can land in a month just after it is published

- **Severity**: ⚠️ WARNING
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20261007120000_publish_and_override_schedules.sql:61-84 (update policy), 140-160 (publish_schedule)
- **Detail**: The freeze relies on an RLS `exists (… schedules … published_at is null)` subquery. Under READ COMMITTED that subquery is evaluated against the statement's snapshot and takes no lock on `schedules`. An override's `UPDATE … SET employee_id` changes no FK column either, so it takes no key lock on the parent. `publish_schedule` locks the `schedules` row `FOR UPDATE` and then counts covered days from its own snapshot. Two interleavings break it:
  - (a) An override that is in flight but uncommitted is invisible to the count. Publish commits, then the override commits, so a published month changes and can be left with a day with no one.
  - (b) An override whose snapshot predates publish's commit still passes RLS, and publish touches no shift row, so no re-check happens.
  - Direct PostgREST insert/delete on `schedule_shifts` has the same gap.
  - Not affected: replace and discard. They delete the `schedules` row, which conflicts with the `FOR UPDATE`.
  - Likelihood: it needs two manager actions within milliseconds. That is unlikely for one station manager, but it breaks two guarantees CLAUDE.md states: "a published month is frozen" and "publish refused while a day has no one".
- **Fix A ⭐ Recommended**: Add a BEFORE INSERT/UPDATE/DELETE row trigger on `schedule_shifts`. It runs `select published_at from schedules where month = … for share` and raises SP001 when the month is published. It is skipped when `pg_trigger_depth() > 1`, so the FK cascade and set-null actions keep working.
  - Strength: It serializes against publish's `FOR UPDATE` for every write path (override, PostgREST insert/delete), and `describeScheduleWriteError` already maps SP001.
  - Tradeoff: It partly reverses the plan's "RLS, not triggers" decision. Superuser fixtures that write shifts of a published month directly would now hit it. The pgTAP fixtures delete via `schedules` (a cascade, so the trigger is skipped), but that needs checking.
  - Confidence: MED — standard row-lock pattern, but concurrency is hard to prove in pgTAP; only the sequential refusal can be asserted.
  - Blind spot: Whether `FOR SHARE` inside the trigger needs a grant on `schedules` for `authenticated`. It may have to be a SECURITY DEFINER helper.
- **Fix B**: Accept the risk and document it in CLAUDE.md as a known single-manager assumption. Publish already re-checks coverage, and unpublish/republish recovers.
  - Strength: No schema change. It matches the realistic usage (one manager per station).
  - Tradeoff: The documented "frozen" guarantee becomes "frozen except under concurrent manager writes".
  - Confidence: HIGH — the window is milliseconds, and recovery is unpublish → fix → publish.
  - Blind spot: If S-05 lets employees act on published data, a silently changed month matters more.
- **Decision**: FIXED (Fix A)
  - New migration `20261007130000_guard_published_schedule_shifts.sql`: the `schedule_shifts_published_guard` BEFORE trigger, SECURITY DEFINER. It locks the month's `schedules` row FOR SHARE, raises SP001 when the month is published, and skips when `pg_trigger_depth() > 1`.
  - pgTAP: the manager's insert into a published month now expects SP001. Five new asserts check that the owner's insert is refused, that account deletion still sets the shift to null, and that a cascade through `schedules` still works. `plan(98)`, 197/197 pass.
  - A two-session race check by hand against the local DB: an update started while publish held its lock waited about 2 s, then failed with SP001, and the shift was left unchanged.
  - CLAUDE.md freeze line updated; types regenerated with no change.

### F2 — Confirm page shows nothing when the warnings can no longer be rebuilt

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/manager/schedule.astro:186-207
- **Detail**: When `?confirm=override&shift=&employee=` arrives but a concurrent change means the override no longer has warnings, or the shift or employee is no longer loaded, `overrideConfirm` stays null. The page then renders no panel and no message, although nothing was saved.
- **Fix**: When `confirm=override` is present but no panel is built, show a card notice such as "Nothing was saved. Choose the assignee again."
- **Decision**: FIXED
  - New `OVERRIDE_NOT_SAVED_ERROR` in `src/lib/schedule.ts`. The page computes it; it is not a `?error=` value, so it is not in the allow-list.
  - `schedule.astro` shows it in the draft card when `confirm=override` builds no panel and there is no other feedback. On a published month it shows `SCHEDULE_PUBLISHED_ERROR` instead.
  - Added to the kitchen sink's error states.
  - Lint, check:ui and astro check are clean. Not exercised in a browser.

### F3 — A published month can gain a day with no one when an account is deleted, and the card does not show it

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/schedule/ScheduleActions.astro:59-71 (published card); migration `employee_id … on delete set null`
- **Detail**: `on delete set null` is an FK action, so RLS does not block it, which is intended per CLAUDE.md. The deleted person's published shifts become Uncovered, but the gaps notice is only shown on a draft card, so the manager is not told that a published month now has a day with no one.
- **Fix**: Show the "N days have no one" line on the published card too (with "Unpublish to fix"), and note the account-deletion case in CLAUDE.md.
- **Decision**: FIXED
  - `ScheduleActions.astro`: the published card shows a destructive alert when `daysWithNoOne > 0`: "Since publishing, N days have no one (a deleted account's shifts became Uncovered). Unpublish to assign someone."
  - Kitchen sink state added; CLAUDE.md freeze line notes the case.

### F4 — Concurrent overrides can combine into an unwarned same-day or back-to-back pair

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/manager/schedule/override.ts:105-128
- **Detail**: Each override computes its warnings from its own read before writing. Two concurrent clean overrides can together create a pair neither one saw. The summary card reports the pair after reload; the database does not check per-person rules. `confirm=override` approves whatever warnings exist at save time, not the ones the manager saw. This is the plan's deliberate choice ("recompute at save time").
- **Fix**: Accept and record it in CLAUDE.md next to the override description. A `generated_at`/version token in the form would close it if it ever matters.
- **Decision**: FIXED (accepted limit, documented in CLAUDE.md's override route description)

### F5 — Publish runs the full team read to use only `daysWithNoOne`

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/manager/schedule/publish.ts:35-76
- **Detail**: Publish follows the plan ("read the inputs, the shifts and the draft row in full"). That means 6+ paged reads (profiles, windows, carry-overs, the boundary windows and shifts) and a `summarizeSchedule` call, only to read `daysWithNoOne`. A failed windows read blocks publish with the generic error, and each publish spends extra Worker subrequests. The CPU cost is negligible.
- **Fix**: Compute covered station days from the month's shifts alone (the same rule as `daysWithNoOne`), or rely on the RPC's SP003 and drop the app pre-check.
- **Decision**: FIXED
  - New pure `daysWithNoOne(month, shifts)` in `schedule-summary.ts`, delegating to `summarizeSchedule` with no members or windows.
  - Unit test: the 30 Nov boundary covered by 1 Dec 00:00–06:00, and equality with the full summary.
  - `publish.ts` now reads only the draft row and the shifts (`loadScheduleInputs` dropped). CLAUDE.md updated.
  - This is a deliberate small departure from the plan's "read the inputs … in full".

### F6 — Override-warning identity includes the assignee, which goes past the plan's wording

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/lib/schedule-override.ts:71-101
- **Detail**: The plan identifies a fairness break by `{kind, shift id}` and the other kinds by "the shift is in after.X". The code keys every warning on the problem, the shifts and the assignee, and filters against `before`. As a result, a problem the old assignee already had on that shift is warned again for the new one. The behaviour is coherent and pinned by tests: `schedule-override.test.ts:225` and the uncommitted block at :302-394. Neither the plan nor CLAUDE.md states this rule.
- **Fix**: Add one line to CLAUDE.md's `schedule-override.ts` bullet ("a warning is a problem for that person: one the old assignee already had is warned again for the new one") and a short addendum to the plan.
- **Decision**: FIXED (CLAUDE.md `schedule-override.ts` bullet; plan.md "Addendum (impl review, 2026-10-07)", which also records the F1 and F5 changes)

### F7 — Manual verification pending and working-tree fixes uncommitted

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: plan.md Progress 1.5, 2.4, 3.5–3.9, 4.6–4.9
- **Detail**: Every automated item is checked with a SHA and re-passes now, except smoke, which was not re-run in this review. All 11 manual items are still `[ ]`, including the Stryker run on `schedule-override.ts` (2.4). Nothing is rubber-stamped. Two working-tree edits are not committed:
  - the published-month feedback routing in `schedule.astro:171-174`
  - three new override tests
- **Fix**: Commit the working tree, run the manual walkthrough (Testing Strategy steps 1–7) and Stryker on `src/lib/schedule-override.ts`, then tick the items.
- **Decision**: FIXED (partly; the manual walkthrough stays with the user)
  - Stryker (2.4) ran with `--timeoutMS 60000`. The default timeout had counted 82 of 91 mutants as timeouts.
    - Result: 21 survivors, 76.9%.
    - 2 were real (the overridden shift as the *first* of a back-to-back pair) and are killed by a new test.
    - 19 are equivalent and are recorded under Progress 2.4.
  - Full re-run on the working tree, all passing:
    - `npm test` 287/287, `npm run test:db` 197
    - lint, check:ui, astro check
    - build
  - Working tree committed.
  - Still open:
    - manual items 1.5, 3.5–3.9 and 4.6–4.9
    - `npm run smoke`, because `.dev.vars` points at hosted, so it needs a swap to local and a rebuild first

## Triage summary

- Fixed: F1 (Fix A), F2, F3, F4 (documented as an accepted limit), F5, F6, F7 (Stryker and commit; manual walkthrough pending)
- Skipped: none
