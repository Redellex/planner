import { describe, expect, it } from "vitest";

import {
  buildPublishedSchedule,
  calendarAssigneeKey,
  OWN_ASSIGNEE_KEY,
  publishedScheduleUrl,
  type PublishedScheduleRow,
} from "./published-schedule";

const PUBLISHED_AT = "2026-10-07T10:00:00+00:00";

const own: PublishedScheduleRow = {
  id: "00000000-0000-4000-8000-00000000f001",
  starts_at: "2026-11-01T06:00:00",
  ends_at: "2026-11-01T18:00:00",
  assignee_name: "Ewa",
  is_own: true,
  published_at: PUBLISHED_AT,
};
const colleague: PublishedScheduleRow = {
  id: "00000000-0000-4000-8000-00000000f002",
  starts_at: "2026-11-01T18:00:00",
  ends_at: "2026-11-02T06:00:00",
  assignee_name: "Tomasz K.",
  is_own: false,
  published_at: PUBLISHED_AT,
};
const uncovered: PublishedScheduleRow = {
  id: "00000000-0000-4000-8000-00000000f003",
  starts_at: "2026-11-02T06:00:00",
  ends_at: "2026-11-02T18:00:00",
  assignee_name: null,
  is_own: false,
  published_at: PUBLISHED_AT,
};

describe("a /schedule read becomes a state the page renders honestly", () => {
  it("is unknown on an error, even with rows", () => {
    expect(buildPublishedSchedule({ data: null, error: { code: "42501" } })).toEqual({ kind: "unknown" });
    expect(buildPublishedSchedule({ data: [own], error: { code: "500" } })).toEqual({ kind: "unknown" });
  });
  it("is unknown without data", () => {
    expect(buildPublishedSchedule({ data: null, error: null })).toEqual({ kind: "unknown" });
  });
  it("is not published when the function returns no rows", () => {
    expect(buildPublishedSchedule({ data: [], error: null })).toEqual({ kind: "notPublished" });
  });
  it("is published with every shift, uncovered ones included, and the publish time", () => {
    expect(buildPublishedSchedule({ data: [own, colleague, uncovered], error: null })).toEqual({
      kind: "published",
      publishedAt: PUBLISHED_AT,
      shifts: [own, colleague, uncovered].map(({ id, starts_at, ends_at, assignee_name, is_own }) => ({
        id,
        starts_at,
        ends_at,
        assignee_name,
        is_own,
      })),
    });
  });
  it("is unknown when an own shift has no name", () => {
    expect(buildPublishedSchedule({ data: [{ ...own, assignee_name: null }, uncovered], error: null })).toEqual({
      kind: "unknown",
    });
  });
});

describe("calendarAssigneeKey keys calendar cells without profile ids", () => {
  it("gives every own shift the same key", () => {
    expect(calendarAssigneeKey(own)).toBe(OWN_ASSIGNEE_KEY);
    expect(calendarAssigneeKey({ ...own, id: "00000000-0000-4000-8000-00000000f009" })).toBe(OWN_ASSIGNEE_KEY);
  });
  it("keys a colleague's shift by the shift id", () => {
    expect(calendarAssigneeKey(colleague)).toBe(`shift:${colleague.id}`);
  });
  it("keys an uncovered shift as null, the calendar's Uncovered", () => {
    expect(calendarAssigneeKey(uncovered)).toBeNull();
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
