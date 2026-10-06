import { describe, expect, it } from "vitest";

import {
  buildScheduleInputs,
  CONFIRM_REPLACE_ERROR,
  describeScheduleWriteError,
  GENERATE_LOAD_ERROR,
  GENERIC_SCHEDULE_WRITE_ERROR,
  managerScheduleUrl,
  MONTH_UNLOCKED_ERROR,
  NO_DRAFT_ERROR,
  NOT_PERMITTED_ERROR,
  resolveScheduleFeedbackError,
  shiftsByStationDay,
  stationDayOf,
  type ScheduleMember,
  type ScheduleWindowRow,
} from "./schedule";
import { summarizeSchedule } from "./schedule-summary";
import type { PagedResult } from "./team-availability";

describe("only known messages from ?error= are shown", () => {
  it.each([CONFIRM_REPLACE_ERROR, GENERATE_LOAD_ERROR, NOT_PERMITTED_ERROR, MONTH_UNLOCKED_ERROR, NO_DRAFT_ERROR])(
    "shows %s as-is",
    (message) => {
      expect(resolveScheduleFeedbackError(message)).toBe(message);
    },
  );

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
    expect(managerScheduleUrl({ month: "2026-11", day: "2026-11-05", confirm: true })).toBe(
      "/manager/schedule?month=2026-11&day=2026-11-05&confirm=replace",
    );
    expect(managerScheduleUrl({ month: null, day: "2026-11-05" })).toBe("/manager/schedule");
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

function ok<T>(data: T[]): PagedResult<T> {
  return { data, error: null };
}
const FAILED: PagedResult<never> = { data: null, error: { message: "boom" } };

describe("schedule inputs are ready only when every list was read in full", () => {
  it.each([
    ["the members read failed", { members: FAILED, windows: ok([MONTH_WINDOW]), carryOvers: ok([]) }],
    ["the windows read failed", { members: ok([ALICE, BOB]), windows: FAILED, carryOvers: ok([]) }],
    ["the carry-over read failed", { members: ok([ALICE, BOB]), windows: ok([MONTH_WINDOW]), carryOvers: FAILED }],
  ])("is unknown when %s", (_name, results) => {
    expect(buildScheduleInputs(results)).toEqual({ status: "unknown" });
  });

  it("joins the carry-overs and the month's windows", () => {
    expect(
      buildScheduleInputs({ members: ok([ALICE, BOB]), windows: ok([MONTH_WINDOW]), carryOvers: ok([CARRY_OVER]) }),
    ).toEqual({ status: "ready", members: [ALICE, BOB], windows: [CARRY_OVER, MONTH_WINDOW] });
  });

  it("flags a member without availability only after a complete read", () => {
    // The legitimate "none": Bob has no window at all, and every list was read in full.
    const inputs = buildScheduleInputs({ members: ok([ALICE, BOB]), windows: ok([MONTH_WINDOW]), carryOvers: ok([]) });
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
