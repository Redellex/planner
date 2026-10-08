import type { AppRole } from "./roles";
import { routeAccess } from "./route-access";

// The pages the top navigation can link to, with their labels, in display order. This list only names and orders
// pages: routeAccess (the decision src/middleware.ts applies) decides which of them a viewer sees, so the nav can never
// offer a link the gate refuses. src/lib/navigation.test.ts fails when a page under src/pages has neither an entry here
// nor an explicit exclusion.
export const NAV_LINKS: readonly { href: string; label: string }[] = [
  { href: "/", label: "Home" },
  { href: "/availability", label: "Availability" },
  { href: "/schedule", label: "Schedule" },
  { href: "/account", label: "Account" },
  { href: "/manager/users", label: "Users" },
  { href: "/manager/months", label: "Months" },
  { href: "/manager/availability", label: "Team availability" },
  { href: "/manager/schedule", label: "Manage schedule" },
  { href: "/auth/signin", label: "Sign in" },
  { href: "/auth/signup", label: "Sign up" },
];

/** The links this viewer may open, in display order. `signedIn` must be computed as the middleware does. */
export function navLinksFor(actor: { signedIn: boolean; role: AppRole | null }): { href: string; label: string }[] {
  return NAV_LINKS.filter((link) => routeAccess(link.href, actor) === "allow");
}

/** Exact match after dropping a trailing slash, so `/` never marks `/account` and `/manager` never marks its children. */
export function isCurrentNavLink(pathname: string, href: string): boolean {
  const normalised = pathname.length > 1 ? pathname.replace(/\/+$/, "") || "/" : pathname;
  return normalised === href;
}

/** Where the "Planner" brand leads: home when signed in, sign-in otherwise (anonymous `/` would redirect there). */
export function navBrandHref(signedIn: boolean): string {
  return signedIn ? "/" : "/auth/signin";
}
