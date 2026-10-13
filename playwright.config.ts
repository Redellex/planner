import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

// Local-only E2E env (gitignored): local Supabase URL/key for the app build, plus E2E_USERNAME / E2E_PASSWORD.
// `.env` and `.dev.vars` may point at the hosted project, so E2E never reads them: the build below runs with
// CLOUDFLARE_ENV=e2e, which makes the Cloudflare plugin take the Worker's secrets from `.dev.vars.e2e` instead.
const E2E_ENV_FILE = ".dev.vars.e2e";
if (existsSync(E2E_ENV_FILE)) process.loadEnvFile(E2E_ENV_FILE);

// E2E signs in and writes data: refuse to run against anything but the local Supabase stack.
const supabaseHost = URL.canParse(process.env.SUPABASE_URL ?? "")
  ? new URL(process.env.SUPABASE_URL ?? "").hostname
  : "";
if (supabaseHost !== "127.0.0.1" && supabaseHost !== "localhost") {
  throw new Error(
    `SUPABASE_URL must point at the local stack (see ${E2E_ENV_FILE}, context/foundation/test-stack.md ## E2E)`,
  );
}

// 4321 is Astro's default preview port (astro.config.mjs sets none, package.json `preview` passes none).
// E2E_PORT overrides it when that port is taken on this machine.
const PORT = Number(process.env.E2E_PORT ?? 4321);
const baseURL = `http://localhost:${PORT}`;

// CLOUDFLARE_ENV=e2e for the build only: it makes the Cloudflare plugin copy `.dev.vars.e2e` into dist/server/.dev.vars
// and resolve the `e2e` environment of wrangler.jsonc into dist/server/wrangler.json, which has no `env` section, so the
// preview must not see the variable ("No environment found … e2e"). webServer runs through cmd.exe on Windows, sh
// elsewhere: cmd's `set` lasts for the whole line, so it is cleared again before the preview.
const buildAndPreview =
  process.platform === "win32"
    ? "set CLOUDFLARE_ENV=e2e&& npm run build && set CLOUDFLARE_ENV=&& npm run preview"
    : "CLOUDFLARE_ENV=e2e npm run build && npm run preview";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  // "never": the default opens a report server on failure and blocks the run until it is closed.
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "setup", testMatch: /.*\.setup\.ts/ },
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], storageState: "playwright/.auth/user.json" },
      dependencies: ["setup"],
    },
  ],
  webServer: {
    // Production-like build + preview (the Cloudflare workerd runtime), on the port above.
    command: `${buildAndPreview} -- --port ${PORT}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      // Astro 7 moves `astro preview` into a background daemon when it detects an agent; keep it in the foreground.
      ASTRO_PREVIEW_BACKGROUND: "1",
    },
  },
});
