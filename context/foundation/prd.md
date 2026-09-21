---
project: Planner
version: 1
status: draft
created: 2026-09-19
context_type: greenfield
product_type: web-app
target_scale:
  users: small
timeline_budget:
  mvp_weeks: 3
  hard_deadline: null
  after_hours_only: true
---

# Planner — Product Requirements

## Vision & Problem Statement

Every month, the manager of a single gas station has to build a work schedule for their team by hand in a spreadsheet, cross-referencing each employee's individually submitted availability windows and deciding who works which 6–12 hour shift while trying to rotate who takes the longer shifts fairly. This is slow and error-prone, and requires holding many people's constraints in your head at once — the pain is both coordination overhead (gathering and reconciling availability from multiple employees) and decision paralysis (deciding a fair, conflict-free assignment across all of them).

Generic scheduling and calendar tools handle time slots but don't model domain rules like shift rotation and fairness across a small team's availability constraints — there is no drop-in tool built for this specific shape of problem, which is why a manual spreadsheet is still the default.

## User & Persona

**Primary persona**: The station manager (kierownik) at a single gas station — responsible for producing the upcoming month's work schedule for their team. They reach for this product once a month when building the schedule, holding every employee's availability constraints and needing to assign 6–12 hour shifts fairly and without conflicts.

### Secondary persona

Station employees, who each maintain their own availability schedule that the manager consumes when building the monthly schedule. They don't build schedules themselves — only their own availability.

## Success Criteria

### Primary
- Manager can generate a monthly schedule that assigns 6–12h shifts to employees, respecting every employee's stated availability, rotating who takes long shifts, and flagging/preventing any assignment that conflicts with availability. Everyone should have atleast few shifts during month.

### Secondary
- Manager can export/print the schedule for sharing outside the app.
- Employees get notified when a new schedule is published.
- Manager can manually override any suggested assignment.

### Guardrails
- Never silently assign a shift outside an employee's stated availability — any conflict must be surfaced to the manager and require an explicit override.

## User Stories

### US-01: Manager generates a valid monthly schedule

- **Given** a manager with all employees' availability submitted for the month
- **When** Manager generates a schedule
- **Then** the system proposes 6–12h shift assignments that respect every employee's availability and rotate who takes the longer shifts, with no conflicts

#### Acceptance Criteria
- No proposed assignment falls outside an employee's stated availability
- Long (12h) shifts rotate across eligible employees rather than repeatedly landing on the same person
- Every shift in the month has exactly one assigned employee
- Work time should be as close to each other as possible

## Functional Requirements

### Availability & scheduling
- FR-001: Employee can create and edit their own availability schedule for the upcoming month, until the manager begins generating that month's schedule — after which availability for that month becomes locked. Priority: must-have
  > Socrates: Counter-argument considered: "editing should be locked once the manager starts building the schedule, so availability doesn't silently change out from under an in-progress schedule." Resolution: accepted — availability becomes read-only for the target month once the manager starts generating a schedule for it.
- FR-002: Manager can view all employees' availability schedules. Priority: must-have
  > Socrates: Counter-argument considered: "full visibility could feel like surveillance; maybe aggregate-only view is enough." Resolution: kept as written — the manager needs per-employee availability to build a valid schedule; aggregate-only isn't sufficient for FR-003/FR-004.
- FR-003: Manager can generate a proposed schedule that assigns 6–12h shifts, respecting employee availability and rotating who takes the longer shifts. Priority: must-have
  > Socrates: Counter-argument considered: "auto-generation is the riskiest, most complex piece — cut to manual-only for v1." Resolution: kept as written — this is the core value proposition distinguishing the product from a generic calendar.
- FR-004: System validates each proposed assignment against an employee's stated availability and warns the manager of any conflict, requiring explicit confirmation to override. Priority: must-have
  > Socrates: Counter-argument considered: "validation should warn, not hard-block, since a manager may legitimately need to override in an emergency." Resolution: accepted — validation warns and requires explicit override (via FR-005) rather than hard-blocking.
- FR-005: Manager can manually adjust or override any assignment before publishing. Priority: must-have
  > Socrates: Counter-argument considered: "overrides should require a reason/note to avoid later disputes." Resolution: kept as written — no reason capture in MVP; noted as a possible future refinement, not blocking.
- FR-006: Manager can publish the schedule. Priority: must-have
  > Socrates: Counter-argument considered: "publishing should require confirmation, since employees rely on it once published." Resolution: kept as written — publish is treated as a deliberate manager action in the UI; explicit confirmation UX is a downstream design detail, not a scope change.
- FR-007: Employee and Manager can view the published schedule as a simple visual grid of who works when. Priority: must-have
  > Socrates: Counter-argument considered: "unpublished/draft schedule shouldn't be visible to employees." Resolution: kept as written — this FR only covers the *published* schedule; drafts are implicitly manager-only since employees have no path to a draft view.

### Sharing & notifications
- FR-008: Manager can export/print the schedule. Priority: nice-to-have
  > Socrates: Counter-argument considered: none raised. Resolution: kept as written, nice-to-have.
- FR-009: Employee is notified when a new schedule is published. Priority: nice-to-have
  > Socrates: Counter-argument considered: "notifications add infrastructure for marginal benefit when employees already log in to submit availability." Resolution: kept as written, nice-to-have — user chose not to drop it, but it remains explicitly out of must-have scope.

## Non-Functional Requirements

- A manager sees a proposed schedule within a few seconds of clicking "generate," with continuous visible progress if it takes longer.
- An employee's submitted availability is visible only to that employee and the manager — never to other employees.

## Business Logic

Given a set of employees' availability windows for the month, the schedule generator assigns one employee to each 6–12h shift such that every assignment falls within that employee's stated availability, and the longer shifts rotate across eligible employees rather than repeatedly falling on the same person. Work time should be as close to each other as possible in month/schedule.

The rule consumes each employee's stated availability windows for the month and the recent history of who has worked long shifts. Its output is a proposed, conflict-free monthly shift assignment — one employee per shift — that the manager then reviews, optionally adjusts, and publishes. The user encounters this rule at the moment they click "generate schedule": rather than staring at a blank grid, they see a starting assignment they can accept or edit.

## Access Control

Login via email + password. Two roles: **Manager** (kierownik) and **Employee** (pracownik).

- **Manager**: full write access to the monthly work schedule; can view every employee's availability schedule.
- **Employee**: can create/edit only their own availability schedule; can view the full published work schedule (everyone's shifts, not just their own).

## Non-Goals

- **No labor-law enforcement** (e.g. mandatory rest days after a 12h shift) — the schedule generator does not encode legal rest-period rules in the MVP; the manager is responsible for compliance.
- **No sick leave / vacation (L4/urlopy) tracking** — availability windows are the only input; time off is not modeled.
- **No multi-employee shifts** — every shift is assigned to exactly one employee by default; shift-sharing/overlap is out of scope.
- **No native mobile app** — web-only for MVP; mobile-web usability is not a guaranteed target.

## Open Questions

1. **What are the expected request volume (qps) and data volume for this product?** — Owner: user. By: not blocking; `/10x-shape` only captured user-count scale (small), not qps/data_volume ballparks. Resolve before infrastructure sizing decisions downstream.
