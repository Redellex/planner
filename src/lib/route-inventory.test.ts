import { readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import type { AppRole } from "./roles";
import { routeAccess } from "./route-access";

// Test plan risk #4, "the page is gated, so the endpoint is gated": every file under src/pages must have an explicit
// expected access here, and that access must agree with routeAccess. A new page or endpoint without a row fails, and
// so does one placed outside the gated prefixes (e.g. a manager action under /api/team/). This test reads src/pages
// from disk, so `vitest related` never links a page to it; lint-staged runs it for staged pages instead.

type AccessClass = "public" | "signed-in" | "manager";

const EXPECTED_ACCESS: Record<string, AccessClass> = {
  "/": "public",
  "/403": "public",
  "/auth/signin": "public",
  "/auth/signup": "public",
  "/auth/confirm-email": "public",
  "/api/auth/signin": "public",
  "/api/auth/signup": "public",
  "/api/auth/signout": "public",
  // Dev-only kitchen sinks: public routes that answer 404 themselves outside `astro dev`.
  "/dev/availability-states": "public",
  "/dev/manager-users-states": "public",
  "/dashboard": "signed-in",
  "/availability": "signed-in",
  "/api/availability/create": "signed-in",
  "/api/availability/update": "signed-in",
  "/api/availability/delete": "signed-in",
  "/manager/users": "manager",
  "/manager/months": "manager",
  "/manager/availability": "manager",
  "/api/manager/months/lock": "manager",
  "/api/manager/users/role": "manager",
};

const OUTCOMES: Record<AccessClass, [anonymous: string, employee: string, manager: string]> = {
  public: ["allow", "allow", "allow"],
  "signed-in": ["signin", "allow", "allow"],
  manager: ["signin", "forbidden", "allow"],
};

const actors: { signedIn: boolean; role: AppRole | null }[] = [
  { signedIn: false, role: null },
  { signedIn: true, role: "employee" },
  { signedIn: true, role: "manager" },
];

const pagesDir = path.resolve(import.meta.dirname, "../pages");
const pageFiles = readdirSync(pagesDir, { recursive: true, encoding: "utf8" })
  .map((file) => file.split(path.sep).join("/"))
  .filter((file) => /\.(astro|ts)$/.test(file))
  .sort();

function routeOf(file: string): string {
  const route = `/${file.replace(/\.(astro|ts)$/, "")}`.replace(/\/index$/, "");
  return route === "" ? "/" : route;
}

describe("every page and endpoint under src/pages has an explicit expected access", () => {
  it("finds the pages directory", () => {
    expect(pageFiles.length).toBeGreaterThan(0);
  });

  it("has no dynamic routes without a sample path", () => {
    // A [param] file needs a concrete sample path in EXPECTED_ACCESS; extend routeOf when the first one appears.
    expect(pageFiles.filter((file) => file.includes("["))).toEqual([]);
  });

  it("lists every route, and only existing routes", () => {
    expect(pageFiles.map(routeOf).sort()).toEqual(Object.keys(EXPECTED_ACCESS).sort());
  });

  it.each(pageFiles.map((file) => [file, routeOf(file)]))("%s (%s) gets its expected access", (_file, route) => {
    const expected = EXPECTED_ACCESS[route];
    expect(expected, `no EXPECTED_ACCESS row for ${route}`).toBeDefined();
    expect(actors.map((actor) => routeAccess(route, actor))).toEqual(OUTCOMES[expected]);
  });
});
