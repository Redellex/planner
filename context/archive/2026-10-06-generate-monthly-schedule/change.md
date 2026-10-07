---
change_id: generate-monthly-schedule
title: Generate monthly schedule
status: archived
created: 2026-10-06
updated: 2026-10-06
archived_at: 2026-10-06T19:57:00Z
---

## Notes

<!-- Free-form notes for this change: links, ad-hoc context, decisions that don't belong in research/frame/plan. -->

### Phase 2 — CPU proxy (Node, 2026-10-06)

`generateSchedule` on the 40-person fixture (fragmented windows over 31 days, October DST switch included):

- Median 1.2–1.4 ms, p95 1.4–1.6 ms (under the 5 ms bar).
- Dense case (everyone available all month): median 3.2 ms, p95 3.5 ms.
- Cold first run in a fresh process (before JIT warm-up): about 7 ms. A generate request may hit a cold-ish Worker isolate, which leaves about 3 ms of the 10 ms Workers Free budget for the rest of the request. Re-check on real Worker CPU time after deploy.

### Phase 2 — accepted adaptations to the plan's examples

- "A and B available all month: no uncovered, no breaks" is impossible (two people covering 24/7 force one onto every night). Split into: A–D all month (no uncovered, no breaks) and only A+B (full coverage, all 30 night breaks reported).
- The 12h-rule 6+6 split only happens when B is blocked (e.g. worked the night before); if B is free, B gets the 12h shift.
- The repair pass also does same-day swaps, accepted only when the sum of squared 12h and night counts strictly drops; still capped at the number of shifts.
- One fill pass after repair assigns still-uncovered shifts to anyone the repair freed.

### Phase 3 — notes for Phase 4 and follow-ups (2026-10-06)

- Smoke: the generate redirect puts the status param first (`/manager/schedule?generated=1&month=YYYY-MM`); match on `generated=1`, not a `&generated=1` suffix. The draft panel carries `data-schedule-draft` as a smoke marker.
- `UNLOCK_WITH_DRAFT_ERROR` is shown only on `/manager/months`; it is not in `SCHEDULE_FEEDBACK_ERRORS`.
- Follow-up (generator, Phase 2): in the kitchen-sink gaps fixture (4 people all month, one uncovered night, one empty day) `summarizeSchedule` reports 8 night-rule breaks (Erin 8 nights, lowest 6); one move might balance it to 7/7/7/7 if not blocked. Investigate whether the repair pass is weaker than intended.
- Follow-up (product): a shift is assigned only when one window covers the whole fixed-time shift (shortest 6h). During manual testing, short windows (3–4h, e.g. 14:25–17:25) left every shift Uncovered. Consider a separate change: show shift times as a hint on the availability form, or allow shorter shifts.
- Local test data only (gone on `npx supabase db reset`): `anna@example.com` and `bartek@example.com` (password `Test-Passw0rd!`, ids …0003/…0004) with November 2026 availability, 4 extra aligned windows for the seeded employee, and a November 2026 draft (month locked).

### After Phase 4 — mixed-team case and two generator fixes (2026-10-06)

- New hand-written case (user-requested): 2 full-timers, 3 part-timers on 12:00–18:00, a manager with no availability, and 2 days nobody is available (`schedule-generator.test.ts`).
- It showed every part-timer at 0 shifts and one person on all 28 nights. Two fixes in `schedule-generator.ts`, departing from the plan's Phase 2 contract wording:
  - the pattern score's "even hours" is the sum of squared hours, not the plan's "spread" (max − min), which ignores a gain while anyone else is still at 0;
  - in the most-constrained-first order, a tie fills the night first, so after a day off for everyone the night run goes to whoever has fewer nights.
- Result on that case: part-timers 2/1/2 shifts, nights 19/9 (was 28/0). The full unit and property suites pass, and the CPU proxy is unchanged (median 1.5 ms fragmented, 3.5 ms dense).

### Impl review F1 — the month's last station night (2026-10-06)

- Reverses the plan's "Next-month windows" non-goal. Calendar-day availability (00:00–00:00) left every month's last night (M+1-01 00:00–06:00) uncovered.
- New migration `20261006130000_lock_last_station_night_windows.sql`: every availability write policy also requires the month of `starts_at - 6h` to be editable. A window starting on day 1 before 06:00 therefore freezes with the previous month (pgTAP `availability_station_night.test.sql`). `/availability` shows such windows read-only on day 1, with a notice.
- `loadScheduleInputs` also reads M+1 windows starting before 06:00 on day 1, and M−1's draft shift ending at `M-01 06:00` (`previousNight`).
- `generateSchedule` blocks that assignee from 06:00 on day 1. `summarizeSchedule` reports `touchesPreviousNight` when M−1's draft changed later. `/manager/schedule` shows M−1's last night on day 1.
- The property suite now draws day-1 night windows and an optional previous-night assignee. Disabling the block makes properties 3 and 5 fail with a seed.

### Impl review F2/F3 (2026-10-06)

- F2: a one-day lookahead (`nextMorningLoss`) keeps a night off the only person eligible for the next day's 06:00 start, both in the night's candidate order and as a pattern score right after uncovered minutes. It has a regression test.
- F3, on 40 people × a 00:00–00:00 window every day (1,200 windows):
  - Warm median: 3.7 → ~1.3 ms. Cold first call: 13–15 → ~9.5 ms. Summary cold: 5.5 → ~3.5 ms. All under Node, in the scratchpad.
  - Changes: a fixed-position `wallClockMinutes` parse and an eligibility bitmap for the greedy candidate count.
  - The rest of the cold cost is V8 warm-up. Check `cpuTime` with `wrangler tail` after deploy.
