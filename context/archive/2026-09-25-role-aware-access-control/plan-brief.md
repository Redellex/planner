# Role-aware Access Control — Plan Brief

> Full plan: `context/changes/role-aware-access-control/plan.md`

## What & Why

Give every account a Manager or Employee role, enforced by Postgres RLS and by the Astro middleware. Every later slice (availability, schedule generation, publishing) needs to gate data and pages by role. The PRD requires that an employee's availability is visible only to them and the manager, which is impossible without a trustworthy role.

## Starting Point

Supabase SSR auth works end-to-end (signup, signin, signout, protected `/dashboard`), but the middleware only knows "logged in or not". There are no tables or migrations yet; `supabase/config.toml` already points at a (missing) `seed.sql`.

## Desired End State

New signups are Employees automatically. Managers can open `/manager/users` to promote or demote accounts, but the database refuses to remove the last manager. Employees who open a manager page get a 403 page. RLS lets employees read only their own profile, and the `is_manager()` helper is ready for the next slices' policies. The smoke test proves both roles in CI.

## Key Decisions Made

| Decision                       | Choice                                                   | Why (1 sentence)                                                                  |
| ------------------------------ | -------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Role assignment at signup      | Everyone starts as Employee                              | No self-escalation path; the signup flow stays unchanged.                          |
| Role storage                   | `public.profiles` table + signup trigger + `is_manager()` | Standard Supabase pattern; later tables reference it and policies can query it.   |
| Employee opens a manager page  | Dedicated 403 page (HTTP 403)                            | Clear to the user and semantically correct.                                        |
| Changing roles later           | Manager UI at `/manager/users`                           | Promote or demote without needing database access.                                 |
| Lockout protection             | Block any demotion that leaves zero managers (DB trigger) | Multiple managers allowed, but the station can never lose manager access.         |
| First-manager bootstrap        | `seed.sql` for local/CI; documented SQL for production   | No service-role key in the app; the smoke test can cover manager paths.            |
| DB typing (from plan review)   | Generated `src/db/database.types.ts` + `Database` generic | Strict type-checked ESLint rejects the untyped client's `any` rows.                |

## Scope

**In scope:** `app_role` enum, `profiles` table, signup trigger + backfill, RLS policies, role-column-only update grant, last-manager guard, seed manager, generated DB types, `locals.role`, `MANAGER_ROUTES` gate, `/403` page, role and Users link in the home top bar and the dashboard, `/manager/users` page + role API, smoke steps, `CLAUDE.md` updates.

**Out of scope:** signup role picker and invites, service-role key, deleting accounts or editing emails, syncing `profiles.email` after an email change, role in JWT claims, availability and schedule tables, pgTAP tests.

## Architecture / Approach

`auth.users` → (trigger) → `public.profiles(role)`. Postgres enforces access: RLS through `is_manager()`, a column-level update grant, and the last-manager trigger. Per request, the middleware reads the caller's role (one primary-key query) into `locals.role` and gates `/manager/*` and `/api/manager/*`: anonymous users go to sign-in, non-managers get `/403`. The role-management UI is plain Astro forms posting to an API route that uses the existing redirect + `?error=` convention. The app never bypasses RLS.

## Phases at a Glance

| Phase                           | What it delivers                                               | Key risk                                                          |
| ------------------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------- |
| 1. Database roles and RLS       | Migration (profiles, trigger, RLS, guard), seeded manager, DB types | RLS recursion or a seed user that can't sign in (GoTrue columns)  |
| 2. Session role enforcement     | `locals.role`, manager route gate, `/403`, role in UI          | Rewrite loop or over-broad prefix matching                        |
| 3. Manager role management      | `/manager/users` + role update API                             | Silent no-op updates if 0 rows are not detected                   |
| 4. Smoke coverage and docs      | Both roles covered in CI smoke; `CLAUDE.md` runbook            | Cookie jar leaking between identities in the smoke script         |

**Prerequisites:** Docker + local Supabase (`npx supabase start`) for Phases 1 and 4; existing auth flow working.
**Estimated effort:** ~2–3 sessions across 4 phases.

## Open Risks & Assumptions

- Production's first manager depends on someone running the documented SQL once. Until then, nobody can reach manager pages.
- `profiles.email` is a copy taken at signup. It can go stale only if an email-change feature is added later.
- S-05 will need employees to see coworker names. It should add a narrow read path (a view with id + display name), not widen `profiles` RLS, which would expose every email.
- Generated DB types must be regenerated after every migration; CI does not detect drift.
- Repeated local smoke runs assume nobody manually demoted the seeded manager. `supabase db reset` restores it.

## Success Criteria (Summary)

- An employee can never read another employee's profile or raise their own role, through the UI or the API.
- A manager can promote and demote accounts but can never leave the station with zero managers.
- CI smoke proves employee → 403, manager → 200, and last-manager demotion rejected.
