import { describe, expect, it } from "vitest";

// The Worker runs in UTC; date tests prove nothing about it unless the runner does too.
describe("test runtime", () => {
  it("runs in the UTC time zone", () => {
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe("UTC");
  });

  it("has no UTC offset in summer, where Europe/Warsaw would be -120", () => {
    expect(new Date(2026, 6, 1).getTimezoneOffset()).toBe(0);
  });
});
