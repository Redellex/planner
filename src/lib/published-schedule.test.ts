import { describe, expect, it } from "vitest";

import { buildPublishedSchedule, publishedScheduleUrl, type PublishedScheduleRow } from "./published-schedule";

const PUBLISHED_AT = "2026-10-07T10:00:00+00:00";

const assigned: PublishedScheduleRow = {
  id: "00000000-0000-4000-8000-00000000f001",
  starts_at: "2026-11-01T06:00:00",
  ends_at: "2026-11-01T18:00:00",
  employee_id: "00000000-0000-4000-8000-00000000000a",
  assignee_name: "Ewa",
  published_at: PUBLISHED_AT,
};
const uncovered: PublishedScheduleRow = {
  id: "00000000-0000-4000-8000-00000000f002",
  starts_at: "2026-11-01T18:00:00",
  ends_at: "2026-11-02T06:00:00",
  employee_id: null,
  assignee_name: null,
  published_at: PUBLISHED_AT,
};

describe("a /schedule read becomes a state the page renders honestly", () => {
  it("is unknown on an error, even with rows", () => {
    expect(buildPublishedSchedule({ data: null, error: { code: "42501" } })).toEqual({ kind: "unknown" });
    expect(buildPublishedSchedule({ data: [assigned], error: { code: "500" } })).toEqual({ kind: "unknown" });
  });
  it("is unknown without data", () => {
    expect(buildPublishedSchedule({ data: null, error: null })).toEqual({ kind: "unknown" });
  });
  it("is not published when the function returns no rows", () => {
    expect(buildPublishedSchedule({ data: [], error: null })).toEqual({ kind: "notPublished" });
  });
  it("is published with every shift, uncovered ones included, and the publish time", () => {
    expect(buildPublishedSchedule({ data: [assigned, uncovered], error: null })).toEqual({
      kind: "published",
      publishedAt: PUBLISHED_AT,
      shifts: [
        {
          id: assigned.id,
          starts_at: assigned.starts_at,
          ends_at: assigned.ends_at,
          employee_id: assigned.employee_id,
          assignee_name: "Ewa",
        },
        {
          id: uncovered.id,
          starts_at: uncovered.starts_at,
          ends_at: uncovered.ends_at,
          employee_id: null,
          assignee_name: null,
        },
      ],
    });
  });
  it("is unknown when an assigned shift has no name", () => {
    expect(buildPublishedSchedule({ data: [{ ...assigned, assignee_name: null }, uncovered], error: null })).toEqual({
      kind: "unknown",
    });
  });
});

describe("publishedScheduleUrl", () => {
  it("links a month", () => {
    expect(publishedScheduleUrl({ month: "2026-11" })).toBe("/schedule?month=2026-11");
  });
  it("links a month and a day, in that order", () => {
    expect(publishedScheduleUrl({ month: "2026-11", day: "2026-11-05" })).toBe(
      "/schedule?month=2026-11&day=2026-11-05",
    );
  });
  it("leaves out an empty day", () => {
    expect(publishedScheduleUrl({ month: "2026-11", day: null })).toBe("/schedule?month=2026-11");
  });
});
