// Messages, redirect URLs and reads for /manager/schedule and its endpoints (filled in by the schedule flow).

/**
 * Shown on /manager/months when an unlock is refused because the month has a draft schedule (the
 * `schedules.month` foreign key restricts deleting its `availability_locks` row, SQLSTATE 23503). smoke.mjs and the
 * schedule page share this text, so change it only together with its callers.
 */
export const UNLOCK_WITH_DRAFT_ERROR = "Discard this month's draft schedule before unlocking it.";
