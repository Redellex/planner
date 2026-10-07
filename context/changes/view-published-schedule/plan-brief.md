# View Published Schedule — Plan Brief

> Full plan: `context/changes/view-published-schedule/plan.md`
> Research: `context/changes/view-published-schedule/research.md`

## What & Why

FR-007 (roadmap S-05, issue #6): employees and managers can view the published schedule as a simple grid of who works when. S-04 can already publish a month, but employees cannot read any schedule data yet, so publishing has no visible effect for them.

## Starting Point

Both schedule tables are readable only by managers. Employees can read only their own `profiles` row, and that table has no name column.

`/manager/schedule` already has a station-day calendar (`ScheduleCalendar`) that lists hours plus the email prefix, but it links every cell to the manager page. `authenticated` holds `grant update (role)` on `profiles`, so a self-update policy there would let a user change their own role.

## Desired End State

Every signed-in user opens `/schedule`:
- **Tabs:** four month tabs, the current station month plus the next 3.
- **Published month:** "Published — <month>", the station-day calendar with each person's display name (or email prefix), Uncovered in red, and a read-only day panel.
- **Own shifts:** marked "You" and coloured.
- **Not published:** a draft or empty month shows "Not published yet" to everyone. Managers also get a link to `/manager/schedule`.

`/account` lets each user set or clear the name colleagues see.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Read path | SECURITY DEFINER `get_published_schedule(month)` | One snapshot, no new table policies, and it returns only derived names and no availability. | Research |
| Name shown | New `profiles.display_name`; falls back to the email prefix, then the id prefix | People choose how colleagues see them, and no full email ever reaches employees. | Plan |
| Who sets the name | The user, on a new `/account` page, via `set_display_name` | Self-service, and no column grant or self-update policy ever exposes `role`. | Plan |
| Months offered | `scheduleMonths()` (4 tabs); unpublished shows "Not published yet" | Same tab set as `/manager/schedule`, and employees see that a month is pending. | Plan |
| Manager access | Shared `/schedule`, linked from the dashboard and the published card | Managers see exactly what employees see (FR-007). | Plan |
| Own shifts | "You" pill plus a new `--highlight` token colour | Answers "when do I work" at a glance, without colour literals. | Plan |
| Day-1 previous night | Not shown | Each tab is its own station days, and that night sits on the previous month's last day. | Plan |
| Smoke | Name write, anonymous refusal, draft invisible to an employee; no successful publish | Covers the new write endpoint cheaply, and the published view is proved in pgTAP. | Research / Plan |

## Scope

**In scope:**
- **Database:** one migration (`display_name`, two functions), regenerated types, and pgTAP in `schedules.test.sql` and `profiles_roles.test.sql`.
- **`/account`:** the page, `POST /api/account/display-name` and `src/lib/account.ts`.
- **`/schedule`:** the page, `src/lib/published-schedule.ts` and `PublishedDayPanel`.
- **Shared changes:** `ScheduleCalendar` props (`labels`, `hrefFor`, `ownEmployeeId`) and the `--highlight` token.
- **Wiring:** route gating and inventory, kitchen sinks, the `check:ui` scope, dashboard links, smoke and CLAUDE.md.

**Out of scope:**
- Display names on the manager pages.
- Manager editing of other people's names, and a name at signup.
- Past months.
- A "my shifts" filter.
- Notifications (FR-009) and export (FR-008).
- New select policies on any table.

## Architecture / Approach

Postgres remains the enforcement layer. One read function returns a month's shifts with `assignee_name` only while `published_at` is set. One write function updates `display_name` where `id = auth.uid()`. Both run with `search_path = ''`, and only `authenticated` can execute them.

The page makes one function call through a pure `buildPublishedSchedule`, which returns `unknown | notPublished | published`, so a failed read never looks like "Not published yet". It reuses `ScheduleCalendar` (the manager page passes what it renders today) and a new small read-only day panel. `/account` copies the role endpoint's form-post, redirect and allow-list pattern.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Database read and write paths | Column, two functions, types, pgTAP | Name rule drift between SQL and `calendarName`; role escalation through `profiles` |
| 2. Display name on /account | Page, endpoint, helpers, routes, kitchen sink | Raw database error text leaking past the allow-list |
| 3. Published schedule on /schedule | Grid page, loader, day panel, token, links | A `ScheduleCalendar` prop change visibly changing the manager grid |
| 4. Smoke steps and documentation | End-to-end proof, CLAUDE.md | Smoke run against the hosted DB (`.dev.vars`) |

**Prerequisites:** S-04 merged (done), Docker and the local Supabase stack, and a reset to apply the migration.
**Estimated effort:** about 2–3 sessions across 4 phases.

## Open Risks & Assumptions

- The SQL name fallback must stay identical to `calendarName`. pgTAP pins the three fallback cases, and comments cross-reference the two places.
- An empty function result is read as "not published". This holds because a published month cannot lose all its shifts (publish requires every day covered, and RLS plus the guard trigger freeze it).
- A page already open in a browser keeps showing a just-unpublished month until it is reloaded (SSR). This is accepted for the MVP.

## Success Criteria (Summary)

- An employee sees a published month as a grid with colleagues' names and their own shifts highlighted, and never sees a draft, an email or anyone's availability.
- Unpublishing hides the month from everyone on the next load.
- `npm run test:db`, `npm test`, `npm run check:ui`, `npx astro check` and `npm run smoke` all pass.
