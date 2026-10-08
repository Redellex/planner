# Day-level save for manual assignments (S-08) — Plan Brief

> Full plan: `context/changes/schedule-day-save/plan.md`
> Research: `context/changes/schedule-day-save/research.md`

## What & Why

On `/manager/schedule` the manager picks who works each shift of a station day, but every shift has its own Save, so adjusting a day means 2–4 round trips. This change gives each day one Save that stores all of its changes at once, all-or-nothing, with the warnings of the combined change shown once before "Assign anyway" (roadmap S-08, MS-03).

## Starting Point

S-04 built a per-shift override: one form per row, an endpoint that updates one row through PostgREST, a warning diff keyed on one shift and a confirm step in the URL as `confirm=override&shift=&employee=`. The database allows only `employee_id` updates by a manager on an unpublished month; separate updates are separate transactions, and nothing checks the value the manager saw.

## Desired End State

An editable day panel is one form with one Save. Saving writes every changed assignee of the day in one database call or none of them. Two changes that conflict only with each other are warned about together, in one confirm panel that lists the pending changes and keeps the manager's picks in the selects. If the day changed underneath the manager, nothing is saved and the panel says so; saving with nothing changed says "No changes to save."

## Key Decisions Made

| Decision               | Choice                                                                                     | Why (1 sentence)                                                                  | Source          |
| ---------------------- | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- | --------------- |
| Warnings               | Computed on the whole day's change set, one confirm                                        | Catches same-day and back-to-back pairs between two changes (roadmap default a)   | Research / Plan |
| Stale rule             | Refuse the whole day if any row of the day differs from what the manager saw               | The manager never saves picks made against an outdated day (roadmap default b)    | Plan (user)     |
| Old per-shift Save     | Replaced in place at `/api/manager/schedule/override`                                      | One write path with one stale rule; route and status names stay                   | Plan (user)     |
| Save with no changes   | Neutral notice "No changes to save.", nothing written                                      | Never claims a save that did not happen                                           | Plan (user)     |
| Selects during confirm | Keep the pending picks; Assign anyway confirms only the listed set                         | The manager can adjust one pick without redoing the day, and FR-004 still holds   | Plan (user)     |
| Atomic write           | New SQL function `save_schedule_day` (SECURITY INVOKER, row locks, SP004)                  | PostgREST cannot do a multi-row update in one transaction with a seen-value check | Research        |
| URL/form encoding      | Every row as `<shift>:<was\|none>:<to\|none>` (`row=` in the URL, `confirmed` in the form) | ≤4 rows per day, so short; lets page and endpoint rebuild the same diff           | Plan            |
| Double submit          | A day already stored as requested redirects as saved                                       | The second click would otherwise say "This day changed" after a successful save   | Plan            |
| Assignee FK error      | 23503 from this call → "Invalid assignee"                                                  | Only the assignee FK can fail on an `employee_id` update                          | Research / Plan |

## Scope

**In scope:**

- `save_schedule_day` migration, its pgTAP file, regenerated types
- Warning diff over a change set; row codec, URL contract, messages, SP004 mapping; day form parsing helpers
- Endpoint rewrite, page confirm rebuild and day-level feedback, one-form day panel, kitchen sink
- Smoke day steps and CLAUDE.md

**Out of scope:**

- Cross-day concurrency guard / version token (S-04 F4 stays accepted)
- Per-row Save, client hydration, submit-button disabling
- Generator, summary rules, publish/unpublish, discard, the published `/schedule` view

## Architecture / Approach

The day form posts each row's shift id, the assignee the manager saw (`was`) and the pick (`to`). The endpoint reads everything in full, checks in order (draft, published, nothing changed, already saved, stale, unknown assignee), computes the combined warnings and either redirects to the confirm step or calls `save_schedule_day`. The function re-checks manager, draft, published state and the seen values under `FOR UPDATE` locks, updates the changed rows and raises SP004 if anything moved. RLS, the column grant and the publish guard trigger still apply to every row.

## Phases at a Glance

| Phase                           | What it delivers                                                | Key risk                                                                            |
| ------------------------------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| 1. Database: atomic day save    | `save_schedule_day` + pgTAP + types                             | Silent 0-row updates under RLS if the published and count checks are missed         |
| 2. Pure logic                   | Combined warnings, row codec, URL contract, form helpers, tests | 17 existing warning tests move to the set form without losing a case                |
| 3. Endpoint, page and day panel | The day save end to end + kitchen sink                          | Check order (idempotent before stale) and confirm acceptance only for the shown set |
| 4. Smoke and docs               | Smoke day steps, CLAUDE.md                                      | Smoke's stale step must not be answered by the idempotent check                     |

**Prerequisites:** local Supabase stack running (`npx supabase start`); S-04 override flow (done).
**Estimated effort:** ~2–3 sessions across 4 phases.

## Open Risks & Assumptions

- The guard trigger fires for updates inside the function (trigger depth 1); the pgTAP published case covers the RLS-first path, the publish race stays untestable in one session, as in S-04.
- A page still showing the old per-row forms after deploy gets "This day changed… Reload and try again.", which is the right advice.

## Success Criteria (Summary)

- A manager changes several shifts of one day and presses Save once; all changes are stored together or none are.
- Conflicts between the day's own changes are warned about once, in one confirm panel.
- A day changed by someone else is refused with a clear message, and nothing is overwritten.
