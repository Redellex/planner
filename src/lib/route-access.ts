import { isAppRole, type AppRole } from "./roles";

// The only place that knows which paths are gated. src/middleware.ts resolves the user and role and maps the
// decision onto redirect/rewrite/next; src/lib/route-inventory.test.ts checks every file under src/pages against it.
// "/" (the dashboard) matches only itself: matchesRoute's prefix for it is "//", which no normalised pathname has.
export const PROTECTED_ROUTES: readonly string[] = [
  "/",
  "/dashboard",
  "/availability",
  "/api/availability",
  "/account",
  "/api/account",
  "/schedule",
];
export const MANAGER_ROUTES: readonly string[] = ["/manager", "/api/manager"];
// Pages a signed-in user has no use for, so they are sent home. Exact pages, not the /auth prefix: a future /auth page
// a signed-in user must reach (e.g. a password-reset callback) must not become guest-only by accident. /api/auth/*
// stays open to everyone.
export const GUEST_ROUTES: readonly string[] = ["/auth/signin", "/auth/signup", "/auth/confirm-email"];

export type RouteAccess = "allow" | "signin" | "forbidden" | "home";

/** Prefix match on segment boundaries: `/manager` and `/manager/users` match `/manager`, `/managerX` does not. */
export function matchesRoute(pathname: string, routes: readonly string[]): boolean {
  return routes.some((route) => pathname === route || pathname.startsWith(`${route}/`));
}

/**
 * The route × role decision. `pathname` is already normalised by Astro (percent-decoded, duplicate slashes
 * collapsed). Guest pages send any signed-in user home (`home`, with or without a role); protected paths need a
 * signed-in user; manager paths also need the manager role.
 */
export function routeAccess(pathname: string, actor: { signedIn: boolean; role: AppRole | null }): RouteAccess {
  if (matchesRoute(pathname, GUEST_ROUTES) && actor.signedIn) {
    return "home";
  }
  if (matchesRoute(pathname, PROTECTED_ROUTES) && !actor.signedIn) {
    return "signin";
  }
  if (matchesRoute(pathname, MANAGER_ROUTES)) {
    if (!actor.signedIn) {
      return "signin";
    }
    if (actor.role !== "manager") {
      return "forbidden";
    }
  }
  return "allow";
}

/** Fail closed: a read error, a missing profile row or an unknown role value all resolve to no role. */
export function roleFromProfile(result: { data: { role: unknown } | null; error: unknown }): AppRole | null {
  const role = result.data?.role;
  return !result.error && isAppRole(role) ? role : null;
}
