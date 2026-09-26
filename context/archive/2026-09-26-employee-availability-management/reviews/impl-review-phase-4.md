<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Employee Availability Management

- **Plan**: context/changes/employee-availability-management/plan.md
- **Scope**: Phase 4 of 4
- **Reviewed phases**: 4
- **Date**: 2026-09-26
- **Verdict**: APPROVED
- **Findings**: 0 critical, 0 warnings, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Success criteria evidence

- **Plan drift:** `scripts/smoke.mjs` matches the plan.
  - The smoke month is the station month + 12, computed with the `Europe/Warsaw` literal and commented to point at `STATION_TIME_ZONE`.
  - Before sign-out, the fresh user renders `/availability`, creates a window, and gets an overlap error on the repeat.
  - After the existing manager steps, the manager locks the month, a create there is refused, and the manager unlocks it. This reuses the F-01 manager sign-in, which the plan allows.
  - Extras, all benign: the smoke asserts the exact error messages (stricter than the plan's bare `error=`), and the redirect includes `day=`, which follows from the documented Phase 2 calendar change.
- **Docs:** CLAUDE.md has the Availability subsection (both tables and the lock semantics, `is_availability_month_editable`, wall-clock Europe/Warsaw with the two-place constant, `src/lib/availability.ts`, routes), lists the seeded `employee@example.com`, and describes the availability smoke steps. No "no custom tables" line remains. The Phase 1–3 triage fixes (the `20260926140000` migration, column grants, DST durations) are reflected too.
- **4.1 (smoke on a fresh DB):**
  - CI `smoke` passed on `5428bb9` (run 36237447766).
  - For `a5fb724` (the triage fixes): at review time `ci` and Workers Build had passed and `smoke` was still pending.
- **4.2 (second run without a reset):** confirmed by reading the code, not by running it.
  - Each run signs up a new `smoke-${Date.now()}` user and unlocks the month at the end, so a second run starts clean.
  - It was not re-run locally, because `.env`/`.dev.vars` point to the hosted project.
- **4.3 (lint and astro check):** both passed earlier this session after the triage fixes. No code has changed since.
- **4.5 (manual):** checked. CLAUDE.md is accurate.
- **Earlier phases still intact:** the Phase 1–3 fixes don't affect the smoke steps. The 08:00–16:00 window on day 1 never spills into the next month, and `create.ts` is unchanged.

## Findings

### F1 — A smoke run that crashes can leave the smoke month locked

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: scripts/smoke.mjs:121-138
- **Detail**: The runner keeps going after a failed step, so the unlock step normally still runs. But if `fetch` throws between the lock and the unlock (the server dies, or a network error), the process exits with the smoke month still locked. Every later local run then fails at "availability create adds a window", because the new user's create is refused as locked. CI is not affected, because it starts from a fresh database each time.
- **Fix**: Add a one-line recovery note to the `npm run smoke` entry in CLAUDE.md: `delete from public.availability_locks where month = '<station month + 12>-01'`.
- **Decision**: FIXED. The `npm run smoke` entry in CLAUDE.md now explains the stale-lock symptom and gives the recovery SQL.

### F2 — The rewritten update endpoint and the delete endpoint have no automated coverage

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: scripts/smoke.mjs:88-98
- **Detail**: The smoke covers only `create`, which matches the plan's contract. `update.ts` was rewritten during the Phase 1–3 triage (F3: it now takes the date from the stored row) and is only type-checked. `delete.ts` has no HTTP coverage either. There is no test runner, so the smoke is the only regression net for these endpoints.
- **Fix**: After the overlap step, add two steps for the fresh user. An `update` of the window's times (id taken from the rendered `/availability` page) should return `&updated=1`, and a `delete` should return `&updated=1`. Then recreate the window, or reorder the steps so the lock step still has a window to refuse.
- **Decision**: FIXED (adjusted). `/availability` only offers the next 3 months, so the edit/delete steps can't use the +12 smoke month. Four new steps run in station month + 3 (the last month the page offers): the fresh user creates a 10:00–12:00 window on day 1, reads its id from the rendered page, updates it to 11:00–13:00 and deletes it, each expecting `&updated=1`. The +12 create, overlap and lock steps are unchanged. `request()` now also returns the response body. The CLAUDE.md smoke entry is updated. Checked with `node --check` and ESLint. The first real run will be CI after the next push, because `.env`/`.dev.vars` point to the hosted project.
