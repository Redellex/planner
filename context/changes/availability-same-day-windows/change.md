---
change_id: availability-same-day-windows
title: Fix a second same-day availability window replacing the first or reporting a false overlap
status: preparing
created: 2026-09-28
updated: 2026-09-29
archived_at: null
---

## Notes

— fix: a second availability window on the same day replaces the first or reports a false overlap (GitHub issue #16)

- Repro (user, Cloudflare preview of PR #15): Thu 12 Nov, add 11:00–13:00, then 13:30–14:50 → only one window shown, or "Overlaps an existing window".
- Ruled out (2026-09-28): the DB accepts both windows (local stack, PostgREST, both 201 and both listed), `buildWindow` is correct, and the page lists every window of the day.
- Display of two windows on one day works: `availability-ui-tokens/screenshots/after/availability-editable.png` (Thu 5 Nov, 08–12 and 16:30–20). Those rows were inserted directly for the capture, not through the form.
- User hypothesis: a display issue; "we never did 2 inputs for the same day". Adding a second window through the form was never exercised: smoke adds one window per day.
- Leading suspect: each saved window renders as editable time fields plus Save, right above the identical-looking Add fields. Typing there and pressing Save updates the first window (→ "only one").
- Pending check: on the preview, enter the second window in the empty "Add window" fields and press Add, then note the URL (`updated=1` or `error=…`).
