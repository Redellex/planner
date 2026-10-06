// Messages, redirect URLs and reads for /manager/schedule and POST /api/manager/schedule/{generate,discard}.

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

// Every message /api/manager/schedule/* can put in `?error=`. smoke.mjs may match these texts, so change a message
// only together with its callers.
export const INVALID_MONTH_ERROR = "Invalid month";
export const SUPABASE_NOT_CONFIGURED_ERROR = "Supabase is not configured";
export const CONFIRM_REPLACE_ERROR = "Confirm replacing the current draft";
/** A team read for generation was not complete; the month stays locked and no draft is written. */
export const GENERATE_LOAD_ERROR = "Could not read the team's availability. Nothing was generated.";
export const NOT_PERMITTED_ERROR = "Not permitted";
/** The month's lock disappeared before the draft was written (schedules.month FK, SQLSTATE 23503). */
export const MONTH_UNLOCKED_ERROR = "The month was unlocked; generate again";
export const NO_DRAFT_ERROR = "No draft to discard";
/** Shown for any schedule write failure without a specific message; the raw error is logged, never shown. */
export const GENERIC_SCHEDULE_WRITE_ERROR = "Could not save the schedule. Try again.";
/** Shown when /manager/schedule cannot read its data; the raw error is logged, never shown. */
export const SCHEDULE_LOAD_ERROR = "Could not load the schedule. Reload the page.";
export const GENERATED_MESSAGE = "Draft generated.";
export const DISCARDED_MESSAGE = "Draft discarded.";

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
  /** Opens the regenerate confirmation panel; only included together with `month`. */
  confirm?: boolean;
  error?: string;
  generated?: boolean;
  discarded?: boolean;
}

/**
 * `/manager/schedule` link or redirect target. The status param (`error=`, `generated=1` or `discarded=1`) is
 * always first, so a caller can match the location with `startsWith("/manager/schedule?error=")`.
 */
export function managerScheduleUrl(params: ManagerScheduleUrlParams): string {
  const { month, day, confirm, error, generated, discarded } = params;
  const query: string[] = [];
  if (error) {
    query.push(`error=${encodeURIComponent(error)}`);
  } else if (generated) {
    query.push("generated=1");
  } else if (discarded) {
    query.push("discarded=1");
  }
  if (month) {
    query.push(`month=${month}`);
    if (day) {
      query.push(`day=${day}`);
    }
    if (confirm) {
      query.push("confirm=replace");
    }
  }
  return query.length > 0 ? `/manager/schedule?${query.join("&")}` : "/manager/schedule";
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
      /** The month's windows plus the previous month's windows that run past day 1 06:00 (carry-overs). */
      windows: ScheduleWindowRow[];
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
}): ScheduleInputs {
  const { members, windows, carryOvers } = results;
  if (members.data === null || windows.data === null || carryOvers.data === null) {
    return { status: "unknown" };
  }
  return { status: "ready", members: members.data, windows: [...carryOvers.data, ...windows.data] };
}

type ScheduleClient = NonNullable<ReturnType<typeof createClient>>;

// Each response is capped at PostgREST's max_rows; loadAllPages follows the exact count, so a cap below this page
// size costs requests, not rows. Every read orders by `id` last so pages never overlap or skip rows.
export const SCHEDULE_PAGE_SIZE = 1000;

/**
 * Reads every profile, every window starting in `month` and every previous-month window that runs past day 1 06:00
 * (the first station day's start), each in full or not at all. Windows starting in the next month are never read:
 * that month is not locked, so they could still change.
 */
export async function loadScheduleInputs(supabase: ScheduleClient, month: string): Promise<ScheduleInputs> {
  const firstDay = monthStart(month);
  const [members, windows, carryOvers] = await Promise.all([
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
  return buildScheduleInputs({ members, windows, carryOvers });
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
