---
date: 2026-10-03T17:09:52+02:00
researcher: Claude (Opus 5.5) for Redellex
git_commit: a2b8054
branch: master
repository: Planner
topic: "Ground rollout Phase 3 of context/foundation/test-plan.md (route gating and honest reads)"
tags: [research, test-plan, middleware, route-gating, roles, team-availability, read-path, smoke]
status: complete
last_updated: 2026-10-03
last_updated_by: Claude (Opus 5.5)
---

# Research: Ground rollout Phase 3 — route gating and honest reads

**Date**: 2026-10-03T17:09:52+02:00
**Researcher**: Claude (Opus 5.5) for Redellex
**Git Commit**: a2b8054. The working tree has one uncommitted change, the Phase 3 status row in `context/foundation/test-plan.md`. Every cited source file under `src/`, `scripts/` and `supabase/` is unchanged from that commit.
**Branch**: master
**Repository**: Planner

## Research Question

Ground §3 Phase 3 of `context/foundation/test-plan.md` ("Route gating and honest reads", risks #4 and #6; unit tests plus targeted smoke steps). The questions:

- Where does the route × role decision live, and what would a unit test need?
- Which route × role combinations are already proven, and by which layer?
- Which reads feed the manager's "who submitted" decision, and how do they behave on an error or a truncated result?
- What would make both risks testable without mocking the whole Supabase client (test-plan §2, anti-pattern for #4)?

## Summary

- **The route × role decision is pure, but it is locked inside `src/middleware.ts`.**
  - The decision at `src/middleware.ts:33-46` depends on three inputs only: the pathname, whether a user exists, and the role. Everything else is context: the Supabase client, `getUser`, the profiles read, and `redirect`/`rewrite`/`next`.
  - The module exports only `onRequest` (`:12`), and it imports `astro:middleware` (`:1`) and `@/lib/supabase`. `@/lib/supabase` imports `astro:env/server` (`src/lib/supabase.ts:3`).
  - `vitest.config.ts:4-11` has no Astro plugin and no alias, so a test cannot import the middleware.
  - The unit layer therefore needs the route lists, `matchesRoute` and the decision extracted into an import-free `src/lib` module. `src/middleware.ts` would then only map the result onto `redirect`, `rewrite` or `next`.
- **Role resolution fails closed in 4 inspected cases, and all 4 end in a 403 on manager routes.** The role is set only when `!error && isAppRole(data?.role)` (`src/middleware.ts:27-28`; `isAppRole` at `src/lib/roles.ts:7-9`). The 4 cases are:
  - a missing profile row (`maybeSingle` returns `data: null`);
  - a read error;
  - an unknown role value;
  - an anonymous or unconfigured request.
- **Every manager route is gated only by the middleware and RLS.** None of the 5 manager pages or endpoints re-checks the role in its handler (`src/pages/manager/{users,months,availability}.astro`, `src/pages/api/manager/{months/lock,users/role}.ts`).
  - This makes "the page is gated, so the endpoint is gated" (test-plan §2 #4) true only through the shared `/manager` / `/api/manager` prefix pair at `src/middleware.ts:6`.
  - The route lists cover every page and endpoint that needs a gate (20 files inspected under `src/pages`; no mismatch found).
- **Smoke covers the route × role table only partly.**
  - Covered: anonymous to `/dashboard`, employee GET of 2 manager pages (403), and manager GET of 2 manager pages plus 2 manager POSTs (`scripts/smoke.mjs:87,156-157,168-205`).
  - **No smoke step sends a manager endpoint request as an employee or anonymous user.** That leaves out `POST /api/manager/months/lock` and `POST /api/manager/users/role`, so the employee self-promotion attempt over HTTP is not covered.
  - The database half of self-promotion is covered by pgTAP (`supabase/tests/database/profiles_roles.test.sql`, Phase 2).
- **The "No availability submitted" flag is derived in the `.astro` frontmatter, not in `src/lib`.**
  - The flag renders at `src/components/team-availability/TeamSummary.astro:56-59` when `totals.get(member.id)` is undefined (`:37,:52`).
  - `totals` is built at `src/pages/manager/availability.astro:134-138` from the paged read `loadMonthWindows` (`:59-79`). That function is page-local.
  - None of the 3 unit test files (`src/lib/*.test.ts`) touches a read path.
- **Archive fixes F1 and F2 (2026-09-29) are present in the code but have no test.**
  - F1: the month-wide window read is paged with `.range()` in steps of 1000 (`:58-79`).
  - F2: a failed window or carry-over read sets `windowsUnknown` (`:103,:110`), which hides the day panel and the summary (`:215-221`).
  - That review was verified with lint, `astro check` and smoke only (`context/archive/2026-09-29-manager-availability-visibility/reviews/impl-review.md:53,73`).
- **4 residual "looks empty" paths remain** (details in Finding 4):
  1. A failed profiles read with successful window reads does not set `windowsUnknown`. The day panel and the summary render empty states under the error alert.
  2. When `windowsUnknown` is set, the calendar still renders, with `aria-label` "no one available" on every day.
  3. The paging loop stops on the first short page. It truncates silently if the PostgREST `max_rows` of an environment is below `WINDOWS_PAGE_SIZE` (1000).
  4. `/manager/months` fails open on a lock-read error and renders the raw database message (`src/pages/manager/months.astro:22-23`).

## Detailed Findings

### 1. Route × role decision (risk #4)

`src/middleware.ts`:

- **Route lists (`:5-6`).** `PROTECTED_ROUTES = ["/dashboard", "/availability", "/api/availability"]` and `MANAGER_ROUTES = ["/manager", "/api/manager"]`.
- **`matchesRoute` (`:8-10`)** is `pathname === route || pathname.startsWith(`${route}/`)`.
  - It matches on segment boundaries and is case-sensitive.
  - `/managerX` does not match; `/manager/` and `/manager/users` do.
- **Order of checks:**
  1. Create the client (`:13`) and reset `locals.user`/`locals.role` to null (`:15-16`).
  2. `getUser` (`:19-22`). Its error is not checked, so an error yields `user = null`.
  3. Read the role from profiles (`:26-29`).
  4. Protected check: no user → `redirect("/auth/signin")` (`:33-37`).
  5. Manager check: no user → redirect (`:40-42`); `role !== "manager"` → `rewrite("/403")` (`:43-45`).
  6. `next()` (`:48`).
- **Pure decision.**
  - Inputs: `(pathname, hasUser, role)`.
  - Outputs: 3 outcomes (continue, sign-in redirect, 403).
  - Path matching precedes it: a path matching neither list continues regardless of user or role.
- **How Astro normalises the path before the middleware reads it** (installed Astro 7.3.2, `node_modules/astro/dist/core/fetch/fetch-state.js:212-216`):
  - Percent-encoding is decoded and duplicate slashes are collapsed, so `/%6Danager/users` and `//manager` reach the middleware as `/manager/...`.
  - `%2F` stays encoded. `/manager%2Fusers` matches no gate but also no route (404).
  - `/Manager/users` is a 404 because route matching is case-sensitive.
  - Source: the worker's reading of `fetch-state.js:772-782` and `core/routing/pattern.js:22`. Only `:212-216` was re-checked in the main pass.
  - Consequence: a unit test of the extracted decision receives an already-normalised pathname. Encoding variants belong to Astro (vendor boundary, test-plan §1) and do not need unit rows.
- **Rewrite behaviour.**
  - `context.rewrite()` re-runs the middleware for the new route (Astro docs via Context7, `guides/middleware.mdx` "Rewriting").
  - `/403` is in neither list, so the second pass calls `next()`.
  - `src/pages/403.astro:5` sets `Astro.response.status = 403`. Its comment at `:4` states that rewritten `/api/manager/*` POSTs land there too, so the endpoint handler does not run.
  - That POST → 403 behaviour is inferred from source and that comment. No smoke step exercises it (Finding 3).
- **Role resolution (`:24-29`).** `.maybeSingle()` on `profiles.role` sets the role only when there is no error and `isAppRole` accepts the value.
  - `isAppRole` (`src/lib/roles.ts:7-9`) is `typeof value === "string" && APP_ROLES.includes(value)`, with `APP_ROLES = ["manager", "employee"]`.
  - `src/lib/roles.ts` has only a type import (`:1`), so it is safe to import in Vitest.
- **Unconfigured Supabase.** With no client, `user` stays null, so every protected or manager path redirects to sign-in (`:18,:33-42`).

### 2. Route inventory: which handler re-checks what

20 page/endpoint files were inspected under `src/pages`. No file exports `prerender`. Every endpoint exports `POST` only.

| Route | Gate (`src/middleware.ts:5-6`) | Handler re-check |
| --- | --- | --- |
| `/`, `/403`, `/auth/*`, `/api/auth/*` | none | none (correct: public) |
| `/dashboard` | protected | reads `user`/`role` for display only |
| `/availability` | protected | `else if (user)` guard, queries `.eq("employee_id", user.id)` |
| `/api/availability/{create,update,delete}` | protected | none; RLS and the `employee_id default auth.uid()` decide |
| `/manager/{users,months,availability}` | manager | none (`manager/availability.astro:34` comment relies on `MANAGER_ROUTES`) |
| `/api/manager/months/lock` | manager | none; RLS (`lock.ts:32` comment) |
| `/api/manager/users/role` | manager | no role check; `locals.user` is used only to send a self-demoted manager to `/dashboard` (`role.ts:41-44`, archive `2026-09-25-role-aware-access-control` F2); RLS plus the last-manager trigger (`role.ts:31-32`) |
| `/dev/*-states` | none | `if (!import.meta.env.DEV)` → status 404 (`availability-states.astro:24-27`, `manager-users-states.astro:19-22`) |

- No page prefix lacks its `/api` counterpart.
- `/manager` (exact) is gated but has no page (404 for a manager).

### 3. What smoke proves today

`scripts/smoke.mjs`:

- **How steps run.** `redirect: "manual"`, a cookie jar, and a status plus location-prefix check (`:58-71`, `:214-219`).
- **Route × role steps, by actor:**
  - Anonymous: GET `/` 200 (`:86`); GET `/dashboard` 302 → `/auth/signin` (`:87`, again after sign-out at `:159`).
  - Fresh employee: GET `/dashboard` and `/availability` 200 (`:103-104`); GET `/manager/users` and `/manager/availability` 403 (`:156-157`).
  - Seeded manager: GET `/manager/users` 200 (`:168,:187`); GET `/manager/availability` 200 (`:169-177`); POST `/api/manager/users/role` self-demotion refused (`:178-186`); POST `/api/manager/months/lock` lock and unlock (`:188-192,:201-205`).
- **Not covered, from the inspected step list:**
  - Anonymous: GET `/availability`, `/manager/*`; POST `/api/availability/*`, `/api/manager/*`.
  - Employee: GET `/manager/months`; POST `/api/manager/months/lock`; POST `/api/manager/users/role` (self-promotion over HTTP).
  - Manager: GET `/manager/months`.
  - Smoke checks status only, never that a 403 response is free of the page's data.
- **Constraints a new smoke step must respect** (CLAUDE.md, `npm run smoke`):
  - The run must stay re-runnable without a DB reset.
  - Lock steps use station month + 12 and unlock it afterwards.
  - An employee lock attempt must target a month that the same run then shows as still unlocked, or one that the later manager unlock clears either way.

### 4. Read paths feeding a decision (risk #6)

No `.rpc(` calls and no `count:` queries exist under `src/`. Reads that feed what a manager or employee concludes:

| Read | Location | Paged? | On error |
| --- | --- | --- | --- |
| Team windows starting in month | `src/pages/manager/availability.astro:59-79` (`loadMonthWindows`) | yes, `.range(from, from+999)` until a short page | returns `{data:null,error}` (`:71-73`) → `windowsUnknown`, alert (`:102-105`) |
| Profiles (team members) | `:86` | no | alert only (`:96-101`); **`windowsUnknown` not set** |
| Carry-over windows | `:88-92` | no (at most 1 per account, because windows do not overlap) | `windowsUnknown`, alert (`:109-115`) |
| Month locks (team view) | `:93` | n/a (≤4 rows) | `lockStateUnknown` → "Lock state unknown" (`:116-124,:170-171`) |
| Own windows | `src/pages/availability.astro:56-62` | no | alert (`:73-78`); the day panel still says "No windows" |
| Own locks | `src/pages/availability.astro:70` | n/a | `lockStateUnknown` → read-only month (`:85-96`; archive `2026-09-26` F4 fix) |
| Profiles (users page) | `src/pages/manager/users.astro:32-35` | no | the alert replaces the list (`:72-78`). This is the honest pattern. |
| Locks (months page) | `src/pages/manager/months.astro:18-23` | n/a | **fails open**: `error ??= queryError.message` renders the raw message, and every month shows "Open" with a Lock button. An `?error=` already in the URL hides the query error (`:8`). |

**Data flow to "No availability submitted":**

1. `loadMonthWindows` (`:59-79`) fills `windows` (`:107`).
2. `totals` is built from `windows` (`:134-138`, using the pure `windowMinutes` from `src/lib/availability.ts`).
3. `<TeamSummary members totals>` (`:219`) renders, only while `!windowsUnknown` (`:215`).
4. `TeamSummary.astro:56-59` shows the flag for each member with no `totals` entry.

Totals count only windows that start in the month (`:133` comment), so a member whose only window is a carry-over is flagged by design.

**Residual paths where incomplete data reads as "nobody" (current code):**

1. **The profiles read fails while the window reads succeed.**
   - `members = []`, and `windowsUnknown` stays false.
   - `addEntry` drops every row because no member matches (`:143-147`). The result:
     - the calendar shows "no one available" on every day (`TeamCalendar.astro:58-60`);
     - the day panel says "No one has availability on this day." (`TeamDayPanel.astro:27-28`);
     - the summary says "No accounts to show." (`TeamSummary.astro:32-33`).
   - The error alert is shown above them (`:186-191`). The exact "No availability submitted" string does not appear on this path.
2. **The window or carry-over read fails.**
   - The calendar still renders (`:207-213`) with empty `entriesByDay`, so each day's `aria-label` reads "no one available".
   - Archive F2 accepted the calendar rendering. It did not discuss the label.
3. **Truncation by a page-size mismatch.**
   - `config.toml:18` sets `max_rows = 1000` locally, and `WINDOWS_PAGE_SIZE = 1000` (`:58`).
   - If an environment's `max_rows` were lower, the first page would come back short and the loop would stop (`:75`). Members past the cut-off would be flagged "No availability submitted": the exact risk #6 scenario.
   - Nothing in code or config enforces `page size ≤ max_rows`; only the comment at `:55-57` does.
   - The hosted project's `max_rows` was not checked (Open Questions).
4. **`/manager/months` lock read fails.** The page fails open and renders the raw message, as in the table above. It is a legacy `bg-cosmic` view (CLAUDE.md UI, Legacy).

**Testability.**

- `src/lib/availability.ts` and `src/lib/manager-users.ts` have no imports, so tests can load them.
- `src/lib/supabase.ts` imports `astro:env/server`, so a lib read helper may only `import type` the client type.
- `.astro` files cannot be rendered under the plain `vitest.config.ts`. The paging loop and the error → state mapping (`:59-125`) must therefore move into a lib function before a unit test can reach them.
- To avoid "mocking the whole Supabase client" (test-plan §2 #4/#6 anti-pattern), the seam can be a narrow page fetcher: `(from, to) => Promise<{ data, error }>`. A test then feeds that function fixture pages, including an error page, a full page, and a page shorter than the page size.
- The truncation check needs a decision about what counts as proof (Open Questions). A short page is indistinguishable from the end of data unless the read also asks for `count`.

**Roadmap tie-in.** `context/foundation/roadmap.md:121` (S-03 handoff) says "PostgREST silently caps a read at 1000 rows, so page month-wide reads (S-02 does this in `loadMonthWindows` with `.range()`)". It asks the generator to page; it does not say the generator reuses that function. Extracting the loop into `src/lib` would make it reusable by S-03. That is an inference, not a roadmap decision.

### 5. Harness facts for the plan

- **Test location and runner.** Tests live in `src/**/*.test.ts` (`vitest.config.ts:9`); `environment: "node"`, TZ forced to UTC (`:2`).
- **Imports in tests.** Existing tests import with relative paths (e.g. `src/lib/station-time-zone.test.ts:5`). Whether Vitest 5.0.3 resolves the `@/` alias without config was not verified. A new lib module that imports only `./roles` (type-only) and other import-free lib modules avoids the question.
- **Hooks and pre-commit.**
  - Agent hooks run related Vitest tests after each edit and the whole suite at end of turn (CLAUDE.md, Commands).
  - Pre-commit runs `vitest related --run` on staged `*.{ts,tsx,astro}` (`lint-staged.config.mjs`).
  - A new `src/lib/*.test.ts` is picked up by both with no config change.
- **Stryker.** `stryker.config.json` mutates only `src/lib/availability.ts`. A new module can be checked with `--mutate` (test-plan §6.1 item 9).

## Code References

- `src/middleware.ts:5-6` — route lists.
- `src/middleware.ts:8-10` — `matchesRoute` (segment-boundary prefix match).
- `src/middleware.ts:24-29` — fail-closed role resolution.
- `src/middleware.ts:33-46` — the route × role decision (pure in its inputs).
- `src/lib/roles.ts:5-9` — `APP_ROLES`, `isAppRole`.
- `src/lib/supabase.ts:3` — `astro:env/server` import (blocks a runtime import in tests).
- `vitest.config.ts:1-11` — plain config, no Astro plugin or alias.
- `src/pages/403.astro:4-5` — status 403, also for rewritten POSTs.
- `src/pages/api/manager/users/role.ts:31-46` — no role check; RLS plus trigger; self-demotion redirect.
- `scripts/smoke.mjs:86-87,103-104,156-159,168-205` — current route × role steps.
- `src/pages/manager/availability.astro:51-53,55-79,85-125,127-163,207-221` — team-view state, paging loop, error mapping, aggregation, conditional render.
- `src/components/team-availability/TeamSummary.astro:32-33,52-59` — "No accounts to show." / "No availability submitted".
- `src/components/team-availability/TeamCalendar.astro:54-60` — per-day `aria-label` text.
- `src/components/team-availability/TeamDayPanel.astro:27-28` — "No one has availability on this day."
- `src/pages/manager/months.astro:8,18-23` — fail-open lock read, raw error message.
- `supabase/config.toml:18` — `max_rows = 1000` (local).

## Architecture Insights

- Authorisation has 2 layers on the paths inspected here: the middleware (prefix gates) and Postgres (RLS, grants, triggers). Handlers add no role checks. Unit tests of the extracted route decision cover the first layer; Phase 2's pgTAP covers the second. Smoke is the only layer that proves they are wired together over HTTP.
- The honest-read pattern already exists in 2 places: `manager/users.astro` (the error replaces the list) and the lock reads of `availability.astro` and `manager/availability.astro` (an "unknown" flag fails closed). The team-view window path follows it partly. The phase can name that pattern in test-plan §6.4.
- Business logic in this repo lives in import-free `src/lib/*.ts` modules that pages and endpoints call (`availability.ts`, `manager-users.ts`, `roles.ts`). Extracting the route decision and the team read/state mapping follows that convention.

## Historical Context (from prior changes)

- `context/archive/2026-09-29-manager-availability-visibility/reviews/impl-review.md`:
  - **F1 (`:36-53`)**: the 1000-row cap flagged accounts "No availability submitted". **Supported**: fixed with `.range()` paging (code at `manager/availability.astro:55-79`). Fix B (`count: "exact"` plus a "partial month" alert, `:48-52`) was not taken. The review judged the profiles cap unrealistic (`:47`).
  - **F2 (`:55-63`)**: a failed window read flagged everyone. **Supported**: fixed with `windowsUnknown` (`:52,:103,:110,:215`). **Partial**: the calendar still renders, and its `aria-label` reads "no one available" (Finding 4.2).
  - Neither fix has an automated test (`:53,:73`, verification by lint, `astro check` and smoke).
- `context/archive/2026-09-26-employee-availability-management/reviews/impl-review.md` **F4 (`:73-81`)**: the lock query failed open on `/availability`. **Supported** for `availability.astro` (`:45-46,85-96`). **Not applied** to `manager/months.astro`, which still has the `error ??=` fail-open pattern (`:8,:22-23`).
- `context/archive/2026-09-25-role-aware-access-control/reviews/impl-review.md` **F2 (`:43-51`)**: a self-demoted manager landed on 403. **Supported**: fixed in `role.ts:41-44`. The review notes that the flow itself was not manually tested (`:51`).
- `context/archive/2026-10-03-testing-database-rules/`: Phase 2 already proves employee self-promotion, promoting another user, and last-manager demotion at the database layer (test-plan §6.6, Phase 2). Phase 3 does not need to repeat those as unit tests.

## Related Research

- `context/archive/2026-10-03-testing-database-rules/research.md` — Phase 2 grounding (RLS, grants, triggers).
- `context/archive/2026-10-01-testing-station-time/research.md` — Phase 1 grounding (Vitest setup, UTC).

## Open Questions

Choices for `/10x-plan` (product/scope decisions, not missing evidence):

1. **Fix residual gaps in this phase, or only test them?**
   - Gaps 4.1 (profiles read failure), 4.2 (calendar `aria-label`) and 4.4 (`/manager/months` fail-open) are product defects against risk #6 and the feedback convention.
   - A test that pins current behaviour would pin the defect. The test plan's goal ("never looks like nobody submitted") implies fixing at least 4.1.
   - 4.4 sits in a legacy view.
2. **What counts as truncation proof?** Two options:
   - (a) Keep the short-page loop and test it against fixture pages, accepting that a `max_rows` below the page size is not detectable.
   - (b) Request `count: "exact"` on the first page and treat `rows.length < count` as an error (archive F1 Fix B).
   - Option (b) is the only one that detects an environment cap below the page size.
3. **Seam for the read helper.** Either a narrow page-fetch function (recommended by the anti-pattern guidance), or a minimal structural client type. Both avoid importing `@/lib/supabase` at runtime.
4. **Smoke additions.** Which of the uncovered combinations from Finding 3 to add. The cheapest high-signal ones:
   - employee POST `/api/manager/months/lock` → 403, then the manager sees the month unlocked;
   - employee POST `/api/manager/users/role` promoting themselves → 403, then still 403 on `/manager/users`;
   - anonymous POST to `/api/manager/*` → 302 to sign-in.

   These are the only checks of the gate on endpoints over HTTP. A unit test of the decision cannot show that `src/middleware.ts` actually calls it.

Unresolved facts (not blocking a plan):

- The hosted Supabase `max_rows` value was not checked (no Supabase MCP or dashboard access in this session).
- POST → `rewrite("/403")` → status 403 with the handler not run is inferred from Astro source and the `403.astro:4` comment; it has not been observed. The proposed smoke step would observe it.
- Whether Vitest 5.0.3 resolves `@/` without config was not verified.
