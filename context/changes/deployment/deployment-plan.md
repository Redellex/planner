# Cloudflare Workers Deployment Plan — Planner

## Context

`context/foundation/infrastructure.md` already recommends Cloudflare Workers (the repo is pre-wired for it: `@astrojs/cloudflare` + `wrangler` are installed, `wrangler.jsonc` exists) and documents an operational story, risk register, and getting-started steps. This plan turns `infrastructure.md`'s recommendation into a concrete, sequenced, checkbox-trackable rollout, and becomes the source for `context/deployment/deploy-plan.md` once executed (per `CLAUDE.md`'s "Plan Mode deploy" hand-off).

**Status update (2026-09-21):** Phase 0 (Cloudflare account + API token, GitHub repo), Phase 1 (git init/commit/push), and Phase 3 (production Supabase project) are now done. The Worker has been renamed to `planner` in `wrangler.jsonc`. Still outstanding: the `package.json` deploy script and a local build check (rest of Phase 2), secrets wiring (Phase 4), the first manual deploy (Phase 5), and Workers Builds auto-deploy (Phase 6). See the phase checklists below for the current, accurate state.

Two things surfaced during research that revise `infrastructure.md`'s own content and are corrected here rather than blindly followed:
- The GitHub issue `infrastructure.md` cites as an **open, unresolved** blocker (`supabase/supabase#37592`, dynamic `require("stream")` on Workers) is actually **closed** (2025-09-04, closed for inactivity after a maintainer asked whether `nodejs_compat` was set — no confirmed reproduction after that). The mitigation is unchanged (`nodejs_compat` + a recent `compatibility_date`, both already correctly set in `wrangler.jsonc`), but the risk's urgency should be downgraded, not treated as a live bug.
- Cloudflare has a native **Workers Builds** Git integration (dashboard-connected, GitHub-App-based auto build+deploy on push) that is simpler than hand-rolling a `wrangler deploy` step in GitHub Actions — no `CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ACCOUNT_ID` secrets to manage in GitHub, no YAML to write for deploy itself. Given the user's explicit goal of minimizing complexity for auto-deploy-on-push, this plan uses Workers Builds instead of a custom Actions deploy job, keeping the existing `ci`/`smoke` Actions jobs as pre-merge gates only.

**Decisions confirmed with the user:**
- Worker name: rename to **`planner`** (from the template default `10x-astro-starter`) before the first deploy.
- Auto-deploy on push: use **Cloudflare Workers Builds** (native Git integration), not a custom GitHub Actions deploy job.
- Production Supabase project: created and configured (Phase 3, done 2026-09-21).
- Production auth-flow verification: **manual check only** for sign-in/dashboard/sign-out (the automated smoke script stays local/CI-only, since hosted Supabase requires email confirmation by default and local dev config disables it).
- Secret wiring (Phase 4): agent-assisted via non-interactive `wrangler secret put`, exact handoff mechanism (how the API token and Supabase values reach the agent) TBD at execution time.

---

## Phase 0 — Prerequisites (manual, human-gated)

- [x] Confirm/create a Cloudflare account (free tier covers this MVP's traffic — 100k requests/day free tier, ~$0/month per `infrastructure.md`'s cost analysis).
- [x] Create a scoped Cloudflare API token (Account → API Tokens → Create Token, "Edit Cloudflare Workers" template or custom: Workers Scripts *Edit*, no DNS zone access, no billing access, scoped to this account only). This token is for **local CLI use** (Phase 4/5 secret-setting and manual deploy) — Workers Builds (Phase 6) authenticates separately via its own GitHub App install and does not need this token. Save the value in a password manager.
- [x] Create a GitHub repository for this project (empty, no template). Decide public/private. Note the owner/org and clone URL — needed for Phase 1 and Phase 6. Repo: `https://github.com/Redellex/planner.git`.

---

## Phase 1 — Git & GitHub Setup

- [x] `git init` in `E:\10xdevs\Planner` (currently not a git repo).
- [x] Confirm `.gitignore` already excludes `.env`, `.env.production`, `.dev.vars`, `.wrangler/`, `dist/`, `node_modules/` (already verified correct — no change expected, just a pre-commit sanity check).
- [x] Initial commit, `git remote add origin <url>`, `git push -u origin master`. Two commits pushed: `0ebe3bf Initial commit: Astro + Supabase auth starter with 10x-cli tooling`, `4d90e6c Renamed project to planner`; `origin/master` up to date, working tree clean.
- [x] **Edge case:** double-check no `.env`/`.dev.vars` file is accidentally staged before the first commit (`git status` review) — these are gitignored but worth a manual glance given they'd contain real Supabase credentials once Phase 3/4 are done.

---

## Phase 2 — Local Config Verification & Small Additions

- [x] Rename `wrangler.jsonc`'s `"name"` field from `"10x-astro-starter"` to `"planner"`. This becomes the production URL: `planner.<account>.workers.dev` — note the exact predicted URL for use in Phase 3's Supabase redirect config. Confirmed: `wrangler.jsonc` now has `"name": "planner"`.
- [x] Sanity-check (no change expected, just confirm before first deploy): `main` points at the Cloudflare adapter entrypoint, `compatibility_flags: ["nodejs_compat"]`, `compatibility_date` (`2026-05-08`) is ≥ 2024-09-23, `assets.binding: "ASSETS"` / `directory: "./dist"`, `observability.enabled: true`. All already correct.
- [ ] Add a `"deploy": "astro build && wrangler deploy"` script to `package.json` — useful for the manual first deploy (Phase 5) and any future one-off manual re-deploys, even though routine deploys will run via Workers Builds after Phase 6.
- [ ] `npm run build` locally — confirm a clean production build before touching Cloudflare at all, to isolate "build is broken" from "deploy config is broken."
- [ ] **Edge case — Worker name collision:** before deploying, check the Cloudflare dashboard's Workers overview (or `npx wrangler deployments list` after auth in Phase 4) to confirm no existing Worker is already named `planner` on this account. `wrangler deploy` overwrites same-named Workers silently rather than erroring.

---

## Phase 3 — Production Supabase Project

- [x] Create a new Supabase project at supabase.com (free tier; single gas station / small team traffic is well within it).
- [x] In the project's Auth settings, set **Site URL** to `https://planner.<account>.workers.dev` (the predicted URL from Phase 2) and add it to **Additional Redirect URLs**. This must happen *before* Phase 5's first deploy verification, or auth redirects will silently misbehave.
- [x] Copy the project's **URL** and **anon/public key** (Settings → API) — needed for Phase 4. Explicitly confirm this is the *anon* key, not the service-role key (the service-role key is never wired into this app or its secrets per `infrastructure.md`'s minimal-permissions posture).
- [x] Leave "Confirm email" **enabled** (production default) — this is intentional; local dev disables it, production doesn't, which is why Phase 7 uses manual verification instead of the automated smoke script.

*(Project confirmed created and configured by the user 2026-09-21; exact project ref/URL/key are not restated in this doc — they're only needed when Phase 4 actually runs.)*

---

## Phase 4 — Secrets Wiring

**Execution note (added after a status check-in with the user, 2026-09-21):** the user wants this phase to be agent-assisted — the agent runs `wrangler secret put` non-interactively (e.g. piping the value in) instead of the user typing secrets by hand into a prompt. The exact handoff mechanism (how the Cloudflare API token and production Supabase URL/anon key reach the agent — env vars vs. some other channel) is intentionally not designed yet; design it when this phase is actually executed.

- [ ] Authenticate wrangler: `npx wrangler login` (interactive/browser) — see Edge Cases for the headless alternative (`CLOUDFLARE_API_TOKEN` env var) if running from a shell with no GUI.
- [ ] `npx wrangler secret put SUPABASE_URL` — paste the **production** Supabase project's URL from Phase 3. **Not** `http://127.0.0.1:54321` or any value from local `.env`/`supabase/config.toml`.
- [ ] `npx wrangler secret put SUPABASE_KEY` — paste the production project's anon key from Phase 3.
- [ ] `npx wrangler secret list` — confirm both names are present (values aren't shown, safe to run/log).
- [ ] **Edge case — secret value mix-up:** because `.dev.vars` (local) and Worker secrets (production) use identical variable names, explicitly state which Supabase project dashboard each value came from while running these commands, and cross-check the project ref in the URL against the one noted in Phase 3.

---

## Phase 5 — First Manual Deploy & Verification

- [ ] `npm run deploy` (or `npm run build && npx wrangler deploy`).
- [ ] Confirm the deployed URL matches what was pre-configured in Supabase's Site URL/Redirect URLs (Phase 3). If it doesn't match exactly, fix the Supabase config immediately.
- [ ] In a separate terminal, run `npx wrangler tail` and watch it while exercising the app.
- [ ] **Manual verification** (per the confirmed decision — not the automated smoke script): visit the production URL, sign up with a real or throwaway email, confirm the email (or check Supabase's email-confirmation flow works as expected), sign in, load `/dashboard`, sign out, confirm `/dashboard` redirects to `/auth/signin` again.
- [ ] Confirm `wrangler tail` shows no `nodejs_compat`-related errors (`require is not a function`, dynamic `require("stream")`, etc.) during the exercised flow — see Edge Cases if one appears despite correct config.
- [ ] **Sign-off checkpoint:** don't proceed to Phase 6 (auto-deploy) until this manual deploy is confirmed working end-to-end.

---

## Phase 6 — Cloudflare Workers Builds (Auto-Deploy on Push)

Cloudflare's native Git integration, not a custom GitHub Actions job — this is the "reduce complexity" path: no `CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ACCOUNT_ID` secrets to manage in GitHub, no deploy YAML to maintain.

- [ ] In the Cloudflare dashboard: Compute → Workers & Pages → select the `planner` Worker → Settings → Builds → **Connect** a Git repository.
- [ ] Authorize the Cloudflare GitHub App for this repository (first-time-only OAuth/App-install prompt).
- [ ] Set the production branch to `master` (matches the existing `.github/workflows/ci.yml` trigger branch).
- [ ] Confirm build command (`npm run build` or the Astro-specific equivalent Cloudflare suggests) and deploy command (default `npx wrangler deploy` — correct as-is, no customization needed).
- [ ] Leave **Root directory** at the default (repo root — this isn't a monorepo).
- [ ] Note: Worker secrets set in Phase 4 (`SUPABASE_URL`/`SUPABASE_KEY`) persist across Workers-Builds-triggered deploys automatically — they're Worker-level state, not part of the build/deploy command, so no re-entry needed here.
- [ ] **Edge case — deploys not gated on existing checks:** Workers Builds triggers on every push to `master`, independent of the existing `ci`/`smoke` GitHub Actions jobs. To avoid auto-deploying a broken change, enable GitHub branch protection on `master` requiring the `ci` (and ideally `smoke`) status checks to pass before merge — this keeps the existing Actions checks as the real gate, with Workers Builds only ever seeing already-validated commits.
- [ ] First push-triggered deploy: merge a trivial change (or push directly if solo and no PR flow yet) to `master`, watch the build in the Cloudflare dashboard's Builds tab, confirm it succeeds and the live URL reflects the change.
- [ ] **Sign-off checkpoint:** watch this first automatic deploy end-to-end before trusting future pushes to auto-deploy unattended.

---

## Phase 7 — Verification Strategy Documentation

- [ ] Document in `CLAUDE.md` (or the final `deploy-plan.md`) that production auth-flow verification is **manual, per-deploy** (per the confirmed decision), not part of `npm run smoke` — and why: hosted Supabase requires email confirmation by default, unlike the local/CI Supabase instance, so the existing automated smoke script would fail past the sign-up step if pointed at production as-is.
- [ ] No code changes to `scripts/smoke.mjs` needed for this — it stays exactly as-is, used only against local/CI Supabase (as it already is in the `smoke` Actions job).

---

## Phase 8 — Documentation & Risk-Register Updates

- [ ] Update `context/foundation/infrastructure.md`'s risk register row for `supabase/supabase#37592`: note it is now **closed** (2025-09-04, closed for inactivity, no confirmed reproduction after the maintainer's `nodejs_compat` question) — downgrade from "open, unresolved" framing. Keep the mitigation guidance as-is (still correct defensive posture).
- [ ] Fix `context/foundation/tech-stack.md`'s stale frontmatter hint `deployment_target: cloudflare-pages` → `cloudflare-workers` (pre-existing inconsistency: `@astrojs/cloudflare` v14+ dropped Pages support; the repo has been Workers-only all along). Low-risk docs-only correction, done so it doesn't mislead a future agent into reaching for `wrangler pages deploy`.
- [ ] Add a one-line callout to `CLAUDE.md` (near the existing Cloudflare/deploy notes) stating Cloudflare Pages is unsupported by this adapter version — only `wrangler dev`/`wrangler deploy` (Workers) are canonical. This directly addresses a risk `infrastructure.md`'s own pre-mortem flagged (stale Pages-era tutorials/training data leading a future session astray).
- [ ] Write `context/deployment/deploy-plan.md` reflecting what actually happened: Worker name (`planner`), Supabase project used, Workers Builds connection confirmed, manual-verification decision — this becomes the ground truth for downstream milestone-planning skills.

---

## Out of Scope (deferred, not this pass)

- **Custom domain.** The `*.workers.dev` subdomain is sufficient for this MVP's single-gas-station internal use. If added later: update `wrangler.jsonc` routes or bind via dashboard, update Supabase's Site URL/Redirect URLs to match, and re-run the manual auth-flow check against the new domain — cookie `Domain` attribute behavior and Astro's Origin-header check (visible in `scripts/smoke.mjs`'s explicit `Origin` header) can behave differently on a custom domain vs. the `workers.dev` subdomain.
- **Automated production token-refresh smoke test.** `infrastructure.md`'s risk register suggests extending `npm run smoke` to cover a session living long enough to trigger a Supabase token refresh. Given the underlying GitHub issue is closed and this is a solo 3-week MVP, this is deferred in favor of watching `wrangler tail` in production; revisit only if a real token-refresh failure is observed.
- **`wrangler types` / Cloudflare binding type-safety.** Not needed yet — this app reads secrets via `astro:env/server`, not `context.locals.runtime.env`, so there's nothing to type against. Add `npx wrangler types` (generates `worker-configuration.d.ts`) only once a Cloudflare binding (KV/D1/R2/etc.) is actually introduced.

---

## Edge Cases & Extra Support Steps

1. **Worker name collision** — see Phase 2.
2. **`nodejs_compat` errors at runtime despite correct config.** `wrangler.jsonc` already has the flag and a valid `compatibility_date`. If `require is not a function` or similar still appears in `wrangler tail`: confirm the error's stack trace actually points to `@supabase/ssr` and not an unrelated dependency; note that `supabase/supabase#37592` (the closed issue) had the exact same symptom and its only suggested fix was the flag already in place here, so a persisting error is likely a *different* code path — isolate with `wrangler dev` (real `workerd`), not `astro dev`.
3. **Email-confirmation-required blocking production verification** — resolved via the Phase 7 decision (manual check only).
4. **CORS/Origin issues with a future custom domain** — see Out of Scope.
5. **`wrangler login` can't open a browser** (headless shell, e.g. an agent sandbox or remote session): skip `wrangler login`, set the `CLOUDFLARE_API_TOKEN` env var to the Phase 0 token instead — wrangler auto-detects it for `secret put`, `deploy`, `tail`, etc. without attempting browser OAuth.
6. **Rollback for a bad deploy.** `npx wrangler deployments list` → `npx wrangler rollback [deployment-id]` — single, deterministic, GA command. Also available from the Cloudflare dashboard's Deployments tab once Workers Builds (Phase 6) is connected. Note the last-known-good deployment ID after each verified deploy so rollback doesn't require guessing.
7. **Secret value confusion (local vs. production)** — see Phase 4.
8. **Stale "Cloudflare Pages" guidance.** If a future session reaches for `wrangler pages deploy`/`wrangler pages dev`: stop — this adapter dropped Pages support entirely; only `wrangler dev`/`wrangler deploy` are canonical. (Addressed proactively in Phase 8's `CLAUDE.md` callout.)
9. **Workers Builds deploying an unreviewed/broken push** — see Phase 6's branch-protection note.
10. **Workers Builds auto-generating a `wrangler.jsonc`.** If Cloudflare's import flow doesn't detect the existing valid `wrangler.jsonc` for some reason, it may offer to open a PR creating one — decline/close that PR if it appears, since a correct one (with the `planner` name from Phase 2) is already committed.

---

## Verification Checklist (end-to-end)

- [ ] `npm run build` succeeds locally.
- [ ] `npx wrangler deploy` succeeds; `wrangler tail` shows no runtime errors during a manual sign-up → sign-in → dashboard → sign-out pass against the production URL.
- [ ] Production Supabase project's Site URL/Redirect URLs match the deployed URL exactly.
- [ ] `npx wrangler secret list` shows `SUPABASE_URL` and `SUPABASE_KEY`.
- [ ] A push to `master` (after branch protection is set up) triggers a Workers Builds deploy visible in the Cloudflare dashboard, without requiring any local `wrangler deploy` command.
- [ ] `context/deployment/deploy-plan.md` exists and reflects the actual Worker name, Supabase project, and decisions made.

## Critical Files

- `E:\10xdevs\Planner\wrangler.jsonc` — Worker name, compatibility settings (Phase 2)
- `E:\10xdevs\Planner\package.json` — `deploy` script (Phase 2)
- `E:\10xdevs\Planner\.gitignore` — pre-commit sanity check (Phase 1)
- `E:\10xdevs\Planner\.github\workflows\ci.yml` — stays as pre-merge gate only, no deploy job added (Phase 6 context)
- `E:\10xdevs\Planner\scripts\smoke.mjs` — unchanged (Phase 7)
- `E:\10xdevs\Planner\context\foundation\infrastructure.md` — risk register update (Phase 8)
- `E:\10xdevs\Planner\context\foundation\tech-stack.md` — stale hint fix (Phase 8)
- `E:\10xdevs\Planner\CLAUDE.md` — Pages-vs-Workers callout (Phase 8)
- `E:\10xdevs\Planner\context\deployment\deploy-plan.md` — new file, final output (Phase 8)
