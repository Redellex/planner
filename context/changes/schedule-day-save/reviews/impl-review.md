<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Day-level save for manual assignments (S-08)

- **Plan**: context/changes/schedule-day-save/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2, 3, 4
- **Date**: 2026-10-08
- **Verdict**: NEEDS ATTENTION (all findings fixed in triage)
- **Findings**: 0 critical, 2 warnings, 4 observations

Automated checks run during review: `npm test` (458 passed), `npm run lint`, `npx astro check` (0 errors), `npm run check:ui`, `npx vitest run src/lib/station-time-zone.test.ts` (4 passed), `npm run test:db` (6 files, 265 tests, PASS). `npm run smoke` was not re-run (needs a local build; recorded passing at b2e6068, no code change since).

Plan drift: every planned change MATCHes (migration check order, 20 pgTAP assertions, codec/URL/messages, endpoint check order, page confirm rebuild, day panel, kitchen sink, smoke, CLAUDE.md). One unplanned file, `src/components/schedule/ScheduleActions.astro` (the `notice` feedback kind), is implied by the plan's "otherwise in the draft card" for `unchanged=1` and is accepted as in scope.

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | PASS    |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | WARNING |
| Success Criteria    | WARNING |

## Findings

### F1 — Overlapping double submit reports "This day changed" after saving

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20261008120000_save_schedule_day.sql:53-68 (with src/pages/api/manager/schedule/override.ts:94-99)
- **Detail**: The endpoint's `alreadySaved` check only covers a second click whose reads run after the first save committed. If the second request reads while the first one's `save_schedule_day` is still in flight, it passes `alreadySaved` (false) and `matchesStored` (true), then blocks on the first call's `FOR UPDATE` locks; once released, the function sees the stored assignee equal to `to` (not `was`) and raises SP004. The browser shows the last response, `DAY_CHANGED_ERROR`, although the day was saved. CLAUDE.md promises `?overridden=1` for the second click of a double submit.
- **Fix A ⭐ Recommended**: In `save_schedule_day`, after the lock, return 0 when the day's stored id set equals `rows` and every stored `employee_id` is not distinct from its row's `employee_id`, before the SP004 check (a new migration, plus a pgTAP case: stale `was`, `employee_id` already stored → 0, nothing changed).
  - Strength: Closes the race at the source, under the row locks, with the same rule as the endpoint's `alreadySaved`; the endpoint already redirects `?overridden=1` on success.
  - Tradeoff: A new migration to push to hosted; CLAUDE.md's `test:db`/function contract lines need the idempotent case.
  - Confidence: HIGH — READ COMMITTED re-reads the locked rows after the wait, so the check sees the committed values.
  - Blind spot: Two managers making the identical change at once both get "Day saved." (already the endpoint's behaviour).
- **Fix B**: In the endpoint, on SP004 re-read the day's shifts and redirect `?overridden=1` when `alreadySaved(rows, dayShifts)`.
  - Strength: No migration.
  - Tradeoff: One more read on the error path; the idempotency rule lives in two endpoint branches instead of one place.
  - Confidence: MEDIUM — the re-read happens after the function's transaction ended, so it is a second, unlocked look.
  - Blind spot: None significant.
- **Decision**: FIXED via Fix A — new migration 20261008130000_save_schedule_day_idempotent.sql (returns 0 when the day is already stored as requested), pgTAP case (plan 22), CLAUDE.md contract; db reset + test:db 267 PASS

### F2 — Manual verification pending (incl. the §6.2 sabotage check)

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: context/changes/schedule-day-save/plan.md Progress 1.5, 3.6–3.11, 4.4
- **Detail**: All automated items are `[x]` and pass; the manual items are honestly unchecked (no rubber-stamping). 1.5 (stale comparison removed → `test:db` red) is the only proof that the pgTAP stale assertions can fail; 3.6–3.11 cover the two-tab stale case and keyboard reachability, which smoke does not.
- **Fix**: Run 1.5, 3.6–3.11 and 4.4 before `/10x-archive`, tick them in Progress.
- **Decision**: FIXED — 1.5 sabotage run: stale comparison removed from the live function → schedule_day_save tests 5–7 red; restored by db reset, 267 PASS. 4.4 CLAUDE.md read-through: no removed symbol. 3.6–3.11 verified by the user in the browser (3.8: a pick changed during the confirm reopens the confirm for the new set, accepted as designed; 3.10 replayed over HTTP: DAY_CHANGED_ERROR, nothing stored).

### F3 — Publish committing mid-call surfaces as "This day changed"

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20261008120000_save_schedule_day.sql:32-42, 82-86
- **Detail**: `published_at` is read without a lock. If `publish_schedule` commits after that read and before the UPDATE, RLS (`published_at is null`) filters every row to 0 without an error, so the count check raises SP004 → `DAY_CHANGED_ERROR` instead of SP001 → `SCHEDULE_PUBLISHED_ERROR`. Nothing is written; only the message is wrong, and "Reload" shows the published month.
- **Fix**: Before raising SP004 on the count mismatch, re-read `schedules.published_at` and raise SP001 when set (fold into the F1 migration if Fix A is chosen).
- **Decision**: FIXED (folded into F1 Fix A) — count mismatch re-reads published_at and raises SP001 before SP004; race not reproducible in single-session pgTAP, so untested

### F4 — Save racing discard/regenerate can deadlock into the generic error

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20261008120000_save_schedule_day.sql:46-51 (with 20261007130000_guard_published_schedule_shifts.sql)
- **Detail**: The save locks shift rows, then the guard trigger wants `schedules … FOR SHARE`; discard and `replace_schedule_draft` lock the `schedules` row first, then cascade to the shifts. Two managers acting on the same month at the same moment can get 40P01; it is unmapped, so the save shows `GENERIC_SCHEDULE_WRITE_ERROR`. Data stays safe (one transaction aborts). Locking `schedules` first in the function is not possible (no UPDATE grant for `FOR SHARE`).
- **Fix**: In `override.ts`, map 40P01 to `DAY_CHANGED_ERROR` (reload is the right advice).
- **Decision**: FIXED — override.ts maps 40P01 to DAY_CHANGED_ERROR after the 23503 case

### F5 — Day form parser has no row cap

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/schedule-day-save.ts:38-56
- **Detail**: The loop over `shift` fields is unbounded and calls `form.getAll` twice per row (each a full scan), so cost is quadratic in field count. Only a manager can reach it (middleware 403s others), but a crafted POST with thousands of fields burns Workers Free CPU for nothing; a station day has at most 4 shifts.
- **Fix**: Return null when `shiftValues.length` exceeds the largest pattern's shift count (4, from `STATION_DAY_PATTERNS`).
- **Decision**: FIXED — parseDaySaveForm returns null above MAX_DAY_ROWS (max STATION_DAY_PATTERNS length, 4); tests: 5 rows → null, a full 6×4 day (4 rows) parses

### F6 — Stale `?shift=` mention in parseShiftParam doc

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/lib/schedule.ts:238
- **Detail**: The doc comment says "A shift id from a form field or `?shift=`", but the `shift=` URL param was removed by this change.
- **Fix**: Change it to "A shift id from a form field or a day row".
- **Decision**: FIXED — doc now "A shift or profile id from a form field or a day row" (it also parses assignee ids)

## Triage summary

- Fixed: F1 (Fix A), F3 (folded into F1), F4, F5, F6
- Fixed: F2 (every manual Progress item done)
- Post-triage checks: `npm test`, `npm run lint`, `npx astro check`, `npm run test:db` (267)
