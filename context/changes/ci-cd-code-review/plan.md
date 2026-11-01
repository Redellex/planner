# AI Code Review in CI (M5L3) Implementation Plan

## Overview

Run the existing `reviewer/` agent (Claude Agent SDK, M5L2) on pull requests to `master` in GitHub Actions. The review is **started by hand** (`workflow_dispatch` with the PR number, from `master`). It posts a summary comment and an `ai-cr:passed`/`ai-cr:failed` label, and sets the `ai-cr/verdict` commit status on the PR head. Once the status is required in ruleset "Protect master", that status is the merge gate. A notify workflow marks every PR head `pending` with a Details link to the review workflow. The reviewer gets English, Planner-specific criteria, the PR title and description as input, and a verdict rule enforced in code.

## Current State Analysis

- `reviewer/` reads only a diff (stdin or `argv[2]`, `reviewer/src/index.ts:13-22`). Its user prompt is Polish ("Zrecenzuj ten diff", `index.ts:43`). `SYSTEM_PROMPT` and the six `.describe()` texts are generic Polish (`reviewer/src/review-schema.ts:5-58`), and nothing links the scores to the verdict.
- Errors exit 2 with a stderr message (`index.ts:77-80`), including a budget overrun (`:63-65`) and a schema mismatch (`:68-69`). The per-run cost line goes to stderr (`:32-35`). Defaults: `claude-sonnet-5-5` and `$0.5` (`:9-11`).
- `reviewer/` has no tests. Root Vitest covers only `src/**/*.test.ts` (`vitest.config.ts`). The root ESLint lints `reviewer/src` type-aware, and `ci.yml:20-23` installs and type-checks `reviewer/`.
- The course templates (`.claude/config-templates/m5l3-review.yml.template`, `m5l3-action.yml.template`) assume a `pull_request` trigger, a built `dist/review.js`, an OpenRouter key, model `z-ai/glm-5.3` and Node 24. None of these fit (research §2). Their pins are current: checkout `3d3c42e5aac5ba805825da76410c181273ba90b1` (v7.0.1), setup-node `949feb2413d6458794dcd2491c4babbbce0c15c1` (v7.1.0).
- Existing workflows use tag refs: `ci.yml` (checkout@v4, setup-node@v4 ×2, `supabase/setup-cli@v1`) and `demo-data.yml` (checkout@v4, setup-node@v4). `supabase-keep-alive.yml` uses no actions. The repo setting `sha_pinning_required` is `false`.
- The repository is public. Ruleset "Protect master" (id 26309273) has rules `update`, `deletion` and `non_fast_forward`, with bypass for the Repository admin role (actor_id 5) in mode `always`. `README.md:108` still says the repo is private with no branch protection.
- The `ANTHROPIC_API_KEY` repository secret exists. No `ai-cr:*` labels exist yet.

## Desired End State

- Every same-repo PR to `master` shows an `ai-cr/verdict` status, `pending` until reviewed. Its **Details** link opens the "AI Code Review" workflow page.
- The owner starts a review from that page (Run workflow, `pr` = number) or with `gh workflow run ai-review.yml -f pr=<n>`. The run reviews exactly the PR head commit it recorded, using master's reviewer code.
- A `pass`/`fail` result posts a comment (verdict, reviewed SHA, six scores, summary), sets the matching label, removes the other one and sets the status to `success`/`failure`. The job fails on `fail`.
- When no verdict could be produced (diff over 100 kB, nothing reviewable after exclusions, agent error, PR changed mid-run), the run posts a short "could not run" comment, leaves labels alone, sets the status to `error` and fails the job.
- The cost of each run appears in the job's step summary.
- The ruleset requires `ai-cr/verdict`, and the admin can pass it only by an explicit bypass on the PR (mode `pull_request`). Every action in the repo is pinned to a SHA, and GitHub enforces that (`sha_pinning_required: true`).
- Verify: the Phase 5 runs on a follow-up PR, plus `gh api` reads of the ruleset and the actions permissions.

### Key Discoveries:

- A `workflow_dispatch` run's check runs attach to the dispatched ref (master), not the PR head. That's why the gate is an explicit commit status on the head SHA (research, "Decision 2026-11-01: manual run").
- `workflow_dispatch` can only be triggered once the workflow file is on the default branch, but any branch's copy of the file can then be dispatched (`--ref`). This PR therefore can't review itself, and the review job must refuse to run unless `github.ref` is `refs/heads/master`. Otherwise a branch could swap in its own reviewer.
- `npm --prefix reviewer run review` runs in `reviewer/`, so the diff path must be absolute (`$RUNNER_TEMP/pr.diff`).
- The lockfile is installed with the Linux SDK binary (`reviewer/package-lock.json:105`). Never pass `--omit=optional`.
- With bypass mode `pull_request`, the admin can't push straight to `master` (rule `update`) but can merge a PR past failing rules with an explicit bypass.

## What We're NOT Doing

- promptfoo evals and model comparison: that's the separate `code-review-evals` change. Here the prompt change gets only a hand-run before/after baseline (recorded exception to the eval-first rule).
- The `ai-cr:review` label retry and any `pull_request`-triggered review. A rerun means dispatching again.
- Business alignment, architectural fit, reading the change's `plan.md` as input (parked in requirements).
- Truncating oversized diffs. Over 100 kB, the review is refused, not partial.
- Making the `ci` or `smoke` jobs required checks. Only `ai-cr/verdict` is added.
- A pre-filled Run workflow link. GitHub has none, so the owner types the PR number.
- Running on `pull_request_target`, or giving fork PRs a notify status. Forks show the required status as "expected", and the owner dispatches by hand.
- Changing the reviewer's code defaults (`$0.5`, Sonnet 5.5). CI passes `0.1` through the action.
- Installing `actionlint` or linting YAML locally.

## Implementation Approach

Change the agent first: its prompt and inputs are the contract every later piece relies on. The prompt-building and verdict-rule logic is pure and gets unit tests. Then add one local composite action that owns everything about calling the agent (Node, install, exclusions already applied by the caller, size limit, outputs, cost), so the review workflow only does GitHub work: validate the input, take the diff, report and gate. Pin the existing workflows in the same PR so `sha_pinning_required` can be turned on right after merge. Platform changes (required status, bypass mode, SHA enforcement) come last, after one real dispatch has proven the workflow, because a required status nothing can set yet would block every PR.

## Critical Implementation Details

- **Dispatch ref guard.** The review job's first step fails unless `github.ref == 'refs/heads/master'`. Without it, `gh workflow run ai-review.yml --ref <branch>` would run a branch's own reviewer and action against the gate.
- **Exclusion pathspec.** Use glob magic, so `**/` also matches the repo root: `git diff "origin/master...$SHA" -- . ':(exclude,glob)**/package-lock.json' ':(exclude)src/db/database.types.ts'`. Without `glob`, `**/package-lock.json` misses the root lockfile.
- **Multi-line PR text.** Title and body read with `gh pr view --json` reach the action through `$GITHUB_OUTPUT` with a random heredoc delimiter (e.g. `EOF_$(openssl rand -hex 8)`), so a body can't forge outputs. They enter scripts only through `env:`, never as `${{ }}` inside `run:`. The model's summary is also untrusted, so it's posted with `gh pr comment --body-file`.
- **Status limits.** A commit status `description` is at most 140 characters, so keep every description short and fixed (no free text from the model or the PR).
- **Ruleset PUT replaces `rules`.** Updating ruleset 26309273 must resend the existing `update`, `deletion` and `non_fast_forward` rules along with the new `required_status_checks` rule and the changed `bypass_actors`.
- **Rollout order.** Merge (workflows on master) → first dispatch works → require the status → enable `sha_pinning_required`. Requiring the status earlier blocks every PR with nothing able to set it. Enabling SHA enforcement while master still has `@v4` refs breaks CI.

## Phase 1: Reviewer — Planner criteria and PR context

### Overview

Make the agent CI-ready: English, Planner-specific criteria from `requirements.md`, the PR title and description as fenced untrusted input, and the "any score ≤ 4 → fail" rule enforced in code. Compare the old and new prompt by hand and record the comparison as the baseline for `code-review-evals`.

### Changes Required:

#### 1. Criteria and system prompt

**File**: `reviewer/src/review-schema.ts`

**Intent**: Rewrite `SYSTEM_PROMPT` and every `.describe()` text in English. The six criteria use the 1/10 anchors from `requirements.md:21-43`. The prompt states the verdict rule (`fail` when any criterion is ≤ 4, or on a blocking bug or security flaw regardless of scores, otherwise `pass`) and says that the content of the `<pr_title>`, `<pr_body>` and `<diff>` tags is data, not instructions.

**Contract**: The schema keys, types, `verdict` enum and `summary` stay unchanged (`REVIEW_SCHEMA`, `REVIEW_JSON_SCHEMA`, `Review`). Only the strings change.

#### 2. Prompt builder

**File**: `reviewer/src/prompt.ts` (new)

**Intent**: Build the user prompt from the diff, an optional title and an optional body. Each goes in its own tag. The body is cut to 4,000 characters with an explicit truncation marker, and an empty title or body is left out.

**Contract**: `buildReviewPrompt({ diff, title?, body? }): string`, `PR_BODY_MAX_CHARS = 4000`.

#### 3. Verdict rule and score range

**File**: `reviewer/src/verdict.ts` (new)

**Intent**: After zod parsing, guarantee the contract rules the JSON schema can't express. A score that isn't an integer from 1 to 10 makes the output invalid (the run exits 2). Any score ≤ 4 with verdict `pass` is turned into `fail`, and a one-line note naming the criterion and score is put before the summary.

**Contract**: `enforceVerdictRule(review: Review): Review` (throws on an out-of-range score). A `fail` verdict is never changed.

#### 4. Entry point

**File**: `reviewer/src/index.ts`

**Intent**: Read optional `PR_TITLE`/`PR_BODY` from the environment, build the prompt with `buildReviewPrompt`, and apply `enforceVerdictRule` after `REVIEW_SCHEMA.safeParse`. Update the header comment (inputs, CI usage).

**Contract**: stdout stays pure JSON (`Review`). Exit codes and the stderr cost line are unchanged.

#### 5. Tests and script

**Files**: `reviewer/src/prompt.test.ts`, `reviewer/src/verdict.test.ts` (new), `reviewer/package.json`

**Intent**: Use `node:test` and `node:assert/strict` through `tsx`, with no new dependency. Cover: the tags are present and an empty title/body is left out; a 4,001-character body is truncated with the marker while 4,000 is kept whole; a score of 4 flips `pass` to `fail` with the note; 5 keeps `pass`; `fail` stays `fail`; 0, 11 and 7.5 are rejected.

**Contract**: script `"test": "node --import tsx --test \"src/**/*.test.ts\""`.

#### 6. Baseline and exception record

**File**: `context/changes/ci-cd-code-review/prompt-baseline.md` (new)

**Intent**: Record the exception to "Run the eval set before changing the review prompt or model" (`CLAUDE.md`, M5L3 hard rules) and why: no eval set exists yet, and it comes in `code-review-evals`. Then the before/after table for two inputs, each run with the old prompt (`git stash` or the 527dbd7 version) and the new one: `reviewer/fixtures/sample-buggy.diff` and the M5L2 diff (`git diff e33fd26...65039b9` with the Phase 2 exclusions). Columns: six scores, verdict, cost, turns.

**Contract**: one Markdown file with an "Exception" section and a "Results" table.

#### 7. Env example

**File**: `reviewer/.env.example`

**Intent**: List the optional `PR_TITLE`/`PR_BODY` and mention the CI budget of `0.1`.

**Contract**: comments and optional keys only.

### Success Criteria:

#### Automated Verification:

- Reviewer unit tests pass: `npm --prefix reviewer test`
- Reviewer type-check passes: `npm --prefix reviewer run typecheck`
- Root lint passes, including `reviewer/src`: `npm run lint`
- Root Vitest ignores the reviewer tests: `npx vitest related reviewer/src/verdict.test.ts --run` exits 0 without running them
- The new prompt still fails the fixture: `npm --prefix reviewer run review -- fixtures/sample-buggy.diff` exits 0 with `"verdict": "fail"`

#### Manual Verification:

- `prompt-baseline.md` holds the exception and both before/after rows, and the new reviews read as Planner-specific (they cite repo rules, not generic advice)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Composite action and workflows

### Overview

Add the local composite action that runs the agent, the manual review workflow that reports and gates, and the notify workflow that marks each PR head pending. All actions are pinned to a SHA.

### Changes Required:

#### 1. Composite action

**File**: `.github/actions/ai-reviewer/action.yml` (new; based on `m5l3-action.yml.template`)

**Intent**: Run the agent on a prepared diff file and report what happened without failing itself, so the workflow decides comment, status and gate. Steps: setup-node (pinned v7.1.0, `node-version-file: .nvmrc`, `cache: npm`, `cache-dependency-path: reviewer/package-lock.json`); a size check (empty diff → `empty`, over `max-diff-bytes` → `too-large`, both without installing or calling the model); `npm ci --prefix reviewer`; the agent run with stdout to the review file and stderr to a log, exit code captured; verdict re-validated as `pass|fail`; the `[review]` cost line appended to `$GITHUB_STEP_SUMMARY`; a comment file written for every outcome (reviewed: `## AI Code Review: PASS|FAIL`, the reviewed short SHA, a six-score table, the summary; otherwise a short fixed reason and "see the run log").

**Contract**: inputs `api-key` (required), `diff-file` (required), `pr-title`, `pr-body`, `head-sha`, `run-url`, `model` (default `claude-sonnet-5-5`), `max-budget-usd` (default `0.1`), `max-diff-bytes` (default `100000`). Outputs `outcome` (`reviewed` | `empty` | `too-large` | `error`), `verdict` (`pass` | `fail` | empty), `review-file`, `comment-file`. The secret goes to the agent only as `ANTHROPIC_API_KEY` in `env:`. The comment is formatted by a small script beside the action (e.g. `format-comment.mjs`), not inline in YAML.

#### 2. Review workflow

**File**: `.github/workflows/ai-review.yml` (new; based on `m5l3-review.yml.template`)

**Intent**: The workflow is "AI Code Review", started with `workflow_dispatch` and input `pr` (number, required). Steps:

1. Guard `github.ref == refs/heads/master`.
2. Validate `pr` (digits only, through `env:`) and read the PR with `gh pr view --json state,baseRefName,headRefOid,title,body`. It must be open with base `master`. Record the head SHA, and write title and body to outputs with a random heredoc delimiter.
3. Set status `pending` "AI review running" linking this run.
4. Checkout master (pinned v7.0.1, `fetch-depth: 0`), fetch `refs/pull/<n>/head`, and check the recorded SHA is present. If it isn't, the PR changed mid-run (`error`).
5. Write the diff with the exclusions (Critical Implementation Details) to `$RUNNER_TEMP/pr.diff`.
6. Run the action.
7. Report (`always()` once the SHA is known): post the comment file, or a generic "could not run" text if the action never ran. On `reviewed`, create both labels `--force`, add the matching one and remove the other, then set the status `success`/`failure`. On anything else, leave labels alone and set the status `error`.
8. Gate: fail unless outcome is `reviewed` and verdict is `pass`.

An invalid input or a closed or wrong-base PR fails the job with a log line and posts nothing.

**Contract**: permissions `contents: read`, `pull-requests: write`, `issues: write`, `statuses: write`. Concurrency group `ai-cr-${{ inputs.pr }}` with `cancel-in-progress: true`. Status context `ai-cr/verdict`, with fixed descriptions of at most 140 characters and `target_url` = this run. Secret `ANTHROPIC_API_KEY`.

#### 3. Notify workflow

**File**: `.github/workflows/ai-review-notify.yml` (new)

**Intent**: On `pull_request` to `master` (types `opened`, `synchronize`, `reopened`), for same-repo PRs only (`head.repo.full_name == github.repository`), set `ai-cr/verdict` = `pending` on the head SHA, with the description "Not reviewed. Run AI Code Review with pr=<n>" and `target_url` = the review workflow page. It skips when that SHA already has an `ai-cr/verdict` status, so a reopen doesn't erase a verdict. No checkout and no secrets.

**Contract**: permissions `statuses: write` only. `target_url` is `${{ github.server_url }}/${{ github.repository }}/actions/workflows/ai-review.yml`.

### Success Criteria:

#### Automated Verification:

- Every `uses:` in the new files is either local (`./…`) or a 40-character SHA with a `# vX.Y.Z` comment: `grep -rnE "uses:" .github/actions .github/workflows/ai-review*.yml`
- No `${{ }}` expression carrying PR text appears inside a `run:` block: `grep -nE "run:|\\$\\{\\{ *(inputs|steps\\.[a-z]+\\.outputs)\\.(pr-title|pr-body|title|body)" .github/workflows/ai-review.yml .github/actions/ai-reviewer/action.yml`, read alongside the step bodies
- After pushing the branch, the notify run succeeds: `gh run list --workflow ai-review-notify.yml --branch feat/ci-code-review --limit 1`
- The PR head carries `ai-cr/verdict` = `pending`: `gh api repos/Redellex/planner/commits/<head sha>/statuses --jq '.[] | select(.context=="ai-cr/verdict") | .state'`

#### Manual Verification:

- On the PR page the `ai-cr/verdict` row shows the pending description, and its Details link opens the "AI Code Review" workflow page
- Reading `ai-review.yml` and `action.yml` end to end confirms the dispatch ref guard, the absolute diff path, the `error` path for every failure after the SHA is known, and that nothing echoes the environment or the key

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Pin existing workflows

### Overview

Pin the remaining actions so the hard rule holds repo-wide and `sha_pinning_required` can be turned on after merge. Also add the reviewer unit tests to CI.

### Changes Required:

#### 1. CI workflow

**File**: `.github/workflows/ci.yml`

**Intent**: Replace `actions/checkout@v4` and `actions/setup-node@v4` (both jobs) with the v7.0.1 / v7.1.0 SHAs used in Phase 2, and `supabase/setup-cli@v1` with the commit SHA of its current latest `v1.x` release, looked up with `gh api` (dereference an annotated tag to its commit). Add `npm test --prefix reviewer` after the reviewer type-check. The `node-version: 22` and `cache: npm` inputs stay as they are.

**Contract**: each `uses:` is `<owner>/<repo>@<40-hex sha> # <tag>`. Job names `ci` and `smoke` are unchanged.

#### 2. Demo data workflow

**File**: `.github/workflows/demo-data.yml`

**Intent**: Pin checkout and setup-node to the same SHAs. Nothing else changes.

**Contract**: same pin format.

### Success Criteria:

#### Automated Verification:

- No tag-referenced action remains anywhere in `.github`: `grep -rnE "uses: [^.][^@]*@" .github | grep -vE "@[0-9a-f]{40} # v"` prints nothing
- The PR's `ci` and `smoke` jobs pass on the pushed branch with the v7 actions and the new reviewer test step: `gh pr checks`

#### Manual Verification:

- The Actions tab shows no "workflow file issue" for `demo-data.yml` (it isn't run, since it writes to the hosted project)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 4: Documentation

### Overview

Bring `README.md`, `CLAUDE.md` and the change notes in line with the new behaviour before merge.

### Changes Required:

#### 1. README

**File**: `README.md`

**Intent**: Rewrite Deployment step 2: the repo is public, and ruleset "Protect master" lets only the admin update `master`, through a PR, with `ai-cr/verdict` required (bypass only explicitly on the PR). CI green stays a convention. Add an "AI code review" section covering:

- how to start a review: the Details link → Run workflow → PR number, or `gh workflow run ai-review.yml -f pr=<n>`
- what it posts: the comment, labels and status
- what `error` means: over 100 kB, only excluded files, agent error, PR changed
- the exclusions, the $0.1 cap and where to see cost
- rerun = dispatch again
- forks: dispatch by hand
- that only users with write access can dispatch

**Contract**: the "Deployment" section and a new "AI code review" section.

#### 2. CLAUDE.md

**File**: `CLAUDE.md`

**Intent**: Update the reviewer command bullet: optional `PR_TITLE`/`PR_BODY` (body capped at 4,000 characters), English Planner criteria, the ≤ 4 rule and 1–10 range enforced in code (`reviewer/src/verdict.ts`), `npm --prefix reviewer test`. Update the CI bullet: `ci` runs the reviewer tests; the AI review workflows (`ai-review.yml` dispatch from master only, `ai-review-notify.yml`) and the composite action (`.github/actions/ai-reviewer/`); `ai-cr/verdict` required in the ruleset; all actions SHA-pinned and enforced by `sha_pinning_required`.

**Contract**: the Commands section bullets for the reviewer and CI.

#### 3. Change notes

**Files**: `context/changes/ci-cd-code-review/requirements.md`

**Intent**: Mark the decisions made in planning (PR body capped at 4,000 characters, the failure path with an `error` status and comment, the exclusions and 100 kB refusal, pin and enforce, bypass via PR) next to the bullets they settle.

**Contract**: short dated notes. No restructuring.

### Success Criteria:

#### Automated Verification:

- Markdown formatting is clean: `npx prettier --check README.md CLAUDE.md "context/changes/ci-cd-code-review/*.md"`

#### Manual Verification:

- The owner reads the README "AI code review" section and can start a review from it without other context

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 5: Rollout on GitHub (after merge)

### Overview

Merge, prove the workflow on a real follow-up PR, then turn on the gate and SHA enforcement through `gh api`. Record the results in the change notes.

### Changes Required:

#### 1. Merge and first runs

**Intent**: Merge this PR (the gate isn't required yet). Open a small follow-up PR, check the pending status, and dispatch `gh workflow run ai-review.yml -f pr=<n>`. Check the comment, label, status and step-summary cost. Then try the failure paths: a dispatch with a closed PR number (fails, posts nothing), and a throwaway PR with a deliberately buggy change (verdict `fail`, `ai-cr:failed`, status `failure`). A throwaway PR adding a file over 100 kB (`error`, "could not run" comment) is optional. Close the throwaway PRs. Record each run's cost in `prompt-baseline.md` to calibrate the $0.1 / 100 kB pair.

**Contract**: no file changes beyond the recorded results.

#### 2. Required status and bypass mode

**Intent**: Update ruleset 26309273: keep the three existing rules, add a `required_status_checks` rule for the context `ai-cr/verdict` (`strict_required_status_checks_policy: false`), and change the admin bypass to mode `pull_request`.

**Contract**:

```bash
gh api -X PUT repos/Redellex/planner/rulesets/26309273 --input - <<'JSON'
{
  "bypass_actors": [{ "actor_id": 5, "actor_type": "RepositoryRole", "bypass_mode": "pull_request" }],
  "rules": [
    { "type": "update" }, { "type": "deletion" }, { "type": "non_fast_forward" },
    { "type": "required_status_checks", "parameters": {
        "strict_required_status_checks_policy": false,
        "required_status_checks": [{ "context": "ai-cr/verdict" }] } }
  ]
}
JSON
```

#### 3. SHA pinning enforcement

**Intent**: Turn on `sha_pinning_required` once master holds only pinned actions (after the merge).

**Contract**: `gh api -X PUT repos/Redellex/planner/actions/permissions -F enabled=true -f allowed_actions=all -F sha_pinning_required=true`.

### Success Criteria:

#### Automated Verification:

- The ruleset requires the status and bypasses via PR: `gh api repos/Redellex/planner/rulesets/26309273 --jq '{b: .bypass_actors, r: [.rules[].type]}'` shows `pull_request` and `required_status_checks`
- SHA pinning is enforced: `gh api repos/Redellex/planner/actions/permissions --jq .sha_pinning_required` prints `true`
- CI still starts and passes with enforcement on: the follow-up PR's `gh pr checks` show `ci` and `smoke` green after the setting change

#### Manual Verification:

- The follow-up PR got the pending status, and the dispatched review posted a comment with the reviewed SHA, scores and summary, set `ai-cr:passed` or `ai-cr:failed`, and set the status to `success` or `failure`
- The throwaway buggy PR got `fail`, `ai-cr:failed`, a `failure` status and a failed job. A closed-PR dispatch failed with nothing posted
- With the gate on, a PR with a pending or failed `ai-cr/verdict` shows merge blocked, with only the admin bypass option
- The step summary of each run shows the cost line, and the costs are recorded in `prompt-baseline.md`

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Testing Strategy

### Unit Tests:

- `buildReviewPrompt`: tags present, empty title/body left out, body truncated exactly above 4,000 characters with the marker.
- `enforceVerdictRule`: boundary 4 vs 5, `fail` untouched, non-integer and out-of-range scores rejected, the note names the criterion.

### Integration Tests:

- None automated. The workflows run only on GitHub. Phase 2 proves the notify path on this PR, and Phase 5 proves the dispatch path on real PRs.

### Manual Testing Steps:

1. Before/after prompt baseline on the fixture and the M5L2 diff (Phase 1).
2. Pending status and Details link on this PR (Phase 2).
3. Pass and fail dispatches, closed-PR dispatch, optional too-large PR (Phase 5).
4. Merge blocked with the gate on (Phase 5).

## Performance Considerations

At Sonnet 5.5 ($2 / $10 per MTok), the $0.1 cap fits roughly 30–40k input tokens plus 2–3k output (uncalibrated). The 100,000-byte limit (about 25–30k tokens) keeps a refused diff from paying for a call that would hit the cap. Calibrate both from the Phase 5 cost lines, and change `max-diff-bytes` or `max-budget-usd` in the workflow if needed.

## Migration Notes

Rollback, in reverse rollout order: `sha_pinning_required` off; ruleset PUT back to the three rules with bypass mode `always`; delete the two workflow files and the action. Existing PR comments and labels can stay. `ai-cr/verdict` statuses on old SHAs are harmless once the context isn't required.

## References

- Requirements: `context/changes/ci-cd-code-review/requirements.md`
- Research: `context/changes/ci-cd-code-review/research.md` (especially "Decision 2026-11-01: manual run")
- Templates: `.claude/config-templates/m5l3-review.yml.template`, `.claude/config-templates/m5l3-action.yml.template`
- Agent: `reviewer/src/index.ts:9-80`, `reviewer/src/review-schema.ts:5-58`
- CI: `.github/workflows/ci.yml:13-23`, `.github/workflows/demo-data.yml:32-35`
- Stale docs: `README.md:108`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Reviewer — Planner criteria and PR context

#### Automated

- [x] 1.1 Reviewer unit tests pass: `npm --prefix reviewer test`
- [x] 1.2 Reviewer type-check passes: `npm --prefix reviewer run typecheck`
- [x] 1.3 Root lint passes, including `reviewer/src`: `npm run lint`
- [x] 1.4 Root Vitest ignores the reviewer tests: `npx vitest related reviewer/src/verdict.test.ts --run` exits 0 without running them
- [x] 1.5 The new prompt still fails the fixture: `npm --prefix reviewer run review -- fixtures/sample-buggy.diff` exits 0 with `"verdict": "fail"`

#### Manual

- [ ] 1.6 `prompt-baseline.md` holds the exception and both before/after rows, and the new reviews read as Planner-specific

### Phase 2: Composite action and workflows

#### Automated

- [ ] 2.1 Every `uses:` in the new files is local or a 40-character SHA with a `# vX.Y.Z` comment
- [ ] 2.2 No `${{ }}` expression carrying PR text appears inside a `run:` block
- [ ] 2.3 After pushing the branch, the notify run succeeds
- [ ] 2.4 The PR head carries `ai-cr/verdict` = `pending`

#### Manual

- [ ] 2.5 On the PR page the `ai-cr/verdict` row shows the pending description and its Details link opens the workflow page
- [ ] 2.6 Read-through confirms the dispatch ref guard, absolute diff path, `error` path and no env/key echo

### Phase 3: Pin existing workflows

#### Automated

- [ ] 3.1 No tag-referenced action remains anywhere in `.github`
- [ ] 3.2 The PR's `ci` and `smoke` jobs pass with the v7 actions and the reviewer test step

#### Manual

- [ ] 3.3 The Actions tab shows no "workflow file issue" for `demo-data.yml`

### Phase 4: Documentation

#### Automated

- [ ] 4.1 Markdown formatting is clean

#### Manual

- [ ] 4.2 The owner can start a review from the README "AI code review" section alone

### Phase 5: Rollout on GitHub (after merge)

#### Automated

- [ ] 5.1 The ruleset requires the status and bypasses via PR
- [ ] 5.2 SHA pinning is enforced
- [ ] 5.3 CI still starts and passes with enforcement on

#### Manual

- [ ] 5.4 The follow-up PR's dispatched review posted comment, label and status
- [ ] 5.5 The throwaway buggy PR got fail; a closed-PR dispatch posted nothing
- [ ] 5.6 With the gate on, a pending or failed `ai-cr/verdict` blocks merge except by admin bypass
- [ ] 5.7 Each run's cost is in the step summary and recorded in `prompt-baseline.md`
