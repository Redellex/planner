---
change_id: testing-database-rules
title: "Test plan Phase 2: database rules for ownership, month lock and roles"
status: impl_reviewed
created: 2026-10-03
updated: 2026-10-03
archived_at: null
---

## Notes

Open a change folder for rollout Phase 2 of context/foundation/test-plan.md: "Database rules: ownership, lock, roles".
Risks covered: #2 (abuse: an employee reads, edits or deletes another employee's availability), #3 (availability changes reach a locked, current or past month), #4 (abuse: role control regresses — self-promotion, last manager demoted). Test types planned: database rules (pgTAP via `supabase test db` on the local stack).
Risk response intent:
- #2: employee B gets no rows and no effect on A's window for read, update and delete; A's row is verified intact after every denied write; a manager can read but not write others' windows.
- #3: every write path into a locked, current or past month is refused — create, update (old and new month), delete, overnight spill into a locked next month, weekday repeat crossing into one — and the open-month path still works.
- #4 (database half only; route gating is Phase 3): an employee cannot change any role including their own; the last manager cannot be demoted.
After creating the folder, follow the downstream continuation rule.
