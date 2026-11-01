# Planner

Monthly shift scheduling for a 24/7 gas station. Employees enter when they can work, the manager generates a fair schedule for the month, reviews and adjusts it, and publishes it for everyone to read. It replaces a schedule built by hand in a spreadsheet.

**Live:** https://planner.10xplanner.workers.dev

## What it does

- **Employees** add, edit and delete their own availability windows on a calendar for the next 3 months, and read the published schedule (`/schedule`), with their own shifts highlighted.
- **The manager** sees the whole team's availability (`/manager/availability`), locks months (`/manager/months`), generates a draft schedule (`/manager/schedule`), changes who works any shift (one Save per day, with warnings that need "Assign anyway"), publishes and unpublishes it, and manages roles (`/manager/users`).
- **The generator** (`src/lib/schedule-generator.ts`) covers every station day (06:00 → 06:00) with one of 5 shift patterns (12+12, 8+8+8, 12+6+6, 6+6+12, 6×4). A person only gets a shift that fits entirely inside their availability, at most one shift a day and never two back to back. Then it balances 12h shifts, nights and total hours across the team. A shift nobody can take stays **Uncovered**, and publishing is refused while any day has no one.

## Try it

Demo accounts on the live app (shared sample data, removed after the review):

| Role     | Email                      | Password               |
| -------- | -------------------------- | ---------------------- |
| Manager  | `reviewer@planner.example` | `WNWboBEZhYFkLxeOWAUe` |
| Employee | `demo-full-a@example.com`  | `7Ym4xh5XOu8-0IlQkXGL` |

The other demo employees (`demo-full-b@`, `demo-part-c@`, `demo-part-d@`, `demo-part-e@example.com`) use the employee password too.

1. Open https://planner.10xplanner.workers.dev and sign in with an account above, or sign up. Production keeps email confirmation on, so confirm the link in your inbox, then sign in.
2. As an **employee**: open **Availability**, pick a day next month and add a window (for example 06:00–18:00, repeated on that weekday). Edit it and delete it. Open **Schedule** to see a published month, or "Not published yet".
3. As a **manager** (the manager account above, since new sign-ups are employees): open **Team availability** to see the 5 demo employees' availability, then **Manage schedule** → Generate for an upcoming month. Days 10 and 20 have no one available on purpose. Look at the Uncovered shifts and the fairness summary. Change who works a shift and Save the day (a pick outside someone's availability asks "Assign anyway" first), then Publish. Publishing is refused while a day has no one. Every signed-in user then sees the month on **Schedule**.

## Tech stack

- [Astro](https://astro.build/) 7 (SSR, `output: "server"`) with [React](https://react.dev/) 19 islands, TypeScript, [Tailwind CSS](https://tailwindcss.com/) 4 and shadcn/ui
- [Supabase](https://supabase.com/): auth, Postgres, row-level security, SQL functions for the atomic writes
- [Cloudflare Workers](https://workers.cloudflare.com/) through `@astrojs/cloudflare`, [Sentry](https://sentry.io/) for errors
- Vitest, pgTAP, Playwright, a dependency-free HTTP smoke script, GitHub Actions

## Certification checklist (10xBuilder)

| Requirement                    | Where it is                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Access control**             | Supabase auth with sign-up, sign-in and sign-out (`src/pages/api/auth/`). `src/middleware.ts` applies `src/lib/route-access.ts`: anonymous users go to sign-in, non-managers get 403 on `/manager/*`. Postgres RLS is the real enforcement: an employee reads and writes only their own availability, and drafts are manager-only (`supabase/migrations/`).                                                                                                                                                                         |
| **CRUD**                       | Availability windows: create, list, edit and delete your own (`/availability`, `src/pages/api/availability/{create,update,delete}.ts`). Also: draft schedules (generate, read, override, discard), month locks, roles and the display name.                                                                                                                                                                                                                                                                                         |
| **Business logic**             | The schedule generator `src/lib/schedule-generator.ts` and its independent recount `src/lib/schedule-summary.ts`, override warnings `src/lib/schedule-override.ts`, and the all-or-nothing day save `public.save_schedule_day`.                                                                                                                                                                                                                                                                                                     |
| **Context documents**          | `context/foundation/`: `prd.md`, `roadmap.md` (milestones M-1 and M-2, both closed), `tech-stack.md`, `infrastructure.md`, `test-plan.md`, `test-stack.md`, `shape-notes.md`, `tasks-linear.md`. The 16 delivered changes are in `context/archive/`, each with its plan (most with research and implementation reviews). `CLAUDE.md` is the agent guide.                                                                                                                                                                            |
| **Tests for a test-plan risk** | `context/foundation/test-plan.md` §2 names 6 risks. Risk #5 (a shift assigned outside availability, or left without anyone, without the manager being told) is covered from the user's side by the Playwright specs `tests/e2e/generate-draft.spec.ts` and `tests/e2e/day-save-override-confirm.spec.ts`. Risks #2–#4 (other people's data, edits to locked months, role escalation) are covered by the pgTAP tests in `supabase/tests/database/` and `npm run smoke`; risk #1 (station time zone) by the Vitest suite (460 tests). |
| **Public URL**                 | https://planner.10xplanner.workers.dev                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **CI**                         | `.github/workflows/ci.yml`: lint, `astro check`, unit tests and build, then pgTAP, a Cloudflare preview build and the smoke test against a local Supabase.                                                                                                                                                                                                                                                                                                                                                                          |

## Local development

Requirements: Node.js v22.14.0 (`.nvmrc`), npm, and [Docker](https://www.docker.com/) for the local Supabase stack (about 7 GB RAM).

```bash
git clone https://github.com/Redellex/planner.git
cd planner
npm install
cp .env.example .env
npx supabase start          # applies supabase/migrations and supabase/seed.sql
```

Copy the URL and anon key that `npx supabase start` prints into `.env` and `.dev.vars` (the Cloudflare runtime reads `.dev.vars`):

```
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_KEY=<anon key from the CLI output>
```

Then `npm run dev` and open http://localhost:4321. Studio is at http://localhost:54323.

The local seed (never run it against production) creates `manager@example.com` / `Manager-Passw0rd!`, `employee@example.com` / `Employee-Passw0rd!` and a 5-person demo team with availability next month (`demo-full-a/b@`, `demo-part-c/d/e@example.com` / `Demo-Passw0rd!`). Generating next month as the manager should leave only days 10 and 20 with no one. After a month boundary, run `npx supabase db reset` or `npm run seed:demo`.

After changing a migration, regenerate the types with `npx supabase gen types typescript --local > src/db/database.types.ts`.

## Scripts

| Command                             | What it does                                                                                                                   |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `npm run dev`                       | Dev server on the Cloudflare workerd runtime                                                                                   |
| `npm run build` / `npm run preview` | Production build and its local preview                                                                                         |
| `npm run deploy`                    | Build and `wrangler deploy`                                                                                                    |
| `npm run lint` / `npm run lint:fix` | ESLint with type-checked rules                                                                                                 |
| `npm run format`                    | Prettier                                                                                                                       |
| `npx astro check`                   | Astro and TypeScript type check                                                                                                |
| `npm test`                          | Vitest unit tests (forced to UTC, like the Worker)                                                                             |
| `npm run test:db`                   | pgTAP database rules tests (needs `npx supabase start`)                                                                        |
| `npx playwright test`               | Playwright E2E tests against a local build (needs the local stack and `.dev.vars.e2e`, see `context/foundation/test-stack.md`) |
| `npm run smoke`                     | HTTP smoke test of auth, roles, availability and the draft schedule flow (`BASE_URL`, default `http://localhost:4321`)         |
| `npm run check:ui`                  | Fails on colour literals in views that use the design tokens                                                                   |
| `npm run seed:demo`                 | Puts the demo team into a database (`-- --month YYYY-MM[,YYYY-MM]`, `-- --all-upcoming`, `-- --remove`)                        |
| `npx stryker run`                   | Manual mutation testing of `src/lib/availability.ts`                                                                           |

## Pages

| Route                                                 | Access     | What it is                                                   |
| ----------------------------------------------------- | ---------- | ------------------------------------------------------------ |
| `/auth/signin`, `/auth/signup`, `/auth/confirm-email` | signed out | Sign in, sign up, "check your email"                         |
| `/`                                                   | signed in  | Dashboard with your role and links                           |
| `/availability`                                       | signed in  | Your availability calendar for the next 3 months             |
| `/schedule`                                           | signed in  | The published schedule, your shifts highlighted              |
| `/account`                                            | signed in  | The display name colleagues see on the schedule              |
| `/manager/availability`                               | manager    | Team availability, per day and per person                    |
| `/manager/months`                                     | manager    | Lock or unlock a month's availability                        |
| `/manager/schedule`                                   | manager    | Generate, review, override, publish and unpublish a month    |
| `/manager/users`                                      | manager    | Promote or demote users (the last manager cannot be demoted) |

## Deployment

The app runs on Cloudflare Workers (`wrangler.jsonc`, entry `src/worker.ts`) against a hosted Supabase project.

1. Apply new migrations to the hosted project: `npx supabase db push`.
2. Merge to `master` through a pull request: Cloudflare Workers Builds deploys every push to `master`. The repository is public, and ruleset "Protect master" lets only the admin update `master`, only through a PR, and requires the `ai-cr/verdict` status (see [AI code review](#ai-code-review)). The admin can merge past a pending or failed verdict only with an explicit bypass on the PR. Waiting for a green CI (`ci`, `smoke`) is still a convention, not a required check. `npm run deploy` deploys by hand.
3. Worker secrets: `SUPABASE_URL`, `SUPABASE_KEY` and optional `SENTRY_DSN`, set with `npx wrangler secret put <NAME>`.
4. Roll back with `npx wrangler deployments list` and `npx wrangler rollback <version-id>`.

### Demo data for reviewers

The **Demo data** workflow (`.github/workflows/demo-data.yml`, run by hand from the Actions tab) puts the 5-person demo team and a reviewer manager account into the hosted project. It runs `scripts/seed-demo-team.mjs --hosted` with the secret key from repository secrets, so the key is never on a laptop.

1. Add the repository secrets (Settings → Secrets and variables → Actions): `SUPABASE_SECRET_KEY` (Supabase dashboard → Project Settings → API keys → secret key), `DEMO_TEAM_PASSWORD`, `DEMO_MANAGER_EMAIL` (any address, for example `reviewer@planner.example`; no mail is sent to it) and `DEMO_MANAGER_PASSWORD` (12+ characters each). `SUPABASE_URL` is already there.
2. Actions → Demo data → Run workflow, with `seed` and an empty month. Each of the next 3 months gets demo availability; a month that is already locked (for example one a reviewer generated) is skipped. The month field also takes one or more of those 3 months (`2026-11,2026-12`); the current month is refused, since no draft can be generated for it.
3. Keep the passwords in the **Try it** table above equal to `DEMO_MANAGER_PASSWORD` and `DEMO_TEAM_PASSWORD`. If you change a secret, update the table and run `seed` again: it resets the accounts' passwords.
4. Afterwards, run it with `remove` to delete the demo employees and the reviewer account, and take the table out of this README. Months they locked stay locked; discard the drafts and unlock them on `/manager/months`.

The first manager is promoted once in the Supabase SQL editor after they sign up: `update public.profiles set role = 'manager' where email = '<email>';`. Production keeps email confirmation on, so production is checked by hand, and `npm run smoke` runs only against a local or CI Supabase. Details: `context/changes/deployment/deployment-plan.md` (Outcome).

## AI code review

Every same-repo pull request opened against `master` gets an `ai-cr/verdict` status, **pending** (`Not reviewed. Run AI Code Review with pr=<n>`) until someone reviews it. The review is the `reviewer/` agent (Claude Agent SDK, `claude-sonnet-5-5`) and is started by hand.

**Start a review** (needs write access to the repository; today only the owner has it):

- On the PR, click **Details** next to `ai-cr/verdict`. This opens Actions → **AI Code Review**. Click **Run workflow**, keep the branch `master`, enter the PR number in `pr` and run it.
- Or from a terminal: `gh workflow run ai-review.yml -f pr=<n>`.

The run reviews the PR head commit it finds at the start, using the reviewer code on `master` (a run dispatched from any other branch is refused). To review again, for example after a push, run it again; each push marks the new head commit pending.

**What it posts**

- A comment with the verdict (`PASS` or `FAIL`), the reviewed commit, six scores from 1 to 10 and a short summary. Any score of 4 or lower fails the review.
- The label `ai-cr:passed` or `ai-cr:failed` (the other one is removed).
- The `ai-cr/verdict` status on the reviewed commit: `success` on pass, `failure` on fail. The run itself fails on `fail`.

The status is the gate, and it belongs to one commit. The label only shows the last verdict: after a new push it may still say `ai-cr:passed` while the new head is pending.

**When it could not run**, the comment says "could not run", labels stay as they were, and the status is `error`. This happens when the diff is over 70 kB (larger diffs would reach the cost cap anyway), when it holds only excluded files, when the agent errors (API error, the cost cap, invalid output), or when the PR changed during the run so that the recorded commit is no longer in it (a force-push). Look at the run log, then run it again (or split the PR). A closed PR, a PR to another branch, or a `pr` that is not a number fails the run and posts nothing.

**Cost and scope.** The diff is `master...<head>` without `package-lock.json` files (root and `reviewer/`) and the generated `src/db/database.types.ts`. Each run is capped at $0.1 (`max-budget-usd` in `.github/workflows/ai-review.yml`); the cost line is in the run's step summary. The API key is the `ANTHROPIC_API_KEY` repository secret.

**Trust boundary.** The gate holds against fork PRs and accidents, not against people with write access: a same-repo PR runs its own copy of the notify workflow, and a dispatch from another branch runs that branch's copy of the review workflow, so either could set the status. Today the owner is the only collaborator. Before adding one, move the status to a GitHub App that only `master` can use.

**Fork PRs** get no pending status (their token cannot set one), so the required check shows as "expected". The owner dispatches the review by hand the same way; it runs `master`'s code and only reads the fork's diff.

Code: `.github/workflows/ai-review.yml`, `.github/workflows/ai-review-notify.yml`, `.github/actions/ai-reviewer/`. Design and decisions: `context/changes/ci-cd-code-review/`.

## License

MIT
