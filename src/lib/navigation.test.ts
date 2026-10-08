import { describe, expect, it } from "vitest";

import { NAV_LINKS, isCurrentNavLink, navBrandHref, navLinksFor } from "./navigation";
import { pageFiles, routeOf } from "./page-routes";
import type { AppRole } from "./roles";

// Roadmap S-07: the navigation must never offer a link the gate refuses, and a permitted page must not go without a
// link. Expected link sets are literals, never derived from the route lists or from NAV_LINKS. The coverage test reads
// src/pages from disk, so lint-staged runs it for staged pages (`vitest related` cannot link them).

const actors = {
  anonymous: { signedIn: false, role: null },
  employee: { signedIn: true, role: "employee" },
  manager: { signedIn: true, role: "manager" },
  // Signed in, but the profile row is missing, unreadable or holds an unknown role.
  noRole: { signedIn: true, role: null },
} satisfies Record<string, { signedIn: boolean; role: AppRole | null }>;

const SIGNED_IN_LINKS: [href: string, label: string][] = [
  ["/", "Home"],
  ["/availability", "Availability"],
  ["/schedule", "Schedule"],
  ["/account", "Account"],
];

const EXPECTED_LINKS: Record<keyof typeof actors, [href: string, label: string][]> = {
  anonymous: [
    ["/auth/signin", "Sign in"],
    ["/auth/signup", "Sign up"],
  ],
  employee: SIGNED_IN_LINKS,
  manager: [
    ...SIGNED_IN_LINKS,
    ["/manager/users", "Users"],
    ["/manager/months", "Months"],
    ["/manager/availability", "Team availability"],
    ["/manager/schedule", "Manage schedule"],
  ],
  noRole: SIGNED_IN_LINKS,
};

// Pages with no navigation link on purpose. Anything else under src/pages (outside /api/ and /dev/) needs a NAV_LINKS
// entry.
const NAV_EXCLUDED: Record<string, string> = {
  "/dashboard": "answers only a 301 to /",
  "/auth/confirm-email": "the landing page after sign-up, reached only from that redirect",
  "/403": "the page the middleware rewrites a refused manager path to",
};

describe("each actor gets exactly the links its role opens, in order", () => {
  it.each(Object.keys(actors) as (keyof typeof actors)[])("%s", (name) => {
    expect(navLinksFor(actors[name]).map((link) => [link.href, link.label])).toEqual(EXPECTED_LINKS[name]);
  });
});

describe("navigation covers every page", () => {
  const routes = pageFiles.map(routeOf).filter((route) => !route.startsWith("/api/") && !route.startsWith("/dev/"));
  const linked = new Set(NAV_LINKS.map((link) => link.href));

  it("finds pages to check", () => {
    expect(routes.length).toBeGreaterThan(0);
  });

  it.each(routes)("%s has a link or an explicit exclusion", (route) => {
    expect(
      linked.has(route) || route in NAV_EXCLUDED,
      `${route} needs a NAV_LINKS entry in src/lib/navigation.ts or a NAV_EXCLUDED row here`,
    ).toBe(true);
  });

  it("links and excludes only existing pages", () => {
    const existing = new Set(routes);
    expect([...linked, ...Object.keys(NAV_EXCLUDED)].filter((route) => !existing.has(route))).toEqual([]);
  });

  it("never both links and excludes a page", () => {
    expect(Object.keys(NAV_EXCLUDED).filter((route) => linked.has(route))).toEqual([]);
  });
});

describe("the current link is an exact match", () => {
  it.each([
    ["/account", "/account", true],
    ["/account/", "/account", true],
    ["/", "/", true],
    ["/account", "/", false],
    ["/manager/users", "/manager", false],
    ["/manager", "/manager/users", false],
    ["/accounts", "/account", false],
    ["/manager/users", "/manager/users", true],
  ])("%s marks %s: %s", (pathname, href, expected) => {
    expect(isCurrentNavLink(pathname, href)).toBe(expected);
  });
});

describe("the brand leads home only when signed in", () => {
  it.each([
    [true, "/"],
    [false, "/auth/signin"],
  ])("signed in %s → %s", (signedIn, expected) => {
    expect(navBrandHref(signedIn)).toBe(expected);
  });
});
