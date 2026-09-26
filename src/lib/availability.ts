// Station-time and window-shaping rules shared by /availability and /api/availability/*.
//
// availability_windows.starts_at / ends_at are Europe/Warsaw wall-clock `timestamp without time zone`
// values that PostgREST returns as "YYYY-MM-DDTHH:MM:SS". They are handled as strings and calendar parts
// only: parsing them with `new Date(...)` on a UTC Worker would shift them. Calendar math below runs
// `Date.UTC` on date parts and reads the result back with getUTC*.

// Must match the 'Europe/Warsaw' literal in public.is_availability_month_editable
// (supabase/migrations/20260926120000_create_availability.sql).
export const STATION_TIME_ZONE = "Europe/Warsaw";

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE_PATTERN = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface WindowTimes {
  starts_at: string;
  ends_at: string;
}

function pad(value: number, width = 2): string {
  return String(value).padStart(width, "0");
}

function toDateString(utcMs: number): string {
  const date = new Date(utcMs);
  return `${pad(date.getUTCFullYear(), 4)}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

function toMonthString(utcMs: number): string {
  return toDateString(utcMs).slice(0, 7);
}

function splitMonth(month: string): [number, number] {
  const [year, monthIndex] = month.split("-").map(Number);
  return [year, monthIndex - 1];
}

function splitDate(date: string): [number, number, number] {
  const [year, month, day] = date.split("-").map(Number);
  return [year, month - 1, day];
}

function dateToUtcMs(date: string): number {
  const [year, monthIndex, day] = splitDate(date);
  return Date.UTC(year, monthIndex, day);
}

/** The current month at the station, as `YYYY-MM`. */
export function currentStationMonth(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: STATION_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());
  const year = parts.find((part) => part.type === "year")?.value ?? "";
  const month = parts.find((part) => part.type === "month")?.value ?? "";
  return `${year}-${month}`;
}

/** `month` shifted by `offset` months, as `YYYY-MM`. */
export function addMonths(month: string, offset: number): string {
  const [year, monthIndex] = splitMonth(month);
  return toMonthString(Date.UTC(year, monthIndex + offset, 1));
}

/** The `count` months after the current station month, as `YYYY-MM`. */
export function upcomingMonths(count = 3): string[] {
  const current = currentStationMonth();
  return Array.from({ length: count }, (_, index) => addMonths(current, index + 1));
}

export function parseMonth(value: unknown): string | null {
  return typeof value === "string" && MONTH_PATTERN.test(value) ? value : null;
}

/** Accepts `YYYY-MM-DD` for a date that exists on the calendar. */
export function parseDate(value: unknown): string | null {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) {
    return null;
  }
  return toDateString(dateToUtcMs(value)) === value ? value : null;
}

/** Accepts `HH:MM` (00–23, 00–59). */
export function parseTime(value: unknown): string | null {
  return typeof value === "string" && TIME_PATTERN.test(value) ? value : null;
}

/** The month a `YYYY-MM-DD` date belongs to, as `YYYY-MM`. */
export function monthOfDate(date: string): string {
  return date.slice(0, 7);
}

/** First day of the month, as `YYYY-MM-DD`. */
export function monthStart(month: string): string {
  return `${month}-01`;
}

/**
 * A window on `date` from `start` to `end` as wall-clock strings.
 * When `end <= start` the window ends on the next calendar day, so 00:00–00:00 is a full 24h day.
 */
export function buildWindow(date: string, start: string, end: string): WindowTimes {
  const endDate = end <= start ? toDateString(dateToUtcMs(date) + DAY_MS) : date;
  return { starts_at: `${date}T${start}:00`, ends_at: `${endDate}T${end}:00` };
}

/** Every date in the month of `date` with the same weekday, including `date` itself. */
export function sameWeekdayDatesInMonth(date: string): string[] {
  const [, , day] = splitDate(date);
  const firstSameWeekday = ((day - 1) % 7) + 1;
  return daysInMonth(monthOfDate(date)).filter((_, index) => (index + 1 - firstSameWeekday) % 7 === 0);
}

/** Every date of the month, as `YYYY-MM-DD`. */
export function daysInMonth(month: string): string[] {
  const [year, monthIndex] = splitMonth(month);
  const count = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  return Array.from({ length: count }, (_, index) => `${month}-${pad(index + 1)}`);
}

/** `"19:00 – 07:00 (+1)"` style text; `(+1)` marks a window ending on the next day. */
export function formatWindow(row: WindowTimes): string {
  const start = row.starts_at.slice(11, 16);
  const end = row.ends_at.slice(11, 16);
  const nextDay = row.ends_at.slice(0, 10) !== row.starts_at.slice(0, 10);
  return `${start} – ${end}${nextDay ? " (+1)" : ""}`;
}

function compactTime(time: string): string {
  return time.endsWith(":00") ? time.slice(0, 2) : time;
}

/** `"08–16"`, `"08:30–16"`, `"19–07+1"` style text for a calendar cell. */
export function formatWindowCompact(row: WindowTimes): string {
  const start = compactTime(row.starts_at.slice(11, 16));
  const end = compactTime(row.ends_at.slice(11, 16));
  const nextDay = row.ends_at.slice(0, 10) !== row.starts_at.slice(0, 10);
  return `${start}–${end}${nextDay ? "+1" : ""}`;
}

/** Day of the month (1–31) of a `YYYY-MM-DD` date. */
export function dayOfMonth(date: string): number {
  return splitDate(date)[2];
}

/** Monday-based weekday index of a `YYYY-MM-DD` date: 0 = Monday … 6 = Sunday. */
export function mondayWeekdayIndex(date: string): number {
  return (new Date(dateToUtcMs(date)).getUTCDay() + 6) % 7;
}

/**
 * The month as Monday-first weeks of 7 cells; `null` pads the cells before day 1 and after the last day.
 */
export function calendarWeeks(month: string): (string | null)[][] {
  const days = daysInMonth(month);
  const leading = mondayWeekdayIndex(monthStart(month));
  const cells: (string | null)[] = [...Array<null>(leading).fill(null), ...days];
  while (cells.length % 7 !== 0) {
    cells.push(null);
  }
  return Array.from({ length: cells.length / 7 }, (_, week) => cells.slice(week * 7, week * 7 + 7));
}

/** Time part (`HH:MM`) of a wall-clock timestamp string. */
export function timeOf(timestamp: string): string {
  return timestamp.slice(11, 16);
}

/** Date part (`YYYY-MM-DD`) of a wall-clock timestamp string. */
export function dateOf(timestamp: string): string {
  return timestamp.slice(0, 10);
}

// Labels are formatted in UTC because the input is a calendar date built with Date.UTC, not an instant.
const WEEKDAY_FORMAT = new Intl.DateTimeFormat("en-GB", { weekday: "long", timeZone: "UTC" });
const DAY_FORMAT = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});
const MONTH_FORMAT = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });

/** `"Monday"` for a `YYYY-MM-DD` date. */
export function weekdayName(date: string): string {
  return WEEKDAY_FORMAT.format(dateToUtcMs(date));
}

/** `"Mon 5 Oct"` for a `YYYY-MM-DD` date. */
export function formatDay(date: string): string {
  return DAY_FORMAT.format(dateToUtcMs(date));
}

/** `"October 2026"` for a `YYYY-MM` month. */
export function formatMonth(month: string): string {
  return MONTH_FORMAT.format(dateToUtcMs(monthStart(month)));
}

/** User-facing message for a failed availability write, keyed by PostgREST error code. */
export function describeWriteError(error: { code: string; message: string }): string {
  switch (error.code) {
    case "23P01":
      return "Overlaps an existing window";
    case "23514":
      return "Invalid window (must be at most 24h)";
    case "42501":
      return "This month is locked or no longer editable";
    default:
      return error.message;
  }
}

/**
 * Redirect target for /api/availability/*; `month` is null when the submitted month could not be parsed.
 * `day` (`YYYY-MM-DD`) keeps the selected day and is only included together with `month`.
 */
export function availabilityUrl(
  month: string | null,
  result: { error: string } | { updated: true },
  day?: string | null,
): string {
  const status = "error" in result ? `error=${encodeURIComponent(result.error)}` : "updated=1";
  if (!month) {
    return `/availability?${status}`;
  }
  return day ? `/availability?month=${month}&day=${day}&${status}` : `/availability?month=${month}&${status}`;
}
