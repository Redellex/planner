import { describe, expect, it } from "vitest";

import { calendarName } from "./manager-users";

describe("calendar cells name a person by the start of their email", () => {
  it("cuts the email at the @", () => {
    expect(calendarName({ id: "a", email: "demo-full-a@example.com" })).toBe("demo-full-a");
  });
  it("keeps an email with no @ or a leading @ whole", () => {
    expect(calendarName({ id: "a", email: "alice" })).toBe("alice");
    expect(calendarName({ id: "a", email: "@example.com" })).toBe("@example.com");
  });
  it("falls back to the id's first 8 characters without an email", () => {
    expect(calendarName({ id: "3f2a9c1b-0000-4000-8000-00000000d004", email: "" })).toBe("3f2a9c1b");
  });
});
