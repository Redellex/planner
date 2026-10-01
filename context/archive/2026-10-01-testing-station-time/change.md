---
change_id: testing-station-time
title: Test runner and station-time logic (test-plan rollout Phase 1)
status: archived
created: 2026-10-01
updated: 2026-10-01
archived_at: 2026-10-01T20:20:29Z
---

## Notes

Open a change folder for rollout Phase 1 of context/foundation/test-plan.md: "Test runner and station-time logic".
Risks covered: #1 (station wall-clock dates drift on the UTC Worker: wrong day/month, overnight window in the wrong month, wrong weekday-repeat dates, current station month flipping at the wrong moment around midnight or DST). Test types planned: unit (Vitest via Astro getViteConfig, run with TZ=UTC).
Risk response intent: #1 — prove correct day/month for independent calendar facts (DST days 2026-03-29 and 2026-10-25, overnight window from the last day of a month into day 1, February in leap year 2028, current station month just before/after midnight Warsaw time) with the process in TZ=UTC; challenge "passes in CET so it passes on the Worker"; avoid expected values computed with the helper under test.
After creating the folder, follow the downstream continuation rule.
