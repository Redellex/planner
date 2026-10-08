// The read and URLs behind /schedule: a published month for every signed-in user, from one
// `get_published_schedule` call. The function returns rows only while the month is published, and no email or role.

import { monthStart } from "./availability";
import type { createClient } from "./supabase";

/** Shown instead of the schedule when the read fails; never "Not published yet" (test-plan §6.4). */
export const PUBLISHED_SCHEDULE_LOAD_ERROR = "Could not load the schedule. Reload the page.";
export const NOT_PUBLISHED_MESSAGE = "Not published yet";

/**
 * One `get_published_schedule` row. Declared here rather than taken from the generated types, which mark every column
 * of a `returns table` function as non-null; `assignee_name` is null on an uncovered shift. The function returns no
 * profile id: `is_own` marks the caller's shifts.
 */
export interface PublishedScheduleRow {
  id: string;
  starts_at: string;
  ends_at: string;
  assignee_name: string | null;
  is_own: boolean;
  published_at: string;
}

export interface PublishedShift {
  id: string;
  starts_at: string;
  ends_at: string;
  /**
   * Display name, else email prefix, else id prefix; null when the shift is uncovered (never assigned, or the
   * assignee's account was deleted).
   */
  assignee_name: string | null;
  /** The viewer's own shift. */
  is_own: boolean;
}

export type PublishedSchedule =
  { kind: "unknown" } | { kind: "notPublished" } | { kind: "published"; publishedAt: string; shifts: PublishedShift[] };

/**
 * The page state for one `get_published_schedule` result. A published month always has shifts (publish needs someone
 * on every station day, and its shifts cannot be deleted while it is published), so `[]` means not published. An
 * error, no data, or an own shift without a name (an inconsistent read) is unknown.
 */
export function buildPublishedSchedule(result: {
  data: PublishedScheduleRow[] | null;
  error: unknown;
}): PublishedSchedule {
  const { data, error } = result;
  if (error || data === null) {
    return { kind: "unknown" };
  }
  if (data.length === 0) {
    return { kind: "notPublished" };
  }
  if (data.some((row) => row.is_own && row.assignee_name === null)) {
    return { kind: "unknown" };
  }
  return {
    kind: "published",
    publishedAt: data[0].published_at,
    shifts: data.map(({ id, starts_at, ends_at, assignee_name, is_own }) => ({
      id,
      starts_at,
      ends_at,
      assignee_name,
      is_own,
    })),
  };
}

/** The `ScheduleCalendar` key of the viewer's own shifts (its `ownEmployeeId`). */
export const OWN_ASSIGNEE_KEY = "own";

/**
 * The key `ScheduleCalendar` reads as `employee_id` (labels and "You"). No profile id reaches the page, so own shifts
 * share OWN_ASSIGNEE_KEY, everyone else's shift is keyed by its own id, and an uncovered shift is null.
 */
export function calendarAssigneeKey(shift: PublishedShift): string | null {
  if (shift.assignee_name === null) {
    return null;
  }
  return shift.is_own ? OWN_ASSIGNEE_KEY : `shift:${shift.id}`;
}

/** Logs a raw /schedule error server-side; its text is never shown to the user. */
export function logPublishedScheduleError(context: string, error: unknown): void {
  // eslint-disable-next-line no-console -- the only record of a raw database error is the Worker log
  console.error(`Published schedule: ${context}`, error);
}

/** Reads `month` (`YYYY-MM`) in one call, so the result never mixes a published and an unpublished state. */
export async function loadPublishedSchedule(
  supabase: NonNullable<ReturnType<typeof createClient>>,
  month: string,
): Promise<PublishedSchedule> {
  const { data, error } = await supabase.rpc("get_published_schedule", { target_month: monthStart(month) });
  if (error) {
    logPublishedScheduleError("could not load the published schedule", error);
  }
  const state = buildPublishedSchedule({ data, error });
  if (!error && state.kind === "unknown") {
    logPublishedScheduleError("inconsistent published schedule read", { month });
  }
  return state;
}

/** `/schedule` link: `month`, then `day`. */
export function publishedScheduleUrl(params: { month: string; day?: string | null }): string {
  const day = params.day ? `&day=${params.day}` : "";
  return `/schedule?month=${params.month}${day}`;
}
