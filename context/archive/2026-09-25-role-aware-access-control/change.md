---
change_id: role-aware-access-control
title: Add Manager/Employee roles enforced at the auth layer
status: archived
created: 2026-09-25
updated: 2026-09-26
archived_at: 2026-09-26T08:55:24Z
---

## Notes

Roadmap F-01 (`context/foundation/roadmap.md`, Linear/backlog #1): Manager and Employee accounts are distinguishable at the auth layer — each account carries a role, enforced via database policy and session checks — so every downstream slice can safely gate data and UI by role.

- PRD refs: Access Control (two roles: Manager, Employee), FR-001 (employee edits only own data), FR-002 (manager views all)
- Unlocks: S-01, S-02
- Open unknown (non-blocking): how a new account gets assigned Manager vs. Employee — signup role picker vs. manager invite/create. `/10x-plan` may propose a default.
