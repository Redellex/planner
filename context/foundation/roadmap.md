---
project: Planner
version: 1
status: draft
created: 2026-09-24
updated: 2026-10-01
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

| ID   | Change ID                        | Outcome (user can …)                                                                  | Prerequisites | PRD refs                       | Status   |
| ---- | -------------------------------- | ------------------------------------------------------------------------------------- | ------------- | ------------------------------ | -------- |
| F-01 | role-aware-access-control        | (foundation) Manager/Employee roles exist and are enforced at the auth layer          | —             | Access Control, FR-001, FR-002 | done     |
| S-01 | employee-availability-management | Employee can create/edit their own monthly availability; locks once generation starts | F-01          | FR-001, Access Control         | done     |
| S-02 | manager-availability-visibility  | Manager can view every employee's submitted availability for the month                | F-01, S-01    | FR-002                         | done     |
| S-03 | generate-monthly-schedule        | Manager generates a proposed schedule: no conflicts, fair long-shift rotation         | S-01          | US-01, FR-003, FR-004          | blocked  |
| S-04 | review-override-publish-schedule | Manager reviews, overrides (with conflict warnings), and publishes the schedule       | S-03          | FR-004, FR-005, FR-006         | proposed |
| S-05 | view-published-schedule          | Employee and Manager can view the published schedule as a visual grid                 | S-04          | FR-007, Access Control         | proposed |

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
- **Unknowns:**
  - What exactly defines "fair" long-shift rotation — equal count over the month, a rolling window across months, something else? PRD's Business Logic says shifts should "rotate ... rather than repeatedly falling on the same person" and stay "as close to each other as possible," but doesn't define the metric precisely. Owner: user. Block: yes — the generator's core acceptance criterion can't be planned without this.
  - What should happen when no employee's availability covers a shift (insufficient coverage)? PRD doesn't specify fallback behavior. Owner: user. Block: yes — the generator needs a defined behavior for this case before it can be planned.
- **Risk:** This is the riskiest, most complex slice in the PRD by its own admission (the FR-003 Socrates note explicitly considered and rejected cutting it) — sequenced immediately after the minimal data prerequisite (S-01) rather than deferred, so the hardest technical bet gets tested early while there's still runway to descope if needed.
- **Handoff from S-01:**
  - `availability_windows.employee_id` is `on delete cascade`. Deleting a user drops their windows even in locked months, so revisit this (restrict or soft-delete) once schedules are persisted.
  - Month-wide reads have no `starts_at` index (S-02 decided none is needed at single-station scale); add one if the generator's reads are slow. PostgREST silently caps a read at 1000 rows, so page month-wide reads (S-02 does this in `loadMonthWindows` with `.range()`).
  - A window belongs to its `starts_at` month and may spill into day 1 of the next month; writes require both months to be editable.
  - Durations are wall-clock, with no DST correction.
- **Status:** blocked

### S-04: Review, override, and publish schedule

- **Outcome:** Manager can review the generated draft, manually override any assignment before publishing (with a conflict warning if the override falls outside an employee's availability), and publish the finalized schedule.
- **Change ID:** review-override-publish-schedule
- **PRD refs:** FR-004 (override-path conflict warning), FR-005, FR-006
- **Prerequisites:** S-03
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Depends entirely on S-03 producing a real draft to act on; sequenced immediately after so the full manager workflow (generate → adjust → publish) is validated end-to-end before employee-facing viewing lands.
- **Status:** proposed

### S-05: View published schedule

- **Outcome:** Employee and Manager can view the published schedule as a simple visual grid of who works when.
- **Change ID:** view-published-schedule
- **PRD refs:** FR-007, Access Control (employee sees everyone's shifts, not just their own)
- **Prerequisites:** S-04
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Simple read-only grid, mostly UI — last in the must-have chain since nothing can be published before S-04 lands.
- **Status:** proposed

## Backlog Handoff

| Roadmap ID       | Issue    | Change ID                        | Suggested issue title                                                             | Ready for `/10x-plan` | Notes                                                           |
| ---------------- | -------- | -------------------------------- | --------------------------------------------------------------------------------- | --------------------- | --------------------------------------------------------------- |
| F-01             | #1       | role-aware-access-control        | Add manager/employee roles to auth                                                | —                     | Done — archived 2026-09-26                                      |
| F-01 (follow-up) | #19      | manager-users-ui-tokens          | `/manager/users` on the shadcn design tokens (UI only)                            | —                     | Done in PR #18 — archived 2026-09-29                            |
| S-01             | #2       | employee-availability-management | Employee availability CRUD with monthly lock                                      | —                     | Done — archived 2026-09-26                                      |
| S-01 (follow-up) | #15 (PR) | availability-ui-tokens           | `/availability` on the shadcn design tokens (UI only)                             | —                     | Done — archived 2026-09-28                                      |
| S-01 (follow-up) | #16      | availability-same-day-windows    | Second same-day availability window replaces the first or reports a false overlap | —                     | Not a bug (edit form used instead of Add) — archived 2026-09-29 |
| S-02             | #3       | manager-availability-visibility  | Manager view of all employee availability                                         | —                     | Done in PR #21 — archived 2026-09-29                            |
| T-01 (test plan) | #24      | testing-station-time             | Test runner and station-time logic (unit tests on UTC)                            | —                     | Done in PR #23 — archived 2026-10-01                            |
| S-03             | #4       | generate-monthly-schedule        | Auto-generate conflict-free, fairly-rotated monthly schedule                      | no                    | Blocked — 2 unknowns need resolving first                       |
| S-04             | #5       | review-override-publish-schedule | Manager review/override/publish workflow for generated schedule                   | no                    | Waiting on S-03                                                 |
| S-05             | #6       | view-published-schedule          | Published schedule grid view for employees and managers                           | no                    | Waiting on S-04                                                 |

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
