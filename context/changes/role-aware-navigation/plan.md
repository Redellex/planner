# Role-aware navigation Implementation Plan

## Overview

Roadmap slice S-07 (MS-02, issue #42): every page gets one top-right navigation bar, mounted once in `src/layouts/Layout.astro`, whose links are exactly the pages the viewer's role may open (plus Sign out when signed in, Sign in / Sign up when anonymous). The link set is not a second hand-written list: a pure module filters an ordered candidate list through `routeAccess`, the same decision the middleware applies, and a test that walks `src/pages` fails when a page has neither a link nor an explicit exclusion. The duplicated navigation (8 "Back to dashboard" links, the dashboard's hand-coded link grid and its Sign out) goes away.

## Current State Analysis

- `src/layouts/Layout.astro:6-36` is the only shared shell: `title` prop, config banners, `<slot />`. Every renderable page passes through it; `src/pages/dashboard.astro` only answers 301 → `/`. No page has a `<header>` or a nav landmark; the only `<nav>` is `MonthTabs` (`aria-label="Months"`, `src/components/availability/MonthTabs.astro:17`).
- The old welcome-page `Topbar.astro` was already deleted in S-06 (commit `ce8f409`), so "the outdated top bar is gone" is already met.
- `src/middleware.ts:8-22` sets `locals.user` and `locals.role` on every request (both `null` when anonymous or unconfigured; `role` also `null` when the profile row is missing). It computes `signedIn` as `locals.user !== null` (`:26-29`). A denied manager path is rewritten to `/403` (`:32-33`), which re-runs the middleware, so 403 renders with fresh locals.
- `src/lib/route-access.ts:6-19` holds prefix lists (`PROTECTED_ROUTES`, `MANAGER_ROUTES`, `GUEST_ROUTES`) that include `/api/*` and `/dashboard` and carry no labels, so they cannot be the nav by themselves; `routeAccess` (`:33-49`) is the per-actor decision.
- `src/pages/index.astro:27-92` hand-codes the same per-role link grid (`{user && …}`, `{role === "manager" && …}`) and a Sign out form; `data-dashboard` (`:11`) is a smoke marker (`scripts/smoke.mjs:201`).
- 8 "Back to dashboard" links: `403.astro:16-21`, `account.astro:61-65`, `availability.astro:161-165`, `schedule.astro:46-50`, `manager/availability.astro:226-230`, `manager/months.astro:84-88`, `manager/schedule.astro:314-318`, `manager/users.astro:92-96`.
- 17 page wrappers are `min-h-screen` (12 pages + 5 dev sinks). Token views: `min-h-screen bg-background p-4`; legacy views: `bg-cosmic flex min-h-screen items-center justify-center p-4`. A bar above `<slot />` would make every page scroll by the bar's height.
- No Vitest test renders `.astro` (`vitest.config.ts`, `environment: node`), so the nav's logic must live in `src/lib` to be unit-tested.

## Desired End State

- Every page shows a top bar: "Planner" at the left, at the right the role-filtered links with `aria-current="page"` on the current one, the signed-in email and Sign out (or Sign in / Sign up when anonymous). Below `lg` the links, email and Sign out collapse into a native `<details>` "Menu".
- Link sets, by actor:
  - anonymous: Sign in (`/auth/signin`), Sign up (`/auth/signup`);
  - employee, or signed in with no role: Home (`/`), Availability, Schedule, Account;
  - manager: those four, then Users, Months, Team availability, Manage schedule.
- No page scrolls only because of the bar; legacy centred cards stay centred in the remaining height.
- No "Back to dashboard" link remains; the dashboard grid renders from the same filtered list (without Home) and has no Sign out of its own.
- `/dev/navigation-states` shows every nav state from fixtures.
- Verify: `npm test` (literal link sets, page coverage), `npm run check:ui`, `npx astro check`, `npm run lint`, `npm run smoke` (nav markers per actor), and the manual width checks below.

### Key Discoveries:

- `routeAccess(href, actor) === "allow"` over the candidate list yields exactly the roadmap outcome for all four actors (research §3 table; `route-access.test.ts:9-15` defines the actors).
- Tests must use literal expected outcomes, never values computed from the route lists (`context/foundation/test-plan.md:164`; `route-access.test.ts:6-7`).
- `route-inventory.test.ts:64-75` already walks `src/pages`; lint-staged runs it explicitly for staged pages because `vitest related` cannot link pages to a test that reads them from disk (`lint-staged.config.mjs`).
- `MonthTabs` is the pattern for nav links: `buttonVariants` + `aria-current` (`MonthTabs.astro:17-34`).
- Dev sinks render the real `Layout` and stop every form submit with `preventDefault()` (e.g. `dev/account-states.astro:89`), so the layout's Sign out is inert there, which is acceptable in dev.
- `body` already gets `bg-background text-foreground` from `global.css` `@layer base`; `bg-cosmic` lives on the legacy page wrappers only.

## What We're NOT Doing

- No change to `route-access.ts`, the middleware or any gate: the nav hides links, the middleware still enforces.
- No restyle of the legacy views (dashboard, auth pages, 403, `/manager/months`); they keep their `bg-cosmic` card markup and only lose `min-h-screen`/back links. That is S-09.
- No new shadcn component, Radix package or hydrated island; the phone menu is a native `<details>`.
- No display name in the bar (it would need a profile read on every request); the email from `locals.user` is enough.
- No layout prop to hide the nav on the existing dev sinks; they show the real session's bar.
- No change to the other in-page cross-links ("Manage month locks", "View published schedule", the manager's link on "Not published yet").
- No change to the default `<title>` ("10x Astro Starter").

## Implementation Approach

Logic first, guarded by literal tests (Phase 1); then the component, layout mount, page-height fix and kitchen sink (Phase 2); then remove the duplicate navigation, prove the wiring end to end in smoke and update the docs (Phase 3). The nav component takes the actor, email and pathname as props so the kitchen sink can render every persona; only the layout reads `Astro.locals`.

## Critical Implementation Details

- **Signed-in must be computed exactly as the middleware does** (`user !== null`), not from `role`: the no-role actor is signed in and must get the employee links and Sign out.
- **Breakpoint.** A manager's inline bar (brand + 8 links + email + Sign out) is roughly 1,100px wide, so the inline row starts at `lg` and may wrap; the email shows inline only from `xl` (it stays inside the `<details>` panel below `lg`). Verify at 390 / 768 / 1024 / 1280px with a manager and a long email.
- **Page height.** The body becomes a `min-h-screen` flex column with the bar first; every page wrapper's `min-h-screen` becomes `flex-1`. The scoped `<style>` in `Layout.astro` sets `height: 100%` on `body`; it must not cap the body's height, or long pages overflow past the background.
- **Coverage walk** reads `src/pages` from disk like the route inventory, so it needs the same explicit lint-staged trigger.

## Phase 1: Navigation model and guard tests

### Overview

A pure module that turns an actor into the ordered link list, and tests that pin the per-actor sets as literals and fail when a page has no link and no exclusion.

### Changes Required:

#### 1. Navigation module

**File**: `src/lib/navigation.ts`

**Intent**: The single place that lists navigable pages and their labels, and derives each viewer's links from `routeAccess`, so the nav and the dashboard grid can never disagree with the gate.

**Contract**:

- `NAV_LINKS: readonly { href: string; label: string }[]` in display order: `/` Home, `/availability` Availability, `/schedule` Schedule, `/account` Account, `/manager/users` Users, `/manager/months` Months, `/manager/availability` Team availability, `/manager/schedule` Manage schedule, `/auth/signin` Sign in, `/auth/signup` Sign up.
- `navLinksFor(actor: { signedIn: boolean; role: AppRole | null })` → the entries of `NAV_LINKS` for which `routeAccess(href, actor) === "allow"`, order kept.
- `isCurrentNavLink(pathname, href)` → exact match after dropping a trailing slash (root stays `/`).
- `navBrandHref(signedIn)` → `/` when signed in, `/auth/signin` otherwise.
- A header comment saying the gate decides, this list only names and orders pages.

#### 2. Shared page walk

**File**: `src/lib/page-routes.ts` (new), `src/lib/route-inventory.test.ts`

**Intent**: Move the `src/pages` walk (`pagesDir`, `ROUTE_FILE`, the `_` exclusion, `routeOf`) out of the inventory test so the navigation test reuses it instead of copying it.

**Contract**: exports the sorted page files and `routeOf(file)` (or a `pageRoutes()` returning the routes); the inventory test's behaviour and assertions are unchanged. Test-only module (imports `node:fs`); no app code imports it.

#### 3. Navigation tests

**File**: `src/lib/navigation.test.ts`

**Intent**: Catch both failure modes the roadmap names: a link the gate refuses and a permitted page with no link.

**Contract**:

- Per actor (anonymous, employee, manager, noRole — same shapes as `route-access.test.ts`), `navLinksFor(actor)` equals a literal array of `[href, label]` pairs, in order.
- Coverage: every route from the page walk that is not under `/api/` or `/dev/` is either a `NAV_LINKS` href or in a literal `NAV_EXCLUDED` list in the test (`/dashboard` — 301 only; `/auth/confirm-email` — post-sign-up landing; `/403`), each with a one-line reason. Every `NAV_LINKS` href is an existing route (no dead link). A new page fails until it gets a link or an exclusion.
- `isCurrentNavLink`: exact match, trailing slash, `/` not matching `/account`, `/manager` not matching `/manager/users`.
- `navBrandHref` for both values.

#### 4. Pre-commit trigger and cookbook

**File**: `lint-staged.config.mjs`, `context/foundation/test-plan.md` (§6.3)

**Intent**: A staged page must run the navigation coverage test as well as the inventory guard; the cookbook tells the next person a new page needs a nav link or an exclusion.

**Contract**: the `src/pages/**` rule runs `vitest run src/lib/route-inventory.test.ts src/lib/navigation.test.ts`; §6.3 step 2 gains one sentence naming `NAV_LINKS` / `NAV_EXCLUDED`.

### Success Criteria:

#### Automated Verification:

- `npm test` passes, including `src/lib/navigation.test.ts` and the unchanged `route-inventory.test.ts`
- Removing a page's entry from `NAV_LINKS` (e.g. `/schedule`) makes the coverage test fail; restore it
- Adding a manager page to the employee literal set makes the per-actor test fail; restore it
- `npm run lint` and `npx astro check` pass

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Nav component, layout mount and kitchen sink

### Overview

Render the bar on every page from the Phase 1 list, fix page height, and add a fixture-driven kitchen sink for every nav state.

### Changes Required:

#### 1. Nav component

**File**: `src/components/navigation/AppNav.astro`

**Intent**: The top bar, rendered without hydration from tokens and shadcn button styles.

**Contract**:

- Props: `actor: { signedIn: boolean; role: AppRole | null }`, `email?: string | null`, `pathname: string`.
- `<header>` with a bottom border on `bg-background`; inside, "Planner" (link to `navBrandHref`) at the left and `<nav aria-label="Main">` at the right.
- Links from `navLinksFor(actor)`: `buttonVariants({ variant: current ? "secondary" : "ghost", size: "sm" })`, `aria-current="page"` when `isCurrentNavLink`, and `data-nav-link={href}` (smoke marker).
- When signed in: the email in `text-muted-foreground`, truncated, then a Sign out `<form method="POST" action="/api/auth/signout">` with an outline `Button`. Email omitted when absent.
- From `lg`: the inline row (may wrap); email inline from `xl`. Below `lg`: a native `<details>` with a `<summary>` "Menu" (lucide `Menu` icon) holding the same links, the email and Sign out, rendered from the same array. No palette or arbitrary values.

#### 2. Layout mount and page height

**File**: `src/layouts/Layout.astro`

**Intent**: Every page gets the bar, and the page content fills the remaining height instead of a full viewport.

**Contract**: reads `Astro.locals.user` / `role` and `Astro.url.pathname`; passes `{ signedIn: user !== null, role }`, `user?.email`, `pathname` to `AppNav`. The bar renders after the config banners and before `<slot />`. `body` becomes a `min-h-screen` flex column, not capped by the scoped `height: 100%`.

#### 3. Page wrappers

**File**: `src/pages/{index,403,account,availability,schedule}.astro`, `src/pages/auth/{signin,signup,confirm-email}.astro`, `src/pages/manager/{availability,months,schedule,users}.astro`, `src/pages/dev/{account,availability,manager-users,published-schedule,schedule}-states.astro`

**Intent**: Remove the bar's extra height from every page.

**Contract**: each outer wrapper's `min-h-screen` becomes `flex-1`; nothing else changes on these pages in this phase.

#### 4. Kitchen sink

**File**: `src/pages/dev/navigation-states.astro`, `src/lib/route-inventory.test.ts`

**Intent**: Every nav state visible on one dev page for the screenshot gate, without four accounts.

**Contract**: follows the existing sink pattern (404 outside dev, fixtures only, forms inert via the submit listener). Renders `AppNav` for: anonymous on `/auth/signin`, employee on `/availability`, no-role on `/`, manager on `/manager/schedule`, and a manager with a long email (truncation), each labelled. `EXPECTED_ACCESS` gains `"/dev/navigation-states": "public"`. The coverage test already skips `/dev/`.

#### 5. Colour-literal scope

**File**: `scripts/check-ui-literals.mjs`

**Intent**: Guard the new clean files.

**Contract**: `SCOPE` gains `src/layouts/Layout.astro`, `src/components/navigation/`, `src/pages/dev/navigation-states.astro`.

### Success Criteria:

#### Automated Verification:

- `npm test` passes (route inventory includes the new sink)
- `npm run check:ui` passes with the three new scope entries
- `npm run lint` and `npx astro check` pass
- `npm run build` succeeds

#### Manual Verification:

- `/dev/navigation-states` at 1280px and 390px: each persona shows exactly its link set, the current link is marked, the long email truncates, no horizontal scroll
- Signed in as the seeded manager, the bar at 390 / 768 / 1024 / 1280px on `/manager/schedule` never overflows the viewport; the `<details>` menu opens and closes with keyboard (Tab, Enter) and mouse
- `/auth/signin` anonymous shows Sign in / Sign up; `/account` as the seeded employee shows four links and Sign out; the employee's direct visit to `/manager/users` (403) shows the employee bar
- Sign out from the bar lands on `/auth/signin`
- No page scrolls only because of the bar: `/account` with little content and the legacy `/manager/months` fit the viewport, and the legacy cards stay centred

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Remove duplicate navigation, smoke and docs

### Overview

Drop the navigation the bar replaces, prove the bar reaches real requests per actor, and record the new structure.

### Changes Required:

#### 1. Back links

**File**: `src/pages/{403,account,availability,schedule}.astro`, `src/pages/manager/{availability,months,schedule,users}.astro`

**Intent**: The bar's Home link (and Sign in / Sign up on an anonymous 403) replaces them.

**Contract**: delete each "Back to dashboard" block and its wrapper; drop a `buttonVariants` import that becomes unused.

#### 2. Dashboard

**File**: `src/pages/index.astro`

**Intent**: Keep the home page's quick links without a second hand-written list.

**Contract**: the grid renders `navLinksFor({ signedIn: user !== null, role })` without `/`, keeping the existing legacy link classes (S-09 restyles them); the Sign out form is removed; `data-dashboard`, heading, welcome and role lines stay.

#### 3. Smoke

**File**: `scripts/smoke.mjs`

**Intent**: A unit test cannot show that the layout actually reads the request's locals; three body checks on existing or one new request do.

**Contract**:

- A new anonymous step before sign-up: `/auth/signin` renders 200 with `data-nav-link="/auth/signin"` and `data-nav-link="/auth/signup"` and no `data-nav-link="/account"`.
- The fresh user's "account page renders for signed-in user" step also checks `data-nav-link="/account"` present and `data-nav-link="/manager/users"` absent.
- The manager's "manager page renders for manager" step also checks `data-nav-link="/manager/schedule"` present.
- No existing check changes meaning; `data-dashboard` stays.

#### 4. Docs

**File**: `CLAUDE.md`

**Intent**: Record where navigation lives and the rule for new pages.

**Contract**:

- Architecture: a "Navigation" bullet naming `src/lib/navigation.ts` (`NAV_LINKS`, `navLinksFor` through `routeAccess`), `AppNav` mounted in `Layout.astro`, the coverage test and its exclusions, `data-nav-link`, and the kitchen sink.
- The smoke command paragraph gains the three nav checks.
- The `/` dashboard description says its links come from `navLinksFor` and that Sign out is in the bar.
- The lint-staged line names the navigation test next to the route inventory guard.
- UI: page wrapper is `flex-1 bg-background p-4` (was `min-h-screen`).

### Success Criteria:

#### Automated Verification:

- `grep -rn "Back to dashboard" src/` finds nothing
- `npm test`, `npm run lint`, `npx astro check`, `npm run check:ui` pass
- `npm run build` succeeds
- `npm run smoke` passes against a local stack with the seed applied (check `.dev.vars` points at local first)

#### Manual Verification:

- The dashboard shows Availability, Schedule, Account for the seeded employee and those plus the four manager links for the seeded manager, with no Sign out in the card
- The 403 page (employee visiting `/manager/users`) has no in-card button, and the bar's Home link leads back to `/`
- An anonymous visit to `/403` shows Sign in / Sign up in the bar

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Testing Strategy

### Unit Tests:

- Literal `[href, label]` sets per actor (anonymous, employee, manager, noRole), order included.
- Page coverage over `src/pages` with a literal exclusion list, and no dead `NAV_LINKS` entry.
- Current-link matching edge cases (root vs prefix, trailing slash, `/manager` vs `/manager/users`).

### Integration Tests:

- Smoke: anonymous, fresh employee and seeded manager each get the expected `data-nav-link` markers on a real request.

### Manual Testing Steps:

1. Open `/dev/navigation-states` at 1280px and 390px; compare each persona against the link sets above.
2. Sign in as the seeded manager; check the bar at 390 / 768 / 1024 / 1280px on `/manager/schedule`; open the menu with the keyboard.
3. Sign in as the seeded employee; visit `/manager/users`; confirm the 403 page shows the employee bar and no in-card button.
4. Sign out from the bar; confirm `/auth/signin` shows Sign in / Sign up.

## Performance Considerations

None: the nav uses locals the middleware already loads; no extra query, no client JS.

## Migration Notes

None: no schema or data change.

## References

- Related research: `context/changes/role-aware-navigation/research.md`
- Roadmap slice: `context/foundation/roadmap.md` S-07
- Link pattern: `src/components/availability/MonthTabs.astro:17-34`
- Gate: `src/lib/route-access.ts:33-49`; inventory walk: `src/lib/route-inventory.test.ts:64-75`
- Prior deferral: `context/archive/2026-10-08-dashboard-as-home/plan.md:36-39`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Navigation model and guard tests

#### Automated

- [x] 1.1 `npm test` passes, including `src/lib/navigation.test.ts` and the unchanged `route-inventory.test.ts`
- [x] 1.2 Removing a page's entry from `NAV_LINKS` (e.g. `/schedule`) makes the coverage test fail; restore it
- [x] 1.3 Adding a manager page to the employee literal set makes the per-actor test fail; restore it
- [x] 1.4 `npm run lint` and `npx astro check` pass

### Phase 2: Nav component, layout mount and kitchen sink

#### Automated

- [ ] 2.1 `npm test` passes (route inventory includes the new sink)
- [ ] 2.2 `npm run check:ui` passes with the three new scope entries
- [ ] 2.3 `npm run lint` and `npx astro check` pass
- [ ] 2.4 `npm run build` succeeds

#### Manual

- [ ] 2.5 `/dev/navigation-states` at 1280px and 390px: each persona shows exactly its link set, the current link is marked, the long email truncates, no horizontal scroll
- [ ] 2.6 Signed in as the seeded manager, the bar at 390 / 768 / 1024 / 1280px on `/manager/schedule` never overflows the viewport; the `<details>` menu opens and closes with keyboard (Tab, Enter) and mouse
- [ ] 2.7 `/auth/signin` anonymous shows Sign in / Sign up; `/account` as the seeded employee shows four links and Sign out; the employee's direct visit to `/manager/users` (403) shows the employee bar
- [ ] 2.8 Sign out from the bar lands on `/auth/signin`
- [ ] 2.9 No page scrolls only because of the bar: `/account` with little content and the legacy `/manager/months` fit the viewport, and the legacy cards stay centred

### Phase 3: Remove duplicate navigation, smoke and docs

#### Automated

- [ ] 3.1 `grep -rn "Back to dashboard" src/` finds nothing
- [ ] 3.2 `npm test`, `npm run lint`, `npx astro check`, `npm run check:ui` pass
- [ ] 3.3 `npm run build` succeeds
- [ ] 3.4 `npm run smoke` passes against a local stack with the seed applied (check `.dev.vars` points at local first)

#### Manual

- [ ] 3.5 The dashboard shows Availability, Schedule, Account for the seeded employee and those plus the four manager links for the seeded manager, with no Sign out in the card
- [ ] 3.6 The 403 page (employee visiting `/manager/users`) has no in-card button, and the bar's Home link leads back to `/`
- [ ] 3.7 An anonymous visit to `/403` shows Sign in / Sign up in the bar
