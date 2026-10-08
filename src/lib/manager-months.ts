// Messages, redirect URLs and the lock read for /manager/months and POST /api/manager/months/lock.

import { parseMonth, upcomingMonths } from "./availability";
import { UNLOCK_WITH_DRAFT_ERROR, UNLOCK_WITH_PUBLISHED_ERROR } from "./schedule";

export { UNLOCK_WITH_DRAFT_ERROR, UNLOCK_WITH_PUBLISHED_ERROR };

// Every message /api/manager/months/lock can put in `?error=`. smoke.mjs compares the decoded param with
// UNLOCK_WITH_DRAFT_ERROR exactly, so change a message only together with its callers.
export const INVALID_MONTH_ERROR = "Invalid month";
export const INVALID_ACTION_ERROR = "Invalid action";
export const SUPABASE_NOT_CONFIGURED_ERROR = "Supabase is not configured";
/** Shown for any lock write failure without a specific message; the raw error is logged, never shown. */
export const GENERIC_LOCK_WRITE_ERROR = "Could not update the month. Try again.";
/** Shown when /manager/months cannot read the month locks; the raw error is logged, never shown. */
export const MONTHS_LOAD_ERROR = "Could not load the month locks. Reload the page.";
export const MONTH_UPDATED_MESSAGE = "Month updated.";

/** The `?error=` values /manager/months shows as-is; anything else is replaced by GENERIC_LOCK_WRITE_ERROR. */
export const MONTHS_FEEDBACK_ERRORS: ReadonlySet<string> = new Set([
  INVALID_MONTH_ERROR,
  INVALID_ACTION_ERROR,
  SUPABASE_NOT_CONFIGURED_ERROR,
  GENERIC_LOCK_WRITE_ERROR,
  UNLOCK_WITH_DRAFT_ERROR,
  UNLOCK_WITH_PUBLISHED_ERROR,
]);

/**
 * Safe text for the `?error=` query param: null when absent or empty, the param itself when it is a known
 * message, GENERIC_LOCK_WRITE_ERROR otherwise (the URL is user-controlled, so unknown text is never rendered).
 */
export function resolveMonthsFeedbackError(param: string | null): string | null {
  if (!param) {
    return null;
  }
  return MONTHS_FEEDBACK_ERRORS.has(param) ? param : GENERIC_LOCK_WRITE_ERROR;
}

/**
 * Redirect target for /api/manager/months/lock. `error=`/`updated=1` is always the first param (smoke.mjs matches
 * the location with `startsWith("/manager/months?error=")` and `?updated=1`); `month` names the row the result
 * belongs to.
 */
export function monthsUrl(result: { error: string } | { updated: true }, month?: string): string {
  const status = "error" in result ? `error=${encodeURIComponent(result.error)}` : "updated=1";
  const target = parseMonth(month);
  return `/manager/months?${status}${target === null ? "" : `&month=${target}`}`;
}

export type LockAction = "lock" | "unlock";

/** True when an unlock failed because the month still has a schedule: schedules.month restricts deleting its lock row. */
export function isUnlockBlockedBySchedule(action: LockAction, error: { code?: string }): boolean {
  return action === "unlock" && error.code === "23503";
}

/**
 * The `?error=` text for a failed lock write. An unlock blocked by a schedule names the step to take first
 * (`published`: the month's schedule is published; false also when it could not be read, so smoke.mjs still matches
 * the draft message); anything else is GENERIC_LOCK_WRITE_ERROR.
 */
export function describeLockWriteError(action: LockAction, error: { code?: string }, published: boolean): string {
  if (isUnlockBlockedBySchedule(action, error)) {
    return published ? UNLOCK_WITH_PUBLISHED_ERROR : UNLOCK_WITH_DRAFT_ERROR;
  }
  return GENERIC_LOCK_WRITE_ERROR;
}

/** The `?month=` param when it is one of the months /manager/months lists, else null (feedback goes to the top). */
export function parseMonthParam(param: string | null): string | null {
  const month = parseMonth(param);
  return month !== null && upcomingMonths().includes(month) ? month : null;
}

export type MonthLocks =
  | {
      state: "ready";
      /** month (`YYYY-MM`) -> locked_at; a listed month without an entry is open. */
      lockedAt: Map<string, string>;
    }
  | { state: "unknown" };

/**
 * The page may show lock states and Lock/Unlock buttons only when the locks were read. On an error or no data it
 * is unknown, so a failed read can never list a locked month as "Open".
 */
export function buildMonthLocks(result: {
  data: { month: string; locked_at: string }[] | null;
  error: unknown;
}): MonthLocks {
  if (result.error || result.data === null) {
    return { state: "unknown" };
  }
  const lockedAt = new Map<string, string>();
  for (const lock of result.data) {
    // `month` is a date (`YYYY-MM-01`).
    lockedAt.set(lock.month.slice(0, 7), lock.locked_at);
  }
  return { state: "ready", lockedAt };
}

/** Logs a raw /manager/months error server-side; its text is never shown to the user. */
export function logMonthsError(context: string, error: unknown): void {
  // eslint-disable-next-line no-console -- the only record of a raw database error is the Worker log
  console.error(`Months: ${context}`, error);
}
