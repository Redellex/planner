---
date: 2026-11-01T12:51:20+01:00
researcher: Claude (Opus 5.5) for Redellex
git_commit: 527dbd7c14b015a4f33c95cd29bf9d2071867031
branch: feat/ci-code-review
repository: Redellex/planner
topic: "AI code review on every pull request in GitHub Actions (M5L3): what the requirements need from reviewer/, the templates and GitHub"
tags: [research, ci, github-actions, reviewer, claude-agent-sdk, m5l3]
status: complete
last_updated: 2026-11-01
last_updated_by: Claude (Opus 5.5)
last_updated_note: "Follow-up: repository made public (branch protection now available, fork PRs now possible); prompt language decided: English; master ruleset created; model/budget decided (Sonnet 5.5, $0.1); trigger decided (manual workflow_dispatch + pending status link). See 'Follow-up 2026-11-01' and its Decision subsections."
---

# Research: AI code review in CI (M5L3)

**Date**: 2026-11-01T12:51:20+01:00
**Researcher**: Claude (Opus 5.5) for Redellex
**Git Commit**: 527dbd7 (working tree has uncommitted M5L3 toolkit files and `CLAUDE.md` edits)
**Branch**: feat/ci-code-review
**Repository**: Redellex/planner (private, GitHub Free at first research; **public since the follow-up**)

## Research Question

Based on `context/changes/ci-cd-code-review/requirements.md`, what does the codebase, the two course templates (`.claude/config-templates/m5l3-review.yml.template`, `m5l3-action.yml.template`) and GitHub give us, and what has to change, to run the existing `reviewer/` agent on every PR to `master` with a comment, `ai-cr:*` labels, an `ai-cr:review` retry, a failing check on `fail` and cost logged per run?

## Summary

- **The agent exists but is not CI-shaped yet.** `reviewer/src/index.ts` reads a diff only (stdin or `argv[2]`, `index.ts:13-22`), no PR title/body; its prompt and all six criterion descriptions are generic and in Polish (`review-schema.ts:5-58`), with no "fail when any score ≤ 4" rule. Requirements `:31-61` ask for Planner-specific criteria and that rule, so the prompt must change — which collides with the hard rule "Run the eval set before changing the review prompt or model" (`CLAUDE.md:128`) while the eval set is a later, separate change (`requirements.md:82`). Open question 1.
- **The action template does not fit `reviewer/` as is.** It expects a built `dist/review.js` reading `DIFF_FILE`/`PR_TITLE`/`PR_BODY` env (`m5l3-action.yml.template:4,55`), an OpenRouter-style `LLM_PROVIDER_API_KEY` (`:48`), model default `z-ai/glm-5.3` (`:26`) and Node 24 (`:41`). The repo has no build step (runs through `tsx`, `reviewer/package.json:11`), `.gitignore:2` ignores `dist/`, `.nvmrc` is `22.14.0`, and requirements pin Anthropic + `ANTHROPIC_API_KEY` (`requirements.md:21`). The simplest fit is `npm ci --prefix reviewer` + `npm --prefix reviewer run review -- <abs diff path>` inside the composite action, with `env: ANTHROPIC_API_KEY`.
- **Install on Linux is already proven.** `ci.yml:20` runs `npm ci --prefix reviewer` on ubuntu-latest today; the Windows-generated lockfile contains the `claude-agent-sdk-linux-x64` optional binary (`reviewer/package-lock.json:105`). `--omit=optional` would break it (SDK `CLINotFoundError`).
- ~~**The merge gate cannot be enforced on this plan.**~~ _Superseded by the follow-up: the repository is now public and branch protection is available._ Branch protection and rulesets return HTTP 403 "Upgrade to GitHub Pro or make this repository public" (checked with `gh api` on 2026-11-01); `README.md:108` already states merging is gated by convention. The failing check and labels are signals, not a block, until the plan changes.
- **Template pins are current.** `actions/checkout@3d3c42e…` = `v7.0.1` and `actions/setup-node@949feb2…` = `v7.1.0`, both the latest releases (verified via `gh api`). Existing workflows use unpinned `@v4` tags (`ci.yml:13-14,34-35`, `demo-data.yml:93-94`).
- **The template's concurrency group has a known pitfall.** `group: ai-review-<PR>` with `cancel-in-progress: true` (`m5l3-review.yml.template:18-20`) is evaluated before the job `if:` (`:24`), so a human adding any unrelated label cancels an in-flight review and the new run is skipped (github/gh-aw#23020). Fix: put the label name in the group for `labeled` events.
- **Prerequisites present:** `ANTHROPIC_API_KEY` repository secret exists (set 2026-10-29); no `ai-cr:*` labels exist yet (the template creates them with `--force`); default workflow token permissions are `read` (`gh api …/actions/permissions/workflow`), so the workflow must declare `pull-requests: write` + `issues: write` as the template does.
- **Cost:** Sonnet 5.5 is $2 / $10 per MTok in/out. Lockfiles dominate large diffs: the M5L2 commit's diff was 96,868 bytes, of which 72,406 were `reviewer/package-lock.json` (measured with `git diff e33fd26...65039b9`). Excluding lockfiles from the review diff is the main cost lever; the per-run cost line already exists on stderr (`index.ts:32-35`) and the `$0.5` cap stays (`index.ts:11`).

## Detailed Findings

### 1. The reviewer agent (`reviewer/`, M5L2)

- Entry `reviewer/src/index.ts`: model `REVIEW_MODEL ?? "claude-sonnet-5-5"` (`:9`), budget `REVIEW_MAX_BUDGET_USD ?? 0.5` (`:11`); `query()` with `settingSources: []`, `tools: []`, `maxTurns: 2`, `maxBudgetUsd`, `outputFormat: json_schema` (`:41-52`). The diff is fenced in `<diff>` tags as untrusted input (`:42-43`).
- Input: `argv[2]` file path, else stdin (`:13-22`). Run through `npm --prefix reviewer run review`, npm executes in `reviewer/`, so a relative path is relative to `reviewer/` (CLAUDE.md commands section); an absolute `$RUNNER_TEMP/pr.diff` avoids that.
- Output: JSON review on stdout (`:76`); `[review] <subtype>, N turns, ms, $cost (per-model tokens)` on stderr (`:32-35`); any error → stderr message + exit code 2 (`:77-80`), including a budget overrun (`subtype !== "success"`, `:63-65`) and schema mismatch (`:68-69`).
- Contract `reviewer/src/review-schema.ts`: six `z.number()` scores (no min/max because structured output rejects them on integers, `:12-13`), `verdict: enum(pass|fail)` (`:57`), `summary: string` (`:58`). SYSTEM_PROMPT (`:5-10`) asks for a binding verdict but states **no rule** linking scores to verdict. All prompt text and descriptions are Polish; requirements' criteria are English and Planner-specific.
- Not present today: reading `PR_TITLE`/`PR_BODY`, a `DIFF_FILE` env, a build output. `reviewer/.env.example` says CI needs a Console key stored as a repository secret.
- SDK runtime (`@anthropic-ai/claude-agent-sdk` 0.3.312): bundles the Claude Code CLI (2.1.312) as platform `optionalDependencies`, no postinstall; `engines.node >=18.14.0`; the spawned CLI reads `ANTHROPIC_API_KEY` from the environment (https://code.claude.com/docs/en/agent-sdk/hosting). Session transcripts go to `~/.claude/projects/` (writable on hosted runners); `persistSession: false` or `CLAUDE_CONFIG_DIR=$RUNNER_TEMP/claude` are optional hardening. Not yet run on ubuntu-latest (gap).

### 2. Course templates vs. Planner

`m5l3-review.yml.template`:

- Triggers `pull_request` on `master`, types `opened, synchronize, reopened, labeled`; permissions `contents: read`, `pull-requests: write`, `issues: write`; job `if: action != 'labeled' || label == 'ai-cr:review'` (`:24`); checkout `fetch-depth: 0` (`:32`); diff `git diff "origin/$BASE_REF...HEAD" > "$RUNNER_TEMP/pr.diff"`; secret `LLM_PROVIDER_API_KEY` (`:44`) → must become `ANTHROPIC_API_KEY`; comment + labels via `gh` guarded by `verdict != ''`; removes `ai-cr:review`; final "Gate on verdict" step fails unless `pass`.
- On `pull_request`, checkout uses the merge ref, so `origin/master...HEAD` diffs the PR as it would merge [inference, not run].
- When the reviewer fails (exit 2: budget, API, schema), the template's `run:` under `set -e` fails the action step, `verdict` is empty, the comment/label step is skipped and the gate fails with "verdict: missing". No comment tells the author why (open question 4).

`m5l3-action.yml.template`:

- Inputs `api-key`, `pr-title`, `pr-body`, `diff-file`, `model`; outputs `verdict`, `review-file`; PR text passed through `env:` (`:45-51`), not interpolated — matches GitHub's script-injection guidance (https://docs.github.com/en/actions/concepts/security/script-injections). Verdict is extracted with a Node one-liner and re-validated as `pass|fail`.
- Mismatches listed in the Summary (dist, key name, model, Node 24).

### 3. GitHub semantics that shape the workflow

- **Forks:** no secrets and a read-only token for fork PRs (https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows). Guard with `github.event.pull_request.head.repo.full_name == github.repository`; do not switch to `pull_request_target`. Low relevance for a private single-owner repo; Dependabot PRs behave alike [inference].
- **No recursion:** events caused by `GITHUB_TOKEN` (the bot's labels and comments) start no new run (https://docs.github.com/en/actions/concepts/security/github_token). A human adding a label does start one.
- **Concurrency pitfall:** see Summary. Suggested group: `ai-cr-${{ github.event.pull_request.number }}-${{ github.event.action == 'labeled' && github.event.label.name || 'code' }}` — pushes still cancel older pushes; an `ai-cr:review` retry shares a group with other retries only.
- **Skipped job = success** for required checks (https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-jobs-with-conditions). An unrelated-label run that skips the job could create a new "success" check on the same SHA after a failing verdict [inference, untested]. Moot while required checks are unavailable (§4), relevant if the repo goes public/Pro.
- **Labels:** `gh label create … --force` makes creation idempotent; `gh pr edit --remove-label X` errors only when label X does not exist in the repo (cli/cli `LabelsToIDs`), so create both first. Removing `ai-cr:review` when it was never added: the template already appends `|| true`.

### 4. Repository and plan constraints

- Branch protection / rulesets: 403 on this private Free repo (checked); `README.md:108` documents merge-by-convention. Requirement "a failing check … merge gate once the check is required" (`requirements.md:77`) is achievable only as a visible failing check.
- Existing workflows: no `permissions:` blocks, literal `node-version: 22` with `cache: npm`, secrets via step `env:` (`ci.yml:16,27-29`, `demo-data.yml:100-107`). `ci.yml` already installs and type-checks `reviewer/` (`ci.yml:19-23`).
- `setup-node@v7.1.0` supports `node-version-file: .nvmrc` and `cache: npm` with `cache-dependency-path: reviewer/package-lock.json` (its `action.yml`).
- Local tooling: root ESLint lints `reviewer/src` type-aware; `.yml` files are not linted or formatted by lint-staged, the Claude hooks or Prettier (lint-staged formats `*.{json,css,md}` only). Workflow YAML is therefore only validated by GitHub on push (consider `actionlint` by hand — not installed, unverified).
- `.claude/skills/10x-impl-review-ci/references/workflow-template.yml` is a different, label-gated (`impl-review`) Claude Code Action workflow with its own concurrency group and status context; it is not installed and does not collide with `ai-cr:*` names. It pins the same checkout/setup-node SHAs.

### 5. Cost

- Pricing per MTok (https://platform.claude.com/docs/en/about-claude/pricing): Sonnet 5.5 $2 in / $10 out; Opus 5.5 $4 / $20; Haiku 5.5 $0.10 / $0.50 (prompts ≤ 100k).
- Estimate for a ~50k-token diff, ~2–3k output, up to 2 turns: Sonnet ~$0.14–0.27; Opus ~$0.40–0.55 (can hit the $0.5 cap); Haiku < $0.01 [arithmetic, not measured]. Calibrate on the first CI run from the stderr cost line.
- Diff composition: of the 96,868-byte M5L2 diff, 72,406 bytes were `reviewer/package-lock.json`. A pathspec such as `':(exclude)**/package-lock.json'` on the diff command removes that; `src/db/database.types.ts` (generated) is a second candidate.
- "Cost per run logged" is met by the existing stderr line in the job log; surfacing it in `$GITHUB_STEP_SUMMARY` or the PR comment is optional.

## Code References

- `reviewer/src/index.ts:9-11` — model and budget env defaults
- `reviewer/src/index.ts:13-22` — diff input (argv path or stdin only)
- `reviewer/src/index.ts:32-35` — per-run cost line on stderr
- `reviewer/src/index.ts:41-52` — `query()` options
- `reviewer/src/index.ts:77-80` — any error → exit 2
- `reviewer/src/review-schema.ts:5-10` — Polish SYSTEM_PROMPT, no score→verdict rule
- `reviewer/src/review-schema.ts:14-58` — six scores, verdict, summary
- `reviewer/package.json:11` — `review` script via `tsx`, no build
- `reviewer/package-lock.json:105` — linux-x64 SDK binary entry
- `.github/workflows/ci.yml:13-23` — unpinned actions, Node 22, reviewer install + typecheck
- `.claude/config-templates/m5l3-review.yml.template:18-24,32,44` — concurrency, job `if`, fetch depth, secret name
- `.claude/config-templates/m5l3-action.yml.template:4,26,41,48,55` — dist, model, Node 24, key env, entry
- `.gitignore:2` — `dist/` ignored
- `README.md:108` — no branch protection on GitHub Free
- `CLAUDE.md:125-128` — M5L3 hard rules (pin SHAs, gate on verdict, files for multi-line, evals before prompt/model change)

## Architecture Insights

- Contract-first: the gate reads only `verdict` from the JSON validated by zod in the agent, re-validated as `pass|fail` in the action. Free text never gates.
- The reviewer is intentionally context-free (`settingSources: []`, no tools): Planner knowledge reaches it only through the prompt/criteria text, which is why the criteria rewrite in requirements matters.
- Keeping the action local (`.github/actions/ai-reviewer/`) lets it call `reviewer/` from the checked-out PR, so the agent version reviewed is the one on the PR branch — including a PR that changes the reviewer itself [inference; implication: a PR can weaken its own reviewer].

## Historical Context (from prior changes)

- No M5L2 change folder exists; M5L2 shipped directly in commit 65039b9 / PR #67. `context/archive/**` has no reviewer or CI-review decisions (only "verdict" in old impl-review reports).
- `context/foundation/roadmap.md` and `tasks-linear.md` have no M5L3 or code-review entries.
- Memory notes: M5L2 done, M5L3 GitHub Actions is the next step on the reviewer path.

## Related Research

Not applicable (first research in this change; `code-review-evals` not opened yet).

## Follow-up 2026-11-01: repository public, English prompt

User decisions: the repository was switched to public; the reviewer's prompt and criteria language is **English** (resolves open question 2).

Checked with `gh` after the switch:

- `gh repo view` → `visibility: PUBLIC`.
- `GET …/branches/master/protection` → HTTP 404 "Branch not protected" (was 403 "Upgrade to GitHub Pro…"): branch protection is now **available but not configured**. `GET …/rulesets` → `[]`.
- `GET …/actions/permissions` → `enabled: true`, `allowed_actions: all`, `sha_pinning_required: false`.
- `GET …/actions/permissions/fork-pr-contributor-approval` → `approval_policy: first_time_contributors`: a first-time contributor's fork PR runs workflows only after the owner approves.

Consequences (superseding §4's "achievable only as a visible failing check" and Summary bullet 4):

1. **The verdict can now be a real merge gate.** Requiring the review job's check on `master` (branch protection or a ruleset, set up by hand or via `gh api`) is a one-time step outside the workflow file; it should be listed in the plan and documented. `README.md:108` ("private on GitHub Free, so there is no branch protection") is now stale and needs an update in this change.
2. **The skipped-job bypass becomes live** (§3, "Skipped job = success"). Once the job's check is required, two paths could report a skipped job as success on the PR head [inference from GitHub docs, untested]:
   - a human adding an unrelated label (job `if:` false) after a `fail` verdict;
   - a fork PR, if the job is guarded with `head.repo.full_name == github.repository`.
     Robust shape to consider: the required check is a job that always runs and passes only when the review step produced `pass` in this run, or (on a non-`ai-cr:review` `labeled` event) when the PR currently carries `ai-cr:passed`; an unguarded fork run fails because the secret is empty. Exact design is a plan decision.
3. **Fork PRs are now possible.** They get no secrets and a read-only token, so the reviewer cannot run and labels/comments fail (403). With the approval policy above, a stranger's first PR runs nothing until approved. The plan must decide what the gate does for a fork PR (fail with an explanatory log line is the safe default; skipping would pass a required check). `pull_request_target` stays out: it would run with secrets on untrusted code.
4. **Logs and comments are public.** The review JSON, summary comment and cost line become visible to anyone; the diff is public anyway. Never echo the key or the full env; the reviewer prints only usage/cost to stderr (`index.ts:32-35`), which is fine.
5. **SHA pinning can be enforced by the platform.** `sha_pinning_required` (now visible, `false`) would make GitHub refuse unpinned actions. Turning it on would break `ci.yml` and `demo-data.yml`, which use `@v4` tags (`ci.yml:13-14,34-35`, `demo-data.yml:93-94`), so it couples with open question 6.
6. **Prompt in English:** the rewrite of `SYSTEM_PROMPT`, the user prompt (`index.ts:43`, "Zrecenzuj ten diff") and the six `.describe()` texts (`review-schema.ts:14-58`) moves to English together with the Planner-specific criteria from `requirements.md:31-55`. This is still a prompt change under `CLAUDE.md:128` (open question 1 stands).

### Decision 2026-11-01: model and per-run budget

User decision: keep **`claude-sonnet-5-5`** and lower the per-run cap to **`REVIEW_MAX_BUDGET_USD=0.1`** in CI (the code default stays `0.5`, `index.ts:11`, unless the plan changes it).

- A $0.01 cap was considered and rejected: `maxBudgetUsd` stops the query once the estimate is exceeded and returns `error_max_budget_usd` (`reviewer/node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:1980-1984`). It does not shorten the answer, so the reviewer exits 2 and the gate fails with no verdict (`index.ts:63-65,77-80`). At Sonnet 5.5's $2 / $10 per MTok, $0.01 is about 5k input or 1k output tokens, below a typical review [arithmetic]. Haiku 5.5 would fit $0.01, but that is a model change under `CLAUDE.md:128`.
- Consequence for the plan: at $0.1 a diff of roughly 30–40k input tokens plus ~2–3k output fits one turn [arithmetic, uncalibrated]. A larger PR exceeds the cap and fails the check with no verdict. That makes diff exclusions (lockfiles, generated `database.types.ts`; question 5) and the failure-path comment (question 4) more important. Calibrate on the first CI runs from the stderr cost line.
- The Anthropic Console monthly spend limit is a separate outer cap that the owner sets by hand.

### Decision 2026-11-01: manual run, started from a link on the PR

User decision, replacing "run for every new pull request" and the `ai-cr:review` label retry (`requirements.md:19,76`): the review runs **only when started by hand**, and every PR to `master` carries a link to start it. The chosen shape:

1. **Notify workflow** (`pull_request` to `master`, types `opened, synchronize, reopened`; no secrets; `statuses: write`): sets a commit status `ai-cr/verdict` = `pending` ("Run the AI review manually") on the PR head SHA. Its `target_url` is the review workflow's page (`https://github.com/Redellex/planner/actions/workflows/<review file>`), so the PR checks list shows a **Details** link. Every push gets a new head SHA with no status, so the notify run marks each new commit pending again.
2. **Review workflow** (`workflow_dispatch`, input `pr`, run on `master`): validates the input as a number of an open PR targeting `master` and records its head SHA. It fetches the diff (`refs/pull/<n>/head` against `origin/master`, three-dot), runs `reviewer/` **from master's checkout**, posts the summary comment and the `ai-cr:passed`/`ai-cr:failed` label, and sets `ai-cr/verdict` to `success`/`failure` on the recorded SHA.

Facts behind the shape:

- **No pre-filled link.** A link cannot open the Run workflow form with inputs filled in. Only the UI form, the REST `POST …/actions/workflows/{id}/dispatches` with `inputs`, or `gh workflow run <file> -f pr=<n>` set inputs. No mechanism found in a web search [gap: no official statement of absence]. The owner types the PR number, or runs `gh workflow run`.
- **Why a commit status instead of the job's check run.** A `workflow_dispatch` run's check runs attach to the dispatched ref's commit (master), not to the PR head. Reports describe them as not counted by branch protection on the PR ([safe-docx#288](https://github.com/UseJunior/safe-docx/pull/288), [Morrison-Lab/gha#285](https://github.com/Morrison-Lab/gha/issues/285)) [third-party, not verified in GitHub docs]. An explicit status on the head SHA via `POST /repos/{o}/{r}/statuses/{sha}` (`statuses: write`) is attached by construction.
- **Problems this removes:** the concurrency/unrelated-label pitfall and the skipped-job-as-success bypass (§3, Follow-up item 2), because no `labeled` trigger or `if:`-skipped job reports the gate, and the gate is one status context. It also removes the self-review risk (open question 7), because the reviewer code comes from `master`.
- **Who can start it:** `workflow_dispatch` needs write access, so only the owner (sole collaborator, admin) can start it today.
- **Fork PRs:** the notify run gets a read-only token, so it cannot set the pending status (guard it, or let it fail quietly). The owner can still dispatch a review of a fork PR: the dispatch runs in the base repo with secrets, but executes only master's code and passes the fork diff as data to a tool-less agent. This answers open question 9 [inference].
- **Merge gate:** require the status context `ai-cr/verdict` in ruleset "Protect master" (id 26309273). The owner's `always` bypass still makes it advisory for the owner (open question 8).
- **Rerun:** run the workflow again. The status on the same SHA is overwritten by the newer one. The `ai-cr:review` label is no longer used.

## Open Questions

Question 2 is resolved (English). The model/budget is decided (Sonnet 5.5, $0.1 per run). The trigger is decided (manual `workflow_dispatch` + pending status link), which also settles questions 7 and 9. Question 6 now also covers enabling `sha_pinning_required`. New: 8 and 9.

1. **Prompt change vs. eval-first rule.** Requirements need Planner-specific criteria and the "≤ 4 → fail" rule in the prompt; `CLAUDE.md:128` says to run the eval set before changing the prompt, but evals are a later change. Options: change the prompt here and record the exception; or ship CI with the current prompt now and move the criteria rewrite into `code-review-evals`.
2. ~~**Prompt language.**~~ Resolved 2026-11-01: English.
3. **PR body input** ("?? cost tradeoff"): include it (truncated, fenced as untrusted), or title only?
4. **Reviewer failure path:** post a short "review could not run" comment (and no label) when the agent exits 2, or only fail the check?
5. **Diff exclusions:** lockfiles only, or also `src/db/database.types.ts`; and a size cap before calling the model?
6. **Pinning existing workflows:** pin `ci.yml`/`demo-data.yml` actions to SHAs in this change, or leave them (the hard rule names third-party actions generally)?
7. **Self-review risk:** run the reviewer from the PR branch (simple, but a PR can change its own reviewer) or from `master` (e.g. a second checkout of the base)? More relevant now that outside contributors can open PRs.
8. **Required check setup:** which check name becomes required, and is it added in this change (by hand, documented) or left to the owner? Since 2026-11-01 `master` has ruleset "Protect master" (id 26309273, created by `gh api`): `update`, `deletion` and `non_fast_forward` rules, only the Repository admin role (the owner, the sole collaborator) bypasses, `bypass_mode: always`. A required `required_status_checks` rule for the AI review belongs in that ruleset; note that the owner's bypass also skips it, so for the owner's own PRs the gate stays advisory unless the bypass mode becomes `pull_request` or the bypass is narrowed.
9. **Fork PRs:** fail the gate with an explanation (blocks merge until the owner reviews by hand or re-runs from a branch) or skip?
