import { describe, expect, it } from "vitest";

import {
  generateSchedule,
  mergeAvailability,
  STATION_DAY_PATTERNS,
  stationDays,
  SHIFT_SHAPES,
  type GeneratedShift,
  type ScheduleWindow,
} from "./schedule-generator";
import { summarizeSchedule } from "./schedule-summary";

// Hand-written cases for the agreed station-day model (plan "Station day and shift model"). Each expected outcome
// follows from the rules (coverage first, then the 12h and night rules, then even hours, then fewer shifts; one shift
// per person per station day; no touching shifts), never from a generator run. November 2026 has 30 days; its
// station days run from 2026-11-01T06:00 to 2026-12-01T06:00.

const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";
const C = "00000000-0000-4000-8000-00000000000c";
const D = "00000000-0000-4000-8000-00000000000d";

function window(employee_id: string, starts_at: string, ends_at: string): ScheduleWindow {
  return { employee_id, starts_at, ends_at };
}

function novemberDate(day: number): string {
  return `2026-11-${String(day).padStart(2, "0")}`;
}

/** One 24h window per November station day: D 06:00 → D+1 06:00, the last ending 2026-12-01T06:00. */
function allNovember(employee_id: string, except: (day: number) => ScheduleWindow[] | null = () => null) {
  return Array.from({ length: 30 }, (_, index) => {
    const day = index + 1;
    const next = day === 30 ? "2026-12-01" : novemberDate(day + 1);
    return except(day) ?? [window(employee_id, `${novemberDate(day)}T06:00:00`, `${next}T06:00:00`)];
  }).flat();
}

function shiftsOf(shifts: GeneratedShift[], employee: string): GeneratedShift[] {
  return shifts.filter((shift) => shift.employee_id === employee);
}

function shiftAt(shifts: GeneratedShift[], starts_at: string): GeneratedShift | undefined {
  return shifts.find((shift) => shift.starts_at === starts_at);
}

function summarize(month: string, members: string[], windows: ScheduleWindow[], shifts: GeneratedShift[]) {
  return summarizeSchedule({ month, members: members.map((id) => ({ id })), windows, shifts });
}

describe("the station day model is the agreed one", () => {
  it("has the 9 shift shapes", () => {
    expect(SHIFT_SHAPES.map((shape) => `${shape.start}/${shape.minutes / 60}h`)).toEqual([
      "06:00/12h",
      "18:00/12h",
      "06:00/8h",
      "14:00/8h",
      "22:00/8h",
      "06:00/6h",
      "12:00/6h",
      "18:00/6h",
      "00:00/6h",
    ]);
  });

  it("has the 5 patterns, each running 06:00 to 06:00", () => {
    expect(STATION_DAY_PATTERNS.map((pattern) => pattern.map((shape) => shape.start).join(" "))).toEqual([
      "06:00 18:00",
      "06:00 14:00 22:00",
      "06:00 18:00 00:00",
      "06:00 12:00 18:00",
      "06:00 12:00 18:00 00:00",
    ]);
    for (const pattern of STATION_DAY_PATTERNS) {
      expect(pattern.reduce((sum, shape) => sum + shape.minutes, 0)).toBe(1440);
    }
  });

  it("gives February 2028 29 station days, the last ending 2028-03-01T06:00", () => {
    const days = stationDays("2028-02");
    expect(days).toHaveLength(29);
    expect(days.at(-1)?.date).toBe("2028-02-29");
    expect((days.at(-1)?.end ?? 0) - (days.at(0)?.start ?? 0)).toBe(29 * 1440);
  });
});

describe("touching windows merge into one span, so a split night is still one night", () => {
  it("merges 18–24 and 00–06 into 18–06 and keeps a separate window apart", () => {
    const merged = mergeAvailability([
      window(A, "2026-11-11T00:00:00", "2026-11-11T06:00:00"),
      window(A, "2026-11-10T18:00:00", "2026-11-11T00:00:00"),
      window(A, "2026-11-12T08:00:00", "2026-11-12T10:00:00"),
    ]);
    const spans = merged.get(A) ?? [];
    expect(spans.map((span) => span.end - span.start)).toEqual([720, 120]);
  });

  it("makes a person with windows 18–24 and 00–06 eligible for the 18–06 night", () => {
    const windows = [
      window(A, "2026-11-10T18:00:00", "2026-11-11T00:00:00"),
      window(A, "2026-11-11T00:00:00", "2026-11-11T06:00:00"),
    ];
    const { shifts } = generateSchedule({ month: "2026-11", windows });
    expect(shiftsOf(shifts, A)).toEqual([
      { starts_at: "2026-11-10T18:00:00", ends_at: "2026-11-11T06:00:00", employee_id: A },
    ]);
  });
});

describe("a fully available team is covered fairly", () => {
  it("covers every shift for A–D with no rule break and hours within 12h", () => {
    const members = [A, B, C, D];
    const windows = members.flatMap((member) => allNovember(member));
    const { shifts } = generateSchedule({ month: "2026-11", windows });
    const summary = summarize("2026-11", members, windows, shifts);
    expect(summary.uncovered).toEqual([]);
    expect(summary.ruleBreaks).toEqual([]);
    const minutes = summary.perMember.map((member) => member.minutes);
    expect(Math.max(...minutes) - Math.min(...minutes)).toBeLessThanOrEqual(720);
    expect(minutes.reduce((sum, value) => sum + value, 0)).toBe(30 * 1440);
  });

  it("with only A and B, keeps full coverage and reports the night breaks it cannot avoid", () => {
    // Two people can cover 24h only as 06–18 + 18–06, and the night person is blocked from the next 06:00 start, so
    // the same person must work every night: coverage wins and each of the 30 nights is reported against a 0 count.
    const windows = [...allNovember(A), ...allNovember(B)];
    const { shifts } = generateSchedule({ month: "2026-11", windows });
    const summary = summarize("2026-11", [A, B], windows, shifts);
    expect(summary.uncovered).toEqual([]);
    expect(shifts).toHaveLength(60);
    const nights = shifts.filter((shift) => shift.starts_at.endsWith("T18:00:00"));
    expect(new Set(nights.map((shift) => shift.employee_id)).size).toBe(1);
    expect(summary.ruleBreaks).toHaveLength(30);
    expect(summary.ruleBreaks.every((entry) => entry.kind === "night" && entry.eligibleMin === 0)).toBe(true);
  });
});

describe("the 12h rule keeps a shared 12h day off the person who already has the most", () => {
  it("gives the shared 06–18 to B, who has no 12h shift yet", () => {
    const windows = [
      ...[1, 2, 3, 4, 5].map((day) => window(A, `${novemberDate(day)}T06:00:00`, `${novemberDate(day)}T18:00:00`)),
      window(B, "2026-11-05T06:00:00", "2026-11-05T18:00:00"),
    ];
    const { shifts } = generateSchedule({ month: "2026-11", windows });
    expect(shiftAt(shifts, "2026-11-05T06:00:00")).toEqual({
      starts_at: "2026-11-05T06:00:00",
      ends_at: "2026-11-05T18:00:00",
      employee_id: B,
    });
    expect(summarize("2026-11", [A, B], windows, shifts).ruleBreaks).toEqual([]);
  });

  it("covers the shared day with a 6+6 split when B is blocked from its 06:00 start", () => {
    // B is the only one available for the 4 Nov night, so B works it and cannot start at 06:00 on 5 Nov. A 12h day for
    // A on 5 Nov would give A 5 long shifts against B's 1; A 06–12 + B 12–18 covers the same 12h within the rule.
    const windows = [
      ...[1, 2, 3, 4, 5].map((day) => window(A, `${novemberDate(day)}T06:00:00`, `${novemberDate(day)}T18:00:00`)),
      window(B, "2026-11-04T18:00:00", "2026-11-05T18:00:00"),
    ];
    const { shifts } = generateSchedule({ month: "2026-11", windows });
    expect(shiftAt(shifts, "2026-11-04T18:00:00")?.employee_id).toBe(B);
    expect(shiftAt(shifts, "2026-11-05T06:00:00")).toEqual({
      starts_at: "2026-11-05T06:00:00",
      ends_at: "2026-11-05T12:00:00",
      employee_id: A,
    });
    expect(shiftAt(shifts, "2026-11-05T12:00:00")).toEqual({
      starts_at: "2026-11-05T12:00:00",
      ends_at: "2026-11-05T18:00:00",
      employee_id: B,
    });
    expect(summarize("2026-11", [A, B], windows, shifts).ruleBreaks).toEqual([]);
  });
});

describe("a shift nobody can take is uncovered, never dropped", () => {
  it("leaves only the 00:00–06:00 of station day 3 uncovered when nobody is available then", () => {
    const members = [A, B, C, D];
    const windows = members.flatMap((member) =>
      allNovember(member, (day) => (day === 3 ? [window(member, "2026-11-03T06:00:00", "2026-11-04T00:00:00")] : null)),
    );
    const { shifts } = generateSchedule({ month: "2026-11", windows });
    const summary = summarize("2026-11", members, windows, shifts);
    expect(summary.uncovered).toEqual([
      { starts_at: "2026-11-04T00:00:00", ends_at: "2026-11-04T06:00:00", employee_id: null },
    ]);
    expect(summary.daysWithNoOne).toEqual([]);
  });

  it("with no availability at all, splits every day 12+12 (fewest shifts) and lists every day as having no one", () => {
    const { shifts } = generateSchedule({ month: "2026-11", windows: [] });
    expect(shifts).toHaveLength(60);
    expect(shifts.at(0)).toEqual({
      starts_at: "2026-11-01T06:00:00",
      ends_at: "2026-11-01T18:00:00",
      employee_id: null,
    });
    expect(shifts.at(-1)).toEqual({
      starts_at: "2026-11-30T18:00:00",
      ends_at: "2026-12-01T06:00:00",
      employee_id: null,
    });
    expect(summarize("2026-11", [], [], shifts).daysWithNoOne).toHaveLength(30);
  });

  it("does not give one person both of two touching shifts: the 4 Nov night and the 5 Nov 06:00 start", () => {
    // A is the only one available for 4 Nov 18–06 and 5 Nov 06–18. Days are decided in date order, and 4 Nov is fully
    // covered only with A on its night, so 5 Nov's 06:00 start is blocked for A and nobody else can take it.
    const windows = [
      window(A, "2026-11-04T18:00:00", "2026-11-05T18:00:00"),
      window(B, "2026-11-04T06:00:00", "2026-11-04T18:00:00"),
      window(C, "2026-11-05T18:00:00", "2026-11-06T06:00:00"),
    ];
    const { shifts } = generateSchedule({ month: "2026-11", windows });
    expect(shiftAt(shifts, "2026-11-04T18:00:00")).toEqual({
      starts_at: "2026-11-04T18:00:00",
      ends_at: "2026-11-05T06:00:00",
      employee_id: A,
    });
    expect(shiftAt(shifts, "2026-11-05T06:00:00")?.employee_id).toBeNull();
    const ownStarts = new Set(shiftsOf(shifts, A).map((shift) => shift.starts_at));
    expect(shiftsOf(shifts, A).filter((shift) => ownStarts.has(shift.ends_at))).toEqual([]);
  });
});

describe("a 5-person team with 3 part-timers and 2 days nobody is available", () => {
  // Full-timers A and B are available every station day except 10 and 20 Nov. Part-timers C, D and E are available
  // 12:00–18:00 in turn (C on day % 3 = 1, D on 2, E on 0), also never on 10 or 20 Nov. The manager M is a member with
  // no availability. Each other day, A and B alone can cover 24h (see the A+B case above), so coverage leaves only the
  // two empty days uncovered. Only A and B can work a night, and the night person cannot start at 06:00 next morning,
  // so one of them works every night of a run (1–9, 11–19, 21–30 Nov); the empty days rest both, so the runs can
  // alternate between them. 06–12 | 12–18 | 18–06 with the day's part-timer covers the same 24h as 06–18 | 18–06 with
  // evener hours, but the 12h rule (ranked above even hours) limits how often the day person can give up a 12h day
  // while the other works 12h nights. So every part-timer works some days, not all of them.
  const E = "00000000-0000-4000-8000-00000000000e";
  const M = "00000000-0000-4000-8000-000000000001";
  const emptyDays = new Set([10, 20]);
  const partTimers = [E, C, D]; // indexed by day % 3
  const windows = [
    ...allNovember(A, (day) => (emptyDays.has(day) ? [] : null)),
    ...allNovember(B, (day) => (emptyDays.has(day) ? [] : null)),
    ...Array.from({ length: 30 }, (_, index) => index + 1)
      .filter((day) => !emptyDays.has(day))
      .map((day) => window(partTimers[day % 3], `${novemberDate(day)}T12:00:00`, `${novemberDate(day)}T18:00:00`)),
  ];
  const members = [A, B, C, D, E, M];
  const { shifts } = generateSchedule({ month: "2026-11", windows });
  const summary = summarize("2026-11", members, windows, shifts);

  it("lists exactly 10 and 20 Nov as days with no one, and leaves nothing else uncovered", () => {
    expect(summary.daysWithNoOne).toEqual(["2026-11-10", "2026-11-20"]);
    // Every uncovered shift belongs to station day 10 or 20, and every shift of those two days is uncovered.
    const onEmptyDay = (shift: GeneratedShift) =>
      (shift.starts_at >= "2026-11-10T06:00:00" && shift.starts_at < "2026-11-11T06:00:00") ||
      (shift.starts_at >= "2026-11-20T06:00:00" && shift.starts_at < "2026-11-21T06:00:00");
    expect(summary.uncovered.every(onEmptyDay)).toBe(true);
    expect(shifts.filter(onEmptyDay).every((shift) => shift.employee_id === null)).toBe(true);
    expect(summary.outsideAvailability).toEqual([]);
  });

  it("gives every part-timer at least one 12:00–18:00 shift, so none is flagged with 0 shifts", () => {
    for (const partTimer of [C, D, E]) {
      const own = shiftsOf(shifts, partTimer);
      expect(own.length).toBeGreaterThan(0);
      expect(own.every((shift) => shift.starts_at.endsWith("T12:00:00") && shift.ends_at.endsWith("T18:00:00"))).toBe(
        true,
      );
      expect(summary.perMember.find((member) => member.id === partTimer)?.zeroShifts).toBe(false);
    }
  });

  it("alternates the runs of nights between A and B and keeps the 12h rule", () => {
    const nightsOf = (member: string) => summary.perMember.find((entry) => entry.id === member)?.nightCount ?? 0;
    expect(nightsOf(A)).toBeGreaterThan(0);
    expect(nightsOf(B)).toBeGreaterThan(0);
    expect(nightsOf(A) + nightsOf(B)).toBe(28);
    expect(summary.ruleBreaks.every((entry) => entry.kind === "night")).toBe(true);
  });

  it("gives the manager without availability no shift and no 0-shifts flag", () => {
    expect(shiftsOf(shifts, M)).toEqual([]);
    expect(summary.perMember.find((member) => member.id === M)).toEqual({
      id: M,
      shifts: 0,
      minutes: 0,
      longCount: 0,
      nightCount: 0,
      hasAvailability: false,
      zeroShifts: false,
    });
  });
});

describe("availability outside the month's station days is ignored, a carry-over inside them is not", () => {
  it("makes an M−1 window running past 1 Nov 06:00 count on station day 1", () => {
    const windows = [window(A, "2026-10-31T20:00:00", "2026-11-01T18:00:00")];
    const { shifts } = generateSchedule({ month: "2026-11", windows });
    expect(shifts.at(0)?.starts_at).toBe("2026-11-01T06:00:00");
    expect(shiftsOf(shifts, A)).toEqual([
      { starts_at: "2026-11-01T06:00:00", ends_at: "2026-11-01T18:00:00", employee_id: A },
    ]);
  });

  it("gives no shift for a window that ends before 1 Nov 06:00 or starts after 1 Dec 06:00", () => {
    const windows = [
      window(A, "2026-10-31T22:00:00", "2026-11-01T06:00:00"),
      window(B, "2026-11-30T23:00:00", "2026-12-01T06:00:00"),
    ];
    const { shifts } = generateSchedule({ month: "2026-11", windows });
    expect(shiftsOf(shifts, A)).toEqual([]);
    expect(shiftAt(shifts, "2026-11-30T18:00:00")?.employee_id).toBeNull();
  });
});

describe("12h shifts across a DST night are 12h of wall-clock time", () => {
  it.each([
    { month: "2026-10", night: "2026-10-24", next: "2026-10-25", after: "2026-10-26" }, // the fall-back night
    { month: "2026-03", night: "2026-03-28", next: "2026-03-29", after: "2026-03-30" }, // the spring-forward night
  ])("counts both 18–06 nights around $next as 720 minutes", ({ month, night, next, after }) => {
    const windows = [
      window(A, `${night}T18:00:00`, `${next}T06:00:00`),
      window(A, `${next}T18:00:00`, `${after}T06:00:00`),
    ];
    const { shifts } = generateSchedule({ month, windows });
    expect(shiftsOf(shifts, A)).toEqual([
      { starts_at: `${night}T18:00:00`, ends_at: `${next}T06:00:00`, employee_id: A },
      { starts_at: `${next}T18:00:00`, ends_at: `${after}T06:00:00`, employee_id: A },
    ]);
    const [member] = summarize(month, [A], windows, shifts).perMember;
    expect(member).toMatchObject({ minutes: 1440, longCount: 2, nightCount: 2 });
  });
});

describe("a member who cannot take any shift is flagged, not hidden", () => {
  it("flags a member whose only window is 2h with zeroShifts", () => {
    const windows = [
      window(A, "2026-11-10T08:00:00", "2026-11-10T10:00:00"),
      window(C, "2026-11-10T06:00:00", "2026-11-10T18:00:00"),
    ];
    const { shifts } = generateSchedule({ month: "2026-11", windows });
    const summary = summarize("2026-11", [A, B, C], windows, shifts);
    expect(summary.perMember).toEqual([
      { id: A, shifts: 0, minutes: 0, longCount: 0, nightCount: 0, hasAvailability: true, zeroShifts: true },
      { id: B, shifts: 0, minutes: 0, longCount: 0, nightCount: 0, hasAvailability: false, zeroShifts: false },
      { id: C, shifts: 1, minutes: 720, longCount: 1, nightCount: 0, hasAvailability: true, zeroShifts: false },
    ]);
  });
});

describe("the generator is deterministic", () => {
  it("gives deep-equal output for the same input and for the same windows in another order", () => {
    const windows = [
      ...allNovember(A),
      ...allNovember(B, (day) => (day % 3 === 0 ? [] : null)),
      window(C, "2026-11-07T10:00:00", "2026-11-08T08:00:00"),
      window(D, "2026-10-31T23:00:00", "2026-11-01T12:00:00"),
    ];
    const first = generateSchedule({ month: "2026-11", windows });
    expect(generateSchedule({ month: "2026-11", windows })).toEqual(first);
    expect(generateSchedule({ month: "2026-11", windows: [...windows].reverse() })).toEqual(first);
  });
});
