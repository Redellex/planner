---
project: Planner
version: 1
status: draft
created: 2026-09-24
updated: 2026-10-08
prd_version: 1
main_goal: speed
top_blocker: capacity
milestone_id: first-valid-monthly-schedule
milestone_seq: 1
milestone_status: open
---

# Roadmap: Planner

> Derived from `context/foundation/prd.md` (v1) + auto-researched codebase baseline.
> Edit-in-place; archive when superseded.
> Slices below are listed in dependency order. The "At a glance" table is the index.

## Milestone

**M-1: First valid monthly schedule** — Status: open

- **Intent:** Ship the full must-have path — a manager can generate a conflict-free, fairly-rotated monthly shift schedule from employee availability, override it, publish it, and everyone can see the result.
- **Source materials:** `context/foundation/prd.md` (v1)
- **Done when:** every F-NN and S-NN below is `done`.
- **Scope anchors:** FR-001–FR-007, US-01, PRD `## Access Control`.

## Vision recap

A gas-station manager currently builds the monthly shift schedule by hand in a spreadsheet, juggling every employee's availability windows and trying to keep long-shift rotation fair — slow, error-prone, and mentally taxing. Generic calendar tools don't model shift-rotation and fairness rules, so the spreadsheet stays the default. Planner's job is to make the schedule-generation step itself trustworthy and fast.

## North star

**S-03: Manager generates a proposed monthly schedule respecting availability and rotating long shifts fairly** — this is the smallest end-to-end slice that, if it works, proves the core hypothesis: that Planner can replace the manual spreadsheet, not just digitize it.

> "North star" here means the smallest end-to-end user-visible flow that would prove Planner's core value — everything else in this milestone only matters if this works, so it's sequenced as early as its data dependency allows rather than last.

## At a glance

| ID   | Change ID                        | Outcome (user can …)                                                                  | Prerequisites | PRD refs                       | Status |
| ---- | -------------------------------- | ------------------------------------------------------------------------------------- | ------------- | ------------------------------ | ------ |
| F-01 | role-aware-access-control        | (foundation) Manager/Employee roles exist and are enforced at the auth layer          | —             | Access Control, FR-001, FR-002 | done   |
| S-01 | employee-availability-management | Employee can create/edit their own monthly availability; locks once generation starts | F-01          | FR-001, Access Control         | done   |
| S-02 | manager-availability-visibility  | Manager can view every employee's submitted availability for the month                | F-01, S-01    | FR-002                         | done   |
| S-03 | generate-monthly-schedule        | Manager generates a proposed schedule: no conflicts, fair long-shift rotation         | S-01          | US-01, FR-003, FR-004          | done   |
| S-04 | review-override-publish-schedule | Manager reviews, overrides (with conflict warnings), and publishes the schedule       | S-03          | FR-004, FR-005, FR-006         | done   |
| S-05 | view-published-schedule          | Employee and Manager can view the published schedule as a visual grid                 | S-04          | FR-007, Access Control         | done   |

## Baseline

What's already in place in the codebase as of `2026-09-24` (auto-researched + user-confirmed).
Foundations below assume these are present and do NOT re-scaffold them.

- **Frontend:** present — Astro 7 SSR + React 19 islands, Tailwind 4, shadcn/ui (`src/layouts/Layout.astro`, `src/components/ui/button.tsx`).
- **Backend / API:** present — Astro API routes for auth (`src/pages/api/auth/{signin,signup,signout}.ts`).
- **Data:** absent — only Supabase Auth's built-in `auth.users`; no domain tables or migrations exist yet (`supabase/` has `config.toml` only).
- **Auth:** present — Supabase SSR auth wired end-to-end: middleware, signin/signup/signout, protected `/dashboard` (`src/middleware.ts`, `src/lib/supabase.ts`). No role model on top of it yet.
- **Deploy / infra:** partial — Cloudflare Workers recommended (`infrastructure.md`) and scaffolded (`wrangler.jsonc`, `@astrojs/cloudflare`); rollout in progress (Phases 0/1/3 done, 2/4/5/6 outstanding per `context/changes/deployment/deployment-plan.md`) — production not yet live. Orthogonal to this milestone's slices.
- **Observability:** absent — no logging/error-tracking library found in `src/`.

## Foundations

### F-01: Role-aware access control

- **Outcome:** (foundation) Manager and Employee accounts are distinguishable at the auth layer — each account carries a role, enforced via database policy and session checks — so every downstream slice can safely gate data and UI by role.
- **Change ID:** role-aware-access-control
- **PRD refs:** Access Control section (two roles: Manager, Employee), FR-001 (employee edits only own data), FR-002 (manager views all)
- **Unlocks:** S-01, S-02
- **Prerequisites:** — (external state: Supabase auth already scaffolded — see Baseline)
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:**
  - ~~How does a new account get assigned Manager vs. Employee — self-selected at signup, or does the manager invite/create employee accounts?~~ Resolved (2026-09-26, by the archived change): every signup becomes an Employee automatically; an existing Manager promotes/demotes accounts from a manager-only page, and the last Manager can never be demoted. No signup role picker, no invite flow.
- **Risk:** Every downstream slice gates by role, so getting the role-assignment UX wrong here forces rework later — worth deciding early, but the decision is small enough not to block sequencing.
- **Status:** done

## Slices

### S-01: Employee availability management

- **Outcome:** Employee can create and edit their own availability windows for the upcoming month; edits lock once the manager starts generating that month's schedule.
- **Change ID:** employee-availability-management
- **PRD refs:** FR-001, Access Control (employee restricted to own data), NFR (availability visible only to that employee and the manager)
- **Prerequisites:** F-01
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:**
  - ~~What shape is an "availability window" — one or more time ranges per day, a weekly recurring pattern, something else?~~ Resolved (2026-09-26, by the archived change): a window is a single `starts_at`–`ends_at` range (longer than 0, at most 24h, may run overnight), with no overlapping windows per employee. Employees add them per day on a calendar and can repeat one on the same weekday for the whole month. Times are Europe/Warsaw wall-clock. A month locks when a manager adds an `availability_locks` row.
- **Risk:** First slice to touch the data layer — the availability schema decided here constrains how S-02/S-03 read that data, so keep it minimal rather than over-designing ahead of need.
- **Status:** done

### S-02: Manager availability visibility

- **Outcome:** Manager can view every employee's submitted availability for the month in one place.
- **Change ID:** manager-availability-visibility
- **PRD refs:** FR-002
- **Prerequisites:** F-01, S-01
- **Parallel with:** S-03
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Low-risk read-only view; kept parallel with S-03 (not a hard prerequisite of it) so it doesn't delay the riskier north-star slice.
- **Handoff from S-01:** ~~`availability_windows` has no `starts_at` index. The GiST exclusion index is led by `employee_id`, so decide whether a month-wide, all-employee query needs one.~~ Resolved (2026-09-29, by the archived change): no index added. At single-station scale the month-wide scan covers a few hundred rows; revisit if S-03's generator reads are slow.
- **Status:** done

### S-03: Generate monthly schedule

- **Outcome:** Manager generates a proposed monthly schedule that assigns every 6–12h shift to an employee, respecting each employee's stated availability and rotating who takes long shifts fairly, with zero conflicting assignments.
- **Change ID:** generate-monthly-schedule
- **PRD refs:** US-01 (all acceptance criteria), FR-003, FR-004 (generation-side validation), NFR (result within a few seconds, visible progress if longer)
- **Prerequisites:** S-01 (external state: at least one employee's availability submitted for the target month)
- **Parallel with:** S-02
- **Blockers:** —
- **Unknowns:** — (both resolved by the user on 2026-10-06)
  - ~~What exactly defines "fair" long-shift rotation — equal count over the month, a rolling window across months, something else?~~ **Resolved:** fairness is measured within one month only, with no history from earlier months. The generator keeps each employee's total assigned hours as even as their availability allows, and spreads 12h shifts evenly: among employees who can take them, counts differ by at most 1.
  - ~~What should happen when no employee's availability covers a shift (insufficient coverage)?~~ **Resolved:** the generator still produces the rest of the schedule, leaves that shift unassigned and flags it as uncovered. It never assigns anyone outside their availability. A schedule with a day that has no one assigned cannot be accepted or published (enforced in S-04).
- **Risk:** This is the riskiest, most complex slice in the PRD by its own admission (the FR-003 Socrates note explicitly considered and rejected cutting it) — sequenced immediately after the minimal data prerequisite (S-01) rather than deferred, so the hardest technical bet gets tested early while there's still runway to descope if needed.
- **Handoff from S-01:**
  - `availability_windows.employee_id` is `on delete cascade`. Deleting a user drops their windows even in locked months, so revisit this (restrict or soft-delete) once schedules are persisted.
  - Month-wide reads have no `starts_at` index (S-02 decided none is needed at single-station scale); add one if the generator's reads are slow. PostgREST silently caps a read at 1000 rows, so page month-wide reads (S-02 does this in `loadMonthWindows` with `.range()`).
  - A window belongs to its `starts_at` month and may spill into day 1 of the next month; writes require both months to be editable.
  - Durations are wall-clock, with no DST correction.
- **Delivery (2026-10-06):** implemented in `context/archive/2026-10-06-generate-monthly-schedule/`, merged in PR #35. S-01 handoff outcome: no `starts_at` index was added (team reads are paged through `loadAllPages`); `availability_windows` stays `on delete cascade`, while a deleted account's draft shifts become uncovered (`schedule_shifts.employee_id` is `on delete set null`).
- **Follow-ups (not in this slice):**
  - The repair pass may leave night counts less even than possible: in the kitchen-sink gaps fixture (4 people all month) one person gets 8 nights against a lowest of 6.
  - A shift is assigned only when one window covers the whole fixed-time shift (shortest 6h), so short windows (e.g. 14:25–17:25) leave every shift uncovered. Consider showing shift times on the availability form, or allowing shorter shifts.
- **Status:** done

### S-04: Review, override, and publish schedule

- **Outcome:** Manager can review the generated draft, manually override any assignment before publishing (with a conflict warning if the override falls outside an employee's availability), and publish the finalized schedule.
- **Change ID:** review-override-publish-schedule
- **PRD refs:** FR-004 (override-path conflict warning), FR-005, FR-006
- **Prerequisites:** S-03
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:** —
- **Handoff from S-03 (decided 2026-10-06):** the draft may contain shifts flagged as uncovered. The manager can fill them in by override, but accepting or publishing is refused while any day of the month has no one assigned.
- **Handoff from S-03 (implemented 2026-10-06, details in CLAUDE.md, Schedule):**
  - **Draft model.** `schedules(month)` is one draft per month, and `schedule_shifts` holds its shifts (`employee_id` null = uncovered; a deleted account's shifts become uncovered). Constraints allow only the 9 shift shapes, require `month` to match the shift's station day (`starts_at - 6h`) and forbid overlapping shifts station-wide. `replace_schedule_draft(target_month, shifts)` deletes the month's draft and inserts the new one in one transaction, so a regenerate replaces every shift (ids change) and any S-04 edits to the draft are lost; a failing row leaves the old draft intact. RLS is manager-only, and employees cannot read drafts at all (S-05 needs a read policy for published schedules).
  - **Unlock is refused while a draft exists.** `schedules.month` references the month's `availability_locks` row `on delete restrict`, so `/manager/months` shows "Discard this month's draft schedule before unlocking it." Publishing must keep the month locked (or decide what a published month's lock means).
  - **Overrides need an update policy.** Neither table has an update policy, and table-level UPDATE is revoked from `authenticated` and `anon` (`20261006140000_revoke_schedule_updates.sql`, pgTAP-checked). S-04 must add a manager-only `update` policy and `grant update (employee_id) on public.schedule_shifts` (or a new RPC). The shape, month and overlap constraints apply to overrides automatically.
  - **Conflict warnings come from `summarizeSchedule`** (`src/lib/schedule-summary.ts`). It recounts from the stored shifts and raw windows: `outsideAvailability` is the FR-004 override warning (always empty for a generated draft), `ruleBreaks` the 12h/night fairness warnings, `perMember.zeroShifts` the "No shifts" flag, and `daysWithNoOne` must block accept and publish. It does not check one-shift-per-station-day or touching shifts per person: overrides can break those hard rules, so S-04 must add a check for them.
  - **Cross-month boundary (impl review F1, 2026-10-06).** Windows starting on day 1 of M+1 before 06:00 count for M's last station night: RLS freezes them while M is locked, and generating M reads them. Generating M+1 blocks M's last-night assignee from 06:00 on day 1, and `summarizeSchedule(...).touchesPreviousNight` reports the conflict when M's draft changed afterwards. S-04 overrides of day 1 06:00 or of M's last night must re-check it.
- **Risk:** Depends entirely on S-03 producing a real draft to act on; sequenced immediately after so the full manager workflow (generate → adjust → publish) is validated end-to-end before employee-facing viewing lands.
- **Delivery (2026-10-07):** implemented in `context/archive/2026-10-06-review-override-publish-schedule/`, merged in PR #37. S-03 handoff outcome: overrides go through a manager-only `update (employee_id)` grant and policy; `overrideWarnings` (`src/lib/schedule-override.ts`) diffs two `summarizeSchedule` runs and adds the per-person same-day and back-to-back checks plus the M−1 last night / M+1 first morning boundary; publish and unpublish are RPCs, and a published month keeps its lock and is frozen (RLS plus the `schedule_shifts_published_guard` trigger). Push `20261007120000_publish_and_override_schedules.sql` and `20261007130000_guard_published_schedule_shifts.sql` to the hosted project.
- **Follow-ups (not in this slice):**
  - Two concurrent overrides that each pass clean can together create a same-day or back-to-back pair nobody was warned about; the summary card shows it on the next load (accepted limit; a version token in the form would close it).
  - `/manager/availability` has no kitchen sink, is outside the `check:ui` scope and its `TeamCalendar` still has a `text-[10px]`: leave to a `/10x-ui` pass on that view.
- **Status:** done

### S-05: View published schedule

- **Outcome:** Employee and Manager can view the published schedule as a simple visual grid of who works when.
- **Change ID:** view-published-schedule
- **PRD refs:** FR-007, Access Control (employee sees everyone's shifts, not just their own)
- **Prerequisites:** S-04
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Simple read-only grid, mostly UI — last in the must-have chain since nothing can be published before S-04 lands.
- **Handoff from S-04:**
  - A month is published when `schedules.published_at` is set (written only by `publish_schedule`/`unpublish_schedule`). A published month is frozen and keeps its availability lock; unpublishing makes it a draft again, which employees must stop seeing.
  - RLS on `schedules` and `schedule_shifts` is still manager-only, so employees cannot read anything yet. S-05 needs a select policy for authenticated users limited to rows of published months (and must not expose drafts), plus a way to show assignee names that does not open `profiles` to everyone.
  - A published month can still gain Uncovered shifts when an assignee's account is deleted (`on delete set null`); the grid should show them.
  - The station-day model (06:00 → 06:00, the 00:00–06:00 night on day 1 of M+1 belongs to M) and `shiftsByStationDay`/`calendarName` from S-03/S-04 can be reused for the grid.
- **Known limitations:**
  - Display names are self-chosen and not unique. Two people can share a name, or one can take a colleague's name, and `/schedule` cannot tell them apart. Only Uncovered keeps its own marker.
  - Accepted for one station's small team (impl-review F5). If it matters later, add a unique index on `lower(display_name)` with a mapped error, or show the email prefix next to a name that two people share.
- **Delivery (2026-10-08):** implemented in `context/changes/view-published-schedule/`, PR #39. S-04 handoff outcome: no select policy was widened; `get_published_schedule(target_month)` (SECURITY DEFINER) is the only read path for non-managers, returns a month's shifts only while it is published, names each assignee by display name (set on `/account` through `set_display_name`) or email prefix, and marks the caller's shifts with `is_own` instead of exposing profile ids; Uncovered shifts show in the grid. Push `20261007140000_published_schedule_and_display_names.sql`, `20261007150000_display_name_visible_characters.sql` and `20261007160000_published_schedule_is_own.sql` to the hosted project before deploying.
- **Status:** done

## Backlog Handoff

| Roadmap ID           | Issue    | Change ID                         | Suggested issue title                                                             | Ready for `/10x-plan` | Notes                                                           |
| -------------------- | -------- | --------------------------------- | --------------------------------------------------------------------------------- | --------------------- | --------------------------------------------------------------- |
| F-01                 | #1       | role-aware-access-control         | Add manager/employee roles to auth                                                | —                     | Done — archived 2026-09-26                                      |
| F-01 (follow-up)     | #19      | manager-users-ui-tokens           | `/manager/users` on the shadcn design tokens (UI only)                            | —                     | Done in PR #18 — archived 2026-09-29                            |
| S-01                 | #2       | employee-availability-management  | Employee availability CRUD with monthly lock                                      | —                     | Done — archived 2026-09-26                                      |
| S-01 (follow-up)     | #15 (PR) | availability-ui-tokens            | `/availability` on the shadcn design tokens (UI only)                             | —                     | Done — archived 2026-09-28                                      |
| S-01 (follow-up)     | #16      | availability-same-day-windows     | Second same-day availability window replaces the first or reports a false overlap | —                     | Not a bug (edit form used instead of Add) — archived 2026-09-29 |
| S-02                 | #3       | manager-availability-visibility   | Manager view of all employee availability                                         | —                     | Done in PR #21 — archived 2026-09-29                            |
| T-01 (test plan)     | #24      | testing-station-time              | Test runner and station-time logic (unit tests on UTC)                            | —                     | Done in PR #23 — archived 2026-10-01                            |
| T-02 (test plan)     | #27      | testing-database-rules            | Database rules: ownership, month lock and roles (pgTAP)                           | —                     | Done in PR #26 — archived 2026-10-03                            |
| QG-01 (test plan §5) | #29      | quality-gate-hooks                | Quality-gate hooks: agent hooks and pre-commit tests on staged files              | —                     | Done in PR #30 — merged 2026-10-03                              |
| T-03 (test plan)     | #31      | testing-route-gating-honest-reads | Route gating and honest availability reads                                        | —                     | Done in PR #32 — archived 2026-10-03                            |
| S-03                 | #4       | generate-monthly-schedule         | Auto-generate conflict-free, fairly-rotated monthly schedule                      | —                     | Done in PR #35 — archived 2026-10-06                            |
| S-04                 | #5       | review-override-publish-schedule  | Manager review/override/publish workflow for generated schedule                   | —                     | Done in PR #37 — archived 2026-10-07                            |
| S-05                 | #6       | view-published-schedule           | Published schedule grid view for employees and managers                           | —                     | Done in PR #39 — 2026-10-08                                     |

## Open Roadmap Questions

1. **[#7]** **What are the expected request volume (qps) and data volume for this product?** — Owner: user. Block: not blocking (small single-station scale is already assumed); resolve before infrastructure sizing decisions downstream. (Carried verbatim from PRD `## Open Questions`.)

## Parked

- **Manager can export/print the schedule (FR-008)** (#8) — Why parked: PRD marks it nice-to-have; deferred behind the must-have generate/override/publish/view path per the speed-first sequencing choice.
- **Employee is notified when a new schedule is published (FR-009)** (#9) — Why parked: PRD marks it nice-to-have and its own Socrates note flags it as marginal-benefit infrastructure; deferred behind the must-have path.
- **No labor-law enforcement** — Why parked: PRD Non-Goal — the generator does not encode legal rest-period rules; manager is responsible for compliance.
- **No sick leave / vacation (L4/urlopy) tracking** — Why parked: PRD Non-Goal — availability windows are the only input; time off is not modeled.
- **No multi-employee shifts** — Why parked: PRD Non-Goal — every shift is assigned to exactly one employee by default.
- **No native mobile app** — Why parked: PRD Non-Goal — web-only for MVP.

## Milestone History

(Empty — this is the first milestone.)

## Done

- **F-01: (foundation) Manager and Employee accounts are distinguishable at the auth layer — each account carries a role, enforced via database policy and session checks — so every downstream slice can safely gate data and UI by role.** — Archived 2026-09-26 → `context/archive/2026-09-25-role-aware-access-control/`. Lesson: —.
- **S-01: Employee can create and edit their own availability windows for the upcoming month; edits lock once the manager starts generating that month's schedule.** — Archived 2026-09-26 → `context/archive/2026-09-26-employee-availability-management/`. Lesson: —.
- **S-02: Manager can view every employee's submitted availability for the month in one place.** — Archived 2026-09-29 → `context/archive/2026-09-29-manager-availability-visibility/`. Lesson: —.
- **T-01: (test plan, Phase 1) Unit test runner (Vitest on UTC) proves station dates, months and "now" are correct on the Worker and across DST; manual Stryker gate on `src/lib/availability.ts`.** — Archived 2026-10-01 → `context/archive/2026-10-01-testing-station-time/`. Lesson: —.
- **T-02: (test plan, Phase 2) pgTAP database rules tests (`npm run test:db`, in the CI smoke job) prove an employee cannot read or write another employee's availability, no write reaches a current, past or locked month, and roles cannot be escalated nor the last manager demoted.** — Archived 2026-10-03 → `context/archive/2026-10-03-testing-database-rules/`. Lesson: —.
- **T-03: (test plan, Phase 3) Unit tests and targeted smoke steps prove the route × role gate holds on every manager page and endpoint after a middleware or role change (a route inventory guard fails on any page or endpoint left outside it), and a failed, truncated or shifting team read shows a load error instead of "No availability submitted".** — Archived 2026-10-03 → `context/archive/2026-10-03-testing-route-gating-honest-reads/`. Lesson: —.
- **S-03: Manager generates a proposed monthly schedule that assigns every 6–12h shift to an employee, respecting each employee's stated availability and rotating who takes long shifts fairly, with zero conflicting assignments.** — Archived 2026-10-06 → `context/archive/2026-10-06-generate-monthly-schedule/`. Lesson: —.
- **S-04: Manager can review the generated draft, manually override any assignment before publishing (with a conflict warning if the override falls outside an employee's availability), and publish the finalized schedule.** — Archived 2026-10-07 → `context/archive/2026-10-06-review-override-publish-schedule/`. Lesson: —.
