# Role-aware Access Control Implementation Plan

## Overview

Add a Manager / Employee role model on top of the existing Supabase auth so every downstream slice (S-01 availability, S-02 manager visibility, …) can gate data by role in the database (RLS) and gate pages by role in the session (middleware). Includes a small manager-only page to promote/demote accounts, with a database guard that makes it impossible to remove the last manager.

## Current State Analysis

- Auth is Supabase SSR, cookie-based. `src/middleware.ts:4` has a single `PROTECTED_ROUTES = ["/dashboard"]` list and only checks "is logged in" (`src/middleware.ts:18-22`).
- `App.Locals` carries only `user` (`src/env.d.ts:1-5`).
- Signup is a form post → `supabase.auth.signUp({ email, password })` → redirect (`src/pages/api/auth/signup.ts:14`). No metadata, no role.
- No domain tables or migrations: `supabase/` contains only `config.toml`. Seeding is already enabled with `sql_paths = ["./seed.sql"]` (`supabase/config.toml:60-65`), but `seed.sql` doesn't exist. Email confirmations are off locally (`supabase/config.toml:209`).
- The smoke script (`scripts/smoke.mjs`) signs up a fresh `smoke-<ts>@example.com` user each run. CI's `smoke` job starts a fresh local Supabase with `supabase start` (`.github/workflows/ci.yml:39-42`), which applies migrations and the seed.
- The app uses the anon key only. There is no service-role key anywhere, and this plan keeps it that way.

## Desired End State

- Every `auth.users` row has exactly one `public.profiles` row with `role ∈ {manager, employee}`. New signups get `employee` automatically.
- RLS on `profiles`: a user reads their own row; a manager reads all rows; only managers can update, and only the `role` column; nobody can insert or delete through the API.
- `public.is_manager()` exists as the reusable RLS predicate for later slices.
- The database rejects any role change that would leave zero managers.
- The middleware exposes `Astro.locals.role`. Paths under `/manager` and `/api/manager` require the manager role. Anonymous users are redirected to `/auth/signin`, and signed-in non-managers get a 403 page (HTTP status 403).
- `/manager/users` lists all accounts (email + role) and lets a manager switch any account's role. Failures come back as `?error=`.
- The home top bar and the dashboard show the signed-in user's role and, for managers, a "Users" link. Supabase queries are typed through generated `src/db/database.types.ts`.
- Local dev and CI have a seeded manager (`manager@example.com`). Production's first manager is created with a documented SQL one-liner.
- `npm run smoke` covers both roles: employee → 403, manager → 200, and demoting the only manager is rejected.

### Key Discoveries:

- `supabase/config.toml:60-65` — seed is already wired; creating `supabase/seed.sql` is enough.
- `.github/workflows/ci.yml:41` — CI starts Supabase from scratch, so the migration and seed run on every smoke job.
- `src/pages/api/auth/signin.ts:18-22` — the error convention is a redirect with `?error=<encoded message>`. Reuse it for the role-update endpoint.
- `src/components/Topbar.astro:1-3` — reads `Astro.locals.user`; the natural place to surface the role.
- `CLAUDE.md` "Key conventions" — migrations go in `supabase/migrations/YYYYMMDDHHmmss_short_description.sql`, with RLS enabled and granular per-operation, per-role policies.

## What We're NOT Doing

- No role picker at signup and no invite flow. Every signup is an Employee.
- No service-role key in the app. Manager bootstrap in production is a manual SQL step.
- No deleting or deactivating accounts, and no editing emails from the manager page.
- No keeping `profiles.email` in sync when a user changes their email. The app has no email-change feature; revisit if one is added.
- No role in JWT claims or custom access token hook. The role is read from `profiles` once per request.
- No availability, schedule or other domain tables. Those belong to S-01 and later.
- No pgTAP / `supabase test db` harness. RLS is verified manually plus through the HTTP smoke steps.
- No coworker visibility for employees. `profiles` RLS stays own-row-only for employees. S-05 (published schedule grid) will need employees to see who works which shift; it should add a narrow read path (e.g. a view exposing only `id` plus a display name) rather than widening `profiles_select_*`, which would expose every email to every employee.

## Implementation Approach

Database first, because RLS is the real security boundary and the app layer only mirrors it for UX. Then the session layer (role in locals, manager route gate, 403 page), then the one manager feature that uses it (role management), and finally the smoke coverage and docs. Each phase leaves the app working: after Phase 1 nothing in the UI changes, and after Phase 2 manager routes are gated but none exist except the 403 behavior.

## Critical Implementation Details

- **RLS recursion.** Policies on `profiles` that check "is the caller a manager?" must call `public.is_manager()`, declared `SECURITY DEFINER` with `set search_path = ''`. An inline subquery on `profiles` inside a `profiles` policy recurses infinitely.
- **Last-manager race.** The guard trigger must lock the manager rows (`select … from public.profiles where role = 'manager' for update`) before counting. Otherwise two managers demoting each other at the same moment could both pass.
- **Seeding an auth user in SQL** needs the GoTrue-shaped columns: the empty-string token columns (GoTrue fails scanning NULLs there) and a matching `auth.identities` row. Otherwise password sign-in fails. See the snippet in Phase 1.
- **Rewrite loop.** `/403` must not match `MANAGER_ROUTES` or `PROTECTED_ROUTES`. Match route prefixes on segment boundaries (`path === p || path.startsWith(p + "/")`) so `/manager` doesn't also match e.g. `/managerial`.

## Phase 1: Database roles and RLS

### Overview

Create the first migration: role enum, `profiles` table, signup trigger with backfill, `is_manager()` helper, RLS policies, column-level update grant, and the last-manager guard. Add `seed.sql` with a local/CI manager. Generate TypeScript database types and wire them into the Supabase client, so the first table queries are typed under the strict type-checked ESLint config.

### Changes Required:

#### 1. Roles migration

**File**: `supabase/migrations/20260925120000_create_profiles_and_roles.sql`

**Intent**: Introduce the role model as the single source of truth, enforced by Postgres, so that neither the app nor a crafted API call can read other profiles as an employee or escalate a role.

**Contract**:
- `create type public.app_role as enum ('manager', 'employee');`
- `public.profiles`: `id uuid primary key references auth.users(id) on delete cascade`, `email text not null`, `role public.app_role not null default 'employee'`, `created_at timestamptz not null default now()`.
- `public.handle_new_user()`: trigger function, `SECURITY DEFINER`, `set search_path = ''`. Inserts `(new.id, new.email)` into `public.profiles`. Trigger `on_auth_user_created` runs `after insert on auth.users for each row`.
- Backfill: insert a profile (role `employee`) for every existing `auth.users` row that lacks one (`on conflict (id) do nothing`).
- `public.is_manager() returns boolean`: `SECURITY DEFINER`, `stable`, `set search_path = ''`. True when a `profiles` row with `id = auth.uid()` and `role = 'manager'` exists. `grant execute` to `authenticated`.
- `alter table public.profiles enable row level security;`
- Policies, all `to authenticated`:
  - `profiles_select_own` (select, `id = (select auth.uid())`)
  - `profiles_select_manager` (select, `public.is_manager()`)
  - `profiles_update_manager` (update, using + with check `public.is_manager()`)
  - No insert/delete policies. No `anon` policies.
- Column privileges: `revoke update on public.profiles from authenticated, anon; grant update (role) on public.profiles to authenticated;`
- `public.prevent_last_manager_demotion()`: trigger function, `before update of role on public.profiles for each row`. When `old.role = 'manager' and new.role <> 'manager'`, lock the manager rows `for update`. If no other manager (`id <> old.id`) exists, `raise exception 'Cannot demote the last manager'` (the message is surfaced to the UI as-is).

#### 2. Local/CI seed

**File**: `supabase/seed.sql`

**Intent**: Give local dev and the CI smoke job a known manager account so manager paths are testable without a service-role key. Local/CI only, never run against production.

**Contract**: creates user `manager@example.com` / `Manager-Passw0rd!` with the fixed id `00000000-0000-4000-8000-000000000001`, then sets its profile role to `manager`. The smoke test (Phase 4) depends on this id and these credentials. Non-obvious insert shape:

```sql
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change)
values ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-000000000001',
  'authenticated', 'authenticated', 'manager@example.com',
  extensions.crypt('Manager-Passw0rd!', extensions.gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');

insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
values (gen_random_uuid(), '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', 'email',
  '{"sub":"00000000-0000-4000-8000-000000000001","email":"manager@example.com","email_verified":true}', now(), now(), now());

update public.profiles set role = 'manager' where id = '00000000-0000-4000-8000-000000000001';
```

#### 3. Generated database types

**Files**: `src/db/database.types.ts` (new, generated), `src/lib/supabase.ts`

**Intent**: `createServerClient` defaults to `Database = any`, so untyped `.from("profiles")` results would trip `no-unsafe-member-access` / `no-unsafe-assignment` under `tseslint.configs.strictTypeChecked`. Typing the client once here keeps every later query (and every later slice) typed without casts.

**Contract**: `npx supabase gen types typescript --local > src/db/database.types.ts`, run after `db reset`. `createClient` passes the generic, as in `createServerClient<Database>(…)`. The file is committed and regenerated after every migration (documented in Phase 4). If Prettier or lint-staged reformat or flag the generated file, add it to the relevant ignore list rather than hand-editing it.

### Success Criteria:

#### Automated Verification:

- `npx supabase db reset` applies the migration and seed without errors
- `npx supabase db lint` reports no errors for the `public` schema
- SQL check: `select role from public.profiles where email = 'manager@example.com'` returns `manager`, and a fresh signup gets a `profiles` row with `employee`. Run it with `docker exec -i supabase_db_planner psql -U postgres -c "<sql>"`. For the signup half, sign up through `npm run dev` (the app is unchanged in this phase), then query `profiles` by that email.
- `src/db/database.types.ts` is generated, `src/lib/supabase.ts` uses it, and `npx astro check` passes

#### Manual Verification:

- Employee impersonation, run as one block in the Studio SQL editor or through the `docker exec … psql` command above: `begin; set local role authenticated; set local request.jwt.claims = '{"sub":"<employee-id>","role":"authenticated"}'; select * from public.profiles; update public.profiles set role = 'manager' where id = '<employee-id>'; rollback;`. The select returns only their own row and the update reports `UPDATE 0`.
- Manager impersonation, using the same `begin; … rollback;` pattern with the seeded manager's id: the select returns all rows, and demoting self while being the only manager fails with "Cannot demote the last manager". In a second block, promote another account first; demoting self then succeeds.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Session role enforcement

### Overview

Load the role into `Astro.locals`, gate manager routes in middleware, add the 403 page, and show the role in the UI chrome.

### Changes Required:

#### 1. Role type

**File**: `src/lib/roles.ts` (new)

**Intent**: A single TypeScript source for role values, shared by the middleware, pages and the API.

**Contract**: exports `type AppRole = Database["public"]["Enums"]["app_role"]` (derived from the generated types so it can't drift from the enum), `const APP_ROLES: readonly AppRole[]`, and `isAppRole(value: unknown): value is AppRole`.

#### 2. Locals typing

**File**: `src/env.d.ts`

**Intent**: Make the role available on `Astro.locals` with full typing.

**Contract**: `App.Locals` gains `role: import("@/lib/roles").AppRole | null`. `null` means anonymous or no profile row.

#### 3. Middleware

**File**: `src/middleware.ts`

**Intent**: After resolving the user, fetch their role from `profiles` (one query, only when signed in). Add a manager-only route gate on top of the existing auth-only gate.

**Contract**:
- `context.locals.role` is set on every request. It's `null` when anonymous, when Supabase is unconfigured, or when the query returns no row or fails (fail closed).
- New `MANAGER_ROUTES = ["/manager", "/api/manager"]`, matched on segment boundaries. An anonymous request is redirected to `/auth/signin`; a signed-in request with `role !== "manager"` gets `return context.rewrite("/403")`.
- Existing `PROTECTED_ROUTES` behavior is unchanged.

#### 4. 403 page

**File**: `src/pages/403.astro` (new)

**Intent**: A clear "you don't have access" page styled like the existing auth cards, with a link back to `/dashboard`.

**Contract**: sets `Astro.response.status = 403`. It must render for both GET and POST, because rewritten `/api/manager/*` form posts land here.

#### 5. Role in the home top bar and the dashboard

**Files**: `src/components/Topbar.astro`, `src/pages/dashboard.astro`

**Intent**: Show the signed-in user's role next to their email, and give managers a "Users" link to `/manager/users` in both places. `Topbar` only renders on the home page (`src/components/Welcome.astro:18`) and isn't part of `Layout.astro`, so the dashboard card needs its own link.

**Contract**: reads `Astro.locals.role` only; no extra queries.

### Success Criteria:

#### Automated Verification:

- `npm run lint` passes
- `npx astro check` passes
- `npm run build` passes

#### Manual Verification:

- Signed in as a new signup: the top bar shows "employee", there is no Users link, and visiting `/manager/users` renders the 403 page with HTTP status 403 (check DevTools)
- Anonymous visit to `/manager/users` redirects to `/auth/signin`
- Signed in as the seeded manager: the home top bar and the dashboard both show "manager" and a Users link

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Manager role management

### Overview

A manager-only page listing all accounts, with a per-row form to change a role, backed by a form-post API that follows the existing redirect + `?error=` convention.

### Changes Required:

#### 1. Users page

**File**: `src/pages/manager/users.astro` (new)

**Intent**: List every profile (email, role, marking "you" on the current user) sorted by email. Each row has a plain HTML form with a role `<select>` and a submit button. No React island, since no client interactivity is needed.

**Contract**: queries `profiles` through the request's Supabase client (RLS returns all rows for a manager). Reads `?error=` and `?updated=` from the URL to render a failure or success notice. Handles `createClient` returning `null` the same way the auth pages do.

#### 2. Role update endpoint

**File**: `src/pages/api/manager/users/role.ts` (new)

**Intent**: Apply a role change requested by a manager. RLS and the last-manager trigger are the real enforcement; the endpoint validates input and translates the result into a redirect.

**Contract**:
- `POST` with FormData `userId` (uuid string) and `role` (validated with `isAppRole`).
- Runs `update profiles set role where id = userId` and selects the updated row back.
- Success → redirect `/manager/users?updated=1`.
- Invalid input, a database error (including "Cannot demote the last manager"), or 0 rows updated → redirect `/manager/users?error=<message>`.
- Unconfigured Supabase → redirect with the "Supabase is not configured" error, like the auth endpoints.

### Success Criteria:

#### Automated Verification:

- `npm run lint` passes
- `npx astro check` passes
- `npm run build` passes

#### Manual Verification:

- As the seeded manager, `/manager/users` lists all accounts with the correct roles
- Promoting an employee to manager succeeds; that user now sees the Users link after reloading
- With one manager left, demoting yourself shows "Cannot demote the last manager" and the role stays unchanged
- An employee posting directly to `/api/manager/users/role` (e.g. via DevTools/curl with their cookie) gets 403 and nothing changes

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 4: Smoke coverage and docs

### Overview

Extend the smoke script to cover both roles, and document the role model and production manager bootstrap.

### Changes Required:

#### 1. Smoke script

**File**: `scripts/smoke.mjs`

**Intent**: Prove role enforcement end-to-end over HTTP in CI, using the seeded manager.

**Contract**: new steps after the existing signed-in steps, keeping the existing ones unchanged:
- (signed in as smoke user) `GET /manager/users` → 403
- sign out
- sign in as manager (`SMOKE_MANAGER_EMAIL` / `SMOKE_MANAGER_PASSWORD` env, defaulting to the seed credentials) → 302 `/`
- `GET /manager/users` → 200
- `POST /api/manager/users/role` with `userId=00000000-0000-4000-8000-000000000001`, `role=employee` → 302 `/manager/users?error=`
- `GET /manager/users` → 200 (still manager)
- sign out

The cookie jar has to be reset or naturally cleared between the two identities.

#### 2. Docs

**File**: `CLAUDE.md`

**Intent**: Keep the agent onboarding doc accurate now that migrations and roles exist.

**Contract**: update the "Auth flow" section (roles in `profiles`, `locals.role`, `MANAGER_ROUTES`, `/403`, `is_manager()` as the RLS helper for new tables). Add the rule to regenerate `src/db/database.types.ts` with `npx supabase gen types typescript --local` after every migration. Update the "Environment" section: migrations now exist; there is a seeded local manager with its credentials; the production bootstrap SQL is `update public.profiles set role = 'manager' where email = '<email>';`, run once in the Supabase SQL editor after that person signs up. Update the smoke description to mention the role steps.

### Success Criteria:

#### Automated Verification:

- `npm run smoke` passes against a local server backed by a freshly reset local Supabase (`npx supabase db reset`, then `npm run build && npm run preview`)
- `npm run lint` and `npx astro check` pass
- CI `smoke` job passes on the branch

#### Manual Verification:

- `CLAUDE.md` accurately describes the role model and the production manager bootstrap step

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful.

---

## Testing Strategy

### Unit Tests:

- None. The repo has no unit test runner and this change doesn't introduce one.

### Integration Tests:

- `scripts/smoke.mjs` (HTTP, CI): employee 403 on a manager page, manager 200, last-manager demotion rejected.
- SQL checks after `supabase db reset`: seed role, new signup gets `employee`.

### Manual Testing Steps:

1. `npx supabase db reset`, then `npm run dev`.
2. Sign up a new account and confirm the top bar shows "employee"; `/manager/users` shows the 403 page.
3. Sign in as `manager@example.com`, open `/manager/users`, promote the new account, and confirm it now sees the Users link.
4. Demote yourself while another manager exists → succeeds; demote the last remaining manager → error.
5. In the Studio SQL editor, impersonate the employee and confirm they can read only their own profile row and cannot update it.

## Performance Considerations

One extra single-row primary-key query per authenticated request (the `profiles` role lookup). That's negligible at single-station scale. Revisit with a JWT claim hook only if request volume ever matters (roadmap open question #7).

## Migration Notes

- This is the first migration. The backfill covers accounts created before it (local dev databases). Production isn't live yet, so no production data needs migrating.
- Rollback: `drop table public.profiles cascade; drop type public.app_role; drop function public.handle_new_user, public.is_manager, public.prevent_last_manager_demotion;`, plus dropping the `on_auth_user_created` trigger on `auth.users`.

## References

- Change identity: `context/changes/role-aware-access-control/change.md`
- Roadmap item F-01: `context/foundation/roadmap.md`
- PRD Access Control and the NFR on availability privacy: `context/foundation/prd.md`
- Existing auth patterns: `src/middleware.ts:4-25`, `src/pages/api/auth/signin.ts:5-25`, `src/components/Topbar.astro`
- Seed config: `supabase/config.toml:60-65`; CI smoke job: `.github/workflows/ci.yml:27-55`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Database roles and RLS

#### Automated

- [x] 1.1 `npx supabase db reset` applies the migration and seed without errors — d7624ca
- [x] 1.2 `npx supabase db lint` reports no errors for the `public` schema — d7624ca
- [x] 1.3 SQL check: seeded manager has role `manager`, and a fresh signup gets an `employee` profile — d7624ca
- [x] 1.6 `src/db/database.types.ts` generated, wired into `src/lib/supabase.ts`, `npx astro check` passes — d7624ca

#### Manual

- [x] 1.4 Employee impersonation reads only own profile row and cannot update role — d7624ca
- [x] 1.5 Manager impersonation reads all rows; last-manager demotion fails, demotion with a second manager succeeds — d7624ca

### Phase 2: Session role enforcement

#### Automated

- [x] 2.1 `npm run lint` passes — 6f31c8b
- [x] 2.2 `npx astro check` passes — 6f31c8b
- [x] 2.3 `npm run build` passes — 6f31c8b

#### Manual

- [x] 2.4 Employee sees role "employee", no Users link, and a 403 page with status 403 on `/manager/users` — 6f31c8b
- [x] 2.5 Anonymous visit to `/manager/users` redirects to `/auth/signin` — 6f31c8b
- [x] 2.6 Seeded manager sees role "manager" and a Users link on both the home top bar and the dashboard — 6f31c8b

### Phase 3: Manager role management

#### Automated

- [x] 3.1 `npm run lint` passes — cc4cb44
- [x] 3.2 `npx astro check` passes — cc4cb44
- [x] 3.3 `npm run build` passes — cc4cb44

#### Manual

- [x] 3.4 `/manager/users` lists all accounts with correct roles for the manager — cc4cb44
- [x] 3.5 Promoting an employee to manager succeeds and grants the Users link — cc4cb44
- [x] 3.6 Demoting the last manager shows "Cannot demote the last manager" and leaves the role unchanged — cc4cb44
- [x] 3.7 Employee direct POST to `/api/manager/users/role` gets 403 and changes nothing — cc4cb44

### Phase 4: Smoke coverage and docs

#### Automated

- [x] 4.1 `npm run smoke` passes against a freshly reset local Supabase — 86945a4
- [x] 4.2 `npm run lint` and `npx astro check` pass — 86945a4
- [x] 4.3 CI `smoke` job passes on the branch — 86945a4

#### Manual

- [x] 4.4 `CLAUDE.md` accurately describes the role model and production manager bootstrap — 86945a4
