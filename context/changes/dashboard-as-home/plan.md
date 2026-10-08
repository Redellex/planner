# Dashboard as Home Implementation Plan

## Overview

Make the dashboard the home page at `/`. Sign-in already redirects to `/`, so once `/` is the dashboard the user lands there straight after signing in. The starter welcome page (`Welcome.astro`) and its top bar (`Topbar.astro`) are deleted. Anonymous visitors at `/` go to sign-in, the old `/dashboard` URL permanently redirects to `/`, and a signed-in user who opens a sign-in, sign-up or confirm-email page is sent home. Roadmap slice S-06 (MS-01), issue #41.

## Current State Analysis

- `src/pages/index.astro` renders `src/components/Welcome.astro`, the "10x Astro Starter" hero. That page includes `src/components/Topbar.astro`, which no other page uses. `/` is public (`src/lib/route-inventory.test.ts:20`, `src/lib/route-access.test.ts:63`).
- The dashboard lives at `src/pages/dashboard.astro` (legacy `bg-cosmic` markup with links by role and a Sign out form). It is gated by `"/dashboard"` in `PROTECTED_ROUTES` (`src/lib/route-access.ts:5-12`).
- Sign-in already redirects to `/` (`src/pages/api/auth/signin.ts:19`); sign-out redirects to `/` (`src/pages/api/auth/signout.ts:9`).
- `routeAccess` (`src/lib/route-access.ts:27`) returns `allow | signin | forbidden`; the middleware (`src/middleware.ts:25-35`) maps `signin` → redirect `/auth/signin` and `forbidden` → rewrite `/403`.
- Links to `/dashboard`: 403 page (`src/pages/403.astro:17`), the "Back to dashboard" buttons on `account.astro:62`, `availability.astro:162`, `manager/availability.astro:227`, `manager/months.astro:85`, `manager/schedule.astro:315`, `manager/users.astro:93`, `schedule.astro:47`, the self-demotion redirect in `src/pages/api/manager/users/role.ts:43`, and `Topbar.astro:50` (deleted).
- Smoke (`scripts/smoke.mjs:180-312`) expects anonymous `/` → 200 ("home renders"), `/dashboard` 302 → sign-in for anonymous and 200 for signed-in, and sign-out → `/`.
- Locally `enable_confirmations = false` (`supabase/config.toml:209`), so `signUp` returns a session and the user is already signed in when redirected to `/auth/confirm-email`.

## Desired End State

- Signed-in user at `/` sees the dashboard (same content as today's `/dashboard`, still legacy styling until S-09).
- Anonymous visitor at `/` is redirected to `/auth/signin`.
- `/dashboard` answers 301 → `/` for a signed-in user (anonymous: 302 → `/auth/signin`, unchanged).
- Signed-in user at `/auth/signin`, `/auth/signup` or `/auth/confirm-email` is redirected to `/`; anonymous users still see those pages. `/api/auth/*` stays public for everyone.
- Sign-out redirects to `/auth/signin`.
- `Welcome.astro` and `Topbar.astro` no longer exist; no page links to `/dashboard`.
- Unit tests, the route inventory guard and smoke all encode the above.

### Key Discoveries:

- `matchesRoute` builds the prefix `${route}/`. For `"/"` that is `"//"`, which no Astro-normalised pathname starts with, so `"/"` in `PROTECTED_ROUTES` matches only `/` exactly (`src/lib/route-access.ts:18-20`). This is correct but subtle, so tests must pin that other public paths stay public.
- The smoke `location` expectation is a **prefix** match (`scripts/smoke.mjs:541`), so the existing `location: "/"` expectation on "signin accepts correct password" accepts any redirect. The core requirement of this slice (sign-in lands on `/`) needs an exact check.
- `src/pages/index.astro`, `dashboard.astro` and the auth pages are outside the `check:ui` scope (`scripts/check-ui-literals.mjs:17-33`), so moving legacy markup into `index.astro` does not trip the colour-literal gate.

## What We're NOT Doing

- No restyle of the dashboard or auth pages. They stay on `bg-cosmic` until S-09 (`legacy-views-ui-tokens`).
- No new navigation bar. The deleted `Topbar` is replaced by S-07 (`role-aware-navigation`). Until then, the dashboard's links and the per-page "Back to dashboard" buttons are the navigation.
- No return-to / `?next=` after sign-in. Sign-in always lands on `/`.
- No guest-only gating of the `/api/auth/*` endpoints. Posting to sign-in while signed in, which switches accounts, still works.
- No change to the "Back to dashboard" button labels or their placement. S-07 decides whether they stay.
- No Supabase `site_url` / email-link callback changes.

## Implementation Approach

Keep all routing decisions in `src/lib/route-access.ts`, as the codebase already does. Add `/` to `PROTECTED_ROUTES` and a new `GUEST_ROUTES` list with a fourth outcome, `home`, which the middleware maps to a redirect to `/`. Then move the dashboard markup into `index.astro`, reduce `dashboard.astro` to a 301, delete the starter components and repoint the links. Smoke and docs follow in a second phase.

## Critical Implementation Details

- **Guest routes are exact pages, not the `/auth` prefix.** List `/auth/signin`, `/auth/signup` and `/auth/confirm-email` individually. A future `/auth/*` page (e.g. a password-reset callback that a signed-in user must reach) must not become guest-only by accident. The inventory guard already forces a row for any new page.
- **Order inside `routeAccess`.** Return `home` for a signed-in actor on a guest route before the protected/manager checks. The lists don't overlap, so order only matters for readability, but `noRole` (signed in, no profile) must also get `home`. The decision depends only on `signedIn`.
- **Local sign-up side effect.** Locally, `signUp` returns a session, so the redirect to `/auth/confirm-email` now bounces to `/` and the user lands on the dashboard already signed in. On the hosted app, with confirmations on, the "Check your email" page still renders. This is accepted, not a bug.

## Phase 1: Route gate and home page

### Overview

`/` becomes the gated dashboard, the auth pages send signed-in users home, the starter page and top bar are deleted, and every internal link to the dashboard points at `/`. Verified by the unit suite, the route inventory guard, lint, type-check and build.

### Changes Required:

#### 1. Route lists and decision

**File**: `src/lib/route-access.ts`

**Intent**: Gate `/` like every other app page and add a guest-only class for the three auth pages, keeping this file the only place that knows which paths are gated.

**Contract**: `PROTECTED_ROUTES` gains `"/"` (and keeps `"/dashboard"`, so the redirect page stays gated). New exported `GUEST_ROUTES: readonly string[] = ["/auth/signin", "/auth/signup", "/auth/confirm-email"]`. `RouteAccess` becomes `"allow" | "signin" | "forbidden" | "home"`; `routeAccess` returns `"home"` when the pathname matches `GUEST_ROUTES` and `actor.signedIn`. Update the header comment and the `routeAccess` doc comment to name the new outcome and why `"/"` matches only itself.

#### 2. Middleware mapping

**File**: `src/middleware.ts`

**Intent**: Map the new decision onto a redirect.

**Contract**: `access === "home"` → `context.redirect("/")`. No other change.

#### 3. Route-access unit tests

**File**: `src/lib/route-access.test.ts`

**Intent**: Pin the new decisions with literal expectations (never derived from the lists), per the file's existing rule.

**Contract**:

- Move `"/"` from the public table to the signed-in table.
- Add a `GUEST` outcome tuple `["allow", "home", "home", "home"]` and a describe block covering `/auth/signin`, `/auth/signup` and `/auth/confirm-email`.
- Assert that `/api/auth/signin`, `/api/auth/signup`, `/api/auth/signout` and `/403` stay `PUBLIC`.
- Add boundary rows: `/auth/signin/` → `GUEST`, `/auth/signinX` → `PUBLIC`, `/auth` → `PUBLIC`, and `/foo` → `PUBLIC`, which proves `"/"` does not prefix-match.

#### 4. Route inventory guard

**File**: `src/lib/route-inventory.test.ts`

**Intent**: Keep every page's expected access explicit.

**Contract**: `AccessClass` gains `"guest-only"` with `OUTCOMES["guest-only"] = ["allow", "home", "home"]`. Change `"/"` to `"signed-in"` and `/auth/signin`, `/auth/signup` and `/auth/confirm-email` to `"guest-only"`. `/dashboard` stays `"signed-in"`.

#### 5. Dashboard becomes the home page

**File**: `src/pages/index.astro`

**Intent**: Render today's dashboard at `/`.

**Contract**: Content moved verbatim from `src/pages/dashboard.astro` (`Layout title="Dashboard"`, links by role, Sign out form), plus a `data-dashboard` attribute on the card as a smoke marker. Legacy classes stay; S-09 restyles.

#### 6. Old dashboard URL

**File**: `src/pages/dashboard.astro`

**Intent**: Keep bookmarks working.

**Contract**: The frontmatter only returns `Astro.redirect("/", 301)`; there is no markup. The file stays, so its inventory row stays.

#### 7. Remove the starter page

**File**: `src/components/Welcome.astro`, `src/components/Topbar.astro`

**Intent**: Delete both; nothing references them after the `index.astro` change.

**Contract**: Files deleted; `grep -r "Welcome\|Topbar" src` finds nothing.

#### 8. Repoint links and redirects

**File**: `src/pages/403.astro`, `src/pages/account.astro`, `src/pages/availability.astro`, `src/pages/manager/availability.astro`, `src/pages/manager/months.astro`, `src/pages/manager/schedule.astro`, `src/pages/manager/users.astro`, `src/pages/schedule.astro`, `src/pages/api/manager/users/role.ts`, `src/pages/api/auth/signout.ts`

**Intent**: No internal link or redirect goes through the `/dashboard` 301, and sign-out lands on the sign-in page instead of bouncing through `/`.

**Contract**: Every `href="/dashboard"` becomes `href="/"`, keeping its label. The self-demotion redirect in `role.ts` changes from `/dashboard` to `/`. `signout.ts` redirects to `/auth/signin`. After the change, `"/dashboard"` appears only in the route lists and their tests.

### Success Criteria:

#### Automated Verification:

- Unit suite passes, including the route-access and route inventory tests: `npm test`
- Lint passes: `npm run lint`
- Type-check passes: `npx astro check`
- Production build succeeds: `npm run build`
- No reference to the deleted components or to `/dashboard` links remains: `grep -rn "Welcome\|Topbar\|href=\"/dashboard\"" src` returns nothing

#### Manual Verification:

- Anonymous `/` in the browser lands on the sign-in page; signing in lands on the dashboard at `/`
- `/dashboard` while signed in ends on `/` with the dashboard shown
- `/auth/signin` and `/auth/signup` while signed in end on `/`; after Sign out the browser is on `/auth/signin` and the forms render
- "Back to dashboard" on `/availability` and the 403 page's link both open `/`

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Smoke and docs

### Overview

Make the smoke script assert the new home, redirects and sign-out target exactly, and bring `CLAUDE.md` in line. Verified by a smoke run against local Supabase.

### Changes Required:

#### 1. Smoke steps

**File**: `scripts/smoke.mjs`

**Intent**: Encode the slice's behaviour over HTTP, with exact location checks where the prefix match would accept anything.

**Contract**:

- "home renders" becomes "home redirects anonymous user", expecting 302 → `/auth/signin`.
- "signin accepts correct password" adds a `check` that `relativeLocation(actual.location) === "/"`.
- "dashboard renders for signed-in user" is replaced by two steps:
  - "home renders the dashboard for signed-in user": 200, with a body containing `data-dashboard`.
  - "dashboard redirects to home": 301, with an exact `/` check.
- New step "sign-in page redirects signed-in user home": GET `/auth/signin` returns 302, with an exact `/` check.
- "signout clears session" expects location `/auth/signin`.
- After sign-out, add "sign-in page renders after signout": GET `/auth/signin` → 200. "dashboard redirects after signout" stays.
- `asSmokeUser`'s exact `"/"` check is unchanged.

#### 2. Project docs

**File**: `CLAUDE.md`

**Intent**: Keep the agent guide true.

**Contract**:

- **Auth flow:** `/` is the signed-in dashboard (protected example `src/pages/index.astro`), `/dashboard` is a 301 to `/`, and `GUEST_ROUTES` with the `home` outcome covers the three auth pages.
- **Sign-out:** redirects to `/auth/signin`.
- **`npm run smoke`:** the description says anonymous `/` → sign-in, sign-in lands on `/`, a signed-in user's auth page redirects home, and sign-out goes to sign-in.
- **UI → Legacy list:** `/dashboard` and `Welcome` are replaced by `/` (the dashboard).

### Success Criteria:

#### Automated Verification:

- Smoke passes against the local stack (`npx supabase start`, `npm run build`, `npm run preview`, then `npm run smoke`); check `.dev.vars` points at local first
- Lint passes on the edited script: `npm run lint`
- Formatting is clean: `npx prettier --check CLAUDE.md scripts/smoke.mjs`

#### Manual Verification:

- `CLAUDE.md` no longer mentions `Welcome`, `src/pages/dashboard.astro` as the protected example, or sign-out to `/`

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Testing Strategy

### Unit Tests:

- `route-access.test.ts`: `/` signed-in; three guest pages `["allow","home","home","home"]`; `/api/auth/*` and `/403` public; boundary rows `/auth/signin/`, `/auth/signinX`, `/auth`, `/foo`.
- `route-inventory.test.ts`: every page still has a row; new `guest-only` class.

### Integration Tests:

- Smoke over HTTP: anonymous `/` → sign-in, exact sign-in → `/`, `/` renders `data-dashboard`, `/dashboard` 301 → `/`, signed-in `/auth/signin` → `/`, sign-out → `/auth/signin`, `/auth/signin` 200 after sign-out.

### Manual Testing Steps:

1. Signed out, open `/`. You land on the sign-in page.
2. Sign in as the seeded manager. You land on `/` with the dashboard and the manager links.
3. Open `/dashboard`. You end on `/`.
4. Open `/auth/signup`. You end on `/`.
5. Sign out. You are on `/auth/signin` and the form renders.

## Performance Considerations

None. One extra list check per request in `routeAccess`.

## Migration Notes

No data migration. Browsers cache the `/dashboard` 301 permanently, which is intended because the URL is retired. Deploy is the usual `npm run build` + `npx wrangler deploy`.

## References

- Roadmap slice: `context/foundation/roadmap.md` (S-06, MS-01), issue #41
- Route gate pattern: `src/lib/route-access.ts:5-41`, `src/middleware.ts:25-35`
- Inventory guard: `src/lib/route-inventory.test.ts:15-55`
- Smoke location matching: `scripts/smoke.mjs:143`, `scripts/smoke.mjs:541`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Route gate and home page

#### Automated

- [x] 1.1 Unit suite passes, including the route-access and route inventory tests: `npm test` — ce8f409
- [x] 1.2 Lint passes: `npm run lint` — ce8f409
- [x] 1.3 Type-check passes: `npx astro check` — ce8f409
- [x] 1.4 Production build succeeds: `npm run build` — ce8f409
- [x] 1.5 No reference to the deleted components or to `/dashboard` links remains: `grep -rn "Welcome\|Topbar\|href=\"/dashboard\"" src` returns nothing — ce8f409 (only hit: the greeting text "Welcome," in `src/pages/index.astro`, moved verbatim from the dashboard; no component or `/dashboard` link remains)

#### Manual

- [ ] 1.6 Anonymous `/` in the browser lands on the sign-in page; signing in lands on the dashboard at `/`
- [ ] 1.7 `/dashboard` while signed in ends on `/` with the dashboard shown
- [ ] 1.8 `/auth/signin` and `/auth/signup` while signed in end on `/`; after Sign out the browser is on `/auth/signin` and the forms render
- [ ] 1.9 "Back to dashboard" on `/availability` and the 403 page's link both open `/`

### Phase 2: Smoke and docs

#### Automated

- [ ] 2.1 Smoke passes against the local stack (`npx supabase start`, `npm run build`, `npm run preview`, then `npm run smoke`); check `.dev.vars` points at local first
- [ ] 2.2 Lint passes on the edited script: `npm run lint`
- [ ] 2.3 Formatting is clean: `npx prettier --check CLAUDE.md scripts/smoke.mjs`

#### Manual

- [ ] 2.4 `CLAUDE.md` no longer mentions `Welcome`, `src/pages/dashboard.astro` as the protected example, or sign-out to `/`
