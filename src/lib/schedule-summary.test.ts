import { describe, expect, it } from "vitest";

import type { GeneratedShift, ScheduleWindow } from "./schedule-generator";
import { summarizeSchedule } from "./schedule-summary";

// summarizeSchedule recounts a draft from its shifts and the raw windows, so S-04 can trust it for overrides. The
// drafts below are injected by hand (not generated), and every expected value is counted from them by the rule:
// a 12h or night shift breaks the rule when its assignee's count is more than 1 above the lowest count among the
// members whose availability contains it.

const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";
const MONTH = "2026-11";

function window(employee_id: string, starts_at: string, ends_at: string): ScheduleWindow {
  return { employee_id, starts_at, ends_at };
}

function shift(starts_at: string, ends_at: string, employee_id: string | null): GeneratedShift {
  return { starts_at, ends_at, employee_id };
}

function summarize(windows: ScheduleWindow[], shifts: GeneratedShift[]) {
  return summarizeSchedule({ month: MONTH, members: [{ id: A }, { id: B }], windows, shifts });
}

describe("an assignment outside the assignee's availability is reported", () => {
  it("lists the injected 18–06 that A has no window for, and not A's covered 06–18", () => {
    const outside = shift("2026-11-10T18:00:00", "2026-11-11T06:00:00", A);
    const summary = summarize(
      [window(A, "2026-11-10T06:00:00", "2026-11-10T18:00:00")],
      [shift("2026-11-10T06:00:00", "2026-11-10T18:00:00", A), outside],
    );
    expect(summary.outsideAvailability).toEqual([outside]);
  });

  it("accepts a shift inside two touching windows (merged availability)", () => {
    const summary = summarize(
      [
        window(A, "2026-11-10T18:00:00", "2026-11-11T00:00:00"),
        window(A, "2026-11-11T00:00:00", "2026-11-11T06:00:00"),
      ],
      [shift("2026-11-10T18:00:00", "2026-11-11T06:00:00", A)],
    );
    expect(summary.outsideAvailability).toEqual([]);
  });
});

describe("12h and night rule breaks are reported, never hidden", () => {
  const dayWindows = (employee: string) =>
    ["10", "11"].map((day) => window(employee, `2026-11-${day}T06:00:00`, `2026-11-${day}T18:00:00`));

  it("reports both of A's 12h days when B was available for them and has none (2 > 0 + 1)", () => {
    const first = shift("2026-11-10T06:00:00", "2026-11-10T18:00:00", A);
    const second = shift("2026-11-11T06:00:00", "2026-11-11T18:00:00", A);
    const summary = summarize([...dayWindows(A), ...dayWindows(B)], [first, second]);
    expect(summary.ruleBreaks).toEqual([
      { kind: "long", shift: first, assignee: A, eligibleMin: 0 },
      { kind: "long", shift: second, assignee: A, eligibleMin: 0 },
    ]);
  });

  it("reports nothing when A and B have one 12h day each", () => {
    const summary = summarize(
      [...dayWindows(A), ...dayWindows(B)],
      [shift("2026-11-10T06:00:00", "2026-11-10T18:00:00", A), shift("2026-11-11T06:00:00", "2026-11-11T18:00:00", B)],
    );
    expect(summary.ruleBreaks).toEqual([]);
  });

  it("reports nothing when B was not available for A's 12h days", () => {
    const summary = summarize(dayWindows(A), [
      shift("2026-11-10T06:00:00", "2026-11-10T18:00:00", A),
      shift("2026-11-11T06:00:00", "2026-11-11T18:00:00", A),
    ]);
    expect(summary.ruleBreaks).toEqual([]);
  });

  it("reports A's 8h nights against B's 0 nights as night breaks only", () => {
    const nights = ["10", "11"].map((day) =>
      window(A, `2026-11-${day}T22:00:00`, `2026-11-${Number(day) + 1}T06:00:00`),
    );
    const bNights = ["10", "11"].map((day) =>
      window(B, `2026-11-${day}T22:00:00`, `2026-11-${Number(day) + 1}T06:00:00`),
    );
    const first = shift("2026-11-10T22:00:00", "2026-11-11T06:00:00", A);
    const second = shift("2026-11-11T22:00:00", "2026-11-12T06:00:00", A);
    const summary = summarize([...nights, ...bNights], [first, second]);
    expect(summary.ruleBreaks).toEqual([
      { kind: "night", shift: first, assignee: A, eligibleMin: 0 },
      { kind: "night", shift: second, assignee: A, eligibleMin: 0 },
    ]);
  });
});

describe("counts, uncovered shifts and days with no one come from the draft itself", () => {
  it("counts per member, lists uncovered shifts and every station day without an assigned shift", () => {
    const uncoveredNight = shift("2026-11-10T18:00:00", "2026-11-11T06:00:00", null);
    const summary = summarize(
      [
        window(A, "2026-11-10T06:00:00", "2026-11-11T06:00:00"),
        window(B, "2026-11-12T00:00:00", "2026-11-12T06:00:00"),
      ],
      [
        shift("2026-11-10T06:00:00", "2026-11-10T12:00:00", A),
        shift("2026-11-10T12:00:00", "2026-11-10T18:00:00", null),
        uncoveredNight,
        shift("2026-11-11T06:00:00", "2026-11-11T18:00:00", null),
        shift("2026-11-11T18:00:00", "2026-11-12T00:00:00", null),
        shift("2026-11-12T00:00:00", "2026-11-12T06:00:00", B),
      ],
    );
    expect(summary.perMember).toEqual([
      { id: A, shifts: 1, minutes: 360, longCount: 0, nightCount: 0, hasAvailability: true, zeroShifts: false },
      { id: B, shifts: 1, minutes: 360, longCount: 0, nightCount: 1, hasAvailability: true, zeroShifts: false },
    ]);
    expect(summary.uncovered).toHaveLength(4);
    expect(summary.uncovered).toContain(uncoveredNight);
    // 10 Nov has A and 11 Nov has B (its 00:00–06:00 on 12 Nov belongs to station day 11); the other 28 have no one.
    expect(summary.daysWithNoOne).toHaveLength(28);
    expect(summary.daysWithNoOne).not.toContain("2026-11-10");
    expect(summary.daysWithNoOne).not.toContain("2026-11-11");
    expect(summary.daysWithNoOne).toContain("2026-11-12");
  });

  it("does not count a carry-over that ends before 1 Nov 06:00 as availability", () => {
    const summary = summarize([window(A, "2026-10-31T22:00:00", "2026-11-01T06:00:00")], []);
    expect(summary.perMember.at(0)).toMatchObject({ hasAvailability: false, zeroShifts: false });
  });
});

describe("a shift back to back with the previous month's last night is reported", () => {
  const windows = [window(A, "2026-11-01T06:00:00", "2026-11-01T18:00:00")];
  const draft = [shift("2026-11-01T06:00:00", "2026-11-01T18:00:00", A)];

  function withPreviousNight(employee_id: string | null) {
    return summarizeSchedule({
      month: MONTH,
      members: [{ id: A }, { id: B }],
      windows,
      shifts: draft,
      previousNight: shift("2026-10-31T18:00:00", "2026-11-01T06:00:00", employee_id),
    });
  }

  it("lists A's 1 Nov 06:00 start after A's 31 Oct night", () => {
    expect(withPreviousNight(A).touchesPreviousNight).toEqual(draft);
  });

  it("lists nothing after B's or an uncovered 31 Oct night, or without a previous draft", () => {
    expect(withPreviousNight(B).touchesPreviousNight).toEqual([]);
    expect(withPreviousNight(null).touchesPreviousNight).toEqual([]);
    expect(summarize(windows, draft).touchesPreviousNight).toEqual([]);
  });
});
