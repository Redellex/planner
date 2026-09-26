---
date: 2026-09-26T11:34:22+0200
researcher: Claude Opus 5.5
git_commit: cc4cb443a15a3e5d9d72f72615018e195360e2b8
branch: master
repository: Planner
topic: "What S-01 employee-availability-management must build on, and which design decisions are still open"
tags: [research, codebase, supabase, rls, middleware, availability, roles]
status: complete
last_updated: 2026-09-26
last_updated_by: Claude Opus 5.5
last_updated_note: "Follow-up: where availability is entered (Planner web app, no import channel)"
---

# Research: Employee availability management (S-01)

**Date**: 2026-09-26T11:34:22+0200
**Researcher**: Claude Opus 5.5
**Git Commit**: cc4cb443a15a3e5d9d72f72615018e195360e2b8 (working tree has only untracked skill/command folders; no source changes)
**Branch**: master
**Repository**: Planner

## Research Question

Roadmap slice S-01 (`context/foundation/roadmap.md:45`, `:80-93`): an employee can create and edit their own availability windows for the upcoming month, and edits lock once the manager starts generating that month's schedule (PRD FR-001, `context/foundation/prd.md:62-63`). The questions for this research:

1. What does F-01 (`role-aware-access-control`) already provide that S-01 has to reuse: schema, RLS helpers, session role, route gating and API patterns?
2. Which conventions (API shape, UI, typing, verification) does a new DB-backed feature have to follow?
3. What do upstream documents already decide about availability shape, the "month" concept and the lock trigger, and what is still open?

## Summary

- **F-01 is usable but not closed.** Phases 1–3 are checked off. Phases 1–2 have commit SHAs, and Phase 3 steps are checked but have no SHA (`context/changes/role-aware-access-control/plan.md`, `## Progress`). Phase 4 is still open (`4.1`–`4.4`): the role steps in the smoke script and the CLAUDE.md docs. `scripts/smoke.mjs` has 8 steps, and none of them signs in as a manager or checks roles (`scripts/smoke.mjs:39-60`). The roadmap still lists F-01 as `ready`, not `done` (`context/foundation/roadmap.md:44`).
- **Reusable building blocks exist.** They are the `public.app_role` enum, the `public.profiles` table, the `public.is_manager()` SECURITY DEFINER helper and the two-policy "own row + manager" SELECT pattern (`supabase/migrations/20260925120000_create_profiles_and_roles.sql:5-13`, `:43-59`, `:64-74`). They also include `locals.role`, which fails closed (`src/middleware.ts:15-31`), and a typed Supabase client (`src/lib/supabase.ts:4,10`).
- **No domain tables exist yet.** Nothing models availability, a month/schedule period or a lock. F-01 explicitly deferred these to S-01 and later (`role-aware-access-control/plan.md:43`). S-01 introduces the first domain table. It also introduces the **lock seam** that S-03 will later trigger, and S-03 is still `blocked` (`roadmap.md:47`).
- **Three product decisions are open.** No inspected document settles (a) the shape of an availability window (`roadmap.md:90`, non-blocking), (b) what "upcoming month" means for editing scope, or (c) what event locks a month and who can trigger it before S-03 exists. The PRD's rule is only "locked once the manager begins generating" (`prd.md:62`).

## Detailed Findings

### 1. Database foundation from F-01

- A single migration holds the whole schema: `supabase/migrations/20260925120000_create_profiles_and_roles.sql`. Its header states that Postgres (RLS + column grants + triggers) is "the single source of truth for access control" (line 2).
- `public.app_role` enum `('manager','employee')` (line 5). `public.profiles(id uuid pk → auth.users on delete cascade, email text not null, role app_role not null default 'employee', created_at)` (lines 8-13). The `on_auth_user_created` trigger creates the profile row on signup with the default role `employee` (lines 18-33).
- `public.is_manager()` is `stable security definer set search_path = ''`. It is granted to `authenticated` only (lines 43-59). The F-01 plan names it "the reusable RLS predicate for later slices" (`role-aware-access-control/plan.md:20`). It also warns that an inline subquery on `profiles` inside a `profiles` policy recurses infinitely (`plan.md:53`).
- The RLS pattern on `profiles` (lines 62-81) has two permissive SELECT policies, `profiles_select_own` (`id = (select auth.uid())`) and `profiles_select_manager` (`public.is_manager()`), and one `profiles_update_manager`. All three target `to authenticated`. There are no anon policies, and the inspected migration has no INSERT/DELETE policies (comment at line 83).
- Column-level grants restrict API updates on `profiles` to the `role` column (lines 87-88). A `prevent_last_manager_demotion` trigger guards against demoting the last manager (lines 91-120).
- Seed (`supabase/seed.sql:1-18`, local/CI only) creates exactly one account: `manager@example.com` / `Manager-Passw0rd!`, id `00000000-0000-4000-8000-000000000001`, promoted to `manager`. No employee account is seeded. The seed comment says "The smoke test depends on this id" (line 3). This describes the planned F-01 Phase 4. `scripts/` currently has no reference to `manager` or that id.

**Implication for S-01:** an availability table can follow the policy-naming pattern (`<table>_select_own`, `<table>_select_manager`). Employee write policies would need `with check` on `employee_id = (select auth.uid())`. Lock enforcement belongs in the database too (RLS `with check` or a trigger) if the "Postgres is the source of truth" principle from line 2 carries over.

### 2. Session role and route gating

- `src/middleware.ts:15-16` sets `locals.user` and `locals.role` to `null` first. Lines 24-30 then read `profiles.role` once per authenticated request. `role` stays `null` on any error or a missing row (comment line 25).
- `App.Locals` typing: `src/env.d.ts:1-6`. `AppRole` comes from the generated enum, and `isAppRole()` is the type guard (`src/lib/roles.ts:3-9`).
- There are two gating lists. `PROTECTED_ROUTES = ["/dashboard"]` (line 5) is checked with a raw `pathname.startsWith(route)` (line 33), not with the segment-boundary `matchesRoute` helper. `MANAGER_ROUTES = ["/manager", "/api/manager"]` (line 6) uses `matchesRoute` (lines 8-10, 39). For those routes, an anonymous user is redirected to `/auth/signin` (line 41) and a non-manager is shown `/403` through `context.rewrite` (line 44). The 403 page sets status 403.
- No employee-only or "any signed-in user" API prefix exists. An S-01 route such as `/availability` or `/api/availability` would need a new entry. The F-01 plan does not say whether a manager may also submit availability. See Open Questions.
- The role is read from `profiles`, not from JWT claims (`role-aware-access-control/plan.md:42`, `:324`).

### 3. API, page and UI conventions

- **API shape:** a form POST followed by a redirect, with `?error=<msg>` / `?updated=1`. There is no JSON API. Reference implementation: `src/pages/api/manager/users/role.ts:11-39`. It reads `formData()` and validates by hand (UUID regex at line 5, `isAppRole` at line 19). It handles a null Supabase client (lines 24-26) and relies on RLS as the real enforcement (comment line 28). It treats `data.length === 0` from `.update(...).select("id")` as "not found or not permitted" (line 34), because PostgREST returns zero rows rather than an error when RLS filters the target row. The auth routes use the same shape (`src/pages/api/auth/signin.ts`). No schema-validation library is installed (`package.json` dependencies).
- **Pages:** each page calls `createClient(Astro.request.headers, Astro.cookies)` itself, because the middleware does not put a client in `locals`. Pages handle a null client and read `?error=`/`?updated=` for display (`src/pages/manager/users.astro:12-26`).
- **UI kit:** `src/components/ui/` contains only `button.tsx` and `LibBadge.astro`. The form primitives (`FormField`, `ServerError`, `SubmitButton`) live under `src/components/auth/` and are styled for the auth screens. There are no date, time, select or table components yet. Navigation links exist in both `src/components/Topbar.astro` (home only) and `src/pages/dashboard.astro`. This is F-01 plan-review finding F3 (`reviews/plan-review.md:54`): a new entry point has to be added in both places.

### 4. Typing and verification conventions

- **Types:** `src/db/database.types.ts` is generated with `npx supabase gen types typescript --local > src/db/database.types.ts` after `db reset`, and it is committed (`role-aware-access-control/plan.md:117`). This follows review F1: strict type-checked lint rejects untyped `.from()` rows (`reviews/plan-review.md:25-42`). No `package.json` script wraps the command. The Phase 4 docs step that would add it to CLAUDE.md is still open (`plan.md:285`, Progress `4.4`).
- **No test runner.** Verification consists of `npm run lint`, `npx astro check`, `npm run build`, manual SQL checks and the HTTP smoke script (`role-aware-access-control/plan.md:44`).
- **RLS impersonation pattern** (required after review F2, `reviews/plan-review.md:44`): run one `begin; set local role authenticated; set local request.jwt.claims = '{"sub":"<id>","role":"authenticated"}'; …; rollback;` block through Studio or `docker exec … psql` (`plan.md:130-131`).
- **CI:** the `smoke` job runs `supabase start`, which applies every migration and `seed.sql` (`supabase/config.toml:60-65`), then builds, runs the preview and runs `npm run smoke` (`.github/workflows/ci.yml` smoke job). A new migration is therefore applied in CI automatically.
- **Production migrations:** `context/changes/deployment/deployment-plan.md` contains no mention of migrations or `supabase db push` (grep for "migration" / "db push" returned nothing). The inspected documents do not say how S-01's migration, or F-01's, reaches the hosted Supabase project.

### 5. What upstream documents decide about availability

| Topic | Settled? | Source |
|---|---|---|
| Employee edits only own availability; manager reads all; other employees never see it | Settled | `prd.md:62`, `:64`, `:86`, `:98-99` |
| Availability locks for a month once the manager begins generating that month's schedule | Settled as a rule, no mechanism | `prd.md:62-63`, `roadmap.md:82` |
| Shape of an availability window (per-day time ranges vs weekly pattern vs other) | **Open**, non-blocking; `/10x-plan` proposes | `roadmap.md:90` |
| Month / schedule-period entity | **Not modeled** anywhere | F-01 `plan.md:43`; migration has no such table |
| What "starts generating" means at the DB level, and who sets it | **Undefined**. S-03 owns generation and is `blocked` | `roadmap.md:47`, `:115-116` |
| Sick leave / vacation | Out of scope. Availability windows are the only input | `prd.md:104` |
| Shifts are 6–12h, one employee per shift | Settled (constrains what S-03 needs to read) | `prd.md:66`, `:90` |
| Keep the schema minimal. S-02/S-03 read it | Roadmap risk note | `roadmap.md:91` |

## Code References

- `supabase/migrations/20260925120000_create_profiles_and_roles.sql:2` - Postgres is the source of truth for access control
- `supabase/migrations/20260925120000_create_profiles_and_roles.sql:43-59` - `is_manager()` SECURITY DEFINER helper + grants
- `supabase/migrations/20260925120000_create_profiles_and_roles.sql:62-81` - RLS policy pattern (own / manager)
- `supabase/migrations/20260925120000_create_profiles_and_roles.sql:87-88` - column-level update grant pattern
- `supabase/seed.sql:1-18` - seeded manager only; no employee
- `src/middleware.ts:5-10` - `PROTECTED_ROUTES`, `MANAGER_ROUTES`, `matchesRoute`
- `src/middleware.ts:33` - `PROTECTED_ROUTES` uses raw `startsWith` (no segment boundary)
- `src/middleware.ts:39-45` - manager gate: signin redirect / `/403` rewrite
- `src/env.d.ts:1-6` - `App.Locals` shape
- `src/lib/roles.ts:3-9` - `AppRole`, `APP_ROLES`, `isAppRole`
- `src/lib/supabase.ts:4,10` - `createServerClient<Database>`
- `src/pages/api/manager/users/role.ts:11-39` - reference form-POST + redirect API route
- `src/pages/manager/users.astro:12-26` - reference server-rendered page querying through RLS
- `scripts/smoke.mjs:39-60` - current 8 smoke steps (no role steps)

## Architecture Insights

- **Authorization in layers:** middleware gates routes for UX (redirect/403), and RLS + grants + triggers are the enforcement. API handlers do not re-check roles (`role.ts:28`). S-01's lock should follow the same split: the UI hides or disables editing, and the database rejects writes to a locked month.
- **Lock is per month, not per employee.** The PRD locks "that month's" availability as a whole (`prd.md:62`). A per-month record, rather than a per-row flag, is therefore the natural carrier for lock state, and S-03 can later set it on "generate". This is an inference from the PRD wording, not a decision.
- **Shape affects S-03 more than S-01.** S-03 must check that a 6–12h shift falls inside an employee's availability (`prd.md:90`). Explicit start/end instants (for example `timestamptz` pairs or a `tstzrange`) make that check a containment test. They also handle overnight shifts that cross midnight. Separate `date` + `time` columns cannot express a cross-midnight window in one row. Whether the station runs overnight shifts is not stated in the PRD. This inference makes timezone handling relevant: Cloudflare Workers run in UTC, and the station's local timezone is not recorded anywhere inspected.
- **Coworker-visibility precedent:** F-01 decided that later slices add narrow read paths rather than widening `profiles` RLS (`plan.md:45`, review F4 at `reviews/plan-review.md:64`). S-01's own view needs no coworker data. S-02 will need employee names/emails next to availability, and a manager can already read all profiles through `profiles_select_manager`.

## Historical Context (from prior changes)

- `context/changes/role-aware-access-control/plan.md:20` - `is_manager()` intended for reuse by later slices (supported: exists at migration lines 43-59).
- `context/changes/role-aware-access-control/plan.md:26` - "`npm run smoke` covers both roles". **Contradicted for the current tree**: this is the Phase 4 target, and Phase 4 is unchecked. `scripts/smoke.mjs` has no role steps.
- `context/changes/role-aware-access-control/plan.md:43` - no availability/schedule tables in F-01 (supported: the migration defines only `profiles`).
- `context/changes/role-aware-access-control/plan.md:117` - types are regenerated after every migration (supported for F-01: the generated file is committed in d7624ca. Documenting the rule in CLAUDE.md is still pending in Phase 4).
- `context/changes/role-aware-access-control/reviews/plan-review.md` - F1 (typed client) and F2 (runnable, transaction-wrapped verification commands) apply directly to S-01's plan. F3 (nav in two places) applies if S-01 adds a nav link.
- `context/changes/deployment/deployment-plan.md` - app deploy only. No migration deploy path (gap, see Open Questions).
- `context/foundation/lessons.md` and `docs/reference/contract-surfaces.md` do not exist. No recorded lessons or load-bearing names registry was available.

## Related Research

None. This is the first `research.md` under `context/changes/`, and `context/archive/` holds only its README.

## Open Questions

Product decisions (owner: user; `/10x-plan` should propose defaults and confirm them):

1. **Window shape.** Specific dated time ranges for the target month (one or more per day) vs a weekly recurring pattern vs whole-day available/unavailable. Can a window cross midnight? (`roadmap.md:90`)
2. **Editable months.** Only the next calendar month, or any future month that is not locked?
3. **Lock trigger before S-03 exists.** What sets a month to locked in S-01: a manager "start scheduling / lock month" action, or only a DB state that S-03 sets later? Is the lock reversible (unlock) by the manager?
4. **Manager availability.** Can a manager also be scheduled and submit availability, or is `/availability` employee-only? This decides the middleware gate and the RLS predicates.
5. **Station timezone.** Needed to interpret "month" boundaries and times if the schema stores instants.

Engineering gaps:

6. **F-01 Phase 4 is open.** The smoke role steps and CLAUDE.md docs are not done. Decide whether S-01 waits for it or proceeds in parallel. S-01's smoke steps would build on the same manager/employee sign-in helpers.
7. **Production migration path is undocumented.** No inspected document covers applying migrations to the hosted Supabase project.
8. **No seeded employee account.** Local and CI testing of employee-own-row RLS relies on the smoke script's fresh signup (`scripts/smoke.mjs:5`) or a seed addition.

## Follow-up 2026-09-26: Where is availability entered?

- **Inside Planner itself.** Each employee enters their own availability in the Planner web app after signing in with email and password (`prd.md:7` `product_type: web-app`, `:62`, `:81` "employees already log in to submit availability", `:96`). This replaces the current workflow, where the manager collects availability and builds the schedule in a spreadsheet (`prd.md:20`).
- **No other input channel is in scope.** The PRD mentions no import from spreadsheets or calendars and no sync with Google Calendar or similar tools (grep of `prd.md` and `shape-notes.md` for spreadsheet/import/calendar/excel/google: `:20` and `:22` only describe the status quo and competing tools). There is no native app (`prd.md:106`). The manager does not enter availability on employees' behalf (Access Control, `prd.md:98-99`: employees create/edit only their own).
- **Device caveat:** `prd.md:106` says "mobile-web usability is not a guaranteed target". Employees at a gas station may well submit from a phone, so the input form's layout is worth a deliberate choice in `/10x-plan`.
- **Still open: the entry UI**, which is tied to Open Question 1 (window shape). Candidate forms: a month calendar where the employee picks days and adds time ranges; a per-day list of the month; or a weekly template applied to the month and then adjusted.
