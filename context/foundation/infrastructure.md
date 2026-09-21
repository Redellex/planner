---
project: planner
researched_at: 2026-09-21
recommended_platform: Cloudflare Workers
runner_up: Netlify
context_type: mvp
tech_stack:
  language: typescript/javascript
  framework: astro
  runtime: cloudflare-workers (workerd, via @astrojs/cloudflare)
---

## Recommendation

**Deploy on Cloudflare Workers.**

The repo already ships with `@astrojs/cloudflare` v14.3.1 and `wrangler` v4.131.1 — Cloudflare is not a candidate being adopted, it's the platform the starter is already wired for, so this is a zero-migration decision. It passes 4 of 5 agent-friendly criteria outright (CLI-first, managed/serverless, agent-readable docs, stable deploy API) with only MCP integration at Partial (explicitly work-in-progress). At this MVP's traffic (one gas station, small team, thousands of requests/month) it costs effectively $0/month against the 100k-requests/day free tier. The developer interview reinforced this: no persistent-connection requirement, cost-minimization as the top priority, no existing platform familiarity to break a tie, single-region traffic, and external services (Supabase) already handling data — none of these push toward a different platform strongly enough to justify a migration.

## Platform Comparison

| Platform | CLI-first | Managed/Serverless | Agent-readable docs | Stable deploy API | MCP/Integration |
|---|---|---|---|---|---|
| **Cloudflare Workers** | Pass | Pass | Pass | Pass | Partial |
| Netlify | Pass | Pass | Pass | Pass | Partial |
| Render | Partial | Pass | Pass | Pass | Pass |
| Railway | Partial | Pass | Pass | Pass | Partial |
| Fly.io | Partial | Partial | Pass | Pass | Pass |
| Vercel | Pass | Pass | Pass | Partial | Partial |

**Cloudflare Workers** — `wrangler deploy`/`wrangler tail`/`wrangler rollback` are all GA and cover the full operational loop unattended. Fully serverless (Workers Static Assets + SSR), no OS/patching surface. Docs are markdown-native (`/index.md` suffix, `llms.txt` per product) and GA as of the research date. Deploy is deterministic and scriptable. The official Cloudflare MCP servers exist but are explicitly labeled work-in-progress.

**Netlify** — `netlify deploy --prod` is GA with a deliberate draft-by-default safety gate; a dedicated CLI rollback subcommand could not be confirmed (UI "Publish deploy" is the documented rollback path). Fully managed (Functions + Edge Functions). Docs are markdown + `llms.txt`, GA. Astro 7 is explicitly confirmed supported ("Astro 7 just works on Netlify," 2026-06-22). Official MCP server exists; maturity label unconfirmed.

**Render** — CLI has closed most of its historical dashboard-centric gap but first-time secret setup still leans on the dashboard. Native Node web service (no Dockerfile needed), fully managed. Docs via `llms.txt`. Deploy API is stable. Notably has an official, first-party hosted MCP server (Pass) and the cleanest SSR cookie story of any alternative (plain Node server, no edge/cookie quirks) — this is the strongest alternative if the Cloudflare `nodejs_compat`/Supabase friction (see cross-check below) ever becomes a real blocker.

**Railway** — CLI covers deploy/logs/redeploy but rollback to an arbitrary past deployment is dashboard-only, a real gap for unattended agent ops. Managed, though the default Railpack builder is still in beta. Docs via `llms.txt`/`llms-full.txt`. MCP server exists but recently shipped, maturity unconfirmed.

**Fly.io** — CLI covers deploy/logs but has no single rollback command (image-pin workaround instead). Requires a Dockerfile (`fly launch` auto-generates one, but it's an ongoing file to maintain — outside this skill's non-goals but a real cost once adopted). Docs are markdown + `llms.txt`, GA. Has an official MCP wrapper (`flymcp`). No free tier as of Oct 2024; ~$2/month minimum for an always-on machine, requires a card on file.

**Vercel** — CLI/docs/deploy API all strong, but the Hobby (free) tier explicitly bans commercial use, forcing Pro ($20/mo) for a real (if small) business — the worst cost fit for this project's stated priority. More materially, there is a real, specific GitHub issue history (#5461, #15076, #8409) around `Set-Cookie` handling in `@astrojs/vercel`, which is a direct risk to the `@supabase/ssr` cookie-based session pattern this app relies on for auth.

### Shortlisted Platforms

#### 1. Cloudflare Workers (Recommended)

Already the installed adapter — no migration, no new adapter to validate, no new CLI to learn. $0/month at this traffic. Full pass on 4/5 criteria. The one known friction point (Supabase SSR client + `nodejs_compat`) has a documented, applicable fix (see Risk Register) rather than being a hard blocker.

#### 2. Netlify

Also $0/month, also has confirmed first-class Astro 7 support, and avoids the Cloudflare-specific `nodejs_compat` requirement entirely (plain Node-based Functions). Runner-up because it requires an adapter swap (`@astrojs/cloudflare` → `@astrojs/netlify`) and reconfiguration/retesting of the auth flow for a project that already works on its current adapter — real but modest engineering cost for a 3-week solo timeline.

#### 3. Render

Third because it requires both an adapter swap and a paid tier (~$7/month for an always-on Starter instance, since the free tier spins down after 15 minutes of inactivity) to avoid cold starts on a login flow. Kept in the shortlist specifically because it has the cleanest cookie/SSR story of any alternative and an official first-party MCP server — the platform to reach for if the Cloudflare-specific auth friction turns out to be a real blocker in practice.

## Anti-Bias Cross-Check: Cloudflare Workers

### Devil's Advocate — Weaknesses

1. `@supabase/ssr`'s dynamic `require("stream")` call is an open, unresolved GitHub issue (supabase/supabase#37592) against Workers' `nodejs_compat` layer — even with the flag set, edge cases in session-refresh may throw at runtime in paths a quick smoke test won't exercise.
2. Wrangler v4's dev server runs in real `workerd`, not Node — Node-specific dependency behavior can diverge between `astro dev` and the deployed Workers runtime, undermining the "closer to prod" promise in subtle ways.
3. Most tutorials, Stack Overflow answers, and even LLM training-data defaults still describe the now-unsupported Cloudflare Pages flow (`@astrojs/cloudflare` v14+ dropped Pages support entirely) — a stale `wrangler pages deploy` reference could burn real debugging time mid-project.
4. CPU-time limits (10ms/request on the free tier) are a real ceiling for any future compute-heavy feature (e.g. the shift-scheduling algorithm from the PRD's core value proposition), unlike the long-lived containers on Fly.io/Railway/Render.
5. `compatibility_date`/`compatibility_flags` in `wrangler.jsonc` are silent footguns — forgetting `nodejs_compat` or pinning a date before 2024-09-23 produces cryptic runtime errors discovered in production, not a clear deploy-time failure.

### Pre-Mortem — How This Could Fail

The team deployed the Astro 7 + Supabase MVP to Cloudflare Workers under time pressure, copying `wrangler.jsonc` from an older tutorial that used Cloudflare Pages defaults and never explicitly set `nodejs_compat`. Locally, `astro dev` worked fine because it exercises `workerd` directly for most paths, but the specific token-refresh code path in `@supabase/ssr` was never hit during development — the manager tested login once and moved on. In production, most requests worked, but any session that lived long enough to need a token refresh silently failed with an opaque `require is not a function` error, logging employees out mid-shift-entry without a clear signal why. Because Workers' error surface doesn't map cleanly to a familiar Node stack trace, the solo developer spent a full evening assuming it was a Supabase misconfiguration before finding the open GitHub issue. Compounding this, bookmarked blog posts referencing `wrangler pages deploy` led to a second, stale Pages-style deployment attempt that confused which URL was authoritative right before the manager needed to publish the month's schedule.

### Unknown Unknowns

- Workers bills by CPU-ms, not wall-clock time — a slow *external* call (e.g. Supabase's auth token exchange) doesn't burn CPU budget while waiting on I/O, so cost estimates based on "requests per month" alone can be misleadingly reassuring once compute-heavy work (the scheduling algorithm) is added.
- `compatibility_date` is not a narrow feature gate — bumping it opportunistically can silently change existing runtime behavior across the board, unlike a typical npm dependency bump.
- Training-data and most public content still describe the Pages-based deployment flow as canonical, so any future troubleshooting session (human or AI agent) has a real chance of reverting to the wrong command (`wrangler pages deploy`) by default and needs to be corrected back to Workers-only commands.
- Cloudflare's official MCP servers are explicitly labeled work-in-progress — not yet a reliable path if agent-driven live-infra ops (vs. CLI) is ever the goal.

**Decision**: proceed with Cloudflare Workers; risks absorbed into the register below rather than triggering a platform swap.

## Operational Story

- **Preview deploys**: Wrangler supports versioned/preview deployments via `wrangler versions upload` + `wrangler versions deploy` for gradual rollout; for a solo MVP, the simplest loop is `wrangler deploy` directly to the one production Worker, with GitHub Actions (per `tech-stack.md`'s `ci_default_flow: auto-deploy-on-merge`) triggering it on merge to the default branch. No fork-PR preview complication since this is a solo repo.
- **Secrets**: `SUPABASE_URL`/`SUPABASE_KEY` are set via `wrangler secret put <NAME>` for production, and via `.dev.vars` (gitignored) for local `astro dev`/`wrangler dev` — matching the existing convention in `CLAUDE.md`. Secrets are readable only by whoever has Cloudflare account/API-token access; rotation is `wrangler secret put <NAME>` again (overwrites in place, takes effect on next deploy or immediately for live Workers).
- **Rollback**: `wrangler rollback [version-id]` or `wrangler versions deploy` to a prior version — deterministic, single command, GA. No database migration rollback concern in this MVP since Supabase schema changes are managed separately from the Worker deploy.
- **Approval**: Routine deploys (`wrangler deploy` on merge) can run unattended via CI. Human-only: rotating the Supabase service-role key, changing the Cloudflare account's billing tier, and deleting the Worker/project — these remain manual, scoped actions per this project's minimal-permissions posture.
- **Logs**: `wrangler tail` streams live production logs from the terminal (GA); no MCP-based log query is recommended yet given the WIP status of Cloudflare's MCP servers — CLI is the correct default here per the lesson's CLI-vs-MCP guidance.

## Risk Register

| Risk | Source | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| `@supabase/ssr` hits the unresolved `nodejs_compat` `require("stream")` issue (supabase/supabase#37592) on a code path not covered by a quick smoke test (e.g. token refresh) | Devil's advocate | M | H | Set `compatibility_flags: ["nodejs_compat"]` and `compatibility_date >= "2024-09-23"` in `wrangler.jsonc`; extend `npm run smoke` (or a manual pass) to include a session that lives long enough to trigger a token refresh, not just sign-in/sign-out |
| Stale Pages-era guidance (tutorials, blog posts, training data) leads to a future troubleshooting session running `wrangler pages deploy` against an adapter that no longer supports Pages | Devil's advocate / Unknown unknowns | M | M | Document in this repo's `CLAUDE.md` or `AGENTS.md` that Cloudflare Pages is unsupported by `@astrojs/cloudflare` v14+ and only `wrangler deploy` (Workers) is canonical |
| Silent runtime failure if `nodejs_compat` or `compatibility_date` is misconfigured — discovered in production, not at deploy time | Devil's advocate | L | H | Commit `wrangler.jsonc` with the required flags checked in from day one (see Getting Started); add a post-deploy smoke check that exercises an authenticated request |
| CPU-ms billing model makes "requests/month" cost estimates misleading once compute-heavy work (shift-scheduling algorithm) is added | Unknown unknowns | L | M | Re-estimate cost once the scheduling algorithm is implemented and its typical CPU time per generate-schedule request is known; the PRD's own NFR ("a few seconds... with visible progress") suggests this could exceed free-tier CPU-ms per invocation and needs measuring, not assuming |
| Cloudflare's MCP servers are explicitly work-in-progress | Research finding | L | L | Continue using `wrangler` CLI directly for all operational tasks; revisit MCP only if a recurring pattern of CLI `--help` traversal emerges |
| Dev/prod parity gap: Node-specific dependency behavior differs between `astro dev` (workerd-backed) and deployed Workers runtime for any future dependency | Devil's advocate | L | M | Before adding a new npm dependency, check for documented Workers/`nodejs_compat` support; run `wrangler dev` (not just `astro dev`) before deploying features that touch new dependencies |

## Getting Started

1. Confirm `wrangler.jsonc` (or `wrangler.toml`) has `compatibility_flags: ["nodejs_compat"]` and a `compatibility_date` of `2024-09-23` or later — required for `@supabase/ssr` to run correctly on Workers. This is not optional; deploying without it risks the silent failure described in the risk register.
2. Authenticate wrangler: `npx wrangler login` (one-time, opens a browser to authorize the CLI against your Cloudflare account).
3. Set production secrets: `npx wrangler secret put SUPABASE_URL` and `npx wrangler secret put SUPABASE_KEY` (prompts for the value; matches the existing `.env`/`.dev.vars` convention in `CLAUDE.md` for local dev).
4. Build and deploy: `npm run build && npx wrangler deploy` — this is the Workers-only path; do not use `wrangler pages deploy`, which is not supported by `@astrojs/cloudflare` v14.3.1.
5. Verify: `npx wrangler tail` to stream live logs while exercising the deployed sign-up → sign-in → protected page → sign-out flow (the same flow `npm run smoke` automates locally) against the production URL.

## Out of Scope

The following were not evaluated in this research:
- Docker image configuration
- CI/CD pipeline setup
- Production-scale architecture (multi-region, HA, DR)
