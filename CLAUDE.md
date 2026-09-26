# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run dev` — start dev server (Cloudflare workerd runtime via Astro's Cloudflare adapter)
- `npm run build` — production build
- `npm run preview` — preview the production build
- `npm run lint` / `npm run lint:fix` — ESLint (type-checked rules)
- `npm run format` — Prettier (includes prettier-plugin-astro and prettier-plugin-tailwindcss)
- `npx astro check` — Astro/TypeScript type-check (not wired to a package.json script, but run in CI before build)
- `npm run smoke` — dependency-free script (`scripts/smoke.mjs`) that walks the whole auth flow (sign-up → sign-in → protected page → sign-out) plus the availability flow (the fresh user adds a window and gets an overlap error; the seeded manager locks a month, a create in it is refused, then unlocks) over HTTP against a running server; `BASE_URL` env, defaults to `http://localhost:4321`; manager credentials via `SMOKE_MANAGER_EMAIL`/`SMOKE_MANAGER_PASSWORD`, defaulting to the seed. It writes to the station month + 12 and can be re-run without a DB reset. Run after dependency upgrades. It is not a substitute for a real test suite — there is currently no unit/integration test runner in this repo.
- Pre-commit (husky + lint-staged): `eslint --fix` on `*.{ts,tsx,astro}`, `prettier --write` on `*.{json,css,md}`.
- CI (`.github/workflows/ci.yml`) runs two jobs on push/PR to `master`: `ci` (`npm ci` → `astro sync` → lint → `astro check` → build, needs `SUPABASE_URL`/`SUPABASE_KEY` secrets) and `smoke` (spins up local Supabase via its CLI, builds, serves the Cloudflare preview, runs the smoke script — no secrets needed).

## Architecture

Astro 7 SSR app (`output: "server"`, deployed via `@astrojs/cloudflare`) with React 19 islands, Tailwind 4, and Supabase for auth. All pages are server-rendered by default; API routes must export `const prerender = false` if they need to opt out of any default.

### Auth flow

- `src/lib/supabase.ts` — `createClient(headers, cookies)` builds a Supabase SSR client (`@supabase/ssr`) with cookie-based sessions, reading `SUPABASE_URL`/`SUPABASE_KEY` from `astro:env/server` (declared as optional server-only secrets in `astro.config.mjs`). Returns `null` when unconfigured — callers must handle that case (see the API routes below).
- `src/middleware.ts` — runs on every request, resolves the current user via `createClient(...).auth.getUser()`, attaches to `context.locals.user`. Redirects unauthenticated requests to `/auth/signin` for any path listed in `PROTECTED_ROUTES`.
- API endpoints: `src/pages/api/auth/{signin,signup,signout}.ts` — read `FormData` directly (no schema-validation library is in use), call the corresponding Supabase auth method, and redirect with an `?error=` query param on failure. There is no JSON API convention to preserve here — auth endpoints are form-post + redirect.
- Auth pages: `src/pages/auth/{signin,signup,confirm-email}.astro`. Protected page example: `src/pages/dashboard.astro`.
- `src/lib/config-status.ts` exposes `missingConfigs` so pages can render a "Supabase not configured" banner instead of crashing when secrets are absent (see `src/components/Banner.astro`).

### Availability

- Tables (`supabase/migrations/20260926120000_create_availability.sql`): `availability_windows` holds one row per window (`employee_id` defaults to `auth.uid()`, `starts_at`/`ends_at`). A check keeps a window longer than 0 and at most 24h, and the `availability_windows_no_overlap` exclusion constraint (`btree_gist`) forbids overlapping windows per employee (half-open ranges, so back-to-back is fine). A window belongs to the month of its `starts_at`. `availability_locks(month)`: a row (first day of the month) means the month is locked. Managers insert/delete it via `/manager/months`; schedule generation (S-03) will insert it too.
- `public.is_availability_month_editable(month)` (SECURITY DEFINER) is true when the month is after the current station month and has no lock row. RLS uses it for every insert/update/delete of own windows (update checks both the old and the new row); managers can read all windows. Only `starts_at`/`ends_at` are updatable (column grant).
- Timestamps are `timestamp without time zone` holding **Europe/Warsaw wall-clock** time. Handle them as strings/calendar parts (`"YYYY-MM-DDTHH:MM:00"`) and never pass them through `new Date(...)` (a UTC Worker shifts them). Station "now" lives in two places that must stay in sync: the `'Europe/Warsaw'` literal in the SQL helper and `STATION_TIME_ZONE` in `src/lib/availability.ts`.
- `src/lib/availability.ts` — pure helpers shared by pages and endpoints: station month and `upcomingMonths()`, `parseMonth`/`parseDate`/`parseTime`, `buildWindow` (end ≤ start rolls to the next day, so `00:00`–`00:00` is a full day), same-weekday expansion, Monday-first `calendarWeeks`, labels, the PostgREST error-code → message mapping and redirect URLs. Calendar math uses `Date.UTC` on date parts only.
- Routes: `/availability` (any signed-in user, `?month=YYYY-MM&day=YYYY-MM-DD`) is a Monday-first calendar grid for one of the next 3 months with a selected-day panel to add (optionally repeating on that weekday all month), edit and delete own windows; a locked month renders read-only. It filters `.eq("employee_id", user.id)` because managers can read everyone's windows. `/api/availability/{create,update,delete}` are form-POST + redirect endpoints that let RLS and the constraints decide. `/manager/months` and `/api/manager/months/lock` (manager-only via `MANAGER_ROUTES` in `src/middleware.ts`) lock and unlock upcoming months idempotently.

### Key conventions

- Path alias `@/*` → `./src/*` (`tsconfig.json`).
- Astro components for static content/layout; React components only where interactivity is needed (auth forms under `src/components/auth/`).
- Use the `cn()` helper from `@/lib/utils` (clsx + tailwind-merge) for conditional/merged Tailwind classes instead of concatenating strings.
- shadcn/ui components live in `src/components/ui/` (`components.json`: "new-york" style, neutral base color, lucide icons). Add new ones with `npx shadcn@latest add [name]`; the configured aliases are `@/components`, `@/components/ui`, `@/lib`, `@/hooks`.
- No Next.js directives (`"use client"`, etc.) — this is plain Astro + React islands.
- Supabase migrations (once added) go in `supabase/migrations/` as `YYYYMMDDHHmmss_short_description.sql`; enable RLS with granular per-operation, per-role policies on any new table.

### Environment

- Node.js v22.14.0 (`.nvmrc`).
- `SUPABASE_URL`, `SUPABASE_KEY` — copy `.env.example` to `.env` (Node/local Supabase) and to `.dev.vars` (Cloudflare local dev via `wrangler`/`astro dev`). Both are optional at the schema level; the app degrades to a "not configured" banner rather than failing, but auth routes won't work without them.
- Local Supabase stack: `npx supabase start` (requires Docker); Studio at `http://localhost:54323`. Migrations in `supabase/migrations/` create `profiles` (roles) and the availability tables; `npx supabase db reset` re-applies them plus `supabase/seed.sql`.
- Seeded local accounts (dev/CI only): `manager@example.com` / `Manager-Passw0rd!` (manager) and `employee@example.com` / `Employee-Passw0rd!` (employee).
- Deploy: `npm run build` then `npx wrangler deploy`; set the two Supabase secrets via the Cloudflare dashboard or `npx wrangler secret put`.

---

**10x-cli skill-chain guardrail:** `context/archive/` holds completed, immutable changes (see `context/archive/README.md`) — any `/10x-*` skill must refuse to write there and abort with "This change is archived. Open a new change with `/10x-new` instead." if a resolved target path starts with `context/archive/`. Full wording in the managed block below.

<!-- BEGIN @przeprogramowani/10x-cli -->

## 10xDevs AI Toolkit - Module 2, Lesson 2

Turn one roadmap item into the first implementation cycle with the **change planning chain**:

```
/10x-roadmap -> /10x-new -> /10x-plan -> /10x-plan-review -> /10x-implement
```

`/10x-new`, `/10x-plan`, `/10x-plan-review`, and `/10x-implement` are the lesson focus. `/10x-frame` and `/10x-research` are not required rituals here; they are escalation paths introduced in the next lesson.

### Task Router - Where to start

| Skill | Use it when |
| --- | --- |
| **Change setup (lesson focus)** | |
| `/10x-new <change-id>` | You selected a roadmap item and need a stable change folder. Creates `context/changes/<change-id>/change.md` so planning, implementation, progress, commits, and later review all share one identity. Use AFTER roadmap selection, BEFORE `/10x-plan`. |
| **Planning (lesson focus)** | |
| `/10x-plan <change-id>` | You have a change folder and need a reviewable implementation plan. Reads roadmap context, foundation docs, codebase evidence, and any existing change notes; writes `plan.md` and `plan-brief.md` with phases, file contracts, success criteria, and `## Progress`. |
| **Plan readiness (lesson focus)** | |
| `/10x-plan-review <change-id>` | You have `plan.md` and need a light pre-code readiness check. Use it to catch missing end state, weak contracts, malformed progress, scope drift, or blind spots before code changes begin. |
| **Implementation (lesson focus)** | |
| `/10x-implement <change-id> phase <n>` | You have an approved plan and want to execute one phase with verification, manual gate, commit ritual, and SHA write-back to `## Progress`. |
| **Lifecycle closure** | |
| `/10x-archive <change-id>` | A change is merged or intentionally closed. Move it out of active `context/changes/` into archive state. |

### How the chain hands off

- `/10x-new` creates the durable change identity.
- `/10x-plan` turns that identity into an implementation contract.
- `/10x-plan-review` checks the plan before the agent mutates code.
- `/10x-implement` executes one planned phase, verifies, asks for manual confirmation when needed, commits, and records progress.

### Lesson boundaries

- Plan is the default router after roadmap selection. Start with `/10x-plan` unless the problem is unclear or external evidence is blocking.
- Do not run `/10x-frame + /10x-research` as ceremony for every change.
- Do not turn this lesson into a full end-to-end product build. A checkpoint with a planned and partially or fully implemented stream is valid.
- Code review of the implemented diff belongs to Lesson 3 via `/10x-impl-review`.
- Lifecycle closure via `/10x-archive` after a change is merged or intentionally closed.

### Paths used by this lesson

- `context/foundation/roadmap.md` - upstream roadmap
- `context/changes/<change-id>/change.md` - change identity
- `context/changes/<change-id>/plan.md` - implementation contract
- `context/changes/<change-id>/plan-brief.md` - compressed handoff
- `context/foundation/lessons.md` - recurring rules and pitfalls
- `docs/reference/contract-surfaces.md` - load-bearing names registry

Skills must not write to `context/archive/`. Archived changes are immutable; if a resolved target path starts with `context/archive/`, abort with: "This change is archived. Open a new change with `/10x-new` instead."

<!-- END @przeprogramowani/10x-cli -->
