# Test stack

## E2E

<!-- Written by /10x-e2e-setup. Re-run it to change this section; other skills only read it. -->

- runner: Playwright Test, @playwright/test 1.64.0
- config: playwright.config.ts
- single-spec command: npx playwright test tests/e2e/<name>.spec.ts
- full-suite command: npx playwright test
- base URL: http://localhost:4321
- port: 4321 (detected from Astro's default preview port; astro.config.mjs and the `preview` script set none; detected default 4321, override with E2E_PORT)
- web server command: npm run build && npm run preview -- --port $E2E_PORT, with CLOUDFLARE_ENV=e2e (the build takes the Worker's Supabase secrets from the local-only .dev.vars.e2e, never the hosted .dev.vars) and ASTRO_PREVIEW_BACKGROUND=1 (keeps Astro 7's preview in the foreground); reuseExistingServer outside CI. The config refuses to run unless SUPABASE_URL is 127.0.0.1/localhost; needs the local stack (`npx supabase start`)
- auth setup project: setup (tests/e2e/auth.setup.ts), credentials from E2E_USERNAME / E2E_PASSWORD in .dev.vars.e2e (gitignored; the seeded local employee from supabase/seed.sql)
- storageState: playwright/.auth/user.json (gitignored)
- seed: tests/e2e/seed.spec.ts — protects #4 role and route control (anonymous `/` → sign-in → dashboard; an employee gets 403 "Access denied" on /manager/schedule with no manager links) and #3 the open-month availability path (a window added in station month + 2 persists on a fresh load, then is deleted)
- browser CLI: playwright-cli, command skill at .claude/skills/playwright-cli/SKILL.md; use a named session (`-s=planner`)
- updated: 2026-10-13
