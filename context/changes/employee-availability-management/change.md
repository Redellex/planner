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
- Phase 2 deviation (user-approved during manual testing, 2026-09-26): `/availability` renders a Monday-first calendar grid with a selected-day panel (`?month=YYYY-MM&day=YYYY-MM-DD`) instead of the planned per-day list. Edit/delete/add forms live in the panel; endpoints redirect back to the selected day.
- Migration renumbered (2026-09-26): `20260926120000_create_availability.sql` → `20260926130000_create_availability.sql`, because F-01's impl-review fix `20260926120000_handle_new_user_null_email.sql` (merged from origin/master) took the same version. plan.md Phase blocks keep the original name. Hosted history repaired with `migration repair 20260926130000 --status applied`.
