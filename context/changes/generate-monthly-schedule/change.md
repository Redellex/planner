---
change_id: generate-monthly-schedule
title: Generate monthly schedule
status: implementing
created: 2026-10-06
updated: 2026-10-06
archived_at: null
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
