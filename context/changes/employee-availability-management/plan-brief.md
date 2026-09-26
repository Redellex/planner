# Employee Availability Management — Plan Brief

> Full plan: `context/changes/employee-availability-management/plan.md`
> Research: `context/changes/employee-availability-management/research.md`

## What & Why

Roadmap S-01 / FR-001: each user enters their own availability windows for upcoming months in Planner, and a month's availability locks once the manager starts scheduling it. This is the first domain data in the app, and S-02 (manager view) and S-03 (the schedule generator) will read it. The schema therefore stays minimal and is shaped so that a shift can be checked against availability with a range containment test.

## Starting Point

F-01 added roles, `profiles`, the `is_manager()` RLS helper, the fail-closed `locals.role` and the form-POST → redirect API convention. No table models availability, months or a lock yet. The seed has only a manager, and the smoke script has no role or availability steps.

## Desired End State

A signed-in user opens `/availability`, picks one of the next 3 months and adds dated windows. Night windows such as 19:00→07:00 are allowed, and a "repeat every Monday this month" option saves typing. The user can edit window times and delete windows. A manager opens `/manager/months` and locks a month. From then on the database refuses every write to that month's windows and the page turns read-only. Unlock reverses this. S-03 will set the same lock when it generates a schedule.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Window shape | Dated start→end ranges; end ≤ start ends the next day; >0 and ≤24h; no overlaps per user | S-03 checks a 6–12h shift, night shifts included, with one containment test | Plan |
| Editable months | Any month after the current station month that is not locked; UI offers the next 3 | Locking next month early doesn't stop employees from entering the month after | Plan |
| Lock trigger | Manager Lock / Unlock page now; S-03 inserts the same lock row later | FR-001's lock is testable end-to-end today and a mis-click can be undone | Plan |
| Who submits availability | Any signed-in user, managers included; RLS is "own rows" | Small stations' managers also work shifts; simplest RLS | Plan |
| Timezone | Europe/Warsaw constant (SQL + TS) | Single-station product; Workers run in UTC | Plan |
| Storage type | `timestamp` (wall-clock) pairs, not `timestamptz` | Form input maps 1:1, no JS timezone conversion; S-03 shifts will use the same type | Plan |
| Bulk entry | "Repeat every <weekday> this month" checkbox; one statement, all-or-nothing | Big time saver with no extra schema | Plan |
| Submitted state | None; zero windows = unavailable | Minimal schema, as the roadmap's risk note asks | Plan |
| Lock carrier | `availability_locks(month)`: a row means locked | Per-month lock, as the PRD describes; minimal for S-03 to set | Research → Plan |
| Enforcement | RLS + check/exclusion constraints + SECURITY DEFINER helper; UI only mirrors it | "Postgres is the source of truth" from F-01 | Research |
| API/UI style | Pure Astro forms, form POST → redirect `?error=`/`?updated=1` | Matches `role.ts`, works without JS and on phones | Research |

## Scope

**In scope:**
- Migration with `availability_windows`, `availability_locks`, `btree_gist`, the editable-month helper, RLS and column grants
- Seeded `employee@example.com` and regenerated types
- The `/availability` page with 3 endpoints; the `/manager/months` page with a lock endpoint
- A segment-safe signed-in route gate and nav links in Topbar and dashboard
- Smoke steps and CLAUDE.md docs

**Out of scope:**
- The manager's view of all availability (S-02) and generation (S-03)
- Submit state, weekly templates and copying the previous month
- Editing a window's date (delete and re-add instead)
- A configurable timezone and a production migration pipeline
- F-01 Phase 4

## Architecture / Approach

Postgres owns every rule. RLS limits writes to the user's own rows in an editable month, which `is_availability_month_editable` decides from the station month and the lock rows. A check constraint caps a window at 24h, and an exclusion constraint forbids overlaps. Astro pages query through the RLS-scoped client, and endpoints validate the shape and map Postgres error codes to messages. `src/lib/availability.ts` holds the pure station-time and window-building helpers.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Availability schema and RLS | Tables, constraints, lock helper, policies, seed employee, types | Policy or lock predicate wrong; `btree_gist` setup |
| 2. Employee availability page | `/availability` with add, repeat, edit and delete, plus route gate and nav | Wall-clock strings mangled by `Date`; manager sees coworkers' rows without the `employee_id` filter |
| 3. Manager month lock | `/manager/months` lock/unlock and nav | Low — follows the `users` page pattern |
| 4. Smoke coverage and docs | HTTP proof of add, overlap and lock; CLAUDE.md | Leftover lock state across local runs (mitigated by a far month and an unlock step) |

**Prerequisites:** F-01 phases 1–3 in place (they are); local Supabase via Docker.
**Estimated effort:** ~3–4 sessions across 4 phases.

## Open Risks & Assumptions

- There is no documented production migration path. Both F-01's and S-01's migrations must be applied to the hosted project by hand.
- DST nights: a wall-clock window may be 1h longer or shorter in real time. We assume this is acceptable for scheduling.
- F-01 Phase 4 also edits `scripts/smoke.mjs`. Whichever lands second reuses the other's manager sign-in.
- If unlock happens after S-03 has produced a draft, S-03 must define what that does to the draft.
- A lock that races a concurrent write keeps a write committed just before the lock (accepted).

## Success Criteria (Summary)

- An employee can enter, adjust and remove their own windows, including overnight ones, for upcoming months, and can never see or touch anyone else's.
- Once the manager locks a month, no path (UI or crafted request) can change that month's availability. Unlock restores editing.
- Lint, type check, build and the smoke script (including the lock) pass locally and in CI.
