// Runs on `git commit` via .husky/pre-commit; lint-staged stashes unstaged changes, so every task sees the staged content only.
/** @type {import("lint-staged").Configuration} */
export default {
  // `vitest related` runs only the tests whose import graph reaches a staged file (a staged test file runs itself) and passes when none do.
  "*.{ts,tsx,astro}": ["eslint --fix", "vitest related --run"],
  "*.{astro,tsx}": "node scripts/check-ui-literals.mjs",
  "*.{json,css,md}": "prettier --write",
  // station-time-zone.test.ts reads these from disk, so `vitest related` never links them to it; functions drop the file arguments.
  "{supabase/migrations/*.sql,supabase/seed.sql,scripts/smoke.mjs,scripts/seed-demo-team.mjs}": () =>
    "vitest run src/lib/station-time-zone.test.ts",
  // route-inventory.test.ts and navigation.test.ts read src/pages from disk, so a new or moved page or endpoint must run them explicitly.
  "src/pages/**/*.{astro,ts,js,mjs,md,mdx,html}": () =>
    "vitest run src/lib/route-inventory.test.ts src/lib/navigation.test.ts",
  // Test config and dependency changes can break any test.
  "{vitest.config.ts,package.json,package-lock.json}": () => "vitest run",
};
