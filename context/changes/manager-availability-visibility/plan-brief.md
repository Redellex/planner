# Manager Availability Visibility — Plan Brief

> Full plan: `context/changes/manager-availability-visibility/plan.md`

## What & Why

Managers need to see every employee's submitted availability for a month in one place before they lock it and build the schedule (roadmap S-02, PRD FR-002). Today the only availability page is `/availability`, which deliberately shows just the signed-in user's own windows. So there is no way for a manager to see who can work when, or who hasn't submitted yet.

## Starting Point

RLS already lets managers read all windows and all profiles; the S-01 change added that read access in advance, and `/manager/*` is already manager-gated in `src/middleware.ts`. `src/lib/availability.ts` and the `/availability` components provide the month rules, calendar grid, window labels and wall-clock conventions to reuse. Profiles carry only `email` and `role`, with no display name.

## Desired End State

A manager opens `/manager/availability` (linked from the dashboard and top bar) and picks the current month or one of the next 3; next month is the default. They see a calendar with the number of available people per day, a day panel listing everyone's windows for the chosen day plus who has none, the month's lock status with a link to `/manager/months`, and a team summary with each person's window count, total hours or a "No availability submitted" flag. "Show only" narrows the view to one person. Employees get 403.

## Key Decisions Made

| Decision                 | Choice                                                                      | Why (1 sentence)                                                                                                    |
| ------------------------ | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Layout                   | Calendar with per-day counts + day panel listing everyone's windows          | Answers "who can work on day X", reuses the `/availability` grid, and stays usable at phone width.                  |
| Who is listed            | Every profile (employees and managers); "No availability submitted" flag   | The manager spots missing submissions before locking, and managers who take shifts are included.                    |
| Months                   | Current station month + next 3; default next month                         | Covers the months being scheduled and the one in progress.                                                          |
| Extras                   | Lock status + link, hour totals per person, one-employee filter            | All chosen, to link review to locking and give a quick sense of how much each person offered.                       |
| Day a window counts to   | The day and month it starts; windows from the previous month show on day 1 | Same rule as the DB and `/availability`; overnight windows are marked `(+1)`.                                       |
| "Submitted" and totals   | Only windows starting in the month; wall-clock hours, no DST correction    | A previous-month overnight window belongs to the previous month; this matches the 24h check.                        |
| Filter input             | `?employee=` honoured only if it matches a loaded profile id               | The URL is untrusted; anything unknown falls back to everyone, with no error.                                       |
| `starts_at` index        | Not added                                                                  | A few hundred rows a month at one station; revisit if S-03 reads turn out slow.                                     |
| Styling                  | shadcn tokens like `/availability`; other manager pages untouched          | Neutral theme accepted; restyling the older pages is out of scope.                                                  |

## Scope

**In scope:**
- New page `src/pages/manager/availability.astro` plus `TeamCalendar`, `TeamDayPanel` and `TeamSummary` components
- Helpers in `src/lib/availability.ts`: the month list, URL builder, load-error text, `windowMinutes` and `formatDuration`
- A link-builder prop on `MonthTabs`
- Dashboard and top-bar links, three smoke steps, CLAUDE.md updates

**Out of scope:**
- A migration or index, and any write actions on the new page
- An employees × days matrix, past months beyond the current one, and splitting overnight windows across months
- Display names, and restyling `/manager/users`, `/manager/months` or the dashboard
- A unit-test runner

## Architecture / Approach

One server-rendered Astro page under `/manager` inherits the middleware's manager gate. It runs four parallel Supabase selects: profiles, windows starting in the month, windows from the previous month running into day 1, and the month's lock row. The data is grouped by day and by employee in the page frontmatter and rendered by small token-styled components. Errors are logged and shown as one generic alert.

## Phases at a Glance

| Phase                                   | What it delivers                                                    | Key risk                                                                  |
| --------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| 1. Team calendar page                   | `/manager/availability` with tabs, lock status, counts, day panel   | Windows from the previous month mishandled (dropping `.limit(1)`, day 1 only) |
| 2. Team summary and employee filter     | Hour totals, "No availability submitted" flag, `?employee=` filter  | Totals leaking previous-month windows or using `new Date` on wall-clock strings |
| 3. Navigation, smoke coverage and docs  | Links, 3 smoke steps (403 + manager sees window), CLAUDE.md          | Smoke window on station month + 3 day 2 must not collide with manual data |

**Prerequisites:** Local Supabase running with `supabase/seed.sql` applied (seeded manager and employee); station month + 3 not locked locally.
**Estimated effort:** ~1–2 sessions across 3 small phases.

## Open Risks & Assumptions

- Assumes single-station scale; the lack of an index and the unpaginated lists rely on it.
- Each smoke run leaves one window on day 2 of station month + 3 for a fresh user. This is harmless, but it accumulates in local data.

## Success Criteria (Summary)

- A manager can see, for any of the 4 offered months, who is available on each day and exactly when.
- The manager can tell at a glance who hasn't submitted and how many hours each person offered.
- Employees cannot reach the page, and the smoke script proves it along with the manager's view of an employee's window.
