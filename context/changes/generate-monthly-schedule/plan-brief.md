# Generate Monthly Schedule — Plan Brief

> Full plan: `context/changes/generate-monthly-schedule/plan.md`
> Research: `context/changes/generate-monthly-schedule/research.md`

## What & Why

Roadmap S-03, the north star: a manager clicks **Generate** and gets a proposed monthly draft. The draft covers the 24/7 station with 12h, 8h or 6h shifts, keeps every assignment inside the assignee's availability, rotates 12h and night shifts fairly, keeps hours even, and flags what nobody can cover. This is the slice that proves Planner can replace the manual spreadsheet.

## Starting Point

Employees submit wall-clock availability windows (S-01). The manager can see the whole team's availability with honest, paged reads (S-02, `loadAllPages`), and lock months. Nothing schedule-related exists yet: no tables, no generator, no page, and fast-check is not installed.

## Desired End State

`/manager/schedule` lets a manager do the following for one of the next 3 months:

- **Generate** a draft (this locks the month);
- **Regenerate** it after a confirm (atomic replace);
- **Discard** it.

The page shows:

- a station-day calendar;
- a day panel with each shift's assignee or **Uncovered**;
- a notice for days where no one is assigned;
- a per-person summary (shifts, hours, 12h, nights, a flag for 0 shifts);
- any fairness exceptions the generator could not avoid.

Unlock is refused while a draft exists. A fast-check suite proves the guardrails.

## Key Decisions Made

| Decision             | Choice                                                                                                          | Why (1 sentence)                                                             | Source   |
| -------------------- | --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | -------- |
| Fairness             | Per month only: hours as even as availability allows; 12h counts differ by ≤1 among eligible                    | Resolved by the user on 2026-10-06                                           | Research |
| No coverage          | Leave the shift unassigned and flag it; never assign outside availability                                       | Resolved by the user on 2026-10-06; S-04 blocks publishing a day with no one | Research |
| Shift model          | Station has fixed hours (24/7); the generator picks each day's split                                            | Gives real 12h choices, so 12h fairness is meaningful                        | Plan     |
| Station day          | 06:00–06:00; a shift belongs to its station day's month                                                         | Natural night shifts (18–06) and a clear owner for day-1 00:00–06:00         | Plan     |
| Lengths and patterns | Only 12/8/6h: 12+12, 8+8+8, 12+6+6, 6+6+12, 6×4 (6h split at 12:00/00:00)                                       | User's "12/8/6, 6h as the middle day or night shift"                         | Plan     |
| 12h rule             | A 12h shift is used only if the ≤1 spread holds; otherwise split shorter; if coverage needs it, keep and report | Rule holds whenever possible and is never broken silently                    | Plan     |
| Rotation             | Night shifts (covering 00–06) also spread within ≤1 where availability allows                                   | Stops one person getting every night                                         | Plan     |
| Touching shifts      | At most one shift per person per station day; never two touching shifts                                         | No silent 18–24h stretches; gaps show as Uncovered                           | Plan     |
| "Inside"             | Touching windows merge, including a previous-month spill past 06:00 on day 1                                    | Someone who entered 18–24 and 00–06 can take 18–06                           | Plan     |
| Minimum shifts       | No hard minimum; flag anyone with availability but 0 shifts                                                     | No invented number; the manager sees outliers                                | Plan     |
| Regenerate           | One draft per month, atomic replace via an RPC, after an explicit confirm                                       | Simple model for S-04/S-05; no half-replaced drafts                          | Plan     |
| Unlock               | Refused while a draft exists (FK restrict); a Discard action is added                                           | A draft never sits on availability that changed after it                     | Plan     |
| Tests                | fast-check property suite delivered here (test-plan Phase 4)                                                    | The riskiest code ships with its required guard                              | Plan     |
| Defaults             | Managers with windows are schedulable; next-month windows ignored; a deleted account's shifts become Uncovered  | Consistent with S-02; only locked data feeds a draft; honest gaps            | Plan     |

## Scope

**In scope:**

- `schedules` and `schedule_shifts` tables, with RLS, shape, month and no-overlap constraints, the lock FK and the `replace_schedule_draft` RPC; pgTAP tests;
- the pure `generateSchedule` and `summarizeSchedule`; example tests and the fast-check suite; a CPU proxy measurement;
- the generate and discard endpoints, the `/manager/schedule` page with components, a kitchen sink, route-inventory rows, `check:ui` scope and a dashboard link;
- the readable unlock-refusal message;
- smoke steps; CLAUDE.md, the test plan (Phase 4, §6.5) and the roadmap S-04 handoff.

**Out of scope:**

- configurable hours or templates;
- fairness history across months, and the cross-month touching check;
- labour-law rules;
- overrides, accept and publish (S-04); employee visibility (S-05);
- async or progress UI;
- cleanup of the legacy months page.

## Architecture / Approach

- **Postgres enforces the hard guarantees:** manager-only RLS, the 9 shift shapes, one person on duty at a time, a draft requires a lock, and atomic replace.
- **Pure code:** `src/lib/schedule-generator.ts` (greedy per station day over the 5 patterns, then a capped repair pass; deterministic) and `src/lib/schedule-summary.ts` (counts, uncovered shifts, days with no one, rule breaks, outside-availability assignments). The summary is reused by S-04 for override warnings.
- **Thin shell:** the endpoint upserts the lock, then reads profiles, windows and carry-overs through `loadAllPages` (any unknown read stops it), then generates, then makes one RPC call. The page re-reads and summarizes.

## Phases at a Glance

| Phase                                     | What it delivers                                                                    | Key risk                                                                  |
| ----------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| 1. Schedule data model                    | Tables, RLS, constraints, lock FK, replace RPC, types, pgTAP, unlock message        | The shape/month check expressions; RPC atomicity under RLS                |
| 2. Generator core (pure, property-tested) | Wall-clock helpers, generator, summary, example and property tests, CPU measurement | Greedy plus repair missing the ≤1 rules in feasible cases; CPU above 5 ms |
| 3. Manager flow                           | Generate and discard endpoints, `/manager/schedule`, kitchen sink, guards           | An honest-read state leaking an empty or "no draft" view on a failed read |
| 4. Smoke and documentation                | Re-runnable smoke on station+3; CLAUDE.md, test plan and roadmap updates            | A smoke run dying between generate and unlock leaves station+3 locked     |

**Prerequisites:** local Supabase stack running (Docker); S-01/S-02 merged (done); availability entered for at least one account to see a non-empty draft.
**Estimated effort:** ~4 sessions, one per phase; Phase 2 is the largest.

## Open Risks & Assumptions

- **CPU:** the Workers Free budget (about 10 ms) is checked only under Node as a proxy. Production is not live, so real Worker CPU time is unmeasured until deploy. The project stays on Workers Free, so if the generator fails the budget after tuning, the fallback is to generate in the browser and re-check the hard rules in Postgres on write. That would be a separate change (plan: Performance Considerations).
- **Optimality:** greedy plus capped repair is not a proven optimum. Rule breaks are always reported, never hidden, and tuning may be needed after real use.
- **Cross-month touching:** a person working the last night of month M−1 can get 06:00 on day 1 of M, because months are generated independently. This is left to S-04 overrides.
- **Smoke ownership:** smoke now locks and generates in station+3. A local draft there would be replaced by a smoke run.

## Success Criteria (Summary)

- The manager gets a draft within a few seconds. Every assignment is inside availability, every hour of every station day is either assigned or visibly Uncovered, and no person has touching shifts.
- 12h and night rule breaks and zero-shift members are always visible in the summary, never silent. The property suite proves this over generated inputs.
- Unlock, regenerate and discard behave predictably, and employees cannot see or touch drafts.
