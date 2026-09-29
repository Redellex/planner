# Frame Brief: Second same-day availability window

> Framing step before /10x-plan. This document captures what is *actually*
> at issue, separated from what was initially assumed.

## Reported Observation

On `/availability` (Cloudflare preview of PR #15), Thu 12 Nov 2026: after
saving 11:00–13:00, entering 13:30–14:50 as a second window left only one
window on the day, or showed "Overlaps an existing window" (GitHub issue #16).

## Initial Framing (preserved)

- **User's stated cause or approach**: a UI problem, not data. Each saved
  window renders as editable time fields plus **Save**, directly above
  identical-looking "Add window" fields. Typing the second window into the
  saved row and pressing Save replaces the first window. The overlap variant
  was unexplained.
- **User's proposed direction**: show saved windows read-only with explicit
  Edit / Delete, keep the add form visually separate, reproduce the overlap
  variant, and add a smoke step for two windows on one day.
- **Pre-dispatch narrowing**: the user answered in their own words: "I think
  it works fine. I just made a mistake." When asked which mistake: "I have
  used edit form instead of add new".

## Dimension Map

1. **Storage / constraints**: the DB rejects or drops a second window.
2. **Window building / request parsing**: wrong `starts_at` / `ends_at`
   reaches the insert (e.g. a 12h/AM-PM entry saved as `11:00–01:00 (+1)`,
   which would really overlap 13:30–14:50).
3. **Page read / grouping**: the page fails to list a second window on a day.
4. **Form affordance**: the edit row looks like the add form, so the user
   enters the new window there and Save runs an update. ← initial framing

## Hypothesis Investigation

| Hypothesis | Evidence | Verdict |
| --- | --- | --- |
| 1. Storage rejects a 2nd window | Issue #16 "ruled out": both PostgREST inserts return 201 and both rows are listed; `availability_windows_no_overlap` uses half-open ranges | NONE |
| 2. Wrong times built | `buildWindow("2026-11-12","13:30","14:50")` is correct (`src/lib/availability.ts:110`); the user did not report an AM/PM or wrong-time entry | NONE |
| 3. Page drops a window | Month query has no limit and groups by `dateOf(starts_at)` (`src/pages/availability.astro:54-60,97-101`); two windows on one day render (`availability-ui-tokens/screenshots/after/availability-editable.png`) | NONE |
| 4. Edit row mistaken for Add | Saved rows are two `Input type="time"` fields plus Save posting to `/api/availability/update` (`src/components/availability/DayPanel.astro:77-110`), right above the Add fields (`:127-161`); update replaces times on the same row (`src/pages/api/availability/update.ts:61-67`); **user confirms they used the edit form** | STRONG |

## Narrowing Signals

- The user says the feature works and the failure was their mistake: they
  typed into a saved window's fields instead of "Add window". That explains
  "only one window" exactly (update, not insert).
- The overlap variant was not reproduced and has no report of its own. The
  user's account does not mention it. Treat it as unconfirmed, not as a
  second bug.

## Cross-System Convention

Lists of saved items conventionally render as read-only text with explicit
Edit / Delete actions, with a single, visually distinct place to create new
items. The current day panel shows every saved row in edit mode by default,
so edit and add look the same. That is the affordance the user tripped on.

## Reframed (or Confirmed) Problem Statement

> **The actual problem to plan around is**: there is no data or logic
> defect. The day panel renders saved windows as always-editable fields that
> look like the add form, so a user can overwrite a window when they meant
> to add one.

The initial framing was correct. Both windows save and display when added
through "Add window". The only real issue is the UX affordance (a silent
overwrite through a look-alike form). Whether that is worth changing is a
product choice, not a bug fix.

## Confidence

**HIGH** for "no functional defect; the edit form was used by mistake" (DB,
building and read paths verified; the user confirms the mistake). The overlap
variant stays **unverified**. If it is seen again, capture the `?error=` URL
and that day's rows before opening a new change.

## What Changes for /10x-plan

There is no bug fix to plan. If the change continues, it is a small UX change
to the day panel: separate viewing saved windows from editing them, so edit
and add cannot be confused, plus optionally a smoke step that adds two windows
on one day. Otherwise close issue #16 as "not a bug / user error" and archive
this change.

## References

- Source files: `src/components/availability/DayPanel.astro:77-161`,
  `src/pages/api/availability/update.ts:61-67`,
  `src/pages/api/availability/create.ts:30-40`, `src/lib/availability.ts:110`,
  `src/pages/availability.astro:54-101`
- Issue: GitHub #16. Roadmap row: `context/foundation/roadmap.md:157`
- Investigation tasks: none spawned; Step 3 was skipped because the user's
  confirmation plus the ruled-out checks in issue #16 were conclusive.
