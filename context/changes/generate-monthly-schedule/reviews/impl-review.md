<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Generate Monthly Schedule

- **Plan**: context/changes/generate-monthly-schedule/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2, 3, 4
- **Date**: 2026-10-06
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 6 warnings, 4 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | PASS    |
| Safety & Quality    | WARNING |
| Architecture        | WARNING |
| Pattern Consistency | WARNING |
| Success Criteria    | PASS    |

Automated checks re-run on 1dcc5ee:

- Passed: `npm ls fast-check` (4.10.2), `npm test` (219 tests), `npm run lint`, `npx astro check` (0/0/0), `npm run check:ui`, `prettier --check` on the docs, and `npm run test:db` (4 files, 133 tests).
- Not re-run: `npm run smoke`. `.dev.vars` and `.env` point at the hosted project. The last recorded pass is at 451e666.

## Findings

### F1 — The last station night of every month is uncovered for calendar-day availability

- **Severity**: ⚠️ WARNING
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Architecture
- **Location**: src/lib/schedule.ts:195-208 (loadScheduleInputs); plan "What We're NOT Doing" → "Next-month windows"
- **Detail**:
  - The plan does not read windows that start in M+1. Its reason: M+1 is not locked, so they could still change.
  - But the last station night ends at M+1-01 06:00. Anyone who enters availability per calendar date (e.g. 00:00–00:00 full days, which `/availability` supports) can never be eligible for it.
  - Reproduced: 40 people with a 00:00–00:00 window on every November date. The only uncovered shift is `2026-12-01T00:00–06:00`. It does not trip `daysWithNoOne`, because other shifts that day are assigned.
  - Property 6 builds its fixtures so that no window starts in M+1, so it hides the case.
  - Result: under natural input, every month's draft has one uncovered shift that S-04 must fix by hand.
- **Fix A ⭐ Recommended**: Treat windows starting in [M+1-01 00:00, 06:00) as part of month M for editability, and read them.
  - Add an RLS editability check on `date_trunc('month', starts_at - interval '6 hours')`, next to the existing starts_at/ends_at checks.
  - Read `starts_at >= M+1-01 AND < M+1-01T06:00` in `loadScheduleInputs`.
  - Add a pgTAP test (such a window is refused once M is locked) and widen the property arbitraries.
  - Strength: matches the station-day model the shift tables already use (`month = date_trunc('month', starts_at - 6h)`). The lock then protects every window the generator reads.
  - Tradeoff: changes the employee write rules (a migration plus pgTAP), and reverses an explicit plan decision.
  - Confidence: MED — the RLS shape follows `20260926140000_harden_availability_writes.sql`, but it touches a shipped rule.
  - Blind spot: smoke leaves windows on day 1 of station+12 / station+3. Check that no smoke month's previous month is locked during the run.
- **Fix B**: Keep the decision and make it visible.
  - Add a hint on `/availability` ("for the last night of a month, enter a window starting on the last day").
  - Add a line on `/manager/schedule` explaining why the last night is uncovered.
  - Record it as a known limitation in CLAUDE.md and the roadmap S-04 handoff.
  - Strength: no change to the database rules; small.
  - Tradeoff: the uncovered last night stays the norm, and it relies on people reading a hint.
  - Confidence: HIGH — copy-only change.
  - Blind spot: whether employees will actually change how they enter availability.
- **Decision**: FIXED via Fix A, extended at the user's request so the next month notices the shift: M+1 generation blocks M's last-night assignee from 06:00 on day 1, `/manager/schedule` shows that night on day 1, and `summarizeSchedule.touchesPreviousNight` reports a later conflict (see change.md "Impl review F1").

### F2 — The greedy pass can leave a shift uncovered that a different choice would have covered (priority 1)

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/lib/schedule-generator.ts:281-344 (simulate), :251-259 (candidateBefore)
- **Detail**:
  - The plan's first priority is "cover as many hours as possible", but each station day is decided with no look at the next one.
  - Reproduced (November 2026). A has two touching windows, 03 18:00 → 04 06:00 and 04 06:00 → 04 18:00, merged into one span. B is available only 03 18:00 → 04 06:00.
  - On day 3 the generator splits the night (B 18–24, A 00–06), because the sum of squared hours is lower. That blocks A from 06:00 on day 4.
  - Coverage is 18h. The best possible is 24h (B 18–06, then A 06–18).
  - Property 4 only checks that every eligible person is blocked, and A is blocked, so the suites pass.
  - CLAUDE.md's "a shift stays uncovered only when every eligible person is blocked" is literally true here, but it reads as "nothing could be covered".
- **Fix A ⭐ Recommended**: Add a one-day lookahead to the night choice, and keep the repro as a regression test.
  - In `simulate`, rank a night-shift candidate who is the only remaining candidate for a next-day 06:00 shape after the others.
  - Score that lost next-morning coverage right after `uncoveredMinutes`.
  - Strength: cheap (≤3 shapes × eligible per day); targets the only cross-day coupling the model has (night of D vs 06:00 of D+1).
  - Tradeoff: still not a global optimum; slightly more scoring logic in the hot loop.
  - Confidence: MED — handles the repro; longer chains are not proven.
  - Blind spot: interaction with the night-rule fairness order in dense teams. Re-run the property suite and the mixed-team case.
- **Fix B**: Document that coverage is optimal per day, not per month.
  - Correct the wording in CLAUDE.md and roadmap.md, and add a follow-up.
  - Strength: no algorithm risk now.
  - Tradeoff: avoidable Uncovered shifts reach managers; S-04 must fix them by hand.
  - Confidence: HIGH.
  - Blind spot: how often real availability produces this pattern.
- **Decision**: FIXED via Fix A: `nextMorningLoss` ranks the night candidates and scores patterns right after uncovered minutes; the repro is a regression test in schedule-generator.test.ts and fails with the lookahead disabled.

### F3 — CPU cost is above the Workers Free budget on a cold isolate with realistic windows

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/lib/availability.ts (wallClockMinutes), src/lib/schedule-generator.ts:100-123, src/pages/manager/schedule.astro:83-121
- **Detail**:
  - change.md records a 1.2–1.5 ms median (fragmented windows), 3.5 ms dense, and about 7 ms cold.
  - With 40 people × one 00:00–00:00 window per day (1,200 windows): warm median 3.6 ms, first call 13–15 ms (two independent measurements), and the summary about 5 ms cold.
  - Timestamp parsing (string split/map) in `mergeAvailability` dominates.
  - `/manager/schedule` parses every window again for `summarizeSchedule` on each render, and loads the windows even when there is no draft.
  - With 100 people, it is about 12 ms warm.
  - The project must stay on Workers Free (10 ms).
- **Fix**: Make `wallClockMinutes` parse at fixed offsets with no allocation, skip the window reads and summary when there is no draft, and check real `cpuTime` in `wrangler tail` after deploy.
  - Strength: attacks the measured hot spot without changing the algorithm; the page saves the most.
  - Tradeoff: the parser becomes stricter about input format (DB timestamps are already uniform).
  - Confidence: MED — the parse share was measured; the cold JIT share on Workers is unknown.
  - Blind spot: how Workers counts CPU for a cold isolate's first compile; this was measured only under Node.
- **Decision**: FIXED (partly). `wallClockMinutes` now parses by fixed position, and the greedy pass counts free candidates with an eligibility bitmap. On the 1,200-window case: warm 3.7 → ~1.3 ms, first call 13–15 → ~9.5 ms, summary cold 5.5 → ~3.5 ms (Node). Not done: skipping the `/manager/schedule` window read without a draft. The summary already runs only with a draft, and the saving (<1 ms of JSON parse) is not worth an extra sequential round trip on every draft view. Still to do after deploy: check real `cpuTime` with `wrangler tail`.

### F4 — Table-level UPDATE is still granted on both new tables, and the S-04 handoff says otherwise

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: supabase/migrations/20261006120000_create_schedules.sql:95-100; context/foundation/roadmap.md:139
- **Detail**:
  - The migration revokes only INSERT. `information_schema.role_table_grants` shows UPDATE for `authenticated` and `anon` on `schedules` and `schedule_shifts`.
  - The earlier migrations revoke update and grant columns (profiles, availability_windows).
  - It is harmless today (RLS on, no update policy).
  - The roadmap tells S-04 there is no update column grant and to "grant only employee_id". Following that literally would leave month/starts_at/ends_at updatable.
  - The pgTAP file also has no anon block and no privilege assertion, e.g. on `replace_schedule_draft` execute for anon, unlike the other test files.
- **Fix**: Add a follow-up migration `revoke update on public.schedules, public.schedule_shifts from authenticated, anon;`, plus pgTAP privilege/anon assertions, and correct the roadmap note.
- **Decision**: FIXED. `20261006140000_revoke_schedule_updates.sql` revokes UPDATE on both tables from authenticated and anon. `schedules.test.sql` gains 8 assertions: no UPDATE privileges, no anon execute on the RPC, and anon reads nothing (with a control). The roadmap and CLAUDE.md notes are corrected.

### F5 — The kitchen sink runs the generator on every production request

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/pages/dev/schedule-states.astro:85-106
- **Detail**:
  - The 404 guard only sets the status (:36). The frontmatter still runs `generateSchedule` ×2 and `summarizeSchedule` ×2.
  - `/dev/schedule-states` is a public route, so any anonymous request burns Worker CPU before returning an empty 404.
  - The other kitchen sinks only build static fixtures.
- **Fix**: Build the generated fixtures only inside `if (isDev)` (or lazily in the dev-only branch).
- **Decision**: FIXED. `generateSchedule` runs only when `isDev`; outside dev the views summarize empty fixtures (trivial cost).

### F6 — Smoke discards a pre-existing draft and unlocks a manager-locked month when its precondition fails

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: scripts/smoke.mjs:286-320 (loop at 328-343 continues after failures)
- **Detail**:
  - Case 1: station+3 already has a draft (a real one, or one left by a dead run). "no draft" fails, then generate is refused with the confirm error, and the script still discards that draft and unlocks the month.
  - Case 2: the month was only locked. The script generates, discards and unlocks a month a manager locked.
  - Memory notes say the smoke env is sometimes pointed at the hosted project.
- **Fix**: Abort the schedule block (or the run) when the "no draft / month open" precondition fails, so the destructive steps never run against unexpected state.
- **Decision**: FIXED. The "no draft, month open" step is a gate (`{ gate: "scheduleMonthClean" }`). When it fails, generate, show, refused unlock, discard and unlock are skipped as SKIP and counted as failures. Checked against a dead port; CLAUDE.md recovery note updated.

### F7 — Generate error messages misreport a few edge cases

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/manager/schedule/generate.ts:33-66; src/lib/schedule.ts:68-79
- **Detail**:
  - A double submit, or two managers generating at once, passes the existing-draft check twice. The second RPC hits 23505 and shows "Could not save the schedule", although a draft was saved.
  - A 23503 from `employee_id` (a profile deleted mid-generate) shows "The month was unlocked".
  - A failed generate leaves the month locked, but `GENERATE_LOAD_ERROR` doesn't say so.
- **Fix**: Map 23505 to `CONFIRM_REPLACE_ERROR`, and add "The month stays locked." to `GENERATE_LOAD_ERROR`.
- **Decision**: FIXED. `describeScheduleWriteError` maps 23505 to `CONFIRM_REPLACE_ERROR` (tested), and `GENERATE_LOAD_ERROR` now ends "the month stays locked". The 23503-from-a-deleted-profile case was left as is (rare, harmless).

### F8 — The repair pass repeats failed work and is weaker than intended

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/schedule-generator.ts:410-484
- **Detail**:
  - Each iteration rescans from day 0 and calls `tryMoveOff` once per position of a breaking member, repeating identical failed calls with `eligible[...].includes` (O(members)).
  - Theoretical worst case: cap × positions × days × members². A hill-climb search found low practical cost (median ~3.6 ms).
  - The gaps fixture still shows 8 night breaks where 7/7/7/7 looks reachable (change.md follow-up).
- **Fix**: Remember the members that failed in this iteration and use a Uint8Array eligibility bitmap. Investigate the gaps-fixture follow-up separately.
- **Decision**: FIXED. Failed `tryMoveOff` attempts are remembered per iteration (by person and kind; the result depends only on the schedule, so the behaviour is the same). Swap eligibility uses the eligibility bitmap. The gaps-fixture investigation stays as the existing follow-up in change.md.

### F9 — Postgres does not restrict drafts to upcoming months

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architecture
- **Location**: supabase/migrations/20261006120000_create_schedules.sql:59-123
- **Detail**:
  - Only the endpoint enforces `generatableMonths()`.
  - A manager calling PostgREST directly can lock any month (the locks policy has no month bound) and write a draft for a past or the current month.
  - It is manager-only, but CLAUDE.md calls Postgres "the real enforcement".
- **Fix**: Document in CLAUDE.md that the month window is an app-level rule for managers (or add a month check to the insert policies if S-04 needs it).
- **Decision**: FIXED (documented). CLAUDE.md Schedule → RLS now states that the generatable-month window is app-level only (generate endpoint); the database does not bound draft months for managers.

### F10 — Small documentation and verification slips

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/pages/dev/schedule-states.astro:108-109; plan.md Phase 2 §6; schedule-generator.test.ts:208
- **Detail**:
  - The kitchen-sink comment says rule breaks "cannot come from the generator". They do (the A+B case, the gaps fixture).
  - The CPU medians are in change.md, not in the plan's Phase 2 notes as the plan asks.
  - The touching example is weaker than the plan's wording (A also gets 12–18 on day 5). Its assertions are still correct.
  - The pgTAP sabotage pass for schedules.test.sql was skipped by decision (test-plan §6.6).
- **Fix**: Correct the kitchen-sink comment; leave the rest as recorded.
- **Decision**: FIXED (comment). The kitchen-sink comment no longer claims rule breaks cannot come from the generator; the other slips stay as recorded.
