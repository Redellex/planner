---
change_id: testing-route-gating-honest-reads
title: "Test rollout Phase 3: route gating and honest availability reads"
status: impl_reviewed
created: 2026-10-03
updated: 2026-10-03
archived_at: null
---

## Notes

Open a change folder for rollout Phase 3 of context/foundation/test-plan.md: "Route gating and honest reads".
Risks covered: #4 (abuse) role and route control regresses after a middleware or role change; #6 a failed or truncated availability read is presented as "nobody submitted". Test types planned: unit + targeted smoke steps.
Risk response intent:
- #4: prove a route x role table holds (anonymous -> sign-in, employee -> 403 on manager pages AND manager endpoints, manager -> 200), an employee cannot change any role including their own, and the last manager cannot be demoted; challenge "the page is gated, so the POST endpoint behind it is gated too"; avoid mocking the whole Supabase client so the test only verifies the mock.
- #6: prove a forced read error or a month with more rows than one page never renders "No availability submitted" and the user sees a load error instead; challenge "an empty list means there is no data"; avoid an e2e test where a unit test on the read path catches the same regression.
After creating the folder, follow the downstream continuation rule.
