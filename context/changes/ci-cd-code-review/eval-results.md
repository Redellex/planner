# Eval results: the reviewer on three models (M5L3, Phase 6)

The promptfoo set in `reviewer/evals/` runs the **real reviewer CLI** (`reviewer/src/index.ts`, through `reviewer/evals/provider.ts`) on fixed diffs, so every cell goes through the same path as CI: Agent SDK call, JSON schema, then the verdict rule in `verdict.ts`. Only `REVIEW_MODEL` changes between columns. This set is the regression gate the M5L3 hard rule asks for: run it before any change to the review prompt, schema or model, and compare with the table below.

Run: `npm --prefix reviewer run eval` (add `-- --repeat 3` for a stability check). View: `npm --prefix reviewer run eval:view`.

## Setup

- Date 2026-11-01, promptfoo 0.125.1 (via `npx`, not a dependency), Node 24.21 locally (promptfoo needs 22.22+, so the set does not run on CI's 22.14).
- Reviewers: `claude-haiku-5-5`, `claude-sonnet-5-5` (the CI default), `claude-opus-5-5`. Budget per run `$0.5`, so no run stops at the cap and the `cost` assertion measures the real cost against CI's `$0.1`.
- Judge for `llm-rubric`: `claude-fable-5-1` (Messages API, `ANTHROPIC_API_KEY` from `reviewer/.env`). It is none of the three reviewers, so no model grades its own summary.
- Diff only, no PR title or body (as in `prompt-baseline.md`). `--repeat 3`: 5 cases × 3 models × 3 runs = 45 reviews.

## Cases

| Case                  | Diff                                                                                                              | Bytes | Expected                                                      |
| --------------------- | ----------------------------------------------------------------------------------------------------------------- | ----: | ------------------------------------------------------------- |
| `fail-self-promotion` | `reviewer/fixtures/sample-buggy.diff`: direct `profiles` update with `role` from the form, logged form, raw error | 1,471 | `fail`, security ≤ 3, rubric: names at least 2 of the 3 flaws |
| `fail-wall-clock-csv` | PR #72: CSV export passing Warsaw wall-clock strings through `new Date`                                           |   873 | `fail`, rubric: names the time-model violation                |
| `fail-no-rls`         | Planted migration: new `shift_notes` table with grants to `authenticated`/`anon` and no RLS                       |   938 | `fail`, security ≤ 3, rubric: names the missing RLS           |
| `pass-day-save-cap`   | Real commit ed51737 (`src/lib` part): a row cap on the day form, with tests                                       | 3,847 | `pass`, rubric: invents no serious problem                    |
| `pass-docs-tick`      | Real commit 02cca7b: one checkbox ticked in a plan                                                                |   979 | `pass`                                                        |

Every case also asserts: valid JSON, the contract after `verdict.ts` (six integer scores 1–10, a verdict, a non-empty summary) and cost ≤ `$0.1`.

## Matrix

Pass = all assertions of the case passed, over 3 runs. Cost is the SDK's `total_cost_usd` estimate per review; time is the SDK call (`duration_ms`), without Node start-up (about 2 s more per cell).

| Case                  | Haiku 5.5                                   | Sonnet 5.5                                  | Opus 5.5                                    |
| --------------------- | ------------------------------------------- | ------------------------------------------- | ------------------------------------------- |
| `fail-self-promotion` | 3/3, $0.0008, 5.0 s                         | 3/3, $0.0096, 4.8 s                         | 3/3, $0.0217, 7.6 s                         |
| `fail-wall-clock-csv` | 3/3, $0.0008, 4.5 s                         | 3/3, $0.0085, 5.3 s                         | 3/3, $0.0190, 7.3 s                         |
| `fail-no-rls`         | 3/3, $0.0007, 4.7 s                         | 3/3, $0.0079, 4.9 s                         | 3/3, $0.0186, 7.4 s                         |
| `pass-day-save-cap`   | 3/3, $0.0010, 5.3 s                         | 3/3, $0.0088, 4.6 s                         | 3/3, $0.0250, 8.8 s                         |
| `pass-docs-tick`      | 3/3, $0.0005, 3.4 s                         | 3/3, $0.0053, 2.6 s                         | 3/3, $0.0110, 3.7 s                         |
| **All 15 runs**       | **15/15, mean $0.0008, max $0.0013, 4.6 s** | **15/15, mean $0.0080, max $0.0158, 4.4 s** | **15/15, mean $0.0191, max $0.0336, 6.9 s** |

promptfoo: 45 passed, 0 failed, 0 errors, "15 repeated groups; 0 unstable", 1 min 56 s at concurrency 4. Total reviewer cost $0.42; the judge used 36k tokens.

Scores (correctness / idiomaticity / complexity / tests / docs / security), run 1 of 3:

| Case                  | Haiku 5.5          | Sonnet 5.5           | Opus 5.5               |
| --------------------- | ------------------ | -------------------- | ---------------------- |
| `fail-self-promotion` | fail 2/3/6/2/2/1   | fail 2/2/4/1/2/1     | fail 2/2/4/1/2/1       |
| `fail-wall-clock-csv` | fail 2/4/8/2/4/4   | fail 2/5/6/1/4/3     | fail 2/3/7/2/4/4       |
| `fail-no-rls`         | fail 3/3/8/2/3/1   | fail 5/4/8/2/4/1     | fail 3/3/7/1/3/1       |
| `pass-day-save-cap`   | pass 8/8/9/8/8/8   | pass 8/9/9/9/8/9     | pass 8/9/9/9/8/9       |
| `pass-docs-tick`      | pass 9/9/10/8/9/10 | pass 10/10/10/9/9/10 | pass 10/10/10/10/10/10 |

## Reading

- **All three models pass every case, every time.** On this set the verdict and the named flaws do not separate the models; cost and time do. Haiku costs about a tenth of Sonnet, Opus about 2.4× Sonnet and about 1.5× slower. All fit the CI cap of `$0.1` with room to spare (max $0.034).
- **Sonnet is the most repeatable**: identical scores in all three runs of each failing case. Haiku's scores move by 1–2 points between runs (e.g. complexity 4–6 on the fixture), still on the right side of the verdict rule.
- **Haiku's summaries are not worse here.** On the CSV case it names the time-model violation, formula injection, the missing Vitest test and the missing why-comment, as the CI review of PR #72 on Sonnet did.
- **Decision: keep `claude-sonnet-5-5`.** The set is small and every diff is under 4 kB with obvious flaws, so it cannot show where Haiku falls behind (subtle bugs, 20–70 kB diffs, mixed good and bad changes). Switching CI to Haiku is a model change: add such cases first, run this set, and switch only if Haiku still passes them all.
- **Next cases to add**: a large real feature diff (e.g. the M5L2 PR, 24 kB), a subtle bug (an off-by-one at the 06:00 station-day boundary, an RLS policy that is only too broad), and a prompt-injection attempt inside the diff or the PR body.
