# Role-aware navigation — Plan Brief

> Full plan: `context/changes/role-aware-navigation/plan.md`
> Research: `context/changes/role-aware-navigation/research.md`

## What & Why

Roadmap S-07 (MS-02): every page gets a top-right navigation with links to exactly the pages the viewer's role may open, plus Sign out (or Sign in / Sign up when anonymous). The roadmap names the risk: a link the gate refuses, or a permitted page with no link. So the link list must come from the same decision the middleware uses, not from a second hand-written list.

## Starting Point

`Layout.astro` is the only shared shell, and it renders no navigation. The old welcome-page top bar is already gone (deleted in S-06). Navigation today is the dashboard's hand-coded per-role link grid and Sign out, plus 8 "Back to dashboard" buttons. `routeAccess` in `src/lib/route-access.ts` is the per-actor decision; its prefix lists include `/api/*` and carry no labels.

## Desired End State

Every page shows a bar with "Planner" at the left. At the right are the viewer's links with the current one marked, the email and Sign out. Below `lg` these collapse into a native `<details>` menu. What each viewer sees:

- anonymous: Sign in, Sign up;
- employee, or signed in with no role: Home, Availability, Schedule, Account;
- manager: those four plus Users, Months, Team availability, Manage schedule.

No page scrolls just because of the bar. The back buttons and the dashboard's own Sign out are gone, and the dashboard grid renders from the same list.

## Key Decisions Made

| Decision       | Choice                                                                                     | Why (1 sentence)                                                   | Source                 |
| -------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ | ---------------------- |
| Mount point    | Once in `Layout.astro`                                                                     | The only shell every page renders through.                         | Research               |
| Link source    | Ordered `NAV_LINKS` filtered by `routeAccess(href, actor) === "allow"`                     | One gate decides both access and visibility, so they cannot drift. | Research               |
| Drift guard    | Literal per-actor link sets plus a `src/pages` coverage walk with a literal exclusion list | Catches a refused link and a permitted page with no link.          | Research / Plan        |
| Phone width    | Native `<details>` "Menu" below `lg`, inline row above                                     | No JS, no Radix, and a manager's 8 links don't push content down.  | Plan                   |
| Back links     | Remove all 8, 403 included                                                                 | The bar's Home (or Sign in / Sign up) covers every exit.           | Plan (roadmap default) |
| Dashboard grid | Rendered from `navLinksFor` minus Home; its Sign out removed                               | Keeps quick links on home without a second list.                   | Plan                   |
| Page height    | Body is a `min-h-screen` flex column; 17 wrappers `min-h-screen` → `flex-1`                | No phantom scroll, and legacy cards stay centred.                  | Plan                   |
| Bar content    | "Planner" left; links, email, Sign out right; `aria-current`                               | Says where and who on every page, from locals already loaded.      | Plan                   |
| Kitchen sink   | New `/dev/navigation-states`; existing sinks keep the real bar                             | Every persona can be screenshotted without four accounts.          | Plan                   |

## Scope

**In scope:**

- `src/lib/navigation.ts` + tests, with a shared page walk extracted from the route inventory test
- `AppNav.astro`, the layout mount and the page-height fix on 17 wrappers
- the nav kitchen sink, plus `check:ui` scope and route inventory rows
- removing the back links and the dashboard duplicates
- smoke nav markers, lint-staged, CLAUDE.md and test-plan §6.3

**Out of scope:**

- any change to the gate or the middleware
- restyling the legacy views (S-09)
- new shadcn/Radix components or hydration
- a display name in the bar
- hiding the bar on the existing sinks
- other in-page cross-links
- the default `<title>`

## Architecture / Approach

The middleware sets `locals.user`/`role`. `Layout.astro` passes `{ signedIn: user !== null, role }`, the email and the pathname to `AppNav`. `AppNav` renders `navLinksFor(actor)` (`NAV_LINKS` ∩ `routeAccess === "allow"`) as `buttonVariants` links with `data-nav-link` markers, once inline and once inside a `<details>`. The dashboard reuses `navLinksFor`. The middleware stays the enforcement; the nav only hides links.

## Phases at a Glance

| Phase                                           | What it delivers                                                                     | Key risk                                                                                    |
| ----------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| 1. Navigation model and guard tests             | `navigation.ts`, literal per-actor tests, page coverage walk, lint-staged trigger    | An expected set computed from the lists instead of written as literals would hide drift     |
| 2. Nav component, layout mount and kitchen sink | Bar on every page, height fix, `/dev/navigation-states`, `check:ui` scope            | A manager's bar overflowing at mid widths; the body height being capped by the scoped style |
| 3. Remove duplicate navigation, smoke and docs  | Back links and dashboard Sign out gone, grid from the list, smoke markers, CLAUDE.md | Smoke against the hosted env instead of local (`.dev.vars`)                                 |

**Prerequisites:** S-06 done (`/` is the dashboard). Local Supabase with the seed for smoke.
**Estimated effort:** ~2 sessions across 3 phases.

## Open Risks & Assumptions

- `Astro.url.pathname` inside the rewritten 403 render is unverified. It doesn't matter: manager links are filtered out for the non-managers who reach 403.
- The `lg`/`xl` breakpoints are estimates for the manager's ~1,100px bar; the manual width checks confirm or adjust them.
- Sign out in the bar is inert on the 4 dev sinks that stop all submits (dev only, accepted).

## Success Criteria (Summary)

- Each of the four actors sees exactly its literal link set on every page, proven by unit tests and smoke.
- A new page without a nav link or an explicit exclusion fails `npm test` and pre-commit.
- No page scrolls only because of the bar, and the manager's bar fits at 390–1280px.
