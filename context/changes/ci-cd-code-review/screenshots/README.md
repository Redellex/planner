# Screenshots: AI code review in CI (M5L3)

Evidence for the 10xChampion task (pipeline view, job logs, the LLM's PR comment, model evals). Taken 2026-11-01; 01–09 signed out from the public repo pages, so GitHub hides the step logs there ("Sign in to view logs").

| File                                    | Shows                                                                                                                                    |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `01-pr69-pass-comment.png`              | The reviewer's PASS comment on #69 (commit `b2e610b`): six scores and the model's summary                                                |
| `02-pr69-header-label-passed.png`       | #69 merged, with the `ai-cr:passed` label                                                                                                |
| `03-pr70-fail-comment.png`              | FAIL comment on the throwaway buggy endpoint #70: self-promotion, logged form, raw error                                                 |
| `04-pr70-label-failed.png`              | #70 with the `ai-cr:failed` label                                                                                                        |
| `04-pr70-run-failed.png`                | The failed "AI Code Review" run for #70 (job failed by the verdict gate)                                                                 |
| `05-pr71-could-not-run-comment.png`     | #71, a 126 kB diff: refused without a model call ("could not run")                                                                       |
| `06-closed-pr-dispatch-refused.png`     | Dispatch on closed #70: refused at "Read the pull request", nothing posted                                                               |
| `07-ai-review-runs.png`                 | Pipeline view: all "AI Code Review" runs (`workflow_dispatch` on master)                                                                 |
| `08-pr72-review-comment-csv-export.png` | FAIL comment on throwaway #72 (CSV export passing wall-clock strings through `new Date`)                                                 |
| `09-pr72-header-label-failed.png`       | #72 with the `ai-cr:failed` label                                                                                                        |
| `10-promptfoo-eval-three-models.png`    | promptfoo eval (`npm --prefix reviewer run eval:view`): Haiku, Sonnet, Opus 5.5, each 15/15 over 5 cases × 3 runs, with cost and latency |
| `11-job-log-review-step.png`            | To add (signed in): run 41316632032, job `review`, step "Review", line `[review] success, 2 turns, 5158 ms, $0.0717`                     |
