import { afterEach, describe, expect, it, vi } from "vitest";

import {
  addMonths,
  buildWindow,
  calendarWeeks,
  currentStationMonth,
  dayOfMonth,
  daysInMonth,
  formatCarryOver,
  formatDay,
  formatMonth,
  formatStationInstant,
  formatWindow,
  formatWindowCompact,
  mondayWeekdayIndex,
  parseDate,
  parseMonth,
  parseTime,
  sameWeekdayDatesInMonth,
  startsInPreviousStationNight,
  teamAvailabilityMonths,
  timestampFromWallClockMinutes,
  upcomingMonths,
  wallClockMinutes,
  weekdayName,
  windowMinutes,
} from "./availability";

// Every expected value below is a literal taken from the calendar and the EU DST rule (last Sunday of March and
// October at 01:00 UTC), never computed with a helper under test. The runner is in UTC, like the Worker.

function freezeClockAt(instant: string): void {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(instant));
}

afterEach(() => {
  vi.useRealTimers();
});

const OVERNIGHT_OCT_31 = { starts_at: "2026-10-31T19:00:00", ends_at: "2026-11-01T07:00:00" };

describe("station month flips at Warsaw midnight, not UTC midnight", () => {
  it.each([
    { instant: "2026-03-31T21:59:59Z", month: "2026-03" },
    { instant: "2026-03-31T22:00:00Z", month: "2026-04" }, // CEST, UTC+2
    { instant: "2026-10-31T22:59:59Z", month: "2026-10" },
    { instant: "2026-10-31T23:00:00Z", month: "2026-11" }, // CET, UTC+1
    { instant: "2026-12-31T22:59:59Z", month: "2026-12" },
    { instant: "2026-12-31T23:00:00Z", month: "2027-01" },
  ])("at $instant the station month is $month", ({ instant, month }) => {
    freezeClockAt(instant);
    expect(currentStationMonth()).toBe(month);
  });
});

describe("offered months follow the station month, so the wrong month never becomes editable or visible", () => {
  it.each([
    { instant: "2026-12-31T22:59:59Z", months: ["2027-01", "2027-02", "2027-03"] },
    { instant: "2026-12-31T23:00:00Z", months: ["2027-02", "2027-03", "2027-04"] },
  ])("at $instant /availability offers $months", ({ instant, months }) => {
    freezeClockAt(instant);
    expect(upcomingMonths()).toEqual(months);
  });

  it("at 2026-10-31T23:00:00Z the team view offers November 2026 to February 2027", () => {
    freezeClockAt("2026-10-31T23:00:00Z");
    expect(teamAvailabilityMonths()).toEqual(["2026-11", "2026-12", "2027-01", "2027-02"]);
  });
});

describe("month arithmetic crosses the year boundary", () => {
  it.each([
    { month: "2026-12", offset: 1, expected: "2027-01" },
    { month: "2027-01", offset: -1, expected: "2026-12" },
  ])("$month shifted by $offset is $expected", ({ month, offset, expected }) => {
    expect(addMonths(month, offset)).toBe(expected);
  });
});

describe("calendar validity knows leap years and short months", () => {
  it.each([
    "2028-02-29", // 29 February in the leap year 2028
    "2026-10-31", // day 31 of a 31-day month in October–December
    "2026-11-01", // a day 1–9
  ])("accepts %s, which is on the calendar", (date) => {
    expect(parseDate(date)).toBe(date);
  });

  it.each(["2027-02-29", "2026-04-31"])("rejects %s, which is not on the calendar", (date) => {
    expect(parseDate(date)).toBeNull();
  });

  it("rejects 12026-10-31, which is not YYYY-MM-DD", () => {
    expect(parseDate("12026-10-31")).toBeNull();
  });

  it("treats a missing ?day= param (null) as no date", () => {
    expect(parseDate(null)).toBeNull();
  });

  it("gives February 2028 29 days", () => {
    const days = daysInMonth("2028-02");
    expect(days).toHaveLength(29);
    expect(days.at(-1)).toBe("2028-02-29");
  });

  it("gives February 2027 28 days", () => {
    const days = daysInMonth("2027-02");
    expect(days).toHaveLength(28);
    expect(days.at(-1)).toBe("2027-02-28");
  });
});

describe("a month input accepts every calendar month and nothing else", () => {
  it.each(["2026-10", "2026-12", "2027-01"])("accepts %s", (month) => {
    expect(parseMonth(month)).toBe(month);
  });

  it.each([
    "2026-13", // there is no 13th month
    "2026-00", // there is no month 0
    "2026-10-31", // a date, not a month
    "12026-10", // not YYYY-MM
    null, // a missing ?month= param
  ])("rejects %s", (value) => {
    expect(parseMonth(value)).toBeNull();
  });
});

describe("a time input accepts 00:00–23:59 as HH:MM and nothing else, so windows are built from real clock times", () => {
  it.each(["00:00", "07:00", "23:59"])("accepts %s", (time) => {
    expect(parseTime(time)).toBe(time);
  });

  it.each([
    "24:00", // the day has no hour 24
    "07:60", // the hour has no minute 60
    "7:00", // not zero-padded
    "07:00:00", // carries seconds
    null, // a missing form field
  ])("rejects %s", (value) => {
    expect(parseTime(value)).toBeNull();
  });
});

describe("overnight windows end on the next calendar day across month, year and DST boundaries", () => {
  it.each([
    {
      date: "2026-10-31",
      start: "19:00",
      end: "07:00",
      starts_at: "2026-10-31T19:00:00",
      ends_at: "2026-11-01T07:00:00",
    },
    {
      date: "2028-02-28",
      start: "22:00",
      end: "06:00",
      starts_at: "2028-02-28T22:00:00",
      ends_at: "2028-02-29T06:00:00",
    },
    {
      date: "2026-12-31",
      start: "22:00",
      end: "06:00",
      starts_at: "2026-12-31T22:00:00",
      ends_at: "2027-01-01T06:00:00",
    },
    // Full day on the spring-forward day.
    {
      date: "2026-03-29",
      start: "00:00",
      end: "00:00",
      starts_at: "2026-03-29T00:00:00",
      ends_at: "2026-03-30T00:00:00",
    },
    // Full day on the fall-back day.
    {
      date: "2026-10-25",
      start: "00:00",
      end: "00:00",
      starts_at: "2026-10-25T00:00:00",
      ends_at: "2026-10-26T00:00:00",
    },
    // Same-day control.
    {
      date: "2026-10-31",
      start: "08:00",
      end: "16:00",
      starts_at: "2026-10-31T08:00:00",
      ends_at: "2026-10-31T16:00:00",
    },
  ])("$date $start–$end runs $starts_at → $ends_at", ({ date, start, end, starts_at, ends_at }) => {
    expect(buildWindow(date, start, end)).toEqual({ starts_at, ends_at });
  });
});

describe("window durations are wall-clock differences with no DST correction", () => {
  it.each([
    {
      label: "00:00–00:00 on the spring-forward day",
      starts_at: "2026-03-29T00:00:00",
      ends_at: "2026-03-30T00:00:00",
      minutes: 1440,
    },
    {
      label: "00:00–00:00 on the fall-back day",
      starts_at: "2026-10-25T00:00:00",
      ends_at: "2026-10-26T00:00:00",
      minutes: 1440,
    },
    {
      label: "01:00–04:00 across the skipped hour",
      starts_at: "2026-03-29T01:00:00",
      ends_at: "2026-03-29T04:00:00",
      minutes: 180,
    },
    {
      label: "19:00–07:00 into the next month",
      starts_at: "2026-10-31T19:00:00",
      ends_at: "2026-11-01T07:00:00",
      minutes: 720,
    },
    {
      label: "22:30–06:15 into the next month, counting the minutes",
      starts_at: "2026-10-31T22:30:00",
      ends_at: "2026-11-01T06:15:00",
      minutes: 465, // 90 minutes to midnight + 6h15
    },
  ])("$label is $minutes minutes", ({ starts_at, ends_at, minutes }) => {
    expect(windowMinutes({ starts_at, ends_at })).toBe(minutes);
  });
});

describe("wall-clock minutes are a calendar axis with no DST, so shifts can be offset without new Date(...)", () => {
  it("counts from 1970-01-01T00:00 with 1440 minutes per day", () => {
    expect(wallClockMinutes("1970-01-01T00:00:00")).toBe(0);
    expect(wallClockMinutes("1970-01-02T06:30:00")).toBe(1830); // 1440 + 6h30
  });

  it.each([
    "2026-10-31T23:30:00", // last half hour of a month
    "2026-11-01T00:00:00", // first minute of the next month
    "2026-12-31T23:59:00", // year end
    "2026-03-29T02:30:00", // inside the hour the spring-forward day skips
    "2026-10-25T02:30:00", // inside the hour the fall-back day repeats
    "2028-02-29T06:00:00", // leap day
  ])("%s survives a round trip", (timestamp) => {
    expect(timestampFromWallClockMinutes(wallClockMinutes(timestamp))).toBe(timestamp);
  });

  it.each([
    { from: "2026-10-31T23:30:00", minutes: 30, to: "2026-11-01T00:00:00" }, // across a month end
    { from: "2026-03-28T18:00:00", minutes: 720, to: "2026-03-29T06:00:00" }, // across the spring-forward night
    { from: "2026-10-24T18:00:00", minutes: 720, to: "2026-10-25T06:00:00" }, // across the fall-back night
    { from: "2026-10-25T18:00:00", minutes: 720, to: "2026-10-26T06:00:00" },
    { from: "2028-02-28T18:00:00", minutes: 720, to: "2028-02-29T06:00:00" }, // into the leap day
  ])("$from + $minutes min is $to", ({ from, minutes, to }) => {
    expect(timestampFromWallClockMinutes(wallClockMinutes(from) + minutes)).toBe(to);
  });
});

describe("weekday repeats land on the same weekday every week of the month", () => {
  it.each([
    { date: "2026-10-18", dates: ["2026-10-04", "2026-10-11", "2026-10-18", "2026-10-25"] }, // Sundays
    { date: "2026-10-31", dates: ["2026-10-03", "2026-10-10", "2026-10-17", "2026-10-24", "2026-10-31"] }, // Saturdays
    { date: "2028-02-29", dates: ["2028-02-01", "2028-02-08", "2028-02-15", "2028-02-22", "2028-02-29"] }, // Tuesdays
  ])("from $date repeats on $dates", ({ date, dates }) => {
    expect(sameWeekdayDatesInMonth(date)).toEqual(dates);
  });
});

describe("the calendar grid is Monday-first", () => {
  it.each([
    { date: "2026-10-01", index: 3 }, // Thursday
    { date: "2026-11-01", index: 6 }, // Sunday
  ])("$date has Monday-based weekday index $index", ({ date, index }) => {
    expect(mondayWeekdayIndex(date)).toBe(index);
  });

  it("pads November 2026 (starts on a Sunday) to 6 weeks", () => {
    const weeks = calendarWeeks("2026-11");
    expect(weeks).toHaveLength(6);
    expect(weeks.at(0)).toEqual([null, null, null, null, null, null, "2026-11-01"]);
    expect(weeks.at(-1)).toEqual(["2026-11-30", null, null, null, null, null, null]);
  });

  it("fits February 2027 (starts on a Monday) in exactly 4 weeks with no padding", () => {
    const cells = calendarWeeks("2027-02");
    expect(cells).toHaveLength(4);
    expect(cells.flat()).not.toContain(null);
    expect(cells.flat().at(0)).toBe("2027-02-01");
    expect(cells.flat().at(-1)).toBe("2027-02-28");
  });
});

// Labels avoid September: en-GB short September is "Sept" or "Sep" depending on the ICU version.
describe("labels name the calendar day, not a shifted one", () => {
  it.each([
    { date: "2028-02-29", name: "Tuesday" },
    { date: "2026-03-29", name: "Sunday" },
  ])("$date is a $name", ({ date, name }) => {
    expect(weekdayName(date)).toBe(name);
  });

  it("formats 2026-10-31 as Sat 31 Oct", () => {
    expect(formatDay("2026-10-31")).toBe("Sat 31 Oct");
  });

  it("formats 2026-11 as November 2026", () => {
    expect(formatMonth("2026-11")).toBe("November 2026");
  });

  it.each([
    { date: "2026-11-01", day: 1 },
    { date: "2026-10-31", day: 31 },
  ])("the calendar cell for $date shows day $day", ({ date, day }) => {
    expect(dayOfMonth(date)).toBe(day);
  });
});

describe("overnight windows are marked as ending on the next day", () => {
  it("full text marks the window with (+1)", () => {
    expect(formatWindow(OVERNIGHT_OCT_31)).toBe("19:00 – 07:00 (+1)");
  });

  it("compact text marks the window with +1", () => {
    expect(formatWindowCompact(OVERNIGHT_OCT_31)).toBe("19–07+1");
  });

  it("the carry-over into 1 November names the day it started", () => {
    expect(formatCarryOver(OVERNIGHT_OCT_31)).toBe("00:00 – 07:00 (from Sat 31 Oct)");
  });
});

describe("same-day windows carry no next-day marker and keep their minutes", () => {
  const SAME_DAY_OCT_31 = { starts_at: "2026-10-31T08:30:00", ends_at: "2026-10-31T16:00:00" };

  it("full text has no (+1)", () => {
    expect(formatWindow(SAME_DAY_OCT_31)).toBe("08:30 – 16:00");
  });

  it("compact text has no +1 and keeps the half hour", () => {
    expect(formatWindowCompact(SAME_DAY_OCT_31)).toBe("08:30–16");
  });
});

describe("a window starting on day 1 before 06:00 belongs to the previous month's last station night", () => {
  it("00:00 and 05:59 on the 1st are in the previous month's last night", () => {
    expect(startsInPreviousStationNight("2026-12-01T00:00:00")).toBe(true);
    expect(startsInPreviousStationNight("2026-12-01T05:59:00")).toBe(true);
  });

  it("06:00 on the 1st starts the month's own first station day", () => {
    expect(startsInPreviousStationNight("2026-12-01T06:00:00")).toBe(false);
  });

  it("before 06:00 on any other day stays in the month", () => {
    expect(startsInPreviousStationNight("2026-12-02T02:00:00")).toBe(false);
    expect(startsInPreviousStationNight("2026-12-10T01:00:00")).toBe(false);
  });
});

describe("station instants are shown in Warsaw time", () => {
  it.each([
    { input: "2026-10-31T22:59:00+00:00", output: "31 Oct 2026, 23:59" },
    { input: "2026-10-31T23:00:00+00:00", output: "1 Nov 2026, 00:00" },
    { input: "2026-03-29T01:00:00+00:00", output: "29 Mar 2026, 03:00" }, // first CEST minute
    { input: "2026-10-25T00:30:00+00:00", output: "25 Oct 2026, 02:30" }, // 02:30 CEST
    { input: "2026-10-25T01:30:00+00:00", output: "25 Oct 2026, 02:30" }, // 02:30 CET, no zone marker
  ])("$input is $output", ({ input, output }) => {
    expect(formatStationInstant(input)).toBe(output);
  });
});
