# Prompt baseline — reviewer before/after (M5L3, Phase 1)

## Exception

`CLAUDE.md` (M5L3 hard rules) says: "Run the eval set before changing the review prompt or model." This change rewrites the review prompt (English, Planner-specific criteria, the "any score ≤ 4 → fail" rule, PR title and description as input) **without** an eval set, because none exists yet. The promptfoo eval set is the separate `code-review-evals` change, which comes after this one.

In its place, this file records a hand-run before/after on two fixed inputs. It is the baseline `code-review-evals` should reproduce and extend. The model stays `claude-sonnet-5-5`, so only the prompt changed.

## Setup

- Date: 2026-11-01, local runs from `reviewer/` with `reviewer/.env` (model `claude-sonnet-5-5`, code default budget `$0.5` for all four runs so none stopped at the cap).
- **Before**: `reviewer/src/index.ts` and `review-schema.ts` from 527dbd7 (Polish generic prompt, user prompt "Zrecenzuj ten diff", no verdict rule).
- **After**: this change's Phase 1 (`review-schema.ts` English Planner criteria, `prompt.ts`, `verdict.ts`).
- Inputs (diff only, no `PR_TITLE`/`PR_BODY`, so both prompts saw the same input):
  - **fixture**: `reviewer/fixtures/sample-buggy.diff` (1,471 bytes, simulated bug: self-promotion through a direct `profiles` update, form data logged, raw error in the URL).
  - **M5L2**: `git diff e33fd26...65039b9 -- . ':(exclude,glob)**/package-lock.json' ':(exclude)src/db/database.types.ts'` (24,462 bytes, 9 files; the PR #67 reviewer itself).
- Scores in the order: correctness / idiomaticity / complexity / test-risk coverage / documentation / security. Cost and turns are from the `[review]` stderr line (the SDK also makes one small Haiku call per run, included in the cost).

## Results

| Input   | Prompt | Corr. | Idiom. | Compl. | Tests | Docs | Sec. | Verdict | Cost    | Turns |
| ------- | ------ | ----: | -----: | -----: | ----: | ---: | ---: | ------- | ------- | ----: |
| fixture | before |     1 |      2 |      3 |     1 |    2 |    1 | fail    | $0.0175 |     2 |
| fixture | after  |     1 |      2 |      4 |     1 |    2 |    1 | fail    | $0.0161 |     2 |
| M5L2    | before |     7 |      8 |      8 |     4 |    8 |    8 | pass    | $0.0401 |     2 |
| M5L2    | after  |     8 |      7 |      9 |     5 |    8 |    8 | pass    | $0.0422 |     2 |

## Observations

- **Verdict/score consistency.** The old prompt returned `pass` on M5L2 with test-risk coverage at **4**: under the new rule that is a `fail`, and `verdict.ts` would now flip it. The new prompt scored it 5 and passed, consistent with the rule.
- **Planner-specific.** On the fixture the new summary names the repo rule the change breaks (the `set_display_name` RPC as the only writer of the caller's own row, `role` taken from the form as self-promotion, `describeDisplayNameWriteError`/`accountUrl` for allow-listed errors, a pgTAP test that a user cannot change their own role). On M5L2 it cites the wall-clock time model, RLS, the route gating in `route-access.ts` and the ≤ 4 verdict rule. The old summaries were Polish and more generic ("add a schema test", "add validation").
- **Format.** The new summaries are English bullets with file paths, ready as a PR comment. The old ones were Polish with a heading.
- **Cost.** Both prompts cost about the same: about $0.016 for 1.5 kB and about $0.04 for 24 kB of diff, well under the CI cap of `$0.1`. Fitting the two points gives about $0.014 fixed plus $0.0011 per kB, so a diff reaches the $0.1 cap near 75–80 kB and would cost about $0.13 at 100 kB. The planned 100 kB refusal limit would therefore let 75–100 kB diffs pay and still end as `error`, so the limit is now 70 kB (implementation review F4). Calibrate from the Phase 5 CI runs.

## CI runs (Phase 5)

To be filled after merge: each dispatched run's cost from the step summary, to calibrate the `$0.1` / 70 kB pair.
