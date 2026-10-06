// Messages, redirect URLs and reads for /manager/schedule and POST /api/manager/schedule/*.

import type { Tables } from "@/db/database.types";

import {
  addMonths,
  currentStationMonth,
  dateOf,
  monthStart,
  timestampFromWallClockMinutes,
  upcomingMonths,
  wallClockMinutes,
} from "./availability";
import type { createClient } from "./supabase";
import { loadAllPages, type PagedResult } from "./team-availability";

/**
 * Shown on /manager/months when an unlock is refused because the month has a draft schedule (the
 * `schedules.month` foreign key restricts deleting its `availability_locks` row, SQLSTATE 23503). smoke.mjs and the
 * schedule page share this text, so change it only together with its callers.
 */
export const UNLOCK_WITH_DRAFT_ERROR = "Discard this month's draft schedule before unlocking it.";
/** Shown on /manager/months only, when an unlock is refused because the month's schedule is published. */
export const UNLOCK_WITH_PUBLISHED_ERROR = "Unpublish and discard this month's schedule before unlocking it.";

// Every message /api/manager/schedule/* can put in `?error=`. smoke.mjs may match these texts, so change a message
// only together with its callers.
export const INVALID_MONTH_ERROR = "Invalid month";
export const SUPABASE_NOT_CONFIGURED_ERROR = "Supabase is not configured";
export const CONFIRM_REPLACE_ERROR = "Confirm replacing the current draft";
/** A team read for generation was not complete; the month stays locked and no draft is written. */
export const GENERATE_LOAD_ERROR =
  "Could not read the team's availability. Nothing was generated; the month stays locked.";
export const NOT_PERMITTED_ERROR = "Not permitted";
/** The month's lock disappeared before the draft was written (schedules.month FK, SQLSTATE 23503). */
export const MONTH_UNLOCKED_ERROR = "The month was unlocked; generate again";
export const NO_DRAFT_ERROR = "No draft to discard";
/** Shown for any schedule write failure without a specific message; the raw error is logged, never shown. */
export const GENERIC_SCHEDULE_WRITE_ERROR = "Could not save the schedule. Try again.";
/** Shown when /manager/schedule cannot read its data; the raw error is logged, never shown. */
export const SCHEDULE_LOAD_ERROR = "Could not load the schedule. Reload the page.";
/** The month's schedule is published (SQLSTATE SP001): generate, regenerate, discard and override are refused. */
export const SCHEDULE_PUBLISHED_ERROR = "Unpublish the schedule before changing it.";
/** A station day has no one assigned, so the month cannot be published (SQLSTATE SP003). */
export const PUBLISH_GAPS_ERROR = "Assign someone on every day before publishing.";
/** The overridden shift is not in the month's current draft (regenerated, discarded or published in between). */
export const STALE_SHIFT_ERROR = "This shift is no longer in the draft. Reload and try again.";
export const INVALID_ASSIGNEE_ERROR = "Invalid assignee";
/** Publish or unpublish found no schedule row for the month (SQLSTATE SP002). */
export const NO_SCHEDULE_ERROR = "No schedule for this month";
export const GENERATED_MESSAGE = "Draft generated.";
export const DISCARDED_MESSAGE = "Draft discarded.";
export const OVERRIDDEN_MESSAGE = "Shift updated.";
export const PUBLISHED_MESSAGE = "Schedule published.";
export const UNPUBLISHED_MESSAGE = "Schedule unpublished. It is a draft again.";

/** The `?error=` values /manager/schedule shows as-is; anything else is replaced by GENERIC_SCHEDULE_WRITE_ERROR. */
export const SCHEDULE_FEEDBACK_ERRORS: ReadonlySet<string> = new Set([
  INVALID_MONTH_ERROR,
  SUPABASE_NOT_CONFIGURED_ERROR,
  CONFIRM_REPLACE_ERROR,
  GENERATE_LOAD_ERROR,
  NOT_PERMITTED_ERROR,
  MONTH_UNLOCKED_ERROR,
  NO_DRAFT_ERROR,
  GENERIC_SCHEDULE_WRITE_ERROR,
  SCHEDULE_PUBLISHED_ERROR,
  PUBLISH_GAPS_ERROR,
  STALE_SHIFT_ERROR,
  INVALID_ASSIGNEE_ERROR,
  NO_SCHEDULE_ERROR,
]);

/**
 * Safe text for the `?error=` query param: null when absent or empty, the param itself when it is a known
 * message, GENERIC_SCHEDULE_WRITE_ERROR otherwise (the URL is user-controlled, so unknown text is never rendered).
 */
export function resolveScheduleFeedbackError(param: string | null): string | null {
  if (!param) {
    return null;
  }
  return SCHEDULE_FEEDBACK_ERRORS.has(param) ? param : GENERIC_SCHEDULE_WRITE_ERROR;
}

/** Logs a raw schedule error server-side; its text is never shown to the user. */
export function logScheduleError(context: string, error: unknown): void {
  // eslint-disable-next-line no-console -- the only record of a raw database error is the Worker log
  console.error(`Schedule: ${context}`, error);
}

/** User-facing message for a failed schedule read or write, keyed by PostgREST error code. */
export function describeScheduleWriteError(error: { code: string; message: string }): string {
  switch (error.code) {
    case "42501":
      return NOT_PERMITTED_ERROR;
    case "23503":
      return MONTH_UNLOCKED_ERROR;
    // A draft for the month appeared between the existing-draft check and the replace (double submit, or two
    // managers at once): ask for the explicit replace instead of reporting a failure.
    case "23505":
      return CONFIRM_REPLACE_ERROR;
    // Raised by replace_schedule_draft, publish_schedule and unpublish_schedule.
    case "SP001":
      return SCHEDULE_PUBLISHED_ERROR;
    case "SP002":
      return NO_SCHEDULE_ERROR;
    case "SP003":
      return PUBLISH_GAPS_ERROR;
    default:
      logScheduleError("unmapped write error", { code: error.code, message: error.message });
      return GENERIC_SCHEDULE_WRITE_ERROR;
  }
}

export interface ManagerScheduleUrlParams {
  /** `YYYY-MM`, already validated; null when the submitted month could not be parsed. */
  month: string | null;
  /** `YYYY-MM-DD` station day of `month`; only included together with `month`. */
  day?: string | null;
  /**
   * Opens a confirmation panel: `replace` for regenerate, `override` for an assignee change with warnings. Only
   * included together with `month`.
   */
  confirm?: "replace" | "override";
  /** The overridden shift's id (a uuid), so its feedback or confirm panel renders in its row; only with `month`. */
  shift?: string | null;
  /**
   * The override's new assignee: a profile id, or null for Uncovered (`employee=none`); left out when undefined.
   * Only included together with `month`.
   */
  employee?: string | null;
  error?: string;
  generated?: boolean;
  discarded?: boolean;
  overridden?: boolean;
  published?: boolean;
  unpublished?: boolean;
}

/**
 * `/manager/schedule` link or redirect target. The status param (`error=`, `generated=1`, `discarded=1`,
 * `overridden=1`, `published=1` or `unpublished=1`) is always first, so a caller can match the location with
 * `startsWith("/manager/schedule?error=")`. Then `month`, `day`, `confirm`, `shift` and `employee`, in that order.
 */
export function managerScheduleUrl(params: ManagerScheduleUrlParams): string {
  const { month, day, confirm, shift, employee, error, generated, discarded, overridden, published, unpublished } =
    params;
  const query: string[] = [];
  if (error) {
    query.push(`error=${encodeURIComponent(error)}`);
  } else if (generated) {
    query.push("generated=1");
  } else if (discarded) {
    query.push("discarded=1");
  } else if (overridden) {
    query.push("overridden=1");
  } else if (published) {
    query.push("published=1");
  } else if (unpublished) {
    query.push("unpublished=1");
  }
  if (month) {
    query.push(`month=${month}`);
    if (day) {
      query.push(`day=${day}`);
    }
    if (confirm) {
      query.push(`confirm=${confirm}`);
    }
    if (shift) {
      query.push(`shift=${encodeURIComponent(shift)}`);
    }
    if (employee !== undefined) {
      query.push(`employee=${employee === null ? "none" : encodeURIComponent(employee)}`);
    }
  }
  return query.length > 0 ? `/manager/schedule?${query.join("&")}` : "/manager/schedule";
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A shift id from a form field or `?shift=`: the value when it is a UUID, null otherwise. */
export function parseShiftParam(value: unknown): string | null {
  return typeof value === "string" && UUID_PATTERN.test(value) ? value : null;
}

/** The months /manager/schedule shows: the current station month plus the next 3, as `YYYY-MM`. */
export function scheduleMonths(): string[] {
  return [currentStationMonth(), ...upcomingMonths()];
}

/** The months a draft can be generated for: the next 3 (the current month is already running). */
export function generatableMonths(): string[] {
  return upcomingMonths();
}

/** The profile columns the schedule reads; email is the only label a profile has. */
export type ScheduleMember = Pick<Tables<"profiles">, "id" | "email" | "role">;
/** The window columns the schedule reads; `id` is the paging tiebreak. */
export type ScheduleWindowRow = Pick<Tables<"availability_windows">, "id" | "employee_id" | "starts_at" | "ends_at">;
/** The shift columns /manager/schedule reads. */
export type ScheduleShiftRow = Pick<Tables<"schedule_shifts">, "id" | "starts_at" | "ends_at" | "employee_id">;

export type ScheduleInputs =
  | { status: "unknown" }
  | {
      status: "ready";
      members: ScheduleMember[];
      /**
       * The month's windows, the previous month's windows that run past day 1 06:00 (carry-overs) and the next
       * month's windows starting on day 1 before 06:00 (the month's last station night).
       */
      windows: ScheduleWindowRow[];
      /**
       * The previous month's draft shift that ends at 06:00 on day 1 (its last night), or null when that month has no
       * draft. Its assignee must not start at 06:00 on day 1 (no back-to-back shifts across months).
       */
      previousNight: ScheduleShiftRow | null;
      /**
       * The next month's draft shift that starts at 06:00 on its day 1 (its first morning), or null when that month
       * has no draft. The summary reports this month's last night when the same person holds both (back to back
       * across months); the generator does not read it.
       */
      nextMorning: ScheduleShiftRow | null;
    };

/**
 * Generation and the draft summary may use the team's availability only when the members, the month's windows and
 * the carry-overs were all read in full; otherwise nobody may be flagged "No shifts" or left uncovered for lack of
 * availability, and nothing may be generated.
 */
export function buildScheduleInputs(results: {
  members: PagedResult<ScheduleMember>;
  windows: PagedResult<ScheduleWindowRow>;
  carryOvers: PagedResult<ScheduleWindowRow>;
  lastNightWindows: PagedResult<ScheduleWindowRow>;
  previousNight: PagedResult<ScheduleShiftRow>;
  nextMorning: PagedResult<ScheduleShiftRow>;
}): ScheduleInputs {
  const { members, windows, carryOvers, lastNightWindows, previousNight, nextMorning } = results;
  if (
    members.data === null ||
    windows.data === null ||
    carryOvers.data === null ||
    lastNightWindows.data === null ||
    previousNight.data === null ||
    nextMorning.data === null
  ) {
    return { status: "unknown" };
  }
  return {
    status: "ready",
    members: members.data,
    windows: [...carryOvers.data, ...windows.data, ...lastNightWindows.data],
    previousNight: previousNight.data[0] ?? null,
    nextMorning: nextMorning.data[0] ?? null,
  };
}

type ScheduleClient = NonNullable<ReturnType<typeof createClient>>;

// Each response is capped at PostgREST's max_rows; loadAllPages follows the exact count, so a cap below this page
// size costs requests, not rows. Every read orders by `id` last so pages never overlap or skip rows.
export const SCHEDULE_PAGE_SIZE = 1000;

/**
 * Reads every profile, every window starting in `month`, every previous-month window that runs past day 1 06:00 (the
 * first station day's start) and every next-month window starting on day 1 before 06:00 (the month's last station
 * night; RLS freezes those while `month` is locked), each in full or not at all, plus the previous month's last night
 * shift and the next month's first morning shift. Later next-month windows are never read: that month is not locked,
 * so they could still change.
 */
export async function loadScheduleInputs(supabase: ScheduleClient, month: string): Promise<ScheduleInputs> {
  const firstDay = monthStart(month);
  const nextFirstDay = monthStart(addMonths(month, 1));
  const [members, windows, carryOvers, lastNightWindows, previousNight, nextMorning] = await Promise.all([
    loadAllPages(
      (from, to) =>
        supabase
          .from("profiles")
          .select("id, email, role", { count: "exact" })
          .order("email", { ascending: true })
          .order("id", { ascending: true })
          .range(from, to),
      SCHEDULE_PAGE_SIZE,
    ),
    // No employee_id filter: the whole team's availability.
    loadAllPages(
      (from, to) =>
        supabase
          .from("availability_windows")
          .select("id, employee_id, starts_at, ends_at", { count: "exact" })
          .gte("starts_at", firstDay)
          .lt("starts_at", monthStart(addMonths(month, 1)))
          .order("starts_at", { ascending: true })
          .order("id", { ascending: true })
          .range(from, to),
      SCHEDULE_PAGE_SIZE,
    ),
    loadAllPages(
      (from, to) =>
        supabase
          .from("availability_windows")
          .select("id, employee_id, starts_at, ends_at", { count: "exact" })
          .lt("starts_at", firstDay)
          .gt("ends_at", `${firstDay}T06:00:00`)
          .order("id", { ascending: true })
          .range(from, to),
      SCHEDULE_PAGE_SIZE,
    ),
    loadAllPages(
      (from, to) =>
        supabase
          .from("availability_windows")
          .select("id, employee_id, starts_at, ends_at", { count: "exact" })
          .gte("starts_at", nextFirstDay)
          .lt("starts_at", `${nextFirstDay}T06:00:00`)
          .order("id", { ascending: true })
          .range(from, to),
      SCHEDULE_PAGE_SIZE,
    ),
    // At most one row: shifts never overlap station-wide.
    loadAllPages(
      (from, to) =>
        supabase
          .from("schedule_shifts")
          .select("id, starts_at, ends_at, employee_id", { count: "exact" })
          .eq("month", monthStart(addMonths(month, -1)))
          .eq("ends_at", `${firstDay}T06:00:00`)
          .order("id", { ascending: true })
          .range(from, to),
      SCHEDULE_PAGE_SIZE,
    ),
    // At most one row, for the same reason.
    loadAllPages(
      (from, to) =>
        supabase
          .from("schedule_shifts")
          .select("id, starts_at, ends_at, employee_id", { count: "exact" })
          .eq("month", nextFirstDay)
          .eq("starts_at", `${nextFirstDay}T06:00:00`)
          .order("id", { ascending: true })
          .range(from, to),
      SCHEDULE_PAGE_SIZE,
    ),
  ]);

  if (members.error) {
    logScheduleError("could not load team members", members.error);
  }
  if (windows.error) {
    logScheduleError("could not load team windows", windows.error);
  }
  if (carryOvers.error) {
    logScheduleError("could not load team carry-over windows", carryOvers.error);
  }
  if (lastNightWindows.error) {
    logScheduleError("could not load the next month's day-1 night windows", lastNightWindows.error);
  }
  if (previousNight.error) {
    logScheduleError("could not load the previous month's last night shift", previousNight.error);
  }
  if (nextMorning.error) {
    logScheduleError("could not load the next month's first morning shift", nextMorning.error);
  }
  return buildScheduleInputs({ members, windows, carryOvers, lastNightWindows, previousNight, nextMorning });
}

const STATION_DAY_START_MINUTES = 6 * 60;

/** The station day (`YYYY-MM-DD`) a shift starting at `timestamp` belongs to: 00:00–06:00 is the previous date's. */
export function stationDayOf(timestamp: string): string {
  return dateOf(timestampFromWallClockMinutes(wallClockMinutes(timestamp) - STATION_DAY_START_MINUTES));
}

/** Shifts grouped by station day, each group in input order (the page reads them ordered by `starts_at`). */
export function shiftsByStationDay<S extends { starts_at: string }>(shifts: readonly S[]): Map<string, S[]> {
  const byDay = new Map<string, S[]>();
  for (const shift of shifts) {
    const day = stationDayOf(shift.starts_at);
    const group = byDay.get(day);
    if (group) {
      group.push(shift);
    } else {
      byDay.set(day, [shift]);
    }
  }
  return byDay;
}
