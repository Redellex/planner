// Worker entry (wrangler.jsonc `main`): Astro's Cloudflare handler wrapped by Sentry. With no SENTRY_DSN (local
// dev, CI, E2E) the SDK stays disabled and sends nothing.
import * as Sentry from "@sentry/cloudflare";
import handler from "@astrojs/cloudflare/entrypoints/server";

interface SentryEnv {
  SENTRY_DSN?: string;
  SENTRY_ENVIRONMENT?: string;
}

export default Sentry.withSentry(
  (env: SentryEnv) => ({
    dsn: env.SENTRY_DSN,
    enabled: Boolean(env.SENTRY_DSN),
    environment: env.SENTRY_ENVIRONMENT ?? "production",
    // The SDK collects everything by default. Keep out the user, the Supabase session cookies, form bodies (passwords)
    // and local variables; keep the user agent and the query string minus auth codes.
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: { request: { allow: ["user-agent", "referer"] }, response: false },
      httpBodies: [],
      urlQueryParams: { deny: ["code", "token", "token_hash"] },
      databaseQueryData: false,
      stackFrameVariables: false,
    },
    // Errors only for now; tracing adds CPU on Workers Free.
    tracesSampleRate: 0,
    // Database and auth failures are logged with console.error and turned into redirects, never thrown, so this
    // is how they reach Sentry.
    integrations: [Sentry.captureConsoleIntegration({ levels: ["error"] })],
  }),
  handler,
);
