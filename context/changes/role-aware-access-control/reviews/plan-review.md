<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Role-aware Access Control

- **Plan**: context/changes/role-aware-access-control/plan.md
- **Mode**: Deep (claims verified inline, no sub-agent)
- **Date**: 2026-09-25
- **Verdict**: REVISE → SOUND after triage
- **Findings**: 0 critical, 2 warnings, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | WARNING |
| Blind Spots | PASS |
| Plan Completeness | WARNING |

## Grounding
8/8 existing paths ✓ (4 new paths correctly absent), seed config ✓, CI supabase start ✓, brief↔plan ✓, Progress↔Phase 22/22 rows ✓

## Findings

### F1 — Untyped Supabase client will fail strict type-checked lint

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Architectural Fitness
- **Location**: Phase 2 (middleware), Phase 3 (users page, role API)
- **Detail**: `createServerClient` defaults to `Database = any` (@supabase/ssr createServerClient.d.ts:74) and `src/lib/supabase.ts` passes no generic, so `.from("profiles")` rows are `any`. Under `tseslint.configs.strictTypeChecked` that trips no-unsafe-member-access / no-unsafe-assignment, failing criteria 2.1 and 3.1.
- **Fix A ⭐ Recommended**: Generate types with `supabase gen types typescript --local` into `src/db/database.types.ts`, pass the `Database` generic, and derive `AppRole` from the enum.
  - Strength: Standard pattern; enum and TS type can't drift; later slices are typed for free.
  - Tradeoff: Must regenerate after every migration; CI doesn't detect drift.
  - Confidence: HIGH — the documented supabase-js typing path.
  - Blind spot: Prettier/lint-staged interaction with the generated file.
- **Fix B**: Hand-write a minimal `Database` type.
  - Strength: No generator step.
  - Tradeoff: Manual sync; drifts silently.
  - Confidence: MED.
  - Blind spot: The exact supabase-js shape is easy to get wrong.
- **Decision**: FIXED (Fix A). Phase 1 §3 added, criterion 1.6 added, roles.ts contract updated, CLAUDE.md regenerate note added to Phase 4.

### F2 — Phase 1 verification steps aren't runnable as written

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 — Success Criteria (1.3–1.5)
- **Detail**: 1.3 had no command, and the impersonation snippet used `set local` outside a transaction.
- **Fix**: Name the exact command (`docker exec -i supabase_db_planner psql …`) and wrap impersonation in `begin; … rollback;`.
- **Decision**: FIXED

### F3 — Top bar isn't global, so managers have one path to Users

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 2 §5
- **Detail**: `Topbar` renders only in `src/components/Welcome.astro:18`, not `Layout.astro`.
- **Fix**: Also add the Users link to the dashboard; reword to "home top bar + dashboard".
- **Decision**: FIXED (criterion 2.6 reworded)

### F4 — Later slices will need employees to see coworker names

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: What We're NOT Doing / Open Risks
- **Detail**: S-05 needs employees to see everyone's shifts; `profiles` RLS is own-row-only for employees and email is the only identifier.
- **Fix**: Note that S-05 should add a narrow read path (a view with id + display name), not widen `profiles` RLS.
- **Decision**: FIXED (added to plan's NOT-doing list and brief's Open Risks)
