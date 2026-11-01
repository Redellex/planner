# AI Code Review in CI (M5L3) — Plan Brief

> Full plan: `context/changes/ci-cd-code-review/plan.md`
> Research: `context/changes/ci-cd-code-review/research.md`

## What & Why

Run the M5L2 review agent (`reviewer/`) on pull requests to `master` in GitHub Actions, so every PR gets a binding `pass`/`fail` verdict on Planner's own rules, a summary comment and a label, and the verdict can block the merge. The review is started by hand to keep spending under the owner's control ($0.1 cap per run).

## Starting Point

`reviewer/` works locally: diff in, JSON verdict out, cost on stderr. But it reads no PR context and uses generic Polish criteria with no score-to-verdict rule. No workflow runs it. The course templates assume a `pull_request` trigger, OpenRouter and a built `dist/`, none of which fit. The repo is public now, ruleset "Protect master" exists, and the other workflows use unpinned `@v4` actions.

## Desired End State

Every same-repo PR shows an `ai-cr/verdict` status, pending until reviewed, with a Details link to the "AI Code Review" workflow. The owner dispatches it with the PR number. Master's reviewer reviews the recorded head commit, posts a comment and an `ai-cr:passed`/`ai-cr:failed` label, and sets the status to success or failure. Failures to run show an `error` status with a short reason. The ruleset requires the status (admin bypass only on the PR), and GitHub enforces SHA-pinned actions.

## Key Decisions Made

| Decision                         | Choice                                                                                                             | Why (1 sentence)                                                                           | Source          |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ | --------------- |
| Trigger                          | Manual `workflow_dispatch` (`pr` input) plus a notify workflow that sets a pending status                          | Spending stays under the owner's control; a link on every PR still makes it one click away | Research        |
| Gate signal                      | Commit status `ai-cr/verdict` on the PR head                                                                       | A dispatch run's check attaches to master, not the PR head                                 | Research        |
| Reviewer code source             | Master's checkout, dispatch refused from any other ref                                                             | A PR can't weaken its own reviewer                                                         | Research + Plan |
| Model / budget                   | Sonnet 5.5, `$0.1` per run in CI                                                                                   | Fits a typical diff; $0.01 would always overrun                                            | Research        |
| Prompt change vs eval-first rule | Change it here, with a hand-run before/after baseline and a recorded exception                                     | CI should ship with the required criteria; evals come in `code-review-evals`               | Plan            |
| Verdict rule                     | "Any score ≤ 4 → fail" and the 1–10 range enforced in code too                                                     | A contract rule should not depend on the model following it                                | Plan            |
| PR description                   | Sent, capped at 4,000 characters, fenced as untrusted                                                              | The author's intent helps the review at a bounded cost                                     | Plan            |
| No verdict produced              | "Could not run" comment, `error` status, labels unchanged, job fails                                               | The PR shows why it's blocked without a misleading label                                   | Plan            |
| Diff scope                       | Exclude lockfiles and `database.types.ts`; refuse over 100 kB, and treat an empty diff after exclusions as `error` | Never pay for a call that would overrun, and never pass code the agent didn't see          | Plan            |
| Pinning                          | Pin every workflow and enable `sha_pinning_required`                                                               | The hard rule holds repo-wide, enforced by GitHub                                          | Plan            |
| Merge gate                       | Require `ai-cr/verdict`; admin bypass mode `pull_request`                                                          | A false fail can still be overridden, but only explicitly on the PR                        | Plan            |

## Scope

**In scope:**

- Reviewer: English Planner criteria, PR title/body input, verdict rule in code, `node:test` unit tests, baseline record
- `.github/actions/ai-reviewer/`, `ai-review.yml` (dispatch), `ai-review-notify.yml`
- Pinning `ci.yml` and `demo-data.yml`, reviewer tests in CI
- README and CLAUDE.md updates
- After merge: real runs, the ruleset required status and bypass mode, `sha_pinning_required`

**Out of scope:**

- promptfoo evals and model comparison (`code-review-evals`)
- The `ai-cr:review` label retry and any automatic `pull_request` review
- Truncated reviews of large diffs; requiring the `ci`/`smoke` checks
- Business or architectural alignment, `plan.md` as input

## Architecture / Approach

The notify workflow (`pull_request`, `statuses: write` only) puts a pending `ai-cr/verdict` on each new head SHA. The review workflow (dispatch, master only) checks that the PR is open against master and records its head SHA. It marks the status running and diffs `origin/master...<sha>` without the excluded files. Then it calls the composite action, which installs `reviewer/`, enforces the size limit, runs the agent with `ANTHROPIC_API_KEY`, and returns `outcome`, `verdict` and a ready comment file. The workflow posts the comment, sets the labels and the status, and fails unless the verdict is `pass`.

## Phases at a Glance

| Phase                                 | What it delivers                                                              | Key risk                                                                 |
| ------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| 1. Reviewer — criteria and PR context | English Planner prompt, PR input, code-enforced verdict rule, tests, baseline | Prompt changed before an eval set exists (mitigated by the baseline)     |
| 2. Composite action and workflows     | Action, dispatch review, notify status, all pinned                            | Workflows can't be tested locally; dispatch is only possible after merge |
| 3. Pin existing workflows             | `ci.yml`/`demo-data.yml` on SHAs, reviewer tests in CI                        | checkout/setup-node v4 → v7 major bump                                   |
| 4. Documentation                      | README "AI code review", CLAUDE.md, change notes                              | Docs describe the gate before it's switched on                           |
| 5. Rollout on GitHub                  | First real runs, required status, bypass via PR, SHA enforcement              | Requiring the status too early would block every PR                      |

**Prerequisites:** `ANTHROPIC_API_KEY` repository secret (present); admin access for `gh api` on the ruleset and actions settings; local Claude Code login for the Phase 1 baseline.
**Estimated effort:** ~3 sessions across 5 phases (Phase 5 needs a follow-up PR and a throwaway PR).

## Open Risks & Assumptions

- The 100 kB / $0.1 pair is arithmetic, not measured. Phase 5 calibrates it from real cost lines.
- Status-vs-check behaviour of dispatch runs comes from third-party reports. The design avoids depending on it by setting the status explicitly.
- The model's summary is posted as a comment, so injected text in a diff could add content or @mentions to it. It can't change the gate, which reads only `verdict`.
- The owner's bypass makes the gate a deliberate override for their own PRs, not a hard block.

## Success Criteria (Summary)

- A PR to `master` shows a pending `ai-cr/verdict`, and one dispatch turns it into a commented, labelled `success` or `failure` on the reviewed commit.
- A buggy PR can't be merged without an explicit admin bypass on the PR.
- Every action in the repo is SHA-pinned and GitHub refuses unpinned ones.
