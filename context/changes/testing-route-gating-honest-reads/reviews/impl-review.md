<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Test Rollout Phase 3: Route Gating and Honest Reads

- **Plan**: context/changes/testing-route-gating-honest-reads/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2, 3, 4
- **Date**: 2026-10-03
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 2 warnings, 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

Success criteria evidence (re-run during review): `npm test` 143/143 · `npm run lint` clean · `npx astro check` 0/0/0 · `npm run build` ok · `npm run check:ui` clean · `npx prettier --check context/foundation/test-plan.md CLAUDE.md` clean · inventory guard red with scratch `src/pages/api/team/probe.ts` (2 failures) and green after removal · Stryker `route-access.ts` 100% (45 killed), `team-availability.ts` 98.21% (1 survivor at :32, accepted in §6.6). Manual items 1.6–4.5 are all checked; 2.7 and 3.4 are temporary-revert checks with no diff trace by design, and smoke was not re-run in this review.

Middleware behaviour is the same as on master: the lists, segment matching, branch order, `rewrite("/403")` and fail-closed role resolution all match. No raw DB error reaches the page (`loadError` only holds allow-listed constants). The §3 Status edit in test-plan.md ("change opened") is the orchestrator's update from when the change was opened, not implementer drift.

## Findings

### F1 — Concurrent delete can make a truncated read "ready"

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/lib/team-availability.ts:16-42
- **Detail**: `loadAllPages` stops when `rows.length >= count` using the *latest* count. With offset paging, if a row before the current offset is deleted between two page requests, the next page shifts by one (a row is skipped) and its count is one lower. The loop then ends "ready" with one row missing. Example: 1500 rows, page 1 = 0–999, row 5 deleted, page 2 returns 499 rows with count 1499 → 1499 ≥ 1499 → ready, and the original row 1000 is lost. That is the risk-#6 symptom (an account can be flagged "No availability submitted"). An insert before the offset duplicates a row and inflates totals. §6.6 accepts "offset paging under concurrent writes is best effort", but the doc comment (":20-21 … pages neither overlap nor skip rows") claims more than the code guarantees, and the case that fails is the silent one. It only matters for lists over 1000 rows (one page).
- **Fix A ⭐ Recommended**: Remember the first page's count and return an error if any later page reports a different count; add one fake-page test (count changes between pages → error).
  - Strength: A few lines. Turns the silent skip/duplicate into the honest load-error path the view already handles, which matches the module's own contract ("read in full or reported as an error").
  - Tradeoff: A busy month with active writers may sometimes show the load error and need a reload; a delete and an insert in the same window (count unchanged) still slips through.
  - Confidence: HIGH — the failing sequence follows from lines 26–37; the fix is local to the loop.
  - Blind spot: How often >1000-row months see concurrent writes in practice (probably rarely).
- **Fix B**: Keep the accepted gap and only correct the doc comment to say ordering prevents overlap/skip only without concurrent writes (link §6.6).
  - Strength: No behaviour change; documentation becomes accurate.
  - Tradeoff: The silent false "No availability submitted" stays possible.
  - Confidence: HIGH — documentation-only.
  - Blind spot: None significant.
- **Decision**: FIXED (Fix A) — count change between pages is a read error; new test; §6.6 gap reworded

### F2 — Inventory guard ignores routable .js/.mjs/.md/.html pages

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/route-inventory.test.ts:52-59, lint-staged.config.mjs:11
- **Detail**: The walker keeps only `\.(astro|ts)$`, and `routeOf` strips only those extensions. Astro also routes `.js`/`.mjs` endpoints and `.md`/`.html` pages under `src/pages`. `routeAccess` defaults to `allow`, so a manager endpoint written as `src/pages/api/team/x.js` would be public and the guard would not notice, despite "every file under src/pages". It also does not skip `_`-prefixed files, which Astro ignores, so one would cause a false failure. No such files exist today.
- **Fix**: Widen the filter and `routeOf` to `astro|ts|js|mjs|md|mdx|html`, skip paths with a `_`-prefixed segment, and widen the lint-staged glob to the same extensions.
- **Decision**: FIXED — walker covers astro|ts|js|mjs|md|mdx|html and skips `_` segments; lint-staged glob aligned; proven with a .js probe (red) and a _probe.astro (ignored)

### F3 — Stale "MANAGER_ROUTES in src/middleware.ts" references

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/pages/manager/availability.astro:34, CLAUDE.md:41, README.md:171
- **Detail**: The lists now live in `src/lib/route-access.ts`, but three places still point readers to `src/middleware.ts` for `MANAGER_ROUTES`/`PROTECTED_ROUTES`. The CLAUDE.md middleware bullet was updated; the Routes bullet was not.
- **Fix**: Change the three references to `src/lib/route-access.ts`.
- **Decision**: FIXED — availability.astro:34, CLAUDE.md Routes bullet and README.md:171 now point to src/lib/route-access.ts

### F4 — Dynamic-route assertion lacks the planned guidance message

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/lib/route-inventory.test.ts:69
- **Detail**: The plan asks the guard to "fail with a message asking for a sample path in the table". The guidance is only a source comment, so a failure shows a bare array diff.
- **Fix**: Pass the guidance as the assertion message: `expect(dynamic, "add a concrete sample path to EXPECTED_ACCESS and extend routeOf").toEqual([])`.
- **Decision**: FIXED — guidance is now the expect() message; verified with a scratch [id].astro

### F5 — loadAllPages can throw despite its result type

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/team-availability.ts:27
- **Detail**: If `fetchPage` rejects, the exception escapes, rejects the `Promise.all` in `manager/availability.astro`, and the request returns a 500 instead of the load-error alert. postgrest-js normally returns `{ error }` (no `throwOnError`) and master behaved the same, so the risk is low.
- **Fix**: Wrap the `await fetchPage(...)` in try/catch and return `{ data: null, error }`.
- **Decision**: FIXED — rejected fetchPage returns { data: null, error }; new test; Stryker re-run 98.48% (same accepted survivor), §6.6 updated
