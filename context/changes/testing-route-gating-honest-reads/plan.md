# Test Rollout Phase 3: Route Gating and Honest Reads Implementation Plan

## Overview

Rollout Phase 3 of `context/foundation/test-plan.md` covers risk #4 (role and route control regresses after a middleware or role change) and risk #6 (a failed or truncated availability read is presented as "nobody submitted"). The plan moves the route × role decision and the team-view read path out of files Vitest cannot load (`src/middleware.ts`, `src/pages/manager/availability.astro`) into import-free `src/lib` modules, and proves them with unit tests plus a guard over the `src/pages` route inventory. It fixes the team view's remaining "looks like nobody" paths instead of pinning them, and adds smoke steps that prove the middleware gates the manager **endpoints** over HTTP, not only the pages.

## Current State Analysis

- **Route × role decision.** `src/middleware.ts:33-46` depends only on `(pathname, user present, role)`, but the module imports `astro:middleware` and `@/lib/supabase` (which imports `astro:env/server`), and `vitest.config.ts` has no Astro plugin, so no test can load it. Role resolution fails closed (`:24-29`: role set only when `!error && isAppRole(data?.role)`).
- **Gates.** `PROTECTED_ROUTES = ["/dashboard", "/availability", "/api/availability"]`, `MANAGER_ROUTES = ["/manager", "/api/manager"]` (`:5-6`), matched on segment boundaries (`:8-10`). None of the 5 manager pages/endpoints re-checks the role in its handler (research Finding 2), so "the page is gated, so the endpoint is gated" is true only because the `/manager` and `/api/manager` prefixes are paired. A non-manager is `rewrite("/403")`-ed; `src/pages/403.astro:4-5` sets status 403 for POSTs too, which no test observes.
- **Smoke.** It covers anonymous → `/dashboard`, employee GET of 2 manager pages (403) and manager GET/POST (`scripts/smoke.mjs:87,156-157,168-205`). **No step sends a manager endpoint request as an employee or anonymous user.**
- **Team read.** `loadMonthWindows` (`src/pages/manager/availability.astro:58-79`) pages by a fixed 1000 and stops at the first short page, so a PostgREST `max_rows` below 1000 would truncate silently and flag accounts "No availability submitted" (`TeamSummary.astro:56-59`). The profiles read (`:86`) and carry-over read (`:88-92`) are unpaged. A failed window/carry-over read sets `windowsUnknown` (`:103,:110`), which hides the day panel and summary (`:215-221`), but:
  - a failed **profiles** read does not set it: the calendar, day panel and summary render empty states ("no one available", "No one has availability on this day.", "No accounts to show.") under the alert;
  - while `windowsUnknown`, the calendar still renders and every day's `aria-label` reads "no one available" (`TeamCalendar.astro:130-136`).
- **Tests.** No unit test touches a read path or the route decision. Archive fixes F1/F2 (`context/archive/2026-09-29-manager-availability-visibility/reviews/impl-review.md`) were verified by lint, `astro check` and smoke only.
- **Legacy gap.** `/manager/months` fails open on a lock-read error and renders the raw database message (`src/pages/manager/months.astro:8,22-23`). It is a legacy `bg-cosmic` view; test-plan §7 excludes legacy views from testing.

## Desired End State

- `src/lib/route-access.ts` is the only place that knows the route lists and decides `allow` / `signin` / `forbidden`; `src/middleware.ts` only resolves the user and role and maps the decision onto `next()` / `redirect("/auth/signin")` / `rewrite("/403")`.
- `npm test` proves a route × actor table (anonymous, employee, manager, signed-in with no resolvable role) over every gated page **and** endpoint plus boundary paths, the 4 fail-closed role cases, and that every file under `src/pages` maps to a route with an explicit expected access, so a new page or endpoint outside the gates fails the suite (and, through lint-staged, the commit).
- `src/lib/team-availability.ts` reads every team list (profiles, month windows, carry-overs) with count-driven paging and turns the results into either `ready` (with totals) or `unknown`. A failed read, a missing count or a shortfall against the count is `unknown`, and an `unknown` team view shows the error alert, month tabs and lock-status line, but **no** calendar, day panel or summary, so nothing on the page can read as "no one available" or "No availability submitted".
- `npm run smoke` shows that an employee POST to either manager endpoint gets the 403 page and has no effect (the month stays editable, the employee stays non-manager), and that an anonymous POST to a manager endpoint is sent to sign-in.
- Test-plan §6.3 and §6.4 are filled in as cookbook recipes; §6.6 records Phase 3 notes, the mutation triage and the accepted `/manager/months` gap.

### Key Discoveries:

- The decision is pure in `(pathname, signedIn, role)`; Astro decodes percent-encoding and collapses duplicate slashes before the middleware runs, so unit rows take normalised paths and encoding variants stay vendor-side (research Finding 1).
- `src/lib/roles.ts` has only a type import, so a lib module that imports it is loadable in Vitest (research Finding 1).
- supabase-js `.select(cols, { count: "exact" })` sends `Prefer: count=exact` and parses the total from `Content-Range` on every `.range()` response, independent of `max_rows` (Context7, `/supabase/supabase-js`, checked 2026-10-03).
- The honest-read pattern already exists in `src/pages/manager/users.astro:72-78` (the alert replaces the list); the team view adopts it.
- Existing file-reading guard to mirror: `src/lib/station-time-zone.test.ts` (reads files from disk; lint-staged maps those files to it explicitly, `lint-staged.config.mjs`).
- The employee's own profile id appears nowhere in the UI; the Supabase session cookie the smoke jar already holds carries it.

## What We're NOT Doing

- Fixing or testing `/manager/months`' fail-open lock read (legacy view, §7). Recorded as an accepted gap in §6.6.
- Unit rows for percent-encoded, double-slash or case variants of paths (Astro normalises them; vendor boundary).
- Re-testing role-change rules or the last-manager guard at the unit layer (proven by Phase 2 pgTAP, `supabase/tests/database/profiles_roles.test.sql`).
- An e2e/browser test of the team view, or a smoke step that forces a read error (test-plan §2 #6 anti-pattern; the unit read-path tests catch it).
- Mocking the Supabase client. Tests use a narrow page-fetch function and fixture pages only.
- Smoke GETs for the remaining page gaps (`/manager/months` as employee/manager, anonymous `/availability`, `/manager/*`): the unit table proves prefix matching; smoke adds only the endpoint gates.
- Paging the lock reads (at most 4 rows) or the employee's own `/availability` read.
- Changing the per-edit agent hook mapping; the end-of-turn hook already runs the whole suite, which includes the inventory guard.
- Updating the §3 Status column (the test-plan orchestrator and `/10x-archive` own it).

## Implementation Approach

Follow the repo's convention that business logic lives in import-free `src/lib/*.ts` modules called by pages and endpoints. Extract first, wire the existing callers to the extraction with no behaviour change (route decision) or with the agreed behaviour change (team view), then test the extraction. Smoke supplies the one thing a unit test cannot: proof that `src/middleware.ts` actually applies the decision to POST endpoints and that the rewrite skips the handler. A Stryker pass on both new modules closes the phase, in place of a hand-written sabotage list.

## Critical Implementation Details

- **Count-driven paging loop.** Advance the offset by the number of rows actually received (not by the page size) and stop once the rows collected reach the latest reported count. Request `from = rows.length` only while `rows.length < count`. PostgREST answers an offset past the end with an error (416), so the loop must not request again after reaching the count. A count of 0 ends after the first (empty) page.
- **Smoke: reading the employee's id.** `@supabase/ssr` stores the session in `sb-<ref>-auth-token` cookies, possibly split into `.0`, `.1`, … chunks, with a `base64-` prefix on a base64url JSON payload whose `user.id` is the id. Join the chunks in index order, URL-decode, strip the prefix, decode and parse. If any part fails, the step must fail with a message naming the cookie format, never silently target a different id. Smoke is re-run after dependency upgrades, so a format change surfaces there.
- **Lint-staged and the inventory guard.** The guard reads `src/pages` from disk, so `vitest related` never links a page file to it, the same as the station-time zone guard. The explicit lint-staged entry is what makes a staged new page fail at commit time.

## Phase 1: Route Access Decision

### Overview

Extract the route × role decision and the role resolution into `src/lib/route-access.ts`, rewire the middleware with no behaviour change, and prove the decision with a route × actor table, boundary paths and an inventory guard over `src/pages`.

### Changes Required:

#### 1. Route access module

**File**: `src/lib/route-access.ts` (new)

**Intent**: Hold the route lists, the segment-boundary matcher, the 3-outcome decision and the fail-closed role resolution in one import-free module, so the middleware and the tests share one source of truth.

**Contract**:

- Exports `PROTECTED_ROUTES`, `MANAGER_ROUTES` (same values as `src/middleware.ts:5-6`) and `matchesRoute(pathname, routes)` (same semantics as `:8-10`).
- `routeAccess(pathname: string, actor: { signedIn: boolean; role: AppRole | null }): "allow" | "signin" | "forbidden"`. Protected paths: not signed in → `signin`. Manager paths: not signed in → `signin`; role other than `"manager"` → `forbidden`. Anything else → `allow`. Same order and outcomes as `:33-46`.
- `roleFromProfile(result: { data: { role: unknown } | null; error: unknown }): AppRole | null`: returns the role only when there is no error and `isAppRole` accepts it.
- Imports only `./roles` (`AppRole` type and `isAppRole`); no `astro:*` and no `@/lib/supabase`.

#### 2. Middleware rewiring

**File**: `src/middleware.ts`

**Intent**: Keep the Supabase calls (`getUser`, the profiles read) and replace the inline lists, matcher and branching with `roleFromProfile` and `routeAccess`, mapping `signin` → `redirect("/auth/signin")`, `forbidden` → `rewrite("/403")`, `allow` → `next()`.

**Contract**: Same observable behaviour for every path and actor; `context.locals.user` / `context.locals.role` are set exactly as today (the role via `roleFromProfile`).

#### 3. Decision and role unit tests

**File**: `src/lib/route-access.test.ts` (new)

**Intent**: Prove the route × actor table and the fail-closed role resolution, named after the regressions they catch (test-plan §6.1 items 1 and 5 style: relative import, no globals, `it.each` tables with literal expected outcomes).

**Contract**:

- Actors: anonymous, employee, manager, signed-in with role `null` (missing profile row / read error / unknown role).
- Rows for every gated page **and** endpoint by name: `/dashboard`, `/availability`, `/api/availability/{create,update,delete}`, `/manager/{users,months,availability}`, `/api/manager/months/lock`, `/api/manager/users/role`, plus public controls (`/`, `/403`, `/auth/signin`, `/api/auth/signin`).
- Boundary rows: `/manager` and `/api/manager` exact (gated), `/manager/` (gated), `/managerX`, `/api/managerial`, `/dashboardX` (not gated), and a manager-only nested path such as `/api/manager/months/lock/extra` (gated).
- Expected values are literals (`"signin"`, `"forbidden"`, `"allow"`), never computed from the route lists.
- `roleFromProfile`: `{data:{role:"manager"},error:null}` → `"manager"`; `"employee"` → `"employee"`; manager data with an error → `null`; `data: null` → `null`; `"admin"` and `"Manager"` → `null`; a non-string role → `null`.

#### 4. Route inventory guard

**File**: `src/lib/route-inventory.test.ts` (new)

**Intent**: Fail when a file under `src/pages` has no explicit expected access, or when the expected access disagrees with `routeAccess`, so a new manager endpoint placed outside `/api/manager` (or a forgotten row) cannot land silently. It challenges "the page is gated, so the endpoint is gated" mechanically.

**Contract**:

- Walks `src/pages` (relative to the test file, like `station-time-zone.test.ts`), maps each `.astro`/`.ts` file to its route (strip the prefix and extension, `index` → `/`).
- An explicit table maps each route to `"public" | "signed-in" | "manager"`; each class implies the 3 actor outcomes (public: allow for all; signed-in: anonymous `signin`, others `allow`; manager: anonymous `signin`, employee `forbidden`, manager `allow`), checked against `routeAccess`.
- The set of discovered routes must equal the table's keys in both directions (a stale row fails too). `/dev/*-states` are `public` (they 404 themselves outside dev; note this beside the rows).
- A file whose name contains `[` (a dynamic route) fails with a message asking for a sample path in the table. None exist today.

#### 5. Lint-staged mapping

**File**: `lint-staged.config.mjs`

**Intent**: Run the inventory guard when a page or endpoint file is staged, since `vitest related` never links a page to a test that only reads it from disk.

**Contract**: New entry `"src/pages/**/*.{astro,ts}"` → `() => "vitest run src/lib/route-inventory.test.ts"`, with a comment in the style of the station-time entry.

### Success Criteria:

#### Automated Verification:

- Unit tests pass, including the new route-access and route-inventory files: `npm test`
- Lint passes: `npm run lint`
- Type check passes: `npx astro check`
- Production build succeeds: `npm run build`
- Inventory guard goes red when a scratch file `src/pages/api/team/probe.ts` is added and green again after it is removed: `npx vitest run src/lib/route-inventory.test.ts`

#### Manual Verification:

- Smoke still passes unchanged against a local server (middleware behaviour preserved): `npm run smoke`
- Committing a staged change to a `src/pages` file shows the inventory guard running in the lint-staged output

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Honest Team Read

### Overview

Move the team-view reads into `src/lib/team-availability.ts` with count-driven paging and a ready/unknown state, refactor `/manager/availability` so an unknown state replaces the calendar, day panel and summary with the alert, and prove that no failed or truncated read can produce a "No availability submitted" flag.

### Changes Required:

#### 1. Team read module

**File**: `src/lib/team-availability.ts` (new)

**Intent**: Give every team list one honest read helper and one pure function that decides whether the team view may show availability at all.

**Contract**:

- `loadAllPages<T>(fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown; count: number | null }>, pageSize: number): Promise<{ data: T[]; error: null } | { data: null; error: unknown }>`. Count-driven, as described in Critical Implementation Details. An error on any page, a `null` count, or an empty page while `rows.length < count` → `{ data: null, error }`, never partial data. The shortfall error carries a message with the rows received and the count, for the Worker log.
- `buildTeamView({ members, windows, carryOvers })`, taking the 3 `loadAllPages` results → `{ status: "unknown" } | { status: "ready"; members; windows; carryOvers; totals: Map<string, { windows: number; minutes: number }> }`. Any failed input → `unknown`. `totals` (moved from `manager/availability.astro:134-138`, using `windowMinutes`) exists only on `ready`.
- Only `import type` for row types (`TeamMember`, `TeamWindowRow`) plus imports from `./availability`. No runtime import of `@/lib/supabase`.

#### 2. Team view page

**File**: `src/pages/manager/availability.astro`

**Intent**: Read profiles, month windows and carry-overs through `loadAllPages` (each with `{ count: "exact" }` and an `id` tiebreak in `order`), log each failed read with `logAvailabilityError` as today, and render from `buildTeamView`. On `unknown`, show `TEAM_LOAD_ERROR` and the month tabs and lock-status line only.

**Contract**:

- `windowsUnknown` and the page-local `loadMonthWindows` are removed. The `WINDOWS_PAGE_SIZE` comment is rewritten to state that paging follows the count, so a lower `max_rows` costs requests, not rows.
- Profiles order: `email`, then `id`. Month windows: `starts_at`, then `id` (as today). Carry-overs: `id`.
- `TeamCalendar`, `TeamDayPanel` and `TeamSummary` render only when the view is `ready`; `?employee=` is honoured only against ready members (unchanged rule).
- The lock read and `lockStateUnknown` stay as they are.

#### 3. Read-path unit tests

**File**: `src/lib/team-availability.test.ts` (new)

**Intent**: Prove "an empty list is not proof of no data": every failure shape ends in `unknown`, and a complete read with a member who has no windows is the only way a member lacks a total.

**Contract** (fixture pages from a fake `fetchPage` over a literal row array; no Supabase client):

- Complete read across pages: 7 rows, page size 3 → all 7 rows in order, requests at offsets 0, 3, 6.
- Cap below page size: the fake serves at most 3 rows per request whatever range is asked, page size 5, 7 rows → all 7 rows (offsets 0, 3, 6). This is the archive F1 scenario that the short-page loop truncated.
- Error on the second page → error, no partial data.
- `count: null` → error.
- Shortfall: count 7, but the fake returns `[]` at offset 5 → error.
- Count 0, empty first page → `[]`, one request.
- `buildTeamView`: windows failed → `unknown`; carry-overs failed → `unknown`; **profiles failed while windows succeed → `unknown`** (the residual gap); all succeed → `ready` with literal totals per member (e.g. two windows 08:00–16:00 and 22:00–02:00 → 2 windows, 720 minutes).
- Control: all succeed, one member with no windows → `ready`, and that member has no `totals` entry (the legitimate "No availability submitted").

### Success Criteria:

#### Automated Verification:

- Unit tests pass, including the new team-availability file: `npm test`
- Lint passes: `npm run lint`
- Type check passes: `npx astro check`
- Colour-literal check passes: `npm run check:ui`
- Production build succeeds: `npm run build`

#### Manual Verification:

- As the seeded manager, `/manager/availability` for a month with windows looks as before (calendar counts, day panel, summary with "No availability submitted" for accounts without windows)
- With the profiles read temporarily pointed at a non-existent column on the local server, the team view shows only the error alert, month tabs and lock-status line, with no calendar, day panel or summary (revert afterwards)
- Smoke still passes, including "team availability shows the employee's window": `npm run smoke`

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Smoke Endpoint Gates

### Overview

Add smoke steps that send the manager endpoints' POSTs as an employee and as an anonymous user, check the 403 page and prove the refused request had no effect.

### Changes Required:

#### 1. Smoke steps

**File**: `scripts/smoke.mjs`

**Intent**: Prove over HTTP that `/api/manager/*` POSTs are gated like the pages and that the rewrite to `/403` skips the handler.

**Contract**:

- A helper that returns the signed-in user's id from the Supabase session cookie in the jar (Critical Implementation Details), used only by the self-promotion step.
- After "team availability forbidden for employee", as the fresh employee:
  1. "employee cannot lock a month": POST `/api/manager/months/lock` `{ month: smokeMonthValue, action: "lock" }` → 403, and the page text contains "Access denied".
  2. "month stays open after the employee lock attempt": POST `/api/availability/create` `{ date: <smokeMonthValue>-02, start: "08:00", end: "16:00" }` → 302 to `/availability?month=<smokeMonthValue>&day=<smokeMonthValue>-02&updated=1` (a lock would refuse it).
  3. "employee cannot promote themselves": POST `/api/manager/users/role` `{ userId: <own id>, role: "manager" }` → 403 with "Access denied".
  4. "employee still forbidden after the promotion attempt": GET `/manager/users` → 403 (the middleware re-reads the role per request, so a promotion would give 200).
- After "dashboard redirects after signout": "anonymous lock request goes to sign-in": POST `/api/manager/months/lock` `{ month: smokeMonthValue, action: "lock" }` → 302 to `/auth/signin`.
- The header comment at `:1-4` mentions the endpoint gates.

#### 2. Smoke documentation

**File**: `CLAUDE.md` (Commands → `npm run smoke`)

**Intent**: Describe the new endpoint-gate steps and correct what each run leaves behind.

**Contract**: The description lists the employee's refused lock and self-promotion POSTs (403, no effect) and the anonymous POST (sign-in). It states that each run leaves the fresh smoke user's windows on day 1 and day 2 of station month + 12 and on day 2 of station month + 3. Re-runnability without a DB reset is unchanged (fresh user each run, manager unlock still runs).

### Success Criteria:

#### Automated Verification:

- Station-time zone guard still passes for the edited smoke script: `npx vitest run src/lib/station-time-zone.test.ts`
- Lint passes: `npm run lint`

#### Manual Verification:

- Smoke passes twice in a row against a local server with no DB reset in between: `npm run smoke`
- With `/api/manager` temporarily removed from `MANAGER_ROUTES` on the local server, the new employee POST steps fail (revert afterwards)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 4: Mutation Pass and Cookbook

### Overview

Check the new tests with Stryker on both new modules, add literal assertions for survivors that would hurt a user, and record the patterns and notes in the test plan and CLAUDE.md.

### Changes Required:

#### 1. Mutation triage

**File**: `src/lib/route-access.test.ts`, `src/lib/team-availability.test.ts` (additions only if needed)

**Intent**: Run `npx stryker run --mutate "src/lib/route-access.ts"` and `npx stryker run --mutate "src/lib/team-availability.ts"`. For each survivor, ask "would this change hurt a user?" (test-plan §6.1 item 9). Add a literal-valued assertion if yes; record it as accepted if no.

**Contract**: No change to `stryker.config.json` (scope by `--mutate`). Scores and accepted survivors go into §6.6.

#### 2. Test plan cookbook and notes

**File**: `context/foundation/test-plan.md`

**Intent**: Replace the §6.3 and §6.4 TBDs with recipes and add the Phase 3 entry under §6.6.

**Contract**:

- §6.3 "Adding a test for a new protected route or endpoint":
  - a new page or endpoint gets a row in the `route-inventory.test.ts` table;
  - a new gate prefix goes into `route-access.ts` with rows in the decision table (page **and** `/api` counterpart);
  - add a smoke step only for a new endpoint that writes data (an employee POST → 403 plus a no-effect check);
  - never re-check the role in a handler as a substitute for the gate.
- §6.4 "Adding a test for a read path that feeds a decision":
  - read month-wide lists through `loadAllPages` with `{ count: "exact" }` and an `id` tiebreak;
  - map results to a ready/unknown state before deriving any "nobody/none" message, and render the alert instead of empty states on unknown;
  - test with a fake `fetchPage` over literal fixture pages (error page, null count, shortfall, cap below page size, count 0) plus one legitimate-empty control;
  - no Supabase client mocks and no e2e test.
- §6.6 Phase 3 entry: test counts per file, mutation scores and accepted survivors, the smoke steps added, and accepted gaps: `/manager/months` fails open and renders the raw error (legacy, §7); offset paging under concurrent writes during one load is best effort; encoding variants of paths are Astro's.

#### 3. Project guide

**File**: `CLAUDE.md`

**Intent**: Point readers at the new modules.

**Contract**:

- Auth flow: the middleware bullet names `src/lib/route-access.ts` as the owner of the route lists and the decision, and the inventory guard.
- Availability, team view: reads go through `loadAllPages`/`buildTeamView` in `src/lib/team-availability.ts`, and an unknown state shows only the alert, tabs and lock status.
- Commands, pre-commit: a staged `src/pages/**` file runs `src/lib/route-inventory.test.ts`.

### Success Criteria:

#### Automated Verification:

- Mutation runs complete for both modules: `npx stryker run --mutate "src/lib/route-access.ts"` and `npx stryker run --mutate "src/lib/team-availability.ts"`
- Unit tests pass after any added assertions: `npm test`
- Markdown is formatted: `npx prettier --check context/foundation/test-plan.md CLAUDE.md`

#### Manual Verification:

- Every survivor in both mutation reports is either killed by a new assertion or listed in §6.6 with a reason
- §6.3 and §6.4 read as self-contained recipes for someone adding a route or a read path

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Testing Strategy

### Unit Tests:

- Route × actor decision over every gated page and endpoint, boundary paths and public controls (`src/lib/route-access.test.ts`).
- Fail-closed role resolution: error, missing row, unknown or mis-cased role, non-string (`src/lib/route-access.test.ts`).
- Route inventory: every `src/pages` file has an explicit expected access that agrees with the decision (`src/lib/route-inventory.test.ts`).
- Count-driven paging: multi-page, cap below page size, error mid-read, null count, shortfall, count 0 (`src/lib/team-availability.test.ts`).
- Ready/unknown mapping: each failed read → unknown (including profiles), literal totals, legitimate no-submission control (`src/lib/team-availability.test.ts`).

### Integration Tests:

- Smoke over HTTP: employee POST to both manager endpoints → 403 page with no effect; anonymous POST → sign-in; the existing team-view and manager steps still pass.
- Phase 2 pgTAP stays the proof for role-change rules and the last-manager guard.

### Manual Testing Steps:

1. Run `npm run smoke` against a local server after Phase 1 (no behaviour change) and twice after Phase 3 (re-runnable).
2. Force a profiles read error locally and confirm the team view shows only the alert, tabs and lock status; revert.
3. Drop `/api/manager` from `MANAGER_ROUTES` locally and confirm the unit table, the inventory guard and the new smoke steps all go red; revert.

## Performance Considerations

`count: "exact"` adds a `COUNT(*)` to each team-list request. The queries are filtered to one month (windows) or are small tables (profiles), and the view already issues one request per page. A lower `max_rows` now costs extra requests instead of missing rows.

## Migration Notes

None: no schema change, no data change. The route decision moves without changing behaviour; the team view's only visible change is on load failure.

## References

- Related research: `context/changes/testing-route-gating-honest-reads/research.md`
- Test plan: `context/foundation/test-plan.md` §2 (risks #4, #6 and Risk Response Guidance), §6.1 (unit test conventions)
- Current decision: `src/middleware.ts:5-46`
- Current team read: `src/pages/manager/availability.astro:51-125,134-138,207-221`
- Honest-read pattern: `src/pages/manager/users.astro:72-78`
- File-reading guard to mirror: `src/lib/station-time-zone.test.ts`, `lint-staged.config.mjs`
- Archive findings: `context/archive/2026-09-29-manager-availability-visibility/reviews/impl-review.md` (F1, F2)
- Previous phase: `context/archive/2026-10-03-testing-database-rules/plan.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Route Access Decision

#### Automated

- [x] 1.1 Unit tests pass, including the new route-access and route-inventory files: `npm test` — a746571
- [x] 1.2 Lint passes: `npm run lint` — a746571
- [x] 1.3 Type check passes: `npx astro check` — a746571
- [x] 1.4 Production build succeeds: `npm run build` — a746571
- [x] 1.5 Inventory guard goes red when a scratch file `src/pages/api/team/probe.ts` is added and green again after it is removed: `npx vitest run src/lib/route-inventory.test.ts` — a746571

#### Manual

- [x] 1.6 Smoke still passes unchanged against a local server (middleware behaviour preserved): `npm run smoke` — a746571
- [x] 1.7 Committing a staged change to a `src/pages` file shows the inventory guard running in the lint-staged output — a746571

### Phase 2: Honest Team Read

#### Automated

- [x] 2.1 Unit tests pass, including the new team-availability file: `npm test` — ad6f083
- [x] 2.2 Lint passes: `npm run lint` — ad6f083
- [x] 2.3 Type check passes: `npx astro check` — ad6f083
- [x] 2.4 Colour-literal check passes: `npm run check:ui` — ad6f083
- [x] 2.5 Production build succeeds: `npm run build` — ad6f083

#### Manual

- [x] 2.6 As the seeded manager, `/manager/availability` for a month with windows looks as before (calendar counts, day panel, summary with "No availability submitted" for accounts without windows) — ad6f083
- [x] 2.7 With the profiles read temporarily pointed at a non-existent column on the local server, the team view shows only the error alert, month tabs and lock-status line, with no calendar, day panel or summary (revert afterwards) — ad6f083
- [x] 2.8 Smoke still passes, including "team availability shows the employee's window": `npm run smoke` — ad6f083

### Phase 3: Smoke Endpoint Gates

#### Automated

- [x] 3.1 Station-time zone guard still passes for the edited smoke script: `npx vitest run src/lib/station-time-zone.test.ts` — 822ec87
- [x] 3.2 Lint passes: `npm run lint` — 822ec87

#### Manual

- [x] 3.3 Smoke passes twice in a row against a local server with no DB reset in between: `npm run smoke` — 822ec87
- [x] 3.4 With `/api/manager` temporarily removed from `MANAGER_ROUTES` on the local server, the new employee POST steps fail (revert afterwards) — 822ec87

### Phase 4: Mutation Pass and Cookbook

#### Automated

- [x] 4.1 Mutation runs complete for both modules: `npx stryker run --mutate "src/lib/route-access.ts"` and `npx stryker run --mutate "src/lib/team-availability.ts"`
- [x] 4.2 Unit tests pass after any added assertions: `npm test`
- [x] 4.3 Markdown is formatted: `npx prettier --check context/foundation/test-plan.md CLAUDE.md`

#### Manual

- [x] 4.4 Every survivor in both mutation reports is either killed by a new assertion or listed in §6.6 with a reason
- [x] 4.5 §6.3 and §6.4 read as self-contained recipes for someone adding a route or a read path
