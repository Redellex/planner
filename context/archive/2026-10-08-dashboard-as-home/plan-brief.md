# Dashboard as Home — Plan Brief

> Full plan: `context/changes/dashboard-as-home/plan.md`

## What & Why

Sign-in should land people on their dashboard, and the dashboard should be the home page at `/`. Today `/` is the leftover "10x Astro Starter" welcome page with an outdated top bar. This is roadmap slice S-06 (MS-01, issue #41), and S-07's navigation and S-09's restyle build on it.

## Starting Point

Sign-in already redirects to `/`, but `/` renders the public starter page (`Welcome.astro` + `Topbar.astro`). The dashboard lives at `/dashboard`, which is gated in `src/lib/route-access.ts`. Eight pages and one endpoint link or redirect to `/dashboard`.

## Desired End State

- A signed-in user at `/` sees the dashboard. An anonymous visitor there is sent to sign-in.
- `/dashboard` permanently redirects to `/`.
- A signed-in user who opens sign-in, sign-up or confirm-email is sent home.
- Sign-out lands on the sign-in page.
- The starter page and its top bar are gone.

## Key Decisions Made

| Decision                     | Choice                                                                                      | Why (1 sentence)                                                                 | Source  |
| ---------------------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ------- |
| Anonymous at `/`             | Redirect to sign-in (`/` in `PROTECTED_ROUTES`)                                             | Every page needs an account, so one gating rule and no public page to maintain   | Plan    |
| Old `/dashboard` URL         | 301 → `/`, still signed-in gated                                                            | Bookmarks keep working, and the inventory row stays                              | Plan    |
| Signed-in user on auth pages | Redirect to `/` via new `GUEST_ROUTES` + `home` outcome                                     | Covers the broader reading of "sign in redirects to the dashboard automatically" | Plan    |
| Guest-route matching         | Exact pages (`/auth/signin`, `/auth/signup`, `/auth/confirm-email`), not the `/auth` prefix | A future `/auth/*` callback page must not become guest-only by accident          | Plan    |
| After sign-in                | Always `/`, with no `?next=`                                                                | Matches MS-01 exactly and needs no open-redirect validation                      | Plan    |
| Sign-out target              | `/auth/signin` directly                                                                     | Avoids bouncing through the now-gated `/`                                        | Plan    |
| Starter components           | Delete `Welcome.astro` and `Topbar.astro`                                                   | Topbar is used only by Welcome, and S-07 builds the new navigation               | Plan    |
| Dashboard styling            | Moved verbatim, still `bg-cosmic`                                                           | Restyle belongs to S-09                                                          | Roadmap |

## Scope

**In scope:**

- Route gate for `/` and the guest-only auth pages (`route-access.ts`, middleware, both route tests).
- Dashboard moved to `index.astro`, and the `/dashboard` 301.
- Starter files deleted, and every `/dashboard` link and redirect repointed.
- Sign-out redirects to `/auth/signin`.
- Smoke steps and `CLAUDE.md` updated.

**Out of scope:**

- Restyling (S-09) and the new navigation (S-07).
- Return-to after sign-in.
- Guest-only `/api/auth/*`.
- Renaming the "Back to dashboard" buttons.
- Changes to Supabase `site_url`.

## Architecture / Approach

All decisions stay in `src/lib/route-access.ts`. `routeAccess` gains a fourth outcome, `home` (signed-in actor on a `GUEST_ROUTES` page), which `src/middleware.ts` maps to a redirect to `/`. Adding `"/"` to `PROTECTED_ROUTES` matches only `/` itself, because the segment-boundary prefix for `/` is `//`, which normalised paths never start with. Tests pin that `/403`, `/auth/*` and `/api/auth/*` stay reachable.

## Phases at a Glance

| Phase                       | What it delivers                                                                                                          | Key risk                                                                                   |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| 1. Route gate and home page | `/` is the gated dashboard, guest-only auth pages, `/dashboard` 301, starter deleted, links repointed; unit tests updated | `"/"` accidentally gating other paths (pinned by boundary tests)                           |
| 2. Smoke and docs           | Exact smoke checks for sign-in → `/`, home dashboard, 301, guest redirect, sign-out → sign-in; `CLAUDE.md` updated        | Smoke's prefix-only `location` match hides a wrong redirect, so the plan uses exact checks |

**Prerequisites:** none (S-06 has no roadmap prerequisites). Smoke needs the local Supabase stack and `.dev.vars` pointing at it.
**Estimated effort:** ~1 session across 2 phases.

## Open Risks & Assumptions

- Locally (`enable_confirmations = false`), `signUp` returns a session, so after sign-up the user lands on the dashboard instead of the "Registration successful" page. This is accepted; on the hosted app with confirmations on, "Check your email" still shows.
- Between S-06 and S-07 there is no top navigation. The dashboard links and the "Back to dashboard" buttons, which now point at `/`, cover it.
- Smoke is red if phase 1 is committed without phase 2.

## Success Criteria (Summary)

- Signing in lands on the dashboard at `/`, and an anonymous `/` goes to sign-in.
- Old `/dashboard` links and signed-in visits to the auth pages end on `/`.
- `npm test`, `npx astro check`, build and smoke all pass with the new expectations.
