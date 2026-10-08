import { describe, expect, it } from "vitest";

import { APP_ROLES, roleLabel } from "./roles";

describe("roleLabel names each role for the dashboard pill", () => {
  it("labels a manager", () => {
    expect(roleLabel("manager")).toBe("Manager");
  });
  it("labels an employee", () => {
    expect(roleLabel("employee")).toBe("Employee");
  });
  it("has a label for every role", () => {
    for (const role of APP_ROLES) {
      expect(roleLabel(role)).not.toBe("");
    }
  });
});
