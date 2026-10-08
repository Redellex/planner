---
project: Planner
version: 1
status: draft
created: 2026-09-24
updated: 2026-10-08
prd_version: —
main_goal: low-complexity
top_blocker: capacity
milestone_id: smoother-navigation-and-assignment
milestone_seq: 2
milestone_status: open
---

# Roadmap: Planner

> Derived from the user's description of M-2 (anchors below) + auto-researched codebase baseline.
> Edit-in-place; archive when superseded.
> Slices below are listed in dependency order. The "At a glance" table is the index.

## Milestone

**M-2: Smoother navigation and assignment** — Status: open

- **Intent:** Make the shipped app quicker to move around and to assign shifts in: sign-in lands on the dashboard, which becomes the home page; every page carries navigation limited to what the viewer's role may open; a day's manual assignments save at once; and the last legacy views move onto the design tokens.
- **Source materials:** user description (2026-10-08), verbatim: "1. Sign in should redirect to dashboard automaticaly. Current main page should be changed to dashboard. 2. All pages and subpages should have in the top right navigation tab with links to pages that user role is allowed to go. Currently there is one navigation bar on current main page (not dashboard) but it's outdated. 3. When you choose persons to shifts manually then i want one save button for that day so i don't need to save 2-3 times. 4. Update the UI task/issue since we won't have current main page - it will change to dashboard."
- **Done when:** every S-NN below is `done`.
- **Scope anchors:**
  - MS-01: After signing in, the user lands on the dashboard, and the dashboard replaces the current main page (`/`); the starter welcome page goes away.
  - MS-02: Every page and subpage has a top-right navigation with links to exactly the pages the user's role may open, replacing the outdated top bar that only the welcome page shows.
  - MS-03: When the manager picks people for shifts by hand, one Save for the whole day stores every change, instead of one Save per shift.
  - MS-04: The legacy-views UI cleanup (the views still on `bg-cosmic`) is updated for the dashboard becoming the home page: the welcome page drops out of it and the dashboard is cleaned as the home page.

## Vision recap

A gas-station manager used to build the monthly shift schedule by hand in a spreadsheet; M-1 replaced that with availability collection, fair automatic generation, override, publish and a published grid everyone can read. M-2 does not add scheduling capability: it removes the friction people now hit in daily use — landing on a stale welcome page, hunting for links, and saving each shift of a day separately.

## North star

**S-08: Manager saves all of one day's manual assignments with a single Save** — the manager does this every time they adjust a draft, so it is the change that saves the most repeated effort, and it is the only M-2 slice that touches write logic.

> "North star" here means the slice whose delivery best proves the milestone worked — for M-2, the one that removes the most repeated work from someone's routine. It has no prerequisites, so it can start at once, in parallel with the navigation stream.

## At a glance

| ID   | Change ID              | Outcome (user can …)                                                                | Prerequisites | PRD refs | Status |
| ---- | ---------------------- | ----------------------------------------------------------------------------------- | ------------- | -------- | ------ |
| S-06 | dashboard-as-home      | User lands on the dashboard after sign-in; the dashboard is the home page at `/`    | —             | MS-01    | done   |
| S-07 | role-aware-navigation  | User sees a top-right navigation on every page with only the links their role opens | S-06          | MS-02    | done   |
| S-08 | schedule-day-save      | Manager saves all of one day's manual assignments with a single Save                | —             | MS-03    | ready  |
| S-09 | legacy-views-ui-tokens | User sees the dashboard, auth pages, 403 and `/manager/months` on the design tokens | S-06, S-07    | MS-04    | done   |

## Streams

Navigation aid — groups items that share a Prerequisites chain. Canonical ordering still lives in the dependency graph below; this table is the proposed reading order across parallel tracks.

| Stream | Theme              | Chain                    | Note                                                                                   |
| ------ | ------------------ | ------------------------ | -------------------------------------------------------------------------------------- |
| A      | Navigation & views | `S-06` → `S-07` → `S-09` | Smallest first: home, then the nav on top of it, then restyling the views around both. |
| B      | Day save           | `S-08`                   | Standalone; can run alongside stream A, the best lever for limited capacity.           |

## Baseline

What's already in place in the codebase as of `2026-10-08` (auto-researched + user-confirmed).
No foundations are needed for this milestone.

- **Frontend:** present — Astro 7 SSR + React 19 islands, Tailwind 4, shadcn tokens (`src/styles/global.css`). Legacy views still on `bg-cosmic`: `/` (`src/components/Welcome.astro` with `src/components/Topbar.astro`, the only page with a top bar), `/dashboard`, the auth pages, `403.astro`, `/manager/months`. Other pages have only a bottom "Back to dashboard" button. (Since S-06: `/` is the dashboard, `/dashboard` answers 301 → `/`, and `Welcome.astro`/`Topbar.astro` are gone.) (Since S-07: every page has one top bar, `src/components/navigation/AppNav.astro` mounted in `Layout.astro`, and the "Back to dashboard" buttons are gone.) (Since S-09: no view is on `bg-cosmic`; the dashboard, auth pages, 403, `/manager/months` and the not-configured banner are on the design tokens, with kitchen sinks and in the `check:ui` scope.)
- **Backend / API:** present — form-post + redirect endpoints; sign-in redirects to `/` (`src/pages/api/auth/signin.ts:19`).
- **Data:** present — Supabase migrations, RLS, pgTAP (`supabase/migrations/`, `supabase/tests/database/`).
- **Auth:** present — Supabase SSR auth plus role gating (`src/middleware.ts`, `src/lib/route-access.ts`, route inventory guard `src/lib/route-inventory.test.ts`).
- **Deploy / infra:** present — Cloudflare Workers via `wrangler deploy`, CI with smoke against local Supabase (`.github/workflows/ci.yml`).
- **Observability:** partial — Workers observability enabled (`wrangler.jsonc`), no error tracking. Orthogonal to this milestone.

## Foundations

(None — every layer M-2 touches is present in the baseline.)

## Slices

### S-06: Dashboard as home

- **Outcome:** User signs in and lands straight on their dashboard, which is now the home page at `/`; the starter welcome page is gone.
- **Change ID:** dashboard-as-home
- **PRD refs:** MS-01
- **Prerequisites:** —
- **Parallel with:** S-08
- **Blockers:** —
- **Unknowns:**
  - What does an anonymous visitor get at `/` — a redirect to sign-in, or a minimal public page? — Owner: user. Block: no (default: redirect to sign-in, since every page needs an account).
  - Does `/dashboard` stay as a redirect to `/` so old links keep working? — Owner: user. Block: no (default: yes).
- **Risk:** Smallest slice, but it changes the `/` row of the route gate and the route inventory guard, and the smoke sign-in step; keep those in step.
- **Status:** done

### S-07: Role-aware navigation

- **Outcome:** On every page, a signed-in user sees a top-right navigation with links to exactly the pages their role may open (plus Sign out), and an anonymous visitor sees Sign in / Sign up; the outdated welcome-page top bar is gone.
- **Change ID:** role-aware-navigation
- **PRD refs:** MS-02
- **Prerequisites:** S-06 (the nav's home link and the old top bar's removal assume `/` is the dashboard)
- **Parallel with:** S-08
- **Blockers:** —
- **Unknowns:**
  - How does the navigation fit a phone-width screen — a collapsed menu or wrapping links? — Owner: user. Block: no.
  - Do the bottom "Back to dashboard" buttons go once the navigation has a home link? — Owner: user. Block: no (default: remove them).
- **Risk:** Touches every page's layout; the failure mode is a link the route gate refuses or a permitted page with no link, so the link list must come from the same route lists the middleware uses.
- **Status:** done

### S-08: Day-level save for manual assignments

- **Outcome:** Manager changes who works several shifts of one station day on `/manager/schedule` and saves them all with one Save for that day; any warnings are shown once for the combined change before "Assign anyway".
- **Change ID:** schedule-day-save
- **PRD refs:** MS-03
- **Prerequisites:** — (external state: S-04's override flow, done in M-1)
- **Parallel with:** S-06, S-07, S-09
- **Blockers:** —
- **Unknowns:**
  - Are warnings computed on the whole day's changes together, so two changes that only conflict with each other are caught, with one confirm for all? — Owner: user. Block: no (default: yes).
  - If one shift of the day changed underneath the manager (stale), is the whole day refused or the rest saved? — Owner: user. Block: no (default: refuse the whole day, all-or-nothing).
- **Risk:** The only slice that touches write logic: the override endpoint and `overrideWarnings` handle one shift today, and separate row updates are not atomic, so a day's save must land all-or-nothing or a half-saved day can appear.
- **Status:** ready

### S-09: Legacy views on the design tokens

- **Outcome:** User sees the remaining legacy views — the dashboard (now the home page), sign-in, sign-up and confirm-email, the 403 page and `/manager/months` — on the shadcn design tokens like the rest of the app, each with a kitchen sink and inside the `check:ui` scope.
- **Change ID:** legacy-views-ui-tokens
- **PRD refs:** MS-04
- **Prerequisites:** S-06, S-07 (restyle the views once, after the home page and the shared navigation exist)
- **Parallel with:** S-08
- **Blockers:** —
- **Unknowns:**
  - One `/10x-ui` change for all the views, or one per view? — Owner: user. Block: no. — **Answered:** one change for all six views.
- **Risk:** Largest by page count but UI-only, following the pattern in `context/archive/*-ui-tokens/tokens.md`; the welcome page drops out of scope because S-06 removes it. Split per view if one change grows too large.
- **Delivery (2026-10-08):** implemented in `context/changes/legacy-views-ui-tokens/`, PR #50. Error text on these views comes only from allow-lists (`src/lib/auth-feedback.ts`, `src/lib/manager-months.ts`; raw Supabase/PostgREST text is logged), `/manager/months` fails closed on a failed lock read and shows results in the month's row, the auth forms have a working pending state, and `bg-cosmic` and `LibBadge.astro` are deleted. No database change.
- **Status:** done

## Backlog Handoff

| Roadmap ID | Issue | Change ID              | Suggested issue title                                                          | Ready for `/10x-plan` | Notes                                         |
| ---------- | ----- | ---------------------- | ------------------------------------------------------------------------------ | --------------------- | --------------------------------------------- |
| S-06       | #41   | dashboard-as-home      | Sign-in lands on the dashboard, which becomes the home page                    | —                     | Done in PR #46 — archived 2026-10-08          |
| S-07       | #42   | role-aware-navigation  | Role-aware top-right navigation on every page                                  | —                     | Done in PR #48 — archived 2026-10-08          |
| S-08       | #43   | schedule-day-save      | One Save per day for manual shift assignments                                  | yes                   | North star; run `/10x-plan schedule-day-save` |
| S-09       | #44   | legacy-views-ui-tokens | Legacy views cleanup: dashboard, auth, 403, `/manager/months` on design tokens | —                     | Done in PR #50 — 2026-10-08                   |

## Open Roadmap Questions

1. **[#7]** **What are the expected request volume (qps) and data volume for this product?** — Owner: user. Block: not blocking (small single-station scale is already assumed); resolve before infrastructure sizing decisions downstream. (Carried verbatim from PRD `## Open Questions`.)

## Parked

- **Manager can export/print the schedule (FR-008)** (#8) — Why parked: PRD marks it nice-to-have; not part of M-2's quick wins.
- **Employee is notified when a new schedule is published (FR-009)** (#9) — Why parked: PRD marks it nice-to-have and its own Socrates note flags it as marginal-benefit infrastructure.
- **`/manager/availability` on the design tokens** — Why parked: M-1 follow-up (S-04); it is already off `bg-cosmic` but has no kitchen sink, is outside the `check:ui` scope and keeps a `text-[10px]`. Not a legacy `bg-cosmic` view, so outside MS-04.
- **More even night counts after the repair pass** — Why parked: M-1 follow-up (S-03); in the kitchen-sink gaps fixture one person gets 8 nights against a lowest of 6.
- **Short availability windows leave every shift uncovered** — Why parked: M-1 follow-up (S-03); show shift times on the availability form or allow shorter shifts.
- **Version token against concurrent overrides** — Why parked: M-1 follow-up (S-04); two clean overrides can together create an unwarned same-day or back-to-back pair, shown on the next load (accepted limit).
- **Duplicate display names** — Why parked: M-1 known limitation (S-05); add a unique index on `lower(display_name)` or show the email prefix when two people share a name.
- **No labor-law enforcement** — Why parked: PRD Non-Goal — the generator does not encode legal rest-period rules; manager is responsible for compliance.
- **No sick leave / vacation (L4/urlopy) tracking** — Why parked: PRD Non-Goal — availability windows are the only input; time off is not modeled.
- **No multi-employee shifts** — Why parked: PRD Non-Goal — every shift is assigned to exactly one employee by default.
- **No native mobile app** — Why parked: PRD Non-Goal — web-only for MVP.

## Milestone History

- **M-1: First valid monthly schedule** (`first-valid-monthly-schedule`) — closed 2026-10-08. The full must-have path (FR-001–FR-007, US-01) shipped: availability, team view, fair generation, override and publish, and the published grid (F-01, S-01–S-05; PRs #10–#39).

## Done

(M-1's items, Backlog Handoff and Done entries are in its closing roadmap: `git show 53eaffe:context/foundation/roadmap.md`.)

- **S-06: User signs in and lands straight on their dashboard, which is now the home page at `/`; the starter welcome page is gone.** — Archived 2026-10-08 → `context/archive/2026-10-08-dashboard-as-home/`. Lesson: —.
- **S-07: On every page, a signed-in user sees a top-right navigation with links to exactly the pages their role may open (plus Sign out), and an anonymous visitor sees Sign in / Sign up; the outdated welcome-page top bar is gone.** — Archived 2026-10-08 → `context/archive/2026-10-08-role-aware-navigation/`. Lesson: —.
- **S-09: User sees the remaining legacy views — the dashboard (now the home page), sign-in, sign-up and confirm-email, the 403 page and `/manager/months` — on the shadcn design tokens like the rest of the app, each with a kitchen sink and inside the `check:ui` scope.** — Archived 2026-10-08 → `context/archive/2026-10-08-legacy-views-ui-tokens/`. Lesson: —.
