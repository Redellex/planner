# Requirements — AI code review in CI (M5L3)

Source: `.claude/prompts/m5l3-requirements.md`, with the six criteria rewritten for Planner (user decision, 2026-11-01). The agent itself already exists: `reviewer/` (Claude Agent SDK `query()`, M5L2, PR #67).

## Overall concept

- ~~GHA workflow run for every new pull request to `master`~~ — changed 2026-11-01 (user decision): the review runs **manually** (`workflow_dispatch` with the PR number, from `master`). Every PR to `master` gets a pending `ai-cr/verdict` status whose Details link opens the review workflow's Run workflow page. Details: `research.md` → "Decision 2026-11-01: manual run".
- composite action for the review itself (local, `.github/actions/ai-reviewer/`) so that the main workflow is easy to reason about
- the reviewer stays on the Claude Agent SDK and `ANTHROPIC_API_KEY` (repository secret), not OpenRouter

## Input parameters

- pull request title
- pull request description (?? cost tradeoff)
- git diff against the base branch

## Code Review Criteria

Each criterion is scored on a 1–10 scale, where 1 is the worst outcome and 10 is the best. The six schema keys stay (`implementationCorrectness`, `idiomaticity`, `complexity`, `testRiskCoverage`, `documentation`, `securitySafety`); their descriptions become Planner-specific. The rules come from `CLAUDE.md`.

1. **implementation correctness** — does the code do what it claims, including edge cases, error paths and Planner's time model?
   - _1_: broken logic, missed edge cases (month boundary, the 00:00–06:00 station night, DST days), wall-clock timestamps passed through `new Date(...)`, or a silent regression.
   - _10_: correct on the happy path, edge cases and failure modes; timestamps handled as wall-clock strings; no regressions.

2. **idiomaticity** — does it follow the stack and the repo's conventions?
   - _1_: fights them: React where a static Astro component would do, hydration without need, palette classes or colour literals instead of design tokens, string-concatenated classes instead of `cn()`, a JSON API where the repo uses form-post + redirect, a hand-edited `database.types.ts`, a migration without RLS.
   - _10_: indistinguishable from the surrounding code: Astro first, React islands only for interactivity, shadcn/ui components and tokens, form-post + redirect, migrations named `YYYYMMDDHHmmss_…` with types regenerated.

3. **complexity** — is it as simple as the problem allows?
   - _1_: speculative abstraction, tangled control flow, or work that does not fit the Workers Free CPU budget.
   - _10_: the simplest design that solves the problem completely, pure helpers where the logic is pure.

4. **test / risk coverage** — are the risky behaviours tested where the repo tests them?
   - _1_: risky logic ships untested: no Vitest test next to a changed `src/lib` module, a database rule without pgTAP, a new page without its row in the route inventory, a user flow without a smoke step.
   - _10_: risk-weighted coverage: unit tests for pure logic, pgTAP for RLS and constraints, smoke for flows, the route inventory and navigation tests updated.

5. **documentation** — is the "why" written down where the next reader needs it?
   - _1_: behaviour changes with no update to `CLAUDE.md` or `context/`, opaque code, comments that restate the code.
   - _10_: `CLAUDE.md` and the change's context documents follow the behaviour; comments explain the non-obvious "why" only.

6. **security and safety** — does it keep the access model and untrusted input safe?
   - _1_: a table without RLS or with a too-broad policy, an own-row update policy on `profiles` (self-promotion), a manager page or endpoint outside `MANAGER_ROUTES`, raw database or Supabase auth errors rendered to the user, a secret committed, untrusted input trusted.
   - _10_: per-operation RLS with column grants, routes gated in `src/lib/route-access.ts`, errors logged and replaced by allow-listed messages, secrets only in env/secrets, input validated.

## Verdict

- binding `verdict`: `pass` | `fail`, next to the six scores and a Markdown `summary` (contract: `reviewer/src/review-schema.ts`)
- rule for the agent: `fail` when any criterion is ≤ 4, or when the diff contains a blocking bug or a security flaw regardless of the scores; otherwise `pass`
- the merge gate reads only `verdict`

## Parked for later

- business alignment (requires broader context)
- architectural fit (requires broader context)
- reading the change's `plan.md` as review input (M5L3 task 4, optional)

## Expected side-effects

- PR comment with summary
- labels: `ai-cr:failed` (red) OR `ai-cr:passed` (green)

## Expected behavior

- ~~on-demand retry when label `ai-cr:review` is added~~ — replaced 2026-11-01: rerun = run the workflow again for the PR
- the `ai-cr/verdict` commit status on the PR head is `failure` on a `fail` verdict and `success` on `pass` (merge gate once the context is required in ruleset "Protect master")
- prompt and criteria in English (2026-11-01); model `claude-sonnet-5-5`, CI budget cap `REVIEW_MAX_BUDGET_USD=0.1` (2026-11-01)
- cost per run logged (Hard rule: track cost per run, budget cap stays)

## Out of scope here

- promptfoo evals — a separate change (`code-review-evals`): Haiku 5.5 / Sonnet 5.5 / Opus 5.5 through the Anthropic key, a custom provider running the real agent
