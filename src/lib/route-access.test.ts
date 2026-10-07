import { describe, expect, it } from "vitest";

import type { AppRole } from "./roles";
import { roleFromProfile, routeAccess } from "./route-access";

// Test plan risk #4: role and route control regresses after a middleware or role change. Expected outcomes are
// literals, never derived from the route lists.

const actors = {
  anonymous: { signedIn: false, role: null },
  employee: { signedIn: true, role: "employee" },
  manager: { signedIn: true, role: "manager" },
  // Signed in, but the profile row is missing, unreadable or holds an unknown role.
  noRole: { signedIn: true, role: null },
} satisfies Record<string, { signedIn: boolean; role: AppRole | null }>;

type Outcomes = [anonymous: string, employee: string, manager: string, noRole: string];

const PUBLIC: Outcomes = ["allow", "allow", "allow", "allow"];
const SIGNED_IN: Outcomes = ["signin", "allow", "allow", "allow"];
const MANAGER: Outcomes = ["signin", "forbidden", "allow", "forbidden"];

function outcomesFor(pathname: string): Outcomes {
  return [
    routeAccess(pathname, actors.anonymous),
    routeAccess(pathname, actors.employee),
    routeAccess(pathname, actors.manager),
    routeAccess(pathname, actors.noRole),
  ];
}

describe("manager pages and the endpoints behind them are gated alike", () => {
  it.each([
    ["/manager/users", MANAGER],
    ["/manager/months", MANAGER],
    ["/manager/availability", MANAGER],
    ["/manager/schedule", MANAGER],
    ["/api/manager/months/lock", MANAGER],
    ["/api/manager/users/role", MANAGER],
  ])("%s", (pathname, expected) => {
    expect(outcomesFor(pathname)).toEqual(expected);
  });
});

describe("signed-in pages and their endpoints send anonymous users to sign-in", () => {
  it.each([
    ["/dashboard", SIGNED_IN],
    ["/availability", SIGNED_IN],
    ["/api/availability/create", SIGNED_IN],
    ["/api/availability/update", SIGNED_IN],
    ["/api/availability/delete", SIGNED_IN],
    ["/account", SIGNED_IN],
    ["/api/account/display-name", SIGNED_IN],
    ["/schedule", SIGNED_IN],
  ])("%s", (pathname, expected) => {
    expect(outcomesFor(pathname)).toEqual(expected);
  });
});

describe("public pages stay open to everyone", () => {
  it.each([
    ["/", PUBLIC],
    ["/403", PUBLIC],
    ["/auth/signin", PUBLIC],
    ["/api/auth/signin", PUBLIC],
  ])("%s", (pathname, expected) => {
    expect(outcomesFor(pathname)).toEqual(expected);
  });
});

describe("gates match on segment boundaries, not on string prefixes", () => {
  it.each([
    ["/manager", MANAGER],
    ["/api/manager", MANAGER],
    ["/manager/", MANAGER],
    ["/api/manager/months/lock/extra", MANAGER],
    ["/dashboard/", SIGNED_IN],
    ["/managerX", PUBLIC],
    ["/api/managerial", PUBLIC],
    ["/dashboardX", PUBLIC],
    ["/availability-old", PUBLIC],
    ["/api/availabilityX/create", PUBLIC],
    ["/accounts", PUBLIC],
    ["/api/accounts/display-name", PUBLIC],
    ["/schedules", PUBLIC],
    ["/schedule/", SIGNED_IN],
  ])("%s", (pathname, expected) => {
    expect(outcomesFor(pathname)).toEqual(expected);
  });
});

describe("role resolution fails closed", () => {
  it.each([
    ["a manager row", { data: { role: "manager" }, error: null }, "manager"],
    ["an employee row", { data: { role: "employee" }, error: null }, "employee"],
    ["a manager row returned with an error", { data: { role: "manager" }, error: { message: "boom" } }, null],
    ["a read error with no row", { data: null, error: { message: "boom" } }, null],
    ["a missing profile row", { data: null, error: null }, null],
    ["an unknown role", { data: { role: "admin" }, error: null }, null],
    ["a mis-cased role", { data: { role: "Manager" }, error: null }, null],
    ["a non-string role", { data: { role: 1 }, error: null }, null],
  ])("%s", (_name, result, expected) => {
    expect(roleFromProfile(result)).toBe(expected);
  });
});
