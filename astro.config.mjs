// @ts-check
import { defineConfig, envField } from "astro/config";

import react from "@astrojs/react";
import sitemap from "@astrojs/sitemap";
import tailwindcss from "@tailwindcss/vite";
import cloudflare from "@astrojs/cloudflare";

// https://astro.build/config
export default defineConfig({
  output: "server",
  integrations: [react(), sitemap()],
  vite: {
    plugins: [tailwindcss()],
    environments: {
      ssr: {
        // The passthrough image service loads this at the first request; the
        // adapter does not pre-bundle it, so Vite re-optimizes mid-request and
        // workerd crashes on a deleted deps_ssr chunk ("The file does not exist").
        optimizeDeps: { include: ["astro/assets/services/noop"] },
      },
    },
  },
  adapter: cloudflare({ imageService: "passthrough" }),
  session: false,
  env: {
    schema: {
      SUPABASE_URL: envField.string({ context: "server", access: "secret", optional: true }),
      SUPABASE_KEY: envField.string({ context: "server", access: "secret", optional: true }),
    },
  },
});
