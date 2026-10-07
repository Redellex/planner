import { describe, expect, it } from "vitest";

import type { ScheduleWindow } from "./schedule-generator";
import { applyOverride, overrideWarnings, type OverrideShift } from "./schedule-override";
import { summarizeSchedule, type SummaryShift } from "./schedule-summary";

// overrideWarnings diffs the summary of the stored draft (before) against the same draft with one assignee changed
// (after). Drafts are injected by hand; every expected warning is written out from the rule it tests, never derived
// with the helpers under test.

const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";
const C = "00000000-0000-4000-8000-00000000000c";
const MONTH = "2026-11";

function window(employee_id: string, starts_at: string, ends_at: string): ScheduleWindow {
  return { employee_id, starts_at, ends_at };
}

function row(id: string, starts_at: string, ends_at: string, employee_id: string | null): OverrideShift {
  return { id, starts_at, ends_at, employee_id };
}

/** The warnings for changing `shiftId` to `employeeId` in `shifts`, from full summaries before and after. */
function warningsFor(input: {
  windows: ScheduleWindow[];
  shifts: OverrideShift[];
  shiftId: string;
  employeeId: string | null;
  previousNight?: SummaryShift | null;
  nextMorning?: SummaryShift | null;
}) {
  const common = {
    month: MONTH,
    members: [{ id: A }, { id: B }, { id: C }],
    windows: input.windows,
    previousNight: input.previousNight,
    nextMorning: input.nextMorning,
  };
  const before = summarizeSchedule({ ...common, shifts: input.shifts });
  const after = summarizeSchedule({
    ...common,
    shifts: applyOverride(input.shifts, input.shiftId, input.employeeId),
  });
  return { before, after, warnings: overrideWarnings({ before, after, shiftId: input.shiftId }) };
}

describe("an override changes exactly one assignee", () => {
  it("returns a copy with only that shift's assignee replaced", () => {
    const first = row("s1", "2026-11-10T06:00:00", "2026-11-10T12:00:00", A);
    const second = row("s2", "2026-11-10T12:00:00", "2026-11-10T18:00:00", B);
    const shifts = [first, second];
    expect(applyOverride(shifts, "s1", null)).toEqual([
      { id: "s1", starts_at: "2026-11-10T06:00:00", ends_at: "2026-11-10T12:00:00", employee_id: null },
      { id: "s2", starts_at: "2026-11-10T12:00:00", ends_at: "2026-11-10T18:00:00", employee_id: B },
    ]);
    expect(shifts[0].employee_id).toBe(A);
  });

  it("returns the shifts unchanged for an unknown id", () => {
    const shifts = [row("s1", "2026-11-10T06:00:00", "2026-11-10T12:00:00", A)];
    expect(applyOverride(shifts, "s9", B)).toEqual([
      { id: "s1", starts_at: "2026-11-10T06:00:00", ends_at: "2026-11-10T12:00:00", employee_id: A },
    ]);
  });
});

describe("each hard-rule problem an override introduces is warned on its own", () => {
  it("warns outside availability when B has no window for the 10 Nov 06–12", () => {
    const { warnings } = warningsFor({
      windows: [window(A, "2026-11-10T06:00:00", "2026-11-10T12:00:00")],
      shifts: [row("s1", "2026-11-10T06:00:00", "2026-11-10T12:00:00", A)],
      shiftId: "s1",
      employeeId: B,
    });
    expect(warnings).toEqual([
      { kind: "outside", shift: row("s1", "2026-11-10T06:00:00", "2026-11-10T12:00:00", B), assignee: B },
    ]);
  });

  it("warns a second shift on station day 10 Nov when B already holds its 18–24", () => {
    const { warnings } = warningsFor({
      windows: [
        window(A, "2026-11-10T06:00:00", "2026-11-10T12:00:00"),
        window(B, "2026-11-10T06:00:00", "2026-11-10T12:00:00"),
        window(B, "2026-11-10T18:00:00", "2026-11-11T00:00:00"),
      ],
      shifts: [
        row("s1", "2026-11-10T06:00:00", "2026-11-10T12:00:00", A),
        row("s2", "2026-11-10T18:00:00", "2026-11-11T00:00:00", B),
      ],
      shiftId: "s1",
      employeeId: B,
    });
    expect(warnings).toEqual([
      {
        kind: "sameDay",
        assignee: B,
        shifts: [
          row("s1", "2026-11-10T06:00:00", "2026-11-10T12:00:00", B),
          row("s2", "2026-11-10T18:00:00", "2026-11-11T00:00:00", B),
        ],
      },
    ]);
  });

  it("warns back to back when B's 10 Nov night ends at the 11 Nov 06:00 start B is given", () => {
    const { warnings } = warningsFor({
      windows: [
        window(B, "2026-11-11T00:00:00", "2026-11-11T12:00:00"),
        window(A, "2026-11-11T06:00:00", "2026-11-11T12:00:00"),
      ],
      shifts: [
        row("s1", "2026-11-11T00:00:00", "2026-11-11T06:00:00", B),
        row("s2", "2026-11-11T06:00:00", "2026-11-11T12:00:00", A),
      ],
      shiftId: "s2",
      employeeId: B,
    });
    expect(warnings).toEqual([
      {
        kind: "backToBack",
        assignee: B,
        first: row("s1", "2026-11-11T00:00:00", "2026-11-11T06:00:00", B),
        second: row("s2", "2026-11-11T06:00:00", "2026-11-11T12:00:00", B),
      },
    ]);
  });

  it("warns back to back when B is given the 10 Nov night that ends at B's 11 Nov 06:00 start", () => {
    // The mirror of the case above: the overridden shift is the first of the pair, not the second.
    const { warnings } = warningsFor({
      windows: [
        window(B, "2026-11-11T00:00:00", "2026-11-11T12:00:00"),
        window(A, "2026-11-11T00:00:00", "2026-11-11T06:00:00"),
      ],
      shifts: [
        row("s1", "2026-11-11T00:00:00", "2026-11-11T06:00:00", A),
        row("s2", "2026-11-11T06:00:00", "2026-11-11T12:00:00", B),
      ],
      shiftId: "s1",
      employeeId: B,
    });
    expect(warnings).toEqual([
      {
        kind: "backToBack",
        assignee: B,
        first: row("s1", "2026-11-11T00:00:00", "2026-11-11T06:00:00", B),
        second: row("s2", "2026-11-11T06:00:00", "2026-11-11T12:00:00", B),
      },
    ]);
  });

  it("warns back to back with October's last night when B, its assignee, is given 1 Nov 06:00", () => {
    const { warnings } = warningsFor({
      windows: [
        window(A, "2026-11-01T06:00:00", "2026-11-01T12:00:00"),
        window(B, "2026-11-01T06:00:00", "2026-11-01T12:00:00"),
      ],
      shifts: [row("s1", "2026-11-01T06:00:00", "2026-11-01T12:00:00", A)],
      shiftId: "s1",
      employeeId: B,
      previousNight: { starts_at: "2026-10-31T18:00:00", ends_at: "2026-11-01T06:00:00", employee_id: B },
    });
    expect(warnings).toEqual([
      { kind: "previousNight", shift: row("s1", "2026-11-01T06:00:00", "2026-11-01T12:00:00", B), assignee: B },
    ]);
  });

  it("warns back to back with December's first morning when B, its assignee, is given the 1 Dec 00–06", () => {
    const { warnings } = warningsFor({
      windows: [
        window(A, "2026-12-01T00:00:00", "2026-12-01T06:00:00"),
        window(B, "2026-12-01T00:00:00", "2026-12-01T06:00:00"),
      ],
      shifts: [row("s1", "2026-12-01T00:00:00", "2026-12-01T06:00:00", A)],
      shiftId: "s1",
      employeeId: B,
      nextMorning: { starts_at: "2026-12-01T06:00:00", ends_at: "2026-12-01T18:00:00", employee_id: B },
    });
    expect(warnings).toEqual([
      { kind: "nextMorning", shift: row("s1", "2026-12-01T00:00:00", "2026-12-01T06:00:00", B), assignee: B },
    ]);
  });
});

describe("a new 12h or night break is warned wherever it lands", () => {
  const dayWindows = (employee: string, days: string[]) =>
    days.map((day) => window(employee, `2026-11-${day}T06:00:00`, `2026-11-${day}T18:00:00`));

  it("warns both of A's 12h days when A takes B's, while B was available for one (2 > 0 + 1)", () => {
    const { warnings } = warningsFor({
      windows: [...dayWindows(A, ["10", "11"]), ...dayWindows(B, ["10", "11"])],
      shifts: [
        row("s1", "2026-11-10T06:00:00", "2026-11-10T18:00:00", A),
        row("s2", "2026-11-11T06:00:00", "2026-11-11T18:00:00", B),
      ],
      shiftId: "s2",
      employeeId: A,
    });
    expect(warnings).toEqual([
      {
        kind: "fairness",
        rule: "long",
        shift: row("s1", "2026-11-10T06:00:00", "2026-11-10T18:00:00", A),
        assignee: A,
        eligibleMin: 0,
      },
      {
        kind: "fairness",
        rule: "long",
        shift: row("s2", "2026-11-11T06:00:00", "2026-11-11T18:00:00", A),
        assignee: A,
        eligibleMin: 0,
      },
    ]);
  });

  it("warns C's untouched 12h days when moving A's day to B leaves A, eligible for them, with none", () => {
    // Before: A 1, C 2 → C's lowest eligible (A) is 1, no break. After A → B on 10 Nov: A 0 → C 2 > 0 + 1.
    const { warnings } = warningsFor({
      windows: [...dayWindows(A, ["10", "11", "12"]), ...dayWindows(B, ["10"]), ...dayWindows(C, ["11", "12"])],
      shifts: [
        row("s1", "2026-11-10T06:00:00", "2026-11-10T18:00:00", A),
        row("s2", "2026-11-11T06:00:00", "2026-11-11T18:00:00", C),
        row("s3", "2026-11-12T06:00:00", "2026-11-12T18:00:00", C),
      ],
      shiftId: "s1",
      employeeId: B,
    });
    expect(warnings).toEqual([
      {
        kind: "fairness",
        rule: "long",
        shift: row("s2", "2026-11-11T06:00:00", "2026-11-11T18:00:00", C),
        assignee: C,
        eligibleMin: 0,
      },
      {
        kind: "fairness",
        rule: "long",
        shift: row("s3", "2026-11-12T06:00:00", "2026-11-12T18:00:00", C),
        assignee: C,
        eligibleMin: 0,
      },
    ]);
  });

  it("warns a night break on the new assignee even when the old one broke the rule on that shift too", () => {
    // Before: A holds nights 10 and 11 (A 2, C 0: both break). After 11 → B: A 1, B 2 (11 and 12), C 0, so B's two
    // nights break. The 11 Nov night breaks before and after, but for a different person, so it is new.
    const nightWindows = (employee: string) =>
      ["10", "11", "12"].map((day) =>
        window(employee, `2026-11-${day}T22:00:00`, `2026-11-${Number(day) + 1}T06:00:00`),
      );
    const { warnings } = warningsFor({
      windows: [...nightWindows(A), ...nightWindows(B), ...nightWindows(C)],
      shifts: [
        row("s1", "2026-11-10T22:00:00", "2026-11-11T06:00:00", A),
        row("s2", "2026-11-11T22:00:00", "2026-11-12T06:00:00", A),
        row("s3", "2026-11-12T22:00:00", "2026-11-13T06:00:00", B),
      ],
      shiftId: "s2",
      employeeId: B,
    });
    expect(warnings).toEqual([
      {
        kind: "fairness",
        rule: "night",
        shift: row("s2", "2026-11-11T22:00:00", "2026-11-12T06:00:00", B),
        assignee: B,
        eligibleMin: 0,
      },
      {
        kind: "fairness",
        rule: "night",
        shift: row("s3", "2026-11-12T22:00:00", "2026-11-13T06:00:00", B),
        assignee: B,
        eligibleMin: 0,
      },
    ]);
  });
});

describe("only problems the change introduces are warned", () => {
  it("gives no warnings for an unchanged assignee, even on a shift already outside availability", () => {
    const { before, warnings } = warningsFor({
      windows: [],
      shifts: [row("s1", "2026-11-10T06:00:00", "2026-11-10T12:00:00", A)],
      shiftId: "s1",
      employeeId: A,
    });
    expect(before.outsideAvailability).toEqual([row("s1", "2026-11-10T06:00:00", "2026-11-10T12:00:00", A)]);
    expect(warnings).toEqual([]);
  });

  it("warns a day with no one when the last assigned shift of 10 Nov is cleared", () => {
    const { warnings } = warningsFor({
      windows: [window(A, "2026-11-10T06:00:00", "2026-11-10T12:00:00")],
      shifts: [
        row("s1", "2026-11-10T06:00:00", "2026-11-10T12:00:00", A),
        row("s2", "2026-11-10T12:00:00", "2026-11-10T18:00:00", null),
      ],
      shiftId: "s1",
      employeeId: null,
    });
    expect(warnings).toEqual([{ kind: "noOne", date: "2026-11-10" }]);
  });

  it("gives no warnings when clearing a shift outside availability on a day someone else still covers", () => {
    const { before, after, warnings } = warningsFor({
      windows: [window(B, "2026-11-10T12:00:00", "2026-11-10T18:00:00")],
      shifts: [
        row("s1", "2026-11-10T06:00:00", "2026-11-10T12:00:00", A),
        row("s2", "2026-11-10T12:00:00", "2026-11-10T18:00:00", B),
      ],
      shiftId: "s1",
      employeeId: null,
    });
    expect(before.outsideAvailability).toEqual([row("s1", "2026-11-10T06:00:00", "2026-11-10T12:00:00", A)]);
    expect(after.outsideAvailability).toEqual([]);
    expect(warnings).toEqual([]);
  });
});

describe("a problem the old assignee already had is warned again for the new one", () => {
  it("warns outside availability when a shift outside A's windows moves to B, who has none either", () => {
    const { before, warnings } = warningsFor({
      windows: [],
      shifts: [row("s1", "2026-11-10T06:00:00", "2026-11-10T12:00:00", A)],
      shiftId: "s1",
      employeeId: B,
    });
    expect(before.outsideAvailability).toEqual([row("s1", "2026-11-10T06:00:00", "2026-11-10T12:00:00", A)]);
    expect(warnings).toEqual([
      { kind: "outside", shift: row("s1", "2026-11-10T06:00:00", "2026-11-10T12:00:00", B), assignee: B },
    ]);
  });

  it("warns a second shift on 10 Nov when A's second shift that day moves to B, who holds its 00–06", () => {
    const { before, warnings } = warningsFor({
      windows: [
        window(A, "2026-11-10T06:00:00", "2026-11-10T12:00:00"),
        window(A, "2026-11-10T18:00:00", "2026-11-11T00:00:00"),
        window(B, "2026-11-10T06:00:00", "2026-11-10T12:00:00"),
        window(B, "2026-11-11T00:00:00", "2026-11-11T06:00:00"),
        window(C, "2026-11-10T12:00:00", "2026-11-10T18:00:00"),
      ],
      shifts: [
        row("s1", "2026-11-10T06:00:00", "2026-11-10T12:00:00", A),
        row("s2", "2026-11-10T12:00:00", "2026-11-10T18:00:00", C),
        row("s3", "2026-11-10T18:00:00", "2026-11-11T00:00:00", A),
        row("s4", "2026-11-11T00:00:00", "2026-11-11T06:00:00", B),
      ],
      shiftId: "s1",
      employeeId: B,
    });
    expect(before.sameDay).toEqual([
      {
        assignee: A,
        shifts: [
          row("s1", "2026-11-10T06:00:00", "2026-11-10T12:00:00", A),
          row("s3", "2026-11-10T18:00:00", "2026-11-11T00:00:00", A),
        ],
      },
    ]);
    expect(warnings).toEqual([
      {
        kind: "sameDay",
        assignee: B,
        shifts: [
          row("s1", "2026-11-10T06:00:00", "2026-11-10T12:00:00", B),
          row("s4", "2026-11-11T00:00:00", "2026-11-11T06:00:00", B),
        ],
      },
    ]);
  });

  it("warns back to back when A's night before A's 11 Nov 06:00 moves to B, who holds the 18–24 before it", () => {
    // B's 18–24 and the 00–06 are one station day (10 Nov), so the move also gives B a second shift that day.
    const { before, warnings } = warningsFor({
      windows: [
        window(A, "2026-11-11T00:00:00", "2026-11-11T12:00:00"),
        window(B, "2026-11-10T18:00:00", "2026-11-11T06:00:00"),
      ],
      shifts: [
        row("s1", "2026-11-10T18:00:00", "2026-11-11T00:00:00", B),
        row("s2", "2026-11-11T00:00:00", "2026-11-11T06:00:00", A),
        row("s3", "2026-11-11T06:00:00", "2026-11-11T12:00:00", A),
      ],
      shiftId: "s2",
      employeeId: B,
    });
    expect(before.backToBack).toEqual([
      {
        assignee: A,
        first: row("s2", "2026-11-11T00:00:00", "2026-11-11T06:00:00", A),
        second: row("s3", "2026-11-11T06:00:00", "2026-11-11T12:00:00", A),
      },
    ]);
    expect(warnings).toEqual([
      {
        kind: "sameDay",
        assignee: B,
        shifts: [
          row("s1", "2026-11-10T18:00:00", "2026-11-11T00:00:00", B),
          row("s2", "2026-11-11T00:00:00", "2026-11-11T06:00:00", B),
        ],
      },
      {
        kind: "backToBack",
        assignee: B,
        first: row("s1", "2026-11-10T18:00:00", "2026-11-11T00:00:00", B),
        second: row("s2", "2026-11-11T00:00:00", "2026-11-11T06:00:00", B),
      },
    ]);
  });
});
