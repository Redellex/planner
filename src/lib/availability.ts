// Station-time and window-shaping rules shared by /availability and /api/availability/*.
//
// availability_windows.starts_at / ends_at are Europe/Warsaw wall-clock `timestamp without time zone`
// values that PostgREST returns as "YYYY-MM-DDTHH:MM:SS". They are handled as strings and calendar parts
// only: parsing them with `new Date(...)` on a UTC Worker would shift them. Calendar math below runs
// `Date.UTC` on date parts and reads the result back with getUTC*.

// Must match the 'Europe/Warsaw' literal in public.is_availability_month_editable
// (supabase/migrations/20260926130000_create_availability.sql).
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

/** The months /manager/availability offers: the current station month plus the upcoming ones, as `YYYY-MM`. */
export function teamAvailabilityMonths(): string[] {
  return [currentStationMonth(), ...upcomingMonths()];
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

const DAY_MINUTES = 24 * 60;

/**
 * A wall-clock timestamp (`YYYY-MM-DDTHH:MM…`) as minutes on the `Date.UTC` calendar axis (minute 0 is
 * 1970-01-01T00:00). Every day has 1440 minutes, so differences are wall-clock durations with no DST correction.
 */
export function wallClockMinutes(timestamp: string): number {
  // Fixed positions read by char code: the generator and the schedule summary parse every window this way, and on a
  // cold Worker the split/map version alone cost several ms of the Free plan's 10 ms CPU budget.
  return (
    Date.UTC(digitsAt(timestamp, 0, 4), digitsAt(timestamp, 5, 7) - 1, digitsAt(timestamp, 8, 10)) / 60000 +
    digitsAt(timestamp, 11, 13) * 60 +
    digitsAt(timestamp, 14, 16)
  );
}

/** The decimal digits of `text` in `[start, end)` as a number. */
function digitsAt(text: string, start: number, end: number): number {
  let value = 0;
  for (let index = start; index < end; index++) {
    value = value * 10 + text.charCodeAt(index) - 48;
  }
  return value;
}

/** The inverse of `wallClockMinutes`: `"YYYY-MM-DDTHH:MM:00"`. */
export function timestampFromWallClockMinutes(minutes: number): string {
  const day = Math.floor(minutes / DAY_MINUTES);
  const minuteOfDay = minutes - day * DAY_MINUTES;
  return `${toDateString(day * DAY_MS)}T${pad(Math.floor(minuteOfDay / 60))}:${pad(minuteOfDay % 60)}:00`;
}

/** Wall-clock length of a window in minutes, with no DST correction (00:00–00:00 is always 24h). */
export function windowMinutes(row: WindowTimes): number {
  return wallClockMinutes(row.ends_at) - wallClockMinutes(row.starts_at);
}

/** `"0h"`, `"8h"`, `"37h 20m"` style text for a number of minutes. */
export function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
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

/** `"00:00 – 04:00 (from Sat 31 Oct)"`: the day-1 part of an overnight window from the previous month. */
export function formatCarryOver(row: WindowTimes): string {
  return `00:00 – ${timeOf(row.ends_at)} (from ${formatDay(dateOf(row.starts_at))})`;
}

/** A station day runs from 06:00 to 06:00 the next day (see the schedule). */
export const STATION_DAY_START = "06:00";

/**
 * Whether a window starting at `startsAt` falls in the previous month's last station night (day 1, before 06:00).
 * The generator reads such windows for the previous month, so RLS freezes them while that month is not editable.
 */
export function startsInPreviousStationNight(startsAt: string): boolean {
  return startsAt.slice(8, 10) === "01" && timeOf(startsAt) < STATION_DAY_START;
}

// Unlike the wall-clock window strings, a timestamptz value (e.g. availability_locks.locked_at) is a real
// instant, so it is parsed with Date and shown in station time.
const STATION_INSTANT_FORMAT = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: STATION_TIME_ZONE,
});

/** `"26 Sept 2026, 14:05"` style station-time text for a timestamptz value. */
export function formatStationInstant(timestamptz: string): string {
  return STATION_INSTANT_FORMAT.format(new Date(timestamptz));
}

// Every message /api/availability/* can put in `?error=`. The redirect URLs (and smoke.mjs) depend on the
// exact text, so change a message only together with its callers.
export const INVALID_DATE_ERROR = "Invalid date";
export const INVALID_TIME_ERROR = "Invalid time";
export const INVALID_WINDOW_ID_ERROR = "Invalid window id";
export const INVALID_MONTH_ERROR = "Invalid month";
export const NOT_FOUND_ERROR = "Not found, locked or not permitted";
export const SUPABASE_NOT_CONFIGURED_ERROR = "Supabase is not configured";
export const OVERLAP_ERROR = "Overlaps an existing window";
export const INVALID_WINDOW_ERROR = "Invalid window (must be at most 24h)";
export const MONTH_LOCKED_ERROR = "This month is locked or no longer editable";
/** Shown for any write failure without a specific message; the raw error is logged, never shown. */
export const GENERIC_WRITE_ERROR = "Could not save your availability. Try again.";
/** Shown when /availability cannot read its data; the raw error is logged, never shown. */
export const GENERIC_LOAD_ERROR = "Could not load your availability. Reload the page.";
/** Shown when /manager/availability cannot read its data; the raw error is logged, never shown. */
export const TEAM_LOAD_ERROR = "Could not load team availability. Reload the page.";

/** The `?error=` values /availability shows as-is; anything else is replaced by GENERIC_WRITE_ERROR. */
export const AVAILABILITY_FEEDBACK_ERRORS: ReadonlySet<string> = new Set([
  INVALID_DATE_ERROR,
  INVALID_TIME_ERROR,
  INVALID_WINDOW_ID_ERROR,
  INVALID_MONTH_ERROR,
  NOT_FOUND_ERROR,
  SUPABASE_NOT_CONFIGURED_ERROR,
  OVERLAP_ERROR,
  INVALID_WINDOW_ERROR,
  MONTH_LOCKED_ERROR,
  GENERIC_WRITE_ERROR,
]);

/**
 * Safe text for the `?error=` query param: null when absent or empty, the param itself when it is a known
 * message, GENERIC_WRITE_ERROR otherwise (the URL is user-controlled, so unknown text is never rendered).
 */
export function resolveFeedbackError(param: string | null): string | null {
  if (!param) {
    return null;
  }
  return AVAILABILITY_FEEDBACK_ERRORS.has(param) ? param : GENERIC_WRITE_ERROR;
}

/** Logs a raw availability error server-side; its text is never shown to the user. */
export function logAvailabilityError(context: string, error: unknown): void {
  // eslint-disable-next-line no-console -- the only record of a raw database error is the Worker log
  console.error(`Availability: ${context}`, error);
}

/** User-facing message for a failed availability write, keyed by PostgREST error code. */
export function describeWriteError(error: { code: string; message: string }): string {
  switch (error.code) {
    case "23P01":
      return OVERLAP_ERROR;
    case "23514":
      return INVALID_WINDOW_ERROR;
    case "42501":
      return MONTH_LOCKED_ERROR;
    default:
      logAvailabilityError("write failed", { code: error.code, message: error.message });
      return GENERIC_WRITE_ERROR;
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

/**
 * `/manager/availability` link for a month, optionally keeping the selected day and the employee filter.
 * `employee` must be a profile id the page loaded, never raw URL input.
 */
export function teamAvailabilityUrl(params: { month: string; day?: string | null; employee?: string | null }): string {
  const { month, day, employee } = params;
  const query = [`month=${month}`];
  if (day) {
    query.push(`day=${day}`);
  }
  if (employee) {
    query.push(`employee=${encodeURIComponent(employee)}`);
  }
  return `/manager/availability?${query.join("&")}`;
}
