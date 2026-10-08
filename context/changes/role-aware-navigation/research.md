---
date: 2026-10-08T12:38:40+02:00
researcher: Claude (Opus 5.5) for Redellex
git_commit: 0231905e293840cffbb6b4355eee9104e4a5a775
branch: docs/s06-done
repository: Redellex/planner
topic: "S-07 role-aware navigation: where a top-right nav mounts, how its links come from the route gate, and what it touches"
tags: [research, navigation, layout, route-access, middleware, ui-tokens, smoke]
status: complete
last_updated: 2026-10-08
last_updated_by: Claude (Opus 5.5)
---

# Research: S-07 role-aware navigation

**Date**: 2026-10-08T12:38:40+02:00
**Researcher**: Claude (Opus 5.5) for Redellex
**Git Commit**: 0231905e293840cffbb6b4355eee9104e4a5a775
**Branch**: docs/s06-done
**Repository**: Redellex/planner

## Research Question

Roadmap slice S-07 (`role-aware-navigation`, MS-02, issue #42): "On every page, a signed-in user sees a top-right navigation with links to exactly the pages their role may open (plus Sign out), and an anonymous visitor sees Sign in / Sign up; the outdated welcome-page top bar is gone" (`context/foundation/roadmap.md:96`). Its risk: "the link list must come from the same route lists the middleware uses" (`roadmap.md:105`).

The research answers these questions:

1. Where can one nav mount so that it reaches every page?
2. What user and role data does it get, including on the 403 rewrite?
3. How can the link set be derived from the route gate so that it cannot drift?
4. Which existing markup, tests, smoke steps and UI gates does it touch?
5. Which choices are still open for `/10x-plan`?

## Summary

- **Mount point.** Mount it once in `src/layouts/Layout.astro`. That file is the only shared shell. Every renderable page under `src/pages`, the five `/dev/*` kitchen sinks included, renders through it and passes only `title`. The one exception, `src/pages/dashboard.astro`, has no template: it answers 301 → `/`. No page has a `<header>` or a top bar today. The S-06 change already deleted the old welcome-page `Topbar.astro` (commit `ce8f409`), so the "outdated top bar is gone" half of the outcome is already met.
- **Data.** The nav can read `Astro.locals.user` and `Astro.locals.role`, which the middleware sets on every request. The deleted Topbar read the same pair (`git show ce8f409^:src/components/Topbar.astro`, line 4). The 403 page is reached through `context.rewrite("/403")` (`src/middleware.ts:32-33`). Astro's docs say a rewrite "will trigger a new rendering phase, causing any middleware to be re-executed" (withastro/docs, guides/middleware, via Context7), so the 403 page gets fresh locals.
- **Link derivation.** `route-access.ts` holds prefix lists, not pages with labels. Those lists include `/api/*` and `/dashboard`, so they cannot produce the nav by themselves. The drift-proof shape is:
  - a small list of candidate links (`href` + label) in `src/lib`,
  - filtered per viewer by `routeAccess(href, { signedIn, role }) === "allow"`, the function the middleware calls.

  With today's lists that filter gives these sets:
  - **Anonymous:** Sign in and Sign up only, because the protected and manager pages answer `signin`.
  - **Signed in (employee, or signed in with no role):** Home, Availability, Schedule and Account, plus Sign out. The guest pages answer `home` and are dropped.
  - **Manager:** those links plus the four `/manager/*` pages.

  The test plan requires the expected outcomes in these tests to be literals, not computed from the route lists (`context/foundation/test-plan.md:164`).

- **What it touches:**
  - The dashboard (`src/pages/index.astro:27-92`) already renders the same per-role link grid and Sign out by hand.
  - Eight pages carry a "Back to dashboard" link.
  - Smoke and the unit tests assert none of the nav's likely labels. One marker must survive: smoke needs `data-dashboard` on `/`.
  - `check:ui` does not cover `Layout.astro` or the legacy pages.
- **Open product choices:**
  - phone width (wrapping links vs a collapsed menu),
  - whether the "Back to dashboard" links go (roadmap default: remove),
  - whether the dashboard keeps its own link grid,
  - how the nav sits above the legacy `bg-cosmic` full-height pages until S-09.

## Detailed Findings

### 1. Mount point: `Layout.astro`

- `src/layouts/Layout.astro:6-10` takes `{ title?: string }` (default title "10x Astro Starter").
- `:14` sets `<html lang="en" class="dark">`.
- The body renders one config `Banner` per missing config (`:21-35`), then `<slot />` (`:36`).
- It does not read `Astro.locals` today.
- Every page under `src/pages` that renders markup imports this layout and passes only `title`. The checked set:
  - `index`, `403`, `account`, `availability`, `schedule`
  - `auth/{signin,signup,confirm-email}`
  - `manager/{availability,months,schedule,users}`
  - `dev/{account,availability,manager-users,published-schedule,schedule}-states`

  `src/pages/dashboard.astro:5-6` only sets status 301 and `Location: /`.

- No `<header>` or nav landmark exists in any page. The only `<nav>` in components is the month tabs, `<nav aria-label="Months">` (`src/components/availability/MonthTabs.astro:17`). A second `<nav>` therefore needs its own `aria-label`.
- The page wrappers come in two families:
  - **Token views.** `min-h-screen bg-background p-4` > `mx-auto w-full max-w-2xl`, for example `src/pages/account.astro:47-48`. `/schedule`, `/manager/schedule` and `/manager/availability` widen to `lg:max-w-6xl` (`src/pages/schedule.astro:32`, `src/pages/manager/schedule.astro:236`, `src/pages/manager/availability.astro:178`).
  - **Legacy views.** `bg-cosmic flex min-h-screen items-center justify-center p-4`, a centred card (`src/pages/index.astro:9`, `src/pages/403.astro:9`, the three auth pages, `src/pages/manager/months.astro:36`).

  Either way the page wrapper is `min-h-screen`. A bar rendered above `<slot />` makes every page taller than the viewport. On the legacy pages it would also sit outside the gradient, because `bg-cosmic` is on the wrapper (`src/styles/global.css:121`), not on `body`.

### 2. User and role available to the nav

- `src/middleware.ts:8-22` sets `locals.user` from `supabase.auth.getUser()` and `locals.role` from `roleFromProfile(...)`. Both are `null` when the visitor is anonymous or Supabase is unconfigured. `role` is also `null` when the profile row is missing or unreadable (`src/lib/route-access.ts:52-55`). Types are in `src/env.d.ts:2-5`.
- `routeAccess` has four outcomes (`route-access.ts:21`). The route-access test checks four actors (`src/lib/route-access.test.ts:9-15`):
  - anonymous
  - employee
  - manager
  - `noRole`: signed in with `role: null`, which gets `allow` on signed-in pages and `forbidden` on manager pages
- **403.** For a denied manager path the middleware calls `context.rewrite("/403")` (`middleware.ts:32-33`). Per Astro's middleware guide (Context7, `/withastro/docs`), the rewrite re-executes middleware, so `/403` renders with `user` and `role` resolved for that request. An anonymous direct visit to `/403` is `allow` (`src/lib/route-inventory.test.ts:17`) with `user = null`, so the nav would show Sign in / Sign up there.
- **Not verified:** what `Astro.url.pathname` reports inside the rewritten 403 render (`/403` or the original path). This matters only if the nav marks the current link from the URL. On `/403` no candidate link matches either way, unless the original manager path is reported.
- **Dev kitchen sinks.** All five render `Layout` only when `import.meta.env.DEV` is set; otherwise they answer 404 (e.g. `src/pages/dev/account-states.astro:19-22`, `:49-50`). They use fixture data, not `Astro.locals`. A layout nav that reads `Astro.locals` would therefore show the real visitor's session on those pages, not the fixture persona.
- Four of the five sinks attach a submit listener that calls `preventDefault()` (`account-states.astro:89`, `availability-states.astro:203`, `manager-users-states.astro:124`, `schedule-states.astro:676`; none was found in `published-schedule-states.astro`). A Sign out form in the layout nav would be inert on those four pages in dev. Whether the listener selects every form or only some was checked in `account-states.astro` only.

### 3. Deriving the links from the route gate

- **The gate's lists** (`src/lib/route-access.ts:6-19`):
  - `PROTECTED_ROUTES = ["/", "/dashboard", "/availability", "/api/availability", "/account", "/api/account", "/schedule"]`
  - `MANAGER_ROUTES = ["/manager", "/api/manager"]`
  - `GUEST_ROUTES = ["/auth/signin", "/auth/signup", "/auth/confirm-email"]`

  `routeAccess` (`:33-49`) returns, in this order:
  - `home` for a guest page and a signed-in actor;
  - `signin` for a protected path and an anonymous actor;
  - for a manager path, `signin` when anonymous and `forbidden` for any role other than `manager`;
  - otherwise `allow`.

- **Why the lists alone are not enough:** they are prefixes, they carry no labels, they include `/api/*` endpoints, and they include `/dashboard`, which is only a 301. `MANAGER_ROUTES` holds `/manager`, which is not a page (no `src/pages/manager/index.astro` in the file list).
- **Candidate pages for the nav.** These are the renderable, non-dev, non-redirect pages. Labels are from the dashboard where it has one:

  | href                    | label (dashboard)           | employee / noRole | manager | anonymous |
  | ----------------------- | --------------------------- | ----------------- | ------- | --------- |
  | `/`                     | (none; "Dashboard" heading) | allow             | allow   | signin    |
  | `/availability`         | Availability                | allow             | allow   | signin    |
  | `/schedule`             | Schedule                    | allow             | allow   | signin    |
  | `/account`              | Account                     | allow             | allow   | signin    |
  | `/manager/users`        | Users                       | forbidden         | allow   | signin    |
  | `/manager/months`       | Months                      | forbidden         | allow   | signin    |
  | `/manager/availability` | Team availability           | forbidden         | allow   | signin    |
  | `/manager/schedule`     | Manage schedule             | forbidden         | allow   | signin    |
  | `/auth/signin`          | Sign in                     | home              | home    | allow     |
  | `/auth/signup`          | Sign up                     | home              | home    | allow     |

  The access columns are the classes in `src/lib/route-inventory.test.ts:15-49`, mapped through `OUTCOMES` at `:51-56`. The dashboard labels are at `src/pages/index.astro:28-83`. "Manage schedule" vs "Schedule" was settled in `context/archive/2026-10-07-view-published-schedule/plan.md:46`.

  The table leaves out three pages:
  - `/auth/confirm-email`: a post-sign-up landing, not a destination;
  - `/403`;
  - `/dev/*`.

- **Filtering a candidate list with `routeAccess(href, actor) === "allow"`** gives exactly the roadmap outcome for each of the four actors above. Sign out is not a page: it is `POST /api/auth/signout` (`src/pages/api/auth/signout.ts:4-9`, public per `route-inventory.test.ts:23`). So it is shown whenever `user` is set, as on the dashboard (`index.astro:85-92`) and the old Topbar.
- **Coverage guard (inference).** A unit test can enumerate `src/pages` the way `route-inventory.test.ts:64-75` does. It would require every page whose `EXPECTED_ACCESS` class is `signed-in` or `manager` to appear in the candidate list, except an explicit exclusion set (today `/dashboard`) and the `/api/*` endpoints. A new page then fails until it gets a link or an explicit exclusion. Per `test-plan.md:164`, the per-actor expected link sets should be literal arrays.
- **Drift precedent.** The deleted Topbar (`git show ce8f409^:src/components/Topbar.astro`) and the dashboard each kept their own hand-written list:
  - The Topbar linked `/dashboard` and had no `/schedule` or `/account` link.
  - The dashboard (`src/pages/index.astro:27-83`) still hand-codes `{user && …}` and `{role === "manager" && …}`.
  - Earlier archives tracked the same two-places problem (reported by the prior-decisions sweep: `context/archive/2026-09-25-role-aware-access-control/reviews/plan-review.md:54-62`, F3).

### 4. What the change touches

**"Back to dashboard" links (`href="/"`)**, 8 occurrences found by the page inventory:

- `src/pages/403.astro:16-21` (the 403 page's only way out)
- `src/pages/account.astro:61-65`
- `src/pages/availability.astro:161-165`
- `src/pages/schedule.astro:46-50`
- `src/pages/manager/availability.astro:226-230`
- `src/pages/manager/months.astro:84-88`
- `src/pages/manager/schedule.astro:314-318`
- `src/pages/manager/users.astro:92-96`

S-06 deferred their fate to S-07 (`context/archive/2026-10-08-dashboard-as-home/plan.md:39`). The roadmap default is to remove them (`roadmap.md:104`).

**Other in-page cross-links** (not navigation duplicates):

- "Manage month locks" (`manager/availability.astro:200-202`, `manager/schedule.astro:253-255`, `src/components/schedule/ScheduleActions.astro:144`)
- "View published schedule" (`ScheduleActions.astro:75-77`)
- the manager's link on "Not published yet" (`src/components/published-schedule/PublishedScheduleView.astro:73-74`)

**The dashboard** (`src/pages/index.astro`):

- A link grid: 3 links for any signed-in user (`:28-51`), 4 more for managers (`:52-83`).
- A Sign out form (`:85-92`).
- `data-dashboard` (`:11`), which smoke requires (`scripts/smoke.mjs:201`).

**Smoke** (`scripts/smoke.mjs`):

- It checks bodies with `includes` on tag-stripped text or raw HTML (`:99-102`). The checks a nav must not collide with:
  - "Access denied" (`:124`)
  - `data-schedule-draft` / `data-schedule-published` (`:129`, `:134`)
  - "Colleagues see you as Smoke User" (`:229`)
  - `` `${email} 10:00 – 12:00` `` (`:368`)
  - "Not published yet" (`:430`)
  - no `data-shift-id` (`:432`)
  - the first `data-shift-id` (`:445`)
- No smoke step asserts "Back to dashboard", "Sign out", "Sign in", `href="/"` or a link count.
- Sign out is exercised as a bare `POST /api/auth/signout` (`:327-329`, `:540-542`). That is unaffected by where the button is rendered.
- Inference: a nav that prints the user's email would not collide with `:368`, since there the email is followed by window hours in a calendar cell.

**Unit tests.** No Vitest test renders `.astro` (environment `node`, `vitest.config.ts:7-9`). The nav's logic is unit-testable only if it lives as a pure function in `src/lib`.

**`check:ui`.** The scope list (`scripts/check-ui-literals.mjs:17-33`) has 15 entries. It covers neither `src/layouts/` nor `index.astro`, `403.astro`, `/manager/months` or the auth pages. A new nav component file would need to be added to `SCOPE` to be guarded. CLAUDE.md's UI rules (tokens, `buttonVariants` for links, no hydration by default, kitchen sink per cleaned view) apply.

**Route inventory.** The nav adds no file under `src/pages` unless it gets a kitchen sink (`src/pages/dev/navigation-states.astro` would need a `public` row in `route-inventory.test.ts:24-29`).

### 5. UI building blocks available

- **`src/components/ui/`** holds only `alert`, `button`, `input`, `native-select` and `LibBadge`. There is no dropdown-menu, sheet or navigation-menu.
- **Dependencies.** The only Radix package is `@radix-ui/react-slot` (`package.json:26`). Earlier UI changes refused shadcn components that add Radix packages (reported by the prior-decisions sweep: `context/archive/2026-09-28-availability-ui-tokens/plan.md:69`, `context/archive/2026-09-29-manager-users-ui-tokens/plan.md:76`).
- **Hydration.** CLAUDE.md "No hydration by default" rules out a hydrated menu unless the plan argues for it. A collapsed phone menu without new dependencies or JS would be a native `<details>`/`<summary>`. Wrapping links need neither.
- **Phone width.** Cleaned views were checked at 1280px and 390px with no horizontal scroll (reported by the prior-decisions sweep, e.g. `manager-users-ui-tokens/plan.md:51`). The PRD lists "mobile-web usability is not a guaranteed target" under non-goals (`context/foundation/prd.md:117`).

## Code References

- `src/layouts/Layout.astro:6-36` — the shared shell: title prop, config banners, slot; the natural nav mount point
- `src/middleware.ts:8-37` — sets `locals.user` / `locals.role`, maps `routeAccess` to redirect / rewrite `/403` / redirect home
- `src/lib/route-access.ts:6-19` — `PROTECTED_ROUTES`, `MANAGER_ROUTES`, `GUEST_ROUTES`
- `src/lib/route-access.ts:33-49` — `routeAccess`, the per-actor decision a link filter can reuse
- `src/lib/route-access.ts:52-55` — `roleFromProfile`, fail closed to `null`
- `src/lib/route-inventory.test.ts:15-56` — per-route access classes and per-actor outcomes; `:64-75` walks `src/pages`
- `src/lib/route-access.test.ts:9-22` — the four actors, including `noRole`
- `src/pages/index.astro:5-92` — today's hand-written per-role link grid, Sign out, `data-dashboard`
- `src/pages/403.astro:4-21` — status 403 for any method, only link "Back to dashboard"
- `src/pages/api/auth/signout.ts:4-9` — `POST` only, redirects to `/auth/signin`
- `src/components/availability/MonthTabs.astro:17` — the only existing `<nav>` (`aria-label="Months"`)
- `scripts/smoke.mjs:99-102, 124, 201, 327-329, 432, 445` — body-marker checks and the sign-out step
- `scripts/check-ui-literals.mjs:17-33` — the `check:ui` scope (no layout, no legacy pages)

## Architecture Insights

- The project keeps one source of truth per rule and guards it with a test that walks the real files: the route inventory, and the station time zone guard. A nav that filters a candidate list through `routeAccess` follows that pattern. A coverage test that walks `src/pages` would extend it to "a permitted page with no link".
- The middleware only maps decisions; pages do not re-check roles (`test-plan.md:162`). The nav hides links. It is not a gate, and the middleware stays the enforcement.
- UI views render shadcn components from `.astro` without hydration. Links use `buttonVariants`, and any marker uses the documented `bg-secondary` pill. Every cleaned view gets a dev kitchen sink and joins `check:ui`. For the nav to have a kitchen sink showing anonymous / employee / manager states, the component has to take the actor (and the current path, for `aria-current`) as props rather than read `Astro.locals` itself. The layout then reads `Astro.locals` and passes them down.

## Historical Context (from prior changes)

- `context/archive/2026-10-08-dashboard-as-home/plan.md:36`: "No new navigation bar. The deleted `Topbar` is replaced by S-07 … Until then, the dashboard's links and the per-page 'Back to dashboard' buttons are the navigation." Still accurate.
- `context/archive/2026-10-08-dashboard-as-home/plan.md:39`: "S-07 decides whether they stay" (the "Back to dashboard" buttons). Still accurate; this research does not decide it.
- Commit `ce8f409` (S-06): deleted `src/components/Topbar.astro` and `Welcome.astro`. The roadmap baseline note (`roadmap.md:67`) agrees. The roadmap's outcome clause "the outdated welcome-page top bar is gone" (`roadmap.md:96`) is therefore already satisfied on `0231905`.
- The UI-token changes deferred a shared app shell to "a change that spans every view" (reported by the prior-decisions sweep: A6 in `context/archive/2026-09-28-availability-ui-tokens/plan.md:65`, D5 in `context/archive/2026-09-29-manager-users-ui-tokens/plan.md:72`). Those plans are archived, and S-07 is that change.
- `roadmap.md:127`: S-09 restyles the dashboard, auth, 403 and `/manager/months` "after the home page and the shared navigation exist". S-07 therefore does not need to move the legacy views onto tokens. It only has to keep them usable with a bar above them.
- MS-02 exists only in the roadmap (`roadmap.md:30`), not in `prd.md`. The user's own wording is quoted at `roadmap.md:26`: "All pages and subpages should have in the top right navigation tab with links to pages that user role is allowed to go."

## Related Research

- `context/archive/2026-10-08-dashboard-as-home/` — S-06, the home page and the removal of the old top bar.
- `context/archive/*-ui-tokens/tokens.md` — the role map the nav's styling should follow.

## Open Questions

For `/10x-plan` and the user; none blocks planning, and the roadmap gives a default where noted.

1. **Phone width** (`roadmap.md:103`): wrapping links, or a collapsed `<details>` menu? A Radix sheet or dropdown would be a new dependency plus hydration, which earlier changes avoided.
2. **"Back to dashboard" links** (`roadmap.md:104`, default remove): remove all 8? The 403 page's only exit is one of them. With a nav on 403 that exit is covered for signed-in users, and an anonymous visitor at `/403` would see Sign in / Sign up.
3. **The dashboard's own link grid and Sign out** (`index.astro:27-92`): keep it as a second list (the drift precedent), render it from the same filtered list, or drop it in favour of the nav? `data-dashboard` must stay either way (`smoke.mjs:201`).
4. **Legacy full-height pages:** with the bar above `<slot />`, the `min-h-screen` wrappers overflow the viewport, and the `bg-cosmic` gradient does not reach the bar. Options: accept until S-09, or make the body a flex column so the content fills the remaining height. This is a layout decision with no prior ruling.
5. **What the nav shows besides links:** the user's email or display name, the role, `aria-current="page"` on the current link, a Home/brand link at the left? The old Topbar showed the email and a role pill. Not decided anywhere.
6. **Kitchen sinks:** the layout nav on `/dev/*` shows the real session, and its Sign out is inert on 4 of the 5 sinks. Should the sinks render the nav (or suppress it via a Layout prop), and should the nav get its own `dev/navigation-states.astro`?
7. **Unverified detail:** `Astro.url.pathname` inside the rewritten 403 render. Check during implementation if `aria-current` is derived from the URL.
