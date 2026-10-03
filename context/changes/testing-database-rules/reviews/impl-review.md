<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Database Rules: Ownership, Month Lock and Roles

- **Plan**: context/changes/testing-database-rules/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2, 3, 4
- **Date**: 2026-10-03
- **Verdict**: APPROVED
- **Findings**: 0 critical, 0 warnings, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | WARNING |

## Evidence

- Every scenario row in the Phase 1–3 contract tables has a matching assertion: ownership 30, month lock 39, roles 21, so 90 in total.
- Each refused write on an existing row is followed by an intactness check as `postgres`, scoped to fixture ids.
- No migration or `src/` app code changed. The only TS change is the zone guard (`src/lib/station-time-zone.test.ts`).
- `availability_month_lock.test.sql:27` clears the M−1 and M locks as well. The plan only asked for M+1 and M+3. This tightens the plan: a current-month refusal now comes from the time rule, not from a stray lock. Cookbook §6.2 item 5 documents it.
- Automated checks, run during this review: `npm run test:db` 90/90 PASS (twice); `npm test` 75/75; `npm run lint` clean; `npx astro check` 0 errors; `npx prettier --check context/foundation/test-plan.md CLAUDE.md` clean.
- DB state after a run: no `@db-rules.test` users. The seed manager `…0001` is still the only manager. The lock list is the same before and after.
- CI run 37116516053 passed. The smoke job's setup step shows `version: 2.117.0`, and the job runs "Database rules tests" before the secrets, build and smoke steps.

## Findings

### F1 — Per-phase CI gates were confirmed once, at the end

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: context/changes/testing-database-rules/plan.md (Progress 1.5, 2.4, 3.3)
- **Detail**: The plan says to pause for a CI run after each of Phases 1–3. All three manual CI items are stamped `2d4452d`, and the branch has only two CI runs: 37116516053 (success) and the run for the epilogue commit. CI was confirmed once for the finished branch, not per phase. The evidence is real (green step on the pinned CLI), so this is not rubber-stamping. The Progress record just reads as if each phase had its own confirmation.
- **Fix**: Add a note under Progress that items 1.5, 2.4 and 3.3 were confirmed together by CI run 37116516053 on `2d4452d`.
- **Decision**: FIXED: CI note added under `## Progress` in plan.md

### F2 — Weekday-repeat batch refusal has no batch-shaped control

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: supabase/tests/database/availability_month_lock.test.sql:168
- **Detail**: Cookbook §6.2 item 9 and the plan's Testing Strategy pair every refusal with an allow control on the same kind of write. The multi-row `insert … select` weekday batch is checked only for refusal (42501). The single-row spill has its half-open control, but no test shows that a non-spilling weekday batch is accepted. A regression that refuses every multi-row insert, which breaks the app's "repeat on this weekday" feature (`src/pages/api/availability/create.ts:30-44`), would leave this file green.
- **Fix**: Add a `lives_ok` for the same `generate_series` batch that does not spill (for example, 13:00–14:00 on the weekday of M+1's last day, which does not overlap A's other M+1 windows), and raise `plan(39)` to `plan(40)`.
- **Decision**: FIXED: added the open-M+1 weekday batch `lives_ok` control (plan(40)); test-plan §6.6 counts updated to 91 / 40
