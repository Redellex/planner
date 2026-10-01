<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Test Runner and Station-Time Logic

- **Plan**: context/changes/testing-station-time/plan.md
- **Mode**: Deep (verified inline)
- **Date**: 2026-10-01
- **Verdict**: SOUND
- **Findings**: 0 critical, 1 warning, 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | WARNING |
| Plan Completeness | WARNING |

## Grounding

6/6 paths ✓, 8/8 symbols ✓, brief↔plan ✓, Progress↔Phase ✓ (16/16 criteria matched). All expected literals (station-month flips, weekdays, DST instants, labels) were re-derived with raw `Intl`/`Date.UTC` under `TZ=UTC` on Node 22.23.3 and 24.21.0, and all match. CI's Node 22 ships ICU 78.3, the same as the dev machine, so the brief's "ICU differs on CI" risk is gone.

## Findings

### F1 — Stryker's Vitest runner was never built against Vitest 5

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 1 §1 × Phase 3 §1
- **Detail**: `@stryker-mutator/vitest-runner` 10.0.0 (2026-08-14) pins vitest 4.1.10 in its devDependencies. Vitest 5.0.0 came out later, on 2026-09-03. The 4.1.11 fallback was only decided in Phase 1, but any breakage would show up in Phase 3, which had no contingency.
- **Fix A ⭐ Recommended**: Pin `vitest@^4.1.11` from the start.
  - Strength: This is the version Stryker was tested against.
  - Tradeoff: Starts one major behind.
  - Confidence: HIGH — taken from Stryker's devDependencies.
  - Blind spot: None significant.
- **Fix B**: Keep Vitest 5 and add a Phase 3 contingency.
  - Strength: Stays on the latest major.
  - Tradeoff: The plan branches mid-phase.
  - Confidence: MED — the outcome is unknown until Phase 3 runs.
  - Blind spot: Whether runner 10.0.x will get a Vitest 5 patch.
- **Decision**: FIXED (Fix B). Phase 3 §1 falls back to the command runner (`npm test`) first, and pins Vitest 4.1.11 only as a last resort. Key Discoveries notes the version the runner was built against.

### F2 — The mutation score will mix in untested helpers; 3.3 contradicts the scope

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 3, Progress 3.3/3.4
- **Detail**: Mutating the whole file includes the error/URL helpers and `formatDuration`, which are out of test scope. They become NoCoverage mutants that dilute the recorded score, and 3.3 demanded triage of "duration" survivors.
- **Fix**: Record the covered-code score next to the total, and exempt the out-of-scope helpers in 3.3.
- **Decision**: FIXED

### F3 — No guard against a leftover Stryker sandbox

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 3 §1
- **Detail**: tsconfig.json includes `**/*` and excludes only `dist`. `astro check` would type-check a `.stryker-tmp` sandbox left by a killed run.
- **Fix**: Add `.stryker-tmp` and `reports` to the tsconfig.json `exclude` list.
- **Decision**: FIXED

### F4 — The §3 Status value is described but not named

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 4 §1
- **Detail**: The orchestrator's parser literal for a shipped phase is `complete`.
- **Fix**: Write "§3 row 1 Status → `complete`".
- **Decision**: FIXED
