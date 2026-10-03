# 10x Astro Starter

![](./public/template.png)

A modern, opinionated starter template for building fast, accessible web applications.

## Tech Stack

- [Astro](https://astro.build/) v7 - Modern web framework with server-first rendering
- [React](https://react.dev/) v19 - UI library for interactive components
- [TypeScript](https://www.typescriptlang.org/) v6 - Type-safe JavaScript
- [Tailwind CSS](https://tailwindcss.com/) v4 - Utility-first CSS framework
- [Supabase](https://supabase.com/) - Authentication and backend-as-a-service
- [Cloudflare Workers](https://workers.cloudflare.com/) - Edge deployment runtime

## Prerequisites

- Node.js v22.14.0 (as specified in `.nvmrc`)
- npm (comes with Node.js)

## Getting Started

1. Clone the repository:

```bash
git clone https://github.com/przeprogramowani/10x-astro-starter.git
cd 10x-astro-starter
```

2. Install dependencies:

```bash
npm install
```

3. Set up Supabase and configure environment variables — see [Supabase Configuration](#supabase-configuration) below.

4. Create a `.dev.vars` file for local Cloudflare dev secrets:

```bash
cp .env.example .dev.vars
```

5. Run the development server:

```bash
npm run dev
```

## Available Scripts

- `npm run dev` - Start development server (Cloudflare workerd runtime)
- `npm run build` - Build for production
- `npm run preview` - Preview production build
- `npm run lint` - Run ESLint with type-checked rules
- `npm run lint:fix` - Auto-fix ESLint issues
- `npm run format` - Run Prettier
- `npm run smoke` - Smoke test the auth, role and availability flows against a running server (`BASE_URL`, defaults to `http://localhost:4321`)

## Project Structure

```md
.
├── src/
│ ├── layouts/ # Astro layouts
│ ├── pages/ # Astro pages
│ │ └── api/ # API endpoints
│ ├── components/ # UI components (Astro & React)
│ ├── lib/ # Shared helpers (Supabase client, roles, availability)
│ ├── db/ # Generated Supabase types (database.types.ts)
│ └── assets/ # Static assets
├── supabase/
│ ├── migrations/ # SQL migrations (profiles/roles, availability)
│ └── seed.sql # Local/CI seed users (never run in production)
├── scripts/ # smoke.mjs
├── public/ # Public assets
├── wrangler.jsonc # Cloudflare Workers config
```

## Supabase Configuration

This project uses [Supabase](https://supabase.com/) for authentication. Environment variables are declared via Astro's `astro:env` schema and are treated as **server-only secrets** — they are never exposed to the client.

### First-time setup (local, no cloud project needed)

Requires [Docker](https://www.docker.com/) and ~7 GB RAM.

1. Create your `.env` file:

```bash
cp .env.example .env
```

2. Initialize the local Supabase project (creates a `supabase/` config folder):

```bash
npx supabase init
```

3. Start the local stack (downloads Docker images on first run):

```bash
npx supabase start
```

4. Copy the credentials printed by the CLI into your `.env` and `.dev.vars`:

```
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_KEY=<anon key from CLI output>
```

5. To stop the stack when done:

```bash
npx supabase stop
```

The local Studio UI is available at `http://localhost:54323`.

`npx supabase start` applies the migrations in `supabase/migrations/` and `supabase/seed.sql`. Run `npx supabase db reset` to rebuild the database from scratch. The migrations create:

- `public.profiles`: one row per user with a `manager` | `employee` role. New sign-ups become `employee`.
- `public.availability_windows` and `public.availability_locks`: employee availability and the monthly lock.

All of them are protected by row-level security. The seed creates two local users: `manager@example.com` / `Manager-Passw0rd!` and `employee@example.com` / `Employee-Passw0rd!`.

After changing a migration, regenerate the types with `npx supabase gen types typescript --local > src/db/database.types.ts`.

For a hosted project, apply migrations with `npx supabase db push`. Promote the first manager once in the SQL editor: `update public.profiles set role = 'manager' where email = '<email>';`

### Using a cloud Supabase project instead

If you prefer to use a hosted Supabase project, add these variables to your `.env` and `.dev.vars` files:

| Variable       | Description                                                |
| -------------- | ---------------------------------------------------------- |
| `SUPABASE_URL` | Project URL from Supabase dashboard → Settings → API       |
| `SUPABASE_KEY` | `anon` public key from Supabase dashboard → Settings → API |

```
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_KEY=<anon-key>
```

`npm run dev` runs in the Cloudflare workerd runtime and reads secrets from `.dev.vars`, so that file must be present. If email confirmation is on (the production default), confirmation links go to the project's **Site URL**, not `localhost`. Confirm the account there, then sign in locally.

### Email confirmation in local development

By default Supabase requires email confirmation before a user can sign in. To skip this during local development:

1. Open the Supabase dashboard for your project
2. Go to **Authentication → Email → Confirm email**
3. Toggle it **off**

Users can then sign in immediately after sign-up without clicking a confirmation link.

### Routes

| Route                   | Access    | Description                                                                                                                |
| ----------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------- |
| `/auth/signin`          | anyone    | Email/password sign-in form                                                                                                |
| `/auth/signup`          | anyone    | Email/password sign-up form                                                                                                |
| `/auth/confirm-email`   | anyone    | Post-signup "check your inbox" page                                                                                        |
| `/dashboard`            | signed in | Landing page after sign-in                                                                                                 |
| `/availability`         | signed in | Calendar for adding, editing and deleting your own availability for the next 3 months                                      |
| `/manager/users`        | manager   | Promote or demote users (the last manager cannot be demoted)                                                               |
| `/manager/months`       | manager   | Lock or unlock an upcoming month's availability                                                                            |
| `/manager/availability` | manager   | Read-only team calendar: who is available each day, lock status and per-person totals for the current month and the next 3 |

Route protection is handled in `src/middleware.ts`, which applies the decision in `src/lib/route-access.ts`: `PROTECTED_ROUTES` sends anonymous users to `/auth/signin`. `MANAGER_ROUTES` also returns 403 to non-managers. Postgres row-level security does the actual data enforcement.

## Deployment

This project deploys to [Cloudflare Workers](https://workers.cloudflare.com/).

1. Build the project:

```bash
npm run build
```

2. Deploy with Wrangler:

```bash
npx wrangler deploy
```

Set `SUPABASE_URL` and `SUPABASE_KEY` as secrets in your Cloudflare dashboard or via `npx wrangler secret put`.

## Smoke test

`scripts/smoke.mjs` is a dependency-free Node script that runs over HTTP. It walks the whole auth flow (sign-up, sign-in, protected page, sign-out). It also checks role enforcement: a new user gets 403 on `/manager/users`, and the last manager cannot be demoted. Finally, it checks the availability flow: add, overlap error, edit and delete a window, then a manager locks a month, a create in it is refused, and the manager unlocks it. It also checks the manager team view: a new user gets 403 on `/manager/availability`, and the manager sees the window that user left. Run it against the dev server or the production preview after dependency upgrades:

```bash
npm run dev            # or: npm run build && npm run preview
BASE_URL=http://localhost:4321 npm run smoke
```

It needs a reachable Supabase instance with email confirmation disabled and `supabase/seed.sql` applied, because the manager steps sign in as the seeded manager. You can override that user with `SMOKE_MANAGER_EMAIL` / `SMOKE_MANAGER_PASSWORD`. If a run fails between the lock and unlock steps, see `CLAUDE.md` for how to unlock the month.

> **Note:** this script exists primarily to guard the development of the starter itself — it is a fast sanity check that dependency upgrades did not break the build, the Cloudflare adapter or the Supabase auth flow. It is **not** a substitute for a real test suite. Once you build your own product on top of this starter, add proper tests (unit, integration, end-to-end) suited to your application.

## CI

GitHub Actions runs two jobs on every push and PR to `master`:

- **ci** — lint, `astro check` and build. Configure `SUPABASE_URL` and `SUPABASE_KEY` as repository secrets for the build step.
- **smoke** — starts a local Supabase via the Supabase CLI, builds, serves the production preview on the Cloudflare runtime and runs `npm run smoke` against it. No secrets required.

## License

MIT
