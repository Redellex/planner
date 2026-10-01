<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Test Runner and Station-Time Logic

- **Plan**: context/changes/testing-station-time/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2, 3, 4
- **Date**: 2026-10-01
- **Verdict**: APPROVED
- **Findings**: 0 critical, 0 warnings, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | WARNING |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Evidence

- `npm test`: 3 files, 74 tests passed (Vitest 5.0.3).
- `npm run lint`, `npx astro check` (0 errors, 0 warnings, 0 hints), `npm run build` and `npx prettier --check context/foundation/test-plan.md CLAUDE.md`: all pass.
- PR #23 on `testing-station-time` (head 443c929): the `ci`, `smoke` and Workers Builds checks are all SUCCESS, which backs manual item 4.3.
- Manual item 1.5 reproduced: with a config that does not set `TZ`, both UTC guard tests fail on this Warsaw machine.
- The calendar literals were spot-checked by hand: weekdays for 2026-10-01, 2026-11-01, 2026-10-31, 2026-10-18, 2026-03-29, 2027-02-01 and 2028-02-29 are correct.
- No production code changed (`src/lib/availability.ts` is untouched), as the plan's "NOT doing" list requires.
- Phase 3 went through the plan's first fallback (`testRunner: "command"`), and that is recorded in test-plan §6.6.

## Findings

### F1 — Unused `@stryker-mutator/vitest-runner` devDependency

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: package.json:44, stryker.config.json:3
- **Detail**: The plan installed both Stryker packages for `testRunner: "vitest"`. The vitest runner did not work with Vitest 5, so the documented fallback, `testRunner: "command"`, was used instead, and nothing uses the vitest-runner package now (test-plan §6.6 says so). It is still installed on every `npm ci`, and it suggests the vitest runner is in use when it is not. `stryker.config.json` also adds `ignorePatterns` (`.claude`, `.agents`, `.codestudio`, `dist`, `.wrangler`), which the plan did not mention. That addition is harmless: it keeps the sandbox copy small.
- **Fix**: `npm uninstall @stryker-mutator/vitest-runner` and drop the "installed but not used" clause from test-plan §6.6. If a later rollout phase moves back to the vitest runner, it can reinstall the package then.
- **Decision**: FIXED — uninstalled `@stryker-mutator/vitest-runner` (package.json, package-lock.json); test-plan §6.6 now says it was uninstalled as unused. `npx stryker run --dryRunOnly` still succeeds.

### F2 — Comment gives the wrong reason for setting TZ in the config

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: vitest.config.ts:1, context/foundation/test-plan.md §6.1 step 2
- **Detail**: The comment says `test.env` does not reach "thread workers in time", and §6.1 says "none of those reach the worker threads". Tested on this Warsaw machine with Vitest 5.0.3: `test.env: { TZ: "UTC" }` **does** make the guard pass under the default pool (forks). It fails only with `--pool=threads`. The chosen approach, `process.env.TZ` before `defineConfig`, is still right because it works under both pools. The stated reason is half wrong, though, and someone who checks it under the default pool could decide the comment is stale and move TZ into `test.env`. The UTC guard would keep passing until someone switches to threads.
- **Fix**: Reword both places: "Set before workers start so every pool inherits it; `test.env` only works under `forks` and fails under `--pool=threads`."
- **Decision**: FIXED — reworded the comment at vitest.config.ts:1 and the reason in test-plan §6.1 step 2 (`test.env` works under forks, fails under threads; the config line works under every pool).
