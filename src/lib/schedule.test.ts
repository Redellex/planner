import { describe, expect, it } from "vitest";

import {
  buildScheduleInputs,
  CONFIRM_REPLACE_ERROR,
  describeScheduleWriteError,
  GENERATE_LOAD_ERROR,
  GENERIC_SCHEDULE_WRITE_ERROR,
  groupRuleBreaks,
  INVALID_ASSIGNEE_ERROR,
  INVALID_MONTH_ERROR,
  managerScheduleUrl,
  MONTH_UNLOCKED_ERROR,
  NO_DRAFT_ERROR,
  NO_SCHEDULE_ERROR,
  NOT_PERMITTED_ERROR,
  OVERRIDDEN_MESSAGE,
  parseShiftParam,
  PUBLISH_GAPS_ERROR,
  PUBLISHED_MESSAGE,
  resolveScheduleFeedbackError,
  SCHEDULE_PUBLISHED_ERROR,
  shiftsByStationDay,
  STALE_SHIFT_ERROR,
  stationDayOf,
  UNLOCK_WITH_PUBLISHED_ERROR,
  UNPUBLISHED_MESSAGE,
  type ScheduleMember,
  type ScheduleShiftRow,
  type ScheduleWindowRow,
} from "./schedule";
import { summarizeSchedule } from "./schedule-summary";
import type { PagedResult } from "./team-availability";

const SHIFT_ID = "8f1c2b3a-4d5e-4f60-8a71-92b3c4d5e6f7";
const EMPLOYEE_ID = "00000000-0000-4000-8000-00000000000a";

describe("only known messages from ?error= are shown", () => {
  it.each([CONFIRM_REPLACE_ERROR, GENERATE_LOAD_ERROR, NOT_PERMITTED_ERROR, MONTH_UNLOCKED_ERROR, NO_DRAFT_ERROR])(
    "shows %s as-is",
    (message) => {
      expect(resolveScheduleFeedbackError(message)).toBe(message);
    },
  );

  it.each([
    "Unpublish the schedule before changing it.",
    "Assign someone on every day before publishing.",
    "This shift is no longer in the draft. Reload and try again.",
    "Invalid assignee",
    "No schedule for this month",
  ])("shows the review/override/publish message %s as-is", (message) => {
    expect(resolveScheduleFeedbackError(message)).toBe(message);
  });

  it("does not show the /manager/months-only unlock message on the schedule page", () => {
    expect(resolveScheduleFeedbackError(UNLOCK_WITH_PUBLISHED_ERROR)).toBe(GENERIC_SCHEDULE_WRITE_ERROR);
    expect(UNLOCK_WITH_PUBLISHED_ERROR).toBe("Unpublish and discard this month's schedule before unlocking it.");
  });

  it("keeps the exact texts of the new message constants", () => {
    expect([
      SCHEDULE_PUBLISHED_ERROR,
      PUBLISH_GAPS_ERROR,
      STALE_SHIFT_ERROR,
      INVALID_ASSIGNEE_ERROR,
      NO_SCHEDULE_ERROR,
      OVERRIDDEN_MESSAGE,
      PUBLISHED_MESSAGE,
      UNPUBLISHED_MESSAGE,
    ]).toEqual([
      "Unpublish the schedule before changing it.",
      "Assign someone on every day before publishing.",
      "This shift is no longer in the draft. Reload and try again.",
      "Invalid assignee",
      "No schedule for this month",
      "Shift updated.",
      "Schedule published.",
      "Schedule unpublished. It is a draft again.",
    ]);
  });

  it("shows nothing for an absent or empty param", () => {
    expect(resolveScheduleFeedbackError(null)).toBeNull();
    expect(resolveScheduleFeedbackError("")).toBeNull();
  });

  it("replaces unknown text with the generic message", () => {
    expect(resolveScheduleFeedbackError("duplicate key value violates unique constraint")).toBe(
      GENERIC_SCHEDULE_WRITE_ERROR,
    );
  });
});

describe("database errors map to allow-listed messages", () => {
  it.each([
    ["42501", NOT_PERMITTED_ERROR],
    ["23503", MONTH_UNLOCKED_ERROR],
    ["23505", CONFIRM_REPLACE_ERROR],
    ["SP001", "Unpublish the schedule before changing it."],
    ["SP002", "No schedule for this month"],
    ["SP003", "Assign someone on every day before publishing."],
    ["23P01", GENERIC_SCHEDULE_WRITE_ERROR],
  ])("maps %s to %s", (code, message) => {
    expect(describeScheduleWriteError({ code, message: "raw database text" })).toBe(message);
  });
});

describe("the redirect URL puts the status param first", () => {
  it("builds an error URL with the month after the status", () => {
    expect(managerScheduleUrl({ month: "2026-11", error: CONFIRM_REPLACE_ERROR })).toBe(
      "/manager/schedule?error=Confirm%20replacing%20the%20current%20draft&month=2026-11",
    );
  });

  it("builds an error URL without a month when the month was invalid", () => {
    expect(managerScheduleUrl({ month: null, error: "Invalid month" })).toBe("/manager/schedule?error=Invalid%20month");
  });

  it("builds the generated and discarded URLs", () => {
    expect(managerScheduleUrl({ month: "2026-11", generated: true })).toBe(
      "/manager/schedule?generated=1&month=2026-11",
    );
    expect(managerScheduleUrl({ month: "2026-11", discarded: true })).toBe(
      "/manager/schedule?discarded=1&month=2026-11",
    );
  });

  it("builds plain links with the day and the confirm step", () => {
    expect(managerScheduleUrl({ month: "2026-11" })).toBe("/manager/schedule?month=2026-11");
    expect(managerScheduleUrl({ month: "2026-11", day: "2026-11-05", confirm: "replace" })).toBe(
      "/manager/schedule?month=2026-11&day=2026-11-05&confirm=replace",
    );
    expect(managerScheduleUrl({ month: null, day: "2026-11-05" })).toBe("/manager/schedule");
  });

  it("puts the overridden, published and unpublished flags first", () => {
    expect(managerScheduleUrl({ month: "2026-11", day: "2026-11-05", overridden: true, shift: SHIFT_ID })).toBe(
      "/manager/schedule?overridden=1&month=2026-11&day=2026-11-05&shift=8f1c2b3a-4d5e-4f60-8a71-92b3c4d5e6f7",
    );
    expect(managerScheduleUrl({ month: "2026-11", published: true })).toBe(
      "/manager/schedule?published=1&month=2026-11",
    );
    expect(managerScheduleUrl({ month: "2026-11", unpublished: true })).toBe(
      "/manager/schedule?unpublished=1&month=2026-11",
    );
  });

  it("orders month, day, confirm, shift and employee for the override confirm step", () => {
    expect(
      managerScheduleUrl({
        month: "2026-11",
        day: "2026-11-05",
        confirm: "override",
        shift: SHIFT_ID,
        employee: EMPLOYEE_ID,
      }),
    ).toBe(
      "/manager/schedule?month=2026-11&day=2026-11-05&confirm=override&shift=8f1c2b3a-4d5e-4f60-8a71-92b3c4d5e6f7&employee=00000000-0000-4000-8000-00000000000a",
    );
  });

  it("writes employee=none for Uncovered", () => {
    expect(
      managerScheduleUrl({ month: "2026-11", day: "2026-11-05", confirm: "override", shift: SHIFT_ID, employee: null }),
    ).toBe(
      "/manager/schedule?month=2026-11&day=2026-11-05&confirm=override&shift=8f1c2b3a-4d5e-4f60-8a71-92b3c4d5e6f7&employee=none",
    );
  });

  it("keeps the error first and drops shift and employee without a month", () => {
    expect(managerScheduleUrl({ month: "2026-11", day: "2026-11-05", shift: SHIFT_ID, error: STALE_SHIFT_ERROR })).toBe(
      "/manager/schedule?error=This%20shift%20is%20no%20longer%20in%20the%20draft.%20Reload%20and%20try%20again.&month=2026-11&day=2026-11-05&shift=8f1c2b3a-4d5e-4f60-8a71-92b3c4d5e6f7",
    );
    expect(managerScheduleUrl({ month: null, shift: SHIFT_ID, employee: null, error: INVALID_MONTH_ERROR })).toBe(
      "/manager/schedule?error=Invalid%20month",
    );
  });
});

describe("a shift param is accepted only as a UUID", () => {
  it("returns a UUID as-is", () => {
    expect(parseShiftParam(SHIFT_ID)).toBe("8f1c2b3a-4d5e-4f60-8a71-92b3c4d5e6f7");
  });

  it.each([
    ["absent", null],
    ["empty", ""],
    ["not a uuid", "s1"],
    ["a uuid with a suffix", "8f1c2b3a-4d5e-4f60-8a71-92b3c4d5e6f7&employee=none"],
    ["the Uncovered marker", "none"],
    ["a non-string form value", 42],
  ])("rejects %s", (_name, value) => {
    expect(parseShiftParam(value)).toBeNull();
  });
});

describe("rule breaks are grouped into one line per person and kind", () => {
  const A = "00000000-0000-4000-8000-00000000000a";
  const B = "00000000-0000-4000-8000-00000000000b";
  // Only the start matters for grouping; the end and assignee are filler.
  const at = (starts_at: string) => ({ starts_at, ends_at: starts_at, employee_id: A });

  it("folds one person's nights into one group with their station days sorted, the 00:00 start on the day before", () => {
    expect(
      groupRuleBreaks([
        { kind: "night", shift: at("2026-11-12T00:00:00"), assignee: A, eligibleMin: 1 },
        { kind: "night", shift: at("2026-11-03T18:00:00"), assignee: A, eligibleMin: 0 },
        { kind: "night", shift: at("2026-11-07T22:00:00"), assignee: A, eligibleMin: 0 },
      ]),
    ).toEqual([
      {
        kind: "night",
        assignee: A,
        days: ["2026-11-03", "2026-11-07", "2026-11-11"],
        eligibleMin: { low: 0, high: 1 },
      },
    ]);
  });

  it("keeps 12h and night breaks of one person apart, and other people apart, in first-seen order", () => {
    expect(
      groupRuleBreaks([
        { kind: "long", shift: at("2026-11-02T06:00:00"), assignee: B, eligibleMin: 2 },
        { kind: "night", shift: at("2026-11-02T18:00:00"), assignee: B, eligibleMin: 0 },
        { kind: "long", shift: at("2026-11-04T06:00:00"), assignee: A, eligibleMin: 1 },
        { kind: "long", shift: at("2026-11-09T06:00:00"), assignee: B, eligibleMin: 2 },
      ]),
    ).toEqual([
      { kind: "long", assignee: B, days: ["2026-11-02", "2026-11-09"], eligibleMin: { low: 2, high: 2 } },
      { kind: "night", assignee: B, days: ["2026-11-02"], eligibleMin: { low: 0, high: 0 } },
      { kind: "long", assignee: A, days: ["2026-11-04"], eligibleMin: { low: 1, high: 1 } },
    ]);
  });

  it("lists a station day once when an override gave the person two breaking shifts on it", () => {
    expect(
      groupRuleBreaks([
        { kind: "long", shift: at("2026-11-05T06:00:00"), assignee: A, eligibleMin: 0 },
        { kind: "long", shift: at("2026-11-05T18:00:00"), assignee: A, eligibleMin: 0 },
      ]),
    ).toEqual([{ kind: "long", assignee: A, days: ["2026-11-05"], eligibleMin: { low: 0, high: 0 } }]);
  });

  it("returns no groups for no breaks", () => {
    expect(groupRuleBreaks([])).toEqual([]);
  });
});

describe("a shift belongs to the station day that starts at 06:00", () => {
  it("puts 00:00–06:00 on the previous date, across a month end", () => {
    expect(stationDayOf("2026-11-05T06:00:00")).toBe("2026-11-05");
    expect(stationDayOf("2026-11-05T22:00:00")).toBe("2026-11-05");
    expect(stationDayOf("2026-12-01T00:00:00")).toBe("2026-11-30");
  });

  it("groups shifts by station day in input order", () => {
    const shifts = [
      { starts_at: "2026-11-01T06:00:00" },
      { starts_at: "2026-11-01T18:00:00" },
      { starts_at: "2026-11-02T00:00:00" },
      { starts_at: "2026-11-02T06:00:00" },
    ];
    expect(shiftsByStationDay(shifts)).toEqual(
      new Map([
        ["2026-11-01", [shifts[0], shifts[1], shifts[2]]],
        ["2026-11-02", [shifts[3]]],
      ]),
    );
  });
});

// Test plan §6.4: a failed read must never look like "nobody is available". Literal fixtures, no Supabase client.
const ALICE: ScheduleMember = { id: "a", email: "alice@example.com", role: "employee" };
const BOB: ScheduleMember = { id: "b", email: "bob@example.com", role: "employee" };
const MONTH_WINDOW: ScheduleWindowRow = {
  id: "w1",
  employee_id: "a",
  starts_at: "2026-11-02T06:00:00",
  ends_at: "2026-11-02T18:00:00",
};
const CARRY_OVER: ScheduleWindowRow = {
  id: "w0",
  employee_id: "b",
  starts_at: "2026-10-31T22:00:00",
  ends_at: "2026-11-01T18:00:00",
};

const LAST_NIGHT_WINDOW: ScheduleWindowRow = {
  id: "w9",
  employee_id: "a",
  starts_at: "2026-12-01T00:00:00",
  ends_at: "2026-12-01T08:00:00",
};
const PREVIOUS_NIGHT: ScheduleShiftRow = {
  id: "s0",
  starts_at: "2026-10-31T18:00:00",
  ends_at: "2026-11-01T06:00:00",
  employee_id: "b",
};
const NEXT_MORNING: ScheduleShiftRow = {
  id: "s9",
  starts_at: "2026-12-01T06:00:00",
  ends_at: "2026-12-01T18:00:00",
  employee_id: "a",
};

function ok<T>(data: T[]): PagedResult<T> {
  return { data, error: null };
}
const FAILED: PagedResult<never> = { data: null, error: { message: "boom" } };

function results(overrides: Partial<Parameters<typeof buildScheduleInputs>[0]> = {}) {
  return {
    members: ok([ALICE, BOB]),
    windows: ok([MONTH_WINDOW]),
    carryOvers: ok<ScheduleWindowRow>([]),
    lastNightWindows: ok<ScheduleWindowRow>([]),
    previousNight: ok<ScheduleShiftRow>([]),
    nextMorning: ok<ScheduleShiftRow>([]),
    ...overrides,
  };
}

describe("schedule inputs are ready only when every list was read in full", () => {
  it.each([
    ["the members read failed", results({ members: FAILED })],
    ["the windows read failed", results({ windows: FAILED })],
    ["the carry-over read failed", results({ carryOvers: FAILED })],
    ["the next month's day-1 night read failed", results({ lastNightWindows: FAILED })],
    ["the previous month's last night read failed", results({ previousNight: FAILED })],
    ["the next month's first morning read failed", results({ nextMorning: FAILED })],
  ])("is unknown when %s", (_name, input) => {
    expect(buildScheduleInputs(input)).toEqual({ status: "unknown" });
  });

  it("joins the carry-overs, the month's windows and the next month's day-1 night windows", () => {
    expect(
      buildScheduleInputs(
        results({
          carryOvers: ok([CARRY_OVER]),
          lastNightWindows: ok([LAST_NIGHT_WINDOW]),
          previousNight: ok([PREVIOUS_NIGHT]),
          nextMorning: ok([NEXT_MORNING]),
        }),
      ),
    ).toEqual({
      status: "ready",
      members: [ALICE, BOB],
      windows: [CARRY_OVER, MONTH_WINDOW, LAST_NIGHT_WINDOW],
      previousNight: PREVIOUS_NIGHT,
      nextMorning: NEXT_MORNING,
    });
  });

  it("has no previous night or next morning when those months have no draft (a legitimate none)", () => {
    const inputs = buildScheduleInputs(results());
    expect(inputs.status === "ready" && inputs.previousNight).toBeNull();
    expect(inputs.status === "ready" && inputs.nextMorning).toBeNull();
  });

  it("flags a member without availability only after a complete read", () => {
    // The legitimate "none": Bob has no window at all, and every list was read in full.
    const inputs = buildScheduleInputs(results());
    expect(inputs.status).toBe("ready");
    if (inputs.status !== "ready") return;
    const summary = summarizeSchedule({
      month: "2026-11",
      members: inputs.members,
      windows: inputs.windows,
      shifts: [{ starts_at: "2026-11-02T06:00:00", ends_at: "2026-11-02T18:00:00", employee_id: null }],
    });
    expect(
      summary.perMember.map(({ id, hasAvailability, zeroShifts }) => ({ id, hasAvailability, zeroShifts })),
    ).toEqual([
      { id: "a", hasAvailability: true, zeroShifts: true },
      { id: "b", hasAvailability: false, zeroShifts: false },
    ]);
  });
});
