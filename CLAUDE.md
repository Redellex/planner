# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run dev` — start dev server (Cloudflare workerd runtime via Astro's Cloudflare adapter)
- `npm run build` — production build
- `npm run preview` — preview the production build
- `npm run lint` / `npm run lint:fix` — ESLint (type-checked rules)
- `npm run format` — Prettier (includes prettier-plugin-astro and prettier-plugin-tailwindcss)
- `npx astro check` — Astro/TypeScript type-check (not wired to a package.json script, but run in CI before build)
- `npm run smoke` — dependency-free script (`scripts/smoke.mjs`) that walks the whole auth flow (sign-up → sign-in → protected page → sign-out) plus role enforcement (new user gets 403 on `/manager/users`; the seeded manager gets 200, cannot demote the last manager, and stays manager) and the availability flow (the fresh user adds a window and gets an overlap error; the manager locks a month, a create in it is refused, then unlocks) over HTTP against a running server; `BASE_URL` env, defaults to `http://localhost:4321`; `SMOKE_MANAGER_EMAIL`/`SMOKE_MANAGER_PASSWORD` default to the seeded local manager, so it needs a database with `supabase/seed.sql` applied. Availability steps write to the station month + 12, so it can be re-run without a DB reset. Run after dependency upgrades. It is not a substitute for a real test suite — there is currently no unit/integration test runner in this repo.
- Pre-commit (husky + lint-staged): `eslint --fix` on `*.{ts,tsx,astro}`, `prettier --write` on `*.{json,css,md}`.
- CI (`.github/workflows/ci.yml`) runs two jobs on push/PR to `master`: `ci` (`npm ci` → `astro sync` → lint → `astro check` → build, needs `SUPABASE_URL`/`SUPABASE_KEY` secrets) and `smoke` (spins up local Supabase via its CLI, builds, serves the Cloudflare preview, runs the smoke script — no secrets needed).

## Architecture

Astro 7 SSR app (`output: "server"`, deployed via `@astrojs/cloudflare`) with React 19 islands, Tailwind 4, and Supabase for auth and role storage. All pages are server-rendered by default; API routes must export `const prerender = false` if they need to opt out of any default.

### Auth flow

- `src/lib/supabase.ts` — `createClient(headers, cookies)` builds a Supabase SSR client (`@supabase/ssr`) with cookie-based sessions, reading `SUPABASE_URL`/`SUPABASE_KEY` from `astro:env/server` (declared as optional server-only secrets in `astro.config.mjs`). Returns `null` when unconfigured — callers must handle that case (see the API routes below).
- `src/middleware.ts` — runs on every request, resolves the current user via `createClient(...).auth.getUser()`, attaches to `context.locals.user`, then reads the user's role from `public.profiles` into `context.locals.role` (`AppRole | null`; `null` when anonymous, unconfigured, or no row — fail closed). Redirects unauthenticated requests to `/auth/signin` for any path listed in `PROTECTED_ROUTES`. `MANAGER_ROUTES` (`/manager`, `/api/manager`, matched on segment boundaries) redirects anonymous users to `/auth/signin` and rewrites non-managers to `src/pages/403.astro` (status 403).
- API endpoints: `src/pages/api/auth/{signin,signup,signout}.ts` — read `FormData` directly (no schema-validation library is in use), call the corresponding Supabase auth method, and redirect with an `?error=` query param on failure. There is no JSON API convention to preserve here — auth endpoints are form-post + redirect.
- Auth pages: `src/pages/auth/{signin,signup,confirm-email}.astro`. Protected page example: `src/pages/dashboard.astro`.
- Roles: `public.profiles` (one row per auth user, created as `employee` by the `handle_new_user` signup trigger) holds `role` (`public.app_role` enum: `manager` | `employee`); TS side is `src/lib/roles.ts` (`AppRole`, `APP_ROLES`, `isAppRole`). Postgres is the real enforcement: RLS lets users read their own row, managers read all rows and update only the `role` column, and the `prevent_last_manager_demotion` trigger rejects demoting the last manager. Manager UI: `src/pages/manager/users.astro` + `POST src/pages/api/manager/users/role.ts` (form-post + redirect with `?updated=1` / `?error=`).
- `src/lib/config-status.ts` exposes `missingConfigs` so pages can render a "Supabase not configured" banner instead of crashing when secrets are absent (see `src/components/Banner.astro`).

### Availability

- Tables (`supabase/migrations/20260926130000_create_availability.sql`): `availability_windows` holds one row per window (`employee_id` defaults to `auth.uid()`, `starts_at`/`ends_at`). A check keeps a window longer than 0 and at most 24h, and the `availability_windows_no_overlap` exclusion constraint (`btree_gist`) forbids overlapping windows per employee (half-open ranges, so back-to-back is fine). A window belongs to the month of its `starts_at`. `availability_locks(month)`: a row (first day of the month) means the month is locked. Managers insert/delete it via `/manager/months`; schedule generation (S-03) will insert it too.
- `public.is_availability_month_editable(month)` (SECURITY DEFINER) is true when the month is after the current station month and has no lock row. RLS uses it for every insert/update/delete of own windows, for both the month of `starts_at` and the month of `ends_at - 1µs` (so an overnight window cannot spill into a locked month; `20260926140000_harden_availability_writes.sql`), and update checks both the old and the new row; managers can read all windows. Only `starts_at`/`ends_at` are insertable and updatable (column grants).
- Timestamps are `timestamp without time zone` holding **Europe/Warsaw wall-clock** time. Handle them as strings/calendar parts (`"YYYY-MM-DDTHH:MM:00"`) and never pass them through `new Date(...)` (a UTC Worker shifts them). Durations (the 24h cap, and hour counts in scheduling) are wall-clock differences with no DST correction: on a DST day, 00:00–00:00 counts as 24h even though 23h or 25h actually pass. Station "now" lives in two places that must stay in sync: the `'Europe/Warsaw'` literal in the SQL helper and `STATION_TIME_ZONE` in `src/lib/availability.ts`.
- `src/lib/availability.ts` — pure helpers shared by pages and endpoints: station month and `upcomingMonths()`, `parseMonth`/`parseDate`/`parseTime`, `buildWindow` (end ≤ start rolls to the next day, so `00:00`–`00:00` is a full day), same-weekday expansion, Monday-first `calendarWeeks`, labels, the PostgREST error-code → message mapping and redirect URLs. Calendar math uses `Date.UTC` on date parts only.
- Routes: `/availability` (any signed-in user, `?month=YYYY-MM&day=YYYY-MM-DD`) is a Monday-first calendar grid for one of the next 3 months with a selected-day panel to add (optionally repeating on that weekday all month), edit and delete own windows; a locked month renders read-only. It filters `.eq("employee_id", user.id)` because managers can read everyone's windows. `/api/availability/{create,update,delete}` are form-POST + redirect endpoints that let RLS and the constraints decide. `/manager/months` and `/api/manager/months/lock` (manager-only via `MANAGER_ROUTES` in `src/middleware.ts`) lock and unlock upcoming months idempotently.

### Key conventions

- Path alias `@/*` → `./src/*` (`tsconfig.json`).
- Astro components for static content/layout; React components only where interactivity is needed (auth forms under `src/components/auth/`).
- Use the `cn()` helper from `@/lib/utils` (clsx + tailwind-merge) for conditional/merged Tailwind classes instead of concatenating strings.
- shadcn/ui components live in `src/components/ui/` (`components.json`: "new-york" style, neutral base color, lucide icons). Add new ones with `npx shadcn@latest add [name]`; the configured aliases are `@/components`, `@/components/ui`, `@/lib`, `@/hooks`.
- No Next.js directives (`"use client"`, etc.) — this is plain Astro + React islands.
- Supabase migrations go in `supabase/migrations/` as `YYYYMMDDHHmmss_short_description.sql`; enable RLS with granular per-operation, per-role policies on any new table. Use `public.is_manager()` (SECURITY DEFINER, avoids recursion through `profiles` RLS) in policies that need a manager check.
- After every migration, regenerate `src/db/database.types.ts` with `npx supabase gen types typescript --local` (local stack running); never hand-edit it. It is ignored by ESLint and Prettier. `src/lib/supabase.ts` types the client with it (`createServerClient<Database>`).

### Environment

- Node.js v22.14.0 (`.nvmrc`).
- `SUPABASE_URL`, `SUPABASE_KEY` — copy `.env.example` to `.env` (Node/local Supabase) and to `.dev.vars` (Cloudflare local dev via `wrangler`/`astro dev`). Both are optional at the schema level; the app degrades to a "not configured" banner rather than failing, but auth routes won't work without them.
- Local Supabase stack: `npx supabase start` (requires Docker); Studio at `http://localhost:54323`. Migrations in `supabase/migrations/` (`profiles`/roles and the availability tables) and `supabase/seed.sql` are applied on start / `npx supabase db reset`.
- `supabase/seed.sql` is local/CI only (never run it against production): it creates a manager `manager@example.com` / `Manager-Passw0rd!` (id `00000000-0000-4000-8000-000000000001`) that the smoke script relies on, and an employee `employee@example.com` / `Employee-Passw0rd!` (id `00000000-0000-4000-8000-000000000002`).
- Hosted project: migrations reach it via `npx supabase db push` (the project is linked).
- Production manager bootstrap: after that person signs up, run once in the Supabase SQL editor: `update public.profiles set role = 'manager' where email = '<email>';`
- Deploy: `npm run build` then `npx wrangler deploy`; set the two Supabase secrets via the Cloudflare dashboard or `npx wrangler secret put`.

---

**10x-cli skill-chain guardrail:** `context/archive/` holds completed, immutable changes (see `context/archive/README.md`) — any `/10x-*` skill must refuse to write there and abort with "This change is archived. Open a new change with `/10x-new` instead." if a resolved target path starts with `context/archive/`. Full wording in the managed block below.

<!-- BEGIN @przeprogramowani/10x-cli -->

## 10xDevs AI Toolkit - Module 2, Lesson 4

Prepare for a harder implementation stream with the **research-backed planning chain**:

```
internal research (/10x-research) + external research (exa.ai, Context7) -> /10x-plan -> /10x-implement -> success
```

The lesson focus is distinguishing internal from external research and using evidence to back planning decisions.

### Task Router - Where to start

| Skill | Use it when |
| --- | --- |
| **Internal research (lesson focus)** | |
| `/10x-research <change-id>` | You need evidence from the existing codebase — patterns, conventions, integration points, or existing implementations. Runs parallel sub-agents over the repo and writes structured findings to `research.md`. |
| **External research (lesson focus)** | |
| exa.ai | You need AI-native web search for library comparisons, best practices, or ecosystem context that the codebase cannot answer. |
| Context7 (`resolve-library-id` → `get-library-docs`) | You need live, current documentation for a specific library or framework. Resolves a library ID first, then fetches relevant doc pages. |
| **Framing spare wheel** | |
| `/10x-frame <change-id>` | The plan won't converge, the plan doesn't deliver expected results, or persistent drift keeps breaking the implementation. Use as an escape hatch on a separate problem (demonstrated on Space Explorers example), not as pre-research ritual. |
| **Planning and execution** | |
| `/10x-plan <change-id>` / `/10x-implement <change-id> phase <n>` | Use the same planning and execution chain from Lesson 2, now with upstream research evidence feeding the plan. |

### Research discipline

- Internal research (`/10x-research`) answers "what does our codebase already do?" — patterns, schemas, conventions, integration points.
- External research (exa.ai, Context7) answers "what should we do?" — library capabilities, API docs, ecosystem best practices.
- Combine both as evidence-backed input to `/10x-plan`. A plan without research evidence on a non-trivial stream is a guess.
- Agent-friendly docs (`llms.txt`, markdown-for-agents, `/md` endpoints) are a quality signal for library selection — libraries that publish agent-readable docs integrate faster.

### `/10x-frame` as spare wheel

Three triggers for reaching for `/10x-frame`:
1. The plan won't converge — research keeps opening more questions instead of narrowing to a contract.
2. The plan doesn't deliver — implementation repeatedly fails to meet success criteria.
3. Persistent drift — the implementation keeps diverging from the plan in ways that suggest the problem was mis-framed.

Demonstrated on a Space Explorers example, not the SRS path. It is an escape hatch, not a mandatory step.

### Paths used by this lesson

- `context/changes/<change-id>/research.md` - internal research output
- `context/changes/<change-id>/frame.md` - framing output when needed
- `context/changes/<change-id>/plan.md` - evidence-backed implementation contract
- `context/foundation/lessons.md` - recurring rules and pitfalls

Skills must not write to `context/archive/`. Archived changes are immutable; if a resolved target path starts with `context/archive/`, abort with: "This change is archived. Open a new change with `/10x-new` instead."

<!-- END @przeprogramowani/10x-cli -->
