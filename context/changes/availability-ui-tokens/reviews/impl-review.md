<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: /availability on Design Tokens

- **Plan**: context/changes/availability-ui-tokens/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2, 3, 4
- **Date**: 2026-09-28
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 2 warnings, 3 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | WARNING |
| Scope Discipline    | PASS    |
| Safety & Quality    | PASS    |
| Architecture        | WARNING |
| Pattern Consistency | PASS    |
| Success Criteria    | WARNING |

## Evidence

- Commits reviewed: a350310 (p1), 6cd5dbd (p2), 5076dd9 (p3), 6006713 (p4), 8e3e585 (epilogue). Every planned file is in the diff. Unplanned but benign additions: `logAvailabilityError` in `src/lib/availability.ts` (the single place the planned `console.error` calls go through), `src/components/availability/types.ts` (the shared `WindowRow` type), the `pending` prop on `DayPanel` (how the planned pending state reaches the kitchen sink), and a `submit` → `preventDefault` guard in the kitchen sink.
- Automated checks re-run on 2026-09-28:
  - `npm run lint`: pass.
  - `npx astro check`: 0 errors, 0 warnings.
  - `npm run build`: pass.
  - `package.json` and `package-lock.json` are unchanged since `a350310^`.
  - `button.tsx` is unchanged.
  - The 2.5 grep (raw `.message`), the 3.5 grep (literal colours) and the 3.6 grep (`client:`) all return nothing.
  - `/dev/availability-states` returns 404 under `astro preview` (port 4329).
- `npm run smoke` was **not** re-verifiable: see F2.
- Message contract:
  - Every endpoint literal became a constant and the redirect texts are byte-identical.
  - `update.ts` no longer forwards `readError.message`.
  - The page renders only allow-listed `?error=` values.
  - A URL error can no longer hide a load failure.
- Smoke markup contract: the hidden inputs are still native `<input type="hidden" name="id" value=…>`.

## Findings

### F1 — Days with windows have no visible hover state

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/components/availability/AvailabilityCalendar.astro:63-66
- **Detail**: Phase 4 asked for non-selected cells to hover to the accent token. In the dark set, `--accent` and `--secondary` are both `oklch(0.269 0 0)` (`global.css:52,56`). A day with windows is already `bg-secondary`, so `hover:bg-accent` changes nothing on exactly the cells users go back to. `screenshots/README.md` records this but leaves it unresolved.
- **Fix**: For non-selected cells with windows, use `hover:bg-secondary/80`, as the `Button` secondary variant does (`button.tsx:17`). Keep `hover:bg-accent` for empty cells.
- **Decision**: FIXED — non-selected days with windows hover to `bg-secondary/80`, empty days keep `hover:bg-accent`

### F2 — Smoke not re-verified for the pushed state; before-screenshots off-spec

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: plan.md Progress 2.4, 3.4, 4.4, 1.6
- **Detail**:
  - Smoke:
    - `.env` and `.dev.vars` currently point at the hosted project (`https://rrnprjlnteodfcsyllwa.supabase.co`). This review's smoke run therefore failed at "signup creates account": hosted auth rejects `@example.com`. That is an environment problem, not a regression.
    - The 5 commits are not pushed (`ahead 5`), so the CI `smoke` job, which runs on the local stack, has not run on them either.
    - The `[x]` marks on 2.4, 3.4 and 4.4 rest only on the implementer's own runs.
  - Separately, 1.6 asks for 1280px/390px baselines, but `before/` is hand-captured at other sizes. The README says so, so this is a documented gap, not rubber-stamping.
- **Fix**: Push the branch and let CI `smoke` run on the local stack, or temporarily point `.dev.vars` at `http://127.0.0.1:54321` and re-run `npm run smoke`.
- **Decision**: FIXED — PR #15 opened (CI runs only on PRs into `master`); CI run 36468920299 on 8e3e585: `ci` success, `smoke` success (local Supabase stack)

### F3 — DayPanel hard-codes element ids, so it can only render once per page

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architecture
- **Location**: src/components/availability/DayPanel.astro:40,83,95,137,143
- **Detail**:
  - The ids `selected-day-heading`, `add-start`, `add-end` and `start-/end-<row.id>` are fixed.
  - The kitchen sink renders 7 `DayPanel`s. Its page therefore has duplicate ids:
    - `aria-labelledby` on every panel resolves to the first heading;
    - clicking the Start/End labels in panels 2 to 7 focuses panel 1's inputs;
    - `start-…f003` and similar ids appear three times.
  - The live `/availability` page renders a single panel, so it is unaffected.
- **Fix**: Derive the ids from a prefix: a new `idPrefix` prop that defaults to `""`, or `selectedDay` combined with a panel key in the kitchen sink.
- **Decision**: FIXED — optional `idPrefix` prop on `DayPanel` (default `""`, so `/availability` markup is unchanged); the kitchen sink passes `panel-<n>-`; no duplicate ids remain

### F4 — Kitchen sink's production 404 still ships a document and script

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/pages/dev/availability-states.astro:22-26,197-202
- **Detail**:
  - The plan contract was `new Response(null, { status: 404 })`.
  - The implementation sets `Astro.response.status = 404` and renders an empty template. Its comment says this avoids an ESLint `no-misused-promises` crash.
  - Astro still emits the hoisted script. The production body is 158 bytes: `<!DOCTYPE html><script type="module">…preventDefault…</script>`.
  - No fixture data leaks and the status is correct. The deviation is documented in code but not in the plan.
- **Fix**: Accept it, and add one line to the plan or README noting the realisation.
- **Decision**: FIXED — accepted as is; the realisation and its 158-byte body are documented in `screenshots/README.md` (kitchen sink section)

### F5 — Screenshots README promises a violet re-tint follow-up that was later dropped

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: context/changes/availability-ui-tokens/screenshots/README.md:43
- **Detail**: The README says "A violet/navy re-tint of the `.dark` token values is planned as a follow-up change." The later decision was to keep the neutral dark look and drop the re-tint unless it is asked for again. The archived change will carry a stale commitment.
- **Fix**: Reword the line: the neutral palette is accepted, and a re-tint happens only on request.
- **Decision**: FIXED — README now records the neutral look as accepted (re-tint only on request) and notes the F1 hover fix

## Out of scope (not counted in the verdict)

- **Hosted project accepts the seed manager credentials.** With `.dev.vars` pointing at the hosted project, the smoke steps "signin accepts seeded manager", "manager page renders for manager" and "manager locks/unlocks the smoke month" all passed. So `manager@example.com` / `Manager-Passw0rd!` (public in `supabase/seed.sql` and `CLAUDE.md`) is a working **manager** account on the hosted project, although `CLAUDE.md` says the seed must never reach production. Side effects of this review's run on the hosted DB: a lock on 2027-09 was inserted and then deleted, and a last-manager demotion was attempted and rejected. No lasting change.
