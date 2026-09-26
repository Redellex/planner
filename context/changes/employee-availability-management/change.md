---
change_id: employee-availability-management
title: Employee availability CRUD with monthly lock
status: implementing
created: 2026-09-26
updated: 2026-09-26
archived_at: null
---

## Notes

Roadmap S-01 (`context/foundation/roadmap.md`, backlog #2): Employee can create and edit their own availability windows for the upcoming month; edits lock once the manager starts generating that month's schedule.

- PRD refs: FR-001, Access Control (employee restricted to own data), NFR (availability visible only to that employee and the manager)
- Prerequisite: F-01 `role-aware-access-control`
- Open unknown (non-blocking): the shape of an "availability window". `/10x-plan` proposes a schema and confirms it with the user.
