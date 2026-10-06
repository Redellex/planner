---
change_id: generate-monthly-schedule
title: Generate monthly schedule
status: implemented
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

### Phase 3 — notes for Phase 4 and follow-ups (2026-10-06)

- Smoke: the generate redirect puts the status param first (`/manager/schedule?generated=1&month=YYYY-MM`); match on `generated=1`, not a `&generated=1` suffix. The draft panel carries `data-schedule-draft` as a smoke marker.
- `UNLOCK_WITH_DRAFT_ERROR` is shown only on `/manager/months`; it is not in `SCHEDULE_FEEDBACK_ERRORS`.
- Follow-up (generator, Phase 2): in the kitchen-sink gaps fixture (4 people all month, one uncovered night, one empty day) `summarizeSchedule` reports 8 night-rule breaks (Erin 8 nights, lowest 6); one move might balance it to 7/7/7/7 if not blocked. Investigate whether the repair pass is weaker than intended.
- Follow-up (product): a shift is assigned only when one window covers the whole fixed-time shift (shortest 6h). During manual testing, short windows (3–4h, e.g. 14:25–17:25) left every shift Uncovered. Consider a separate change: show shift times as a hint on the availability form, or allow shorter shifts.
- Local test data only (gone on `npx supabase db reset`): `anna@example.com` and `bartek@example.com` (password `Test-Passw0rd!`, ids …0003/…0004) with November 2026 availability, 4 extra aligned windows for the seeded employee, and a November 2026 draft (month locked).
