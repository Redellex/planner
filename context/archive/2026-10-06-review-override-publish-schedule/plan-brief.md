# S-04: Review, override and publish schedule — Plan Brief

> Full plan: `context/changes/review-override-publish-schedule/plan.md`
> Research: `context/changes/review-override-publish-schedule/research.md`

## What & Why

The manager can generate a draft (S-03) but cannot change it or publish it. S-04 lets the manager change the assignee of any shift (FR-005) and warns about every problem the change would cause, requiring an explicit confirmation (FR-004). It also lets them publish the month (FR-006). Publishing is refused while any station day has no one assigned (`prd.md:103`).

## Starting Point

- **Database.** The schedule tables have no update path and no published state: UPDATE is revoked, and there are no columns for either. A regenerate or a discard would silently erase any future published month.
- **Summary.** `summarizeSchedule` already reports availability conflicts, fairness breaks and days with no one. It misses three per-person hard rules: one shift per station day, back-to-back shifts, and M's last night touching M+1's 06:00 shift on day 1.

## Desired End State

**Overriding a shift**

- Every shift in `/manager/schedule`'s day panel has a "Who" select.
- A change with no consequences saves at once, with feedback in that row.
- Any other change first shows a confirm panel at the shift that lists each new problem:
  - outside availability
  - second shift that day
  - back to back, including across months
  - a new 12h or night fairness break
  - a day left with no one

**Publishing**

- Publish appears only when every day has someone.
- A published month is frozen: no overrides, regenerate, discard or unlock, enforced by the app and by Postgres.
- **Unpublish** turns it back into a draft.

## Key Decisions Made

| Decision                | Choice                                                                                 | Why (1 sentence)                                                                                         | Source   |
| ----------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | -------- |
| Accept vs publish       | Same action; states are draft and published                                            | Nothing in the PRD or roadmap gives "accepted" its own behaviour.                                        | Plan     |
| Published month         | Frozen; **Unpublish** returns it to draft; the month stays locked                       | Employees never see a silent change, and smoke and manual runs have a teardown path.                     | Plan     |
| Override scope          | Assignee only, Uncovered allowed                                                       | A single-column UPDATE with an `employee_id` grant, as the S-03 handoff anticipated.                     | Plan     |
| Hard-rule breaks        | Warn + confirm, not block                                                              | PRD non-goal: the manager owns rest-period compliance; FR-004 favours warning over blocking.             | Plan     |
| Fairness breaks         | New breaks join the confirm panel (before/after diff)                                  | The manager sees every consequence before saving.                                                        | Plan     |
| Publish blocker         | `publish_schedule` RPC checks coverage in SQL; endpoint pre-checks for the message     | Postgres is the real enforcement here; a direct PostgREST call cannot publish a day with no one.         | Plan     |
| Freeze mechanism        | RLS + SQLSTATE in `replace_schedule_draft`; SECURITY DEFINER publish/unpublish RPCs     | No UPDATE grant on `schedules`, and superuser fixtures and foreign-key actions keep working.             | Plan     |
| Employee reads          | Left to S-05                                                                           | Keeps S-04 focused; S-05 designs the read path for other people's names together with the grid.          | Plan     |
| Audit                   | `published_at` / `published_by` only                                                   | The state column doubles as the record; the PRD declines override reasons.                               | Plan     |
| Assignee list           | Every profile, managers included                                                       | Managers can submit availability; the summary already flags an assignee without windows.                 | Plan     |
| Missing hard-rule checks | Extend `summarizeSchedule` and read M+1's first morning shift                          | One validator for the card, the confirm panel and the endpoint.                                          | Research |

## Scope

**In scope:**

- Migration: published columns, the override grant and policy, the freeze, the publish and unpublish RPCs
- pgTAP tests
- Hard-rule fields in the summary and the `nextMorning` read
- The override-warning diff
- The override, publish and unpublish endpoints
- UI: the day panel, the draft card and the summary card
- Kitchen sink, route rows, smoke and CLAUDE.md

**Out of scope:**

- A separate "accepted" state
- Changing a day's pattern
- Employee read policies and names (S-05)
- Override audit
- Generator changes
- Live edits on a published month
- A publish confirm panel
- A successful publish in smoke

## Architecture / Approach

Postgres stays the real enforcement:

- RLS keeps every write out of a published month.
- `replace_schedule_draft` raises `SP001` for a published month.
- `publish_schedule` checks coverage (`SP003`). It counts the distinct station dates (`starts_at - 6h`) of assigned shifts against the number of days in the month.

The endpoints follow the existing form POST + redirect pattern with allow-listed messages. Each one recomputes everything from a full read. The override warnings are a pure diff of `summarizeSchedule` before and after the one change (`src/lib/schedule-override.ts`). The endpoint and the page compute it the same way. The page only rebuilds the confirm panel from the `shift` and `employee` ids in the URL and does not trust anything else in it.

## Phases at a Glance

| Phase                                 | What it delivers                                                                           | Key risk                                                                    |
| ------------------------------------- | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| 1. Database — publish & override path | Columns, grant and policies, freeze, publish/unpublish RPCs, pgTAP, fixed availability tests | SQL coverage rule drifting from `daysWithNoOne` at the 00:00–06:00 boundary |
| 2. Validation library                 | Hard-rule summary fields, `nextMorning` read, override diff, messages and URLs, unit tests  | Fairness diff noise from breaks shifting onto third people                  |
| 3. Override — endpoint & day panel    | Per-shift select, warn → confirm → save, per-row feedback, hard-rule section, smoke         | Confirm panel and endpoint disagreeing if they don't share the diff         |
| 4. Publish & unpublish                | Endpoints, published card, generate/discard/unlock refusals, smoke, CLAUDE.md               | Changing a smoke-matched redirect by accident                               |

**Prerequisites:** S-03 merged (done); local Supabase stack with `seed.sql` (demo team in station month + 1).
**Estimated effort:** ~3–4 sessions across 4 phases.

## Open Risks & Assumptions

- **Regenerate can still create a cross-month conflict.** A regenerate of M after M+1 exists can still create a `touchesNextMorning` conflict. It is reported in the summary and fixed by an override, not prevented by the generator.
- **A publish can race an override.** An override saved at the same moment as a publish could leave a day with no one inside a published month. At one-manager scale this is accepted, and the summary would show it.
- **A deleted account opens a gap.** Deleting an account sets its published shifts to Uncovered, through `on delete set null`, which bypasses RLS. A published month can then show a day with no one; the summary reports it.

## Success Criteria (Summary)

- A manager can fix every Uncovered shift and fairness break in a demo draft by override, seeing and confirming each problem before it is saved.
- Publish is impossible, through both the UI and PostgREST, while a day has no one. Once published, nothing changes the month until it is unpublished.
- `npm test`, `npm run test:db` and `npm run smoke` all pass with the new steps.
