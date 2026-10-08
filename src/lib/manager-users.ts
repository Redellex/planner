// Messages, redirect URLs and account labels for /manager/users and POST /api/manager/users/role.

export const USER_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Every message /api/manager/users/role can put in `?error=`. smoke.mjs matches LAST_MANAGER_ERROR against
// /last manager/i, so change a message only together with its callers.
export const INVALID_USER_ID_ERROR = "Invalid user id";
export const INVALID_ROLE_ERROR = "Invalid role";
export const SUPABASE_NOT_CONFIGURED_ERROR = "Supabase is not configured";
export const USER_NOT_FOUND_ERROR = "User not found or not permitted";
/** The exact text raised by the `prevent_last_manager_demotion` trigger (it carries no errcode of its own). */
export const LAST_MANAGER_ERROR = "Cannot demote the last manager";
/** Shown for any role write failure without a specific message; the raw error is logged, never shown. */
export const GENERIC_ROLE_WRITE_ERROR = "Could not update the role. Try again.";
/** Shown when /manager/users cannot read the profiles; the raw error is logged, never shown. */
export const GENERIC_USERS_LOAD_ERROR = "Could not load accounts. Reload the page.";
export const ROLE_UPDATED_MESSAGE = "Role updated.";

/** The `?error=` values /manager/users shows as-is; anything else is replaced by GENERIC_ROLE_WRITE_ERROR. */
export const ROLE_FEEDBACK_ERRORS: ReadonlySet<string> = new Set([
  INVALID_USER_ID_ERROR,
  INVALID_ROLE_ERROR,
  SUPABASE_NOT_CONFIGURED_ERROR,
  USER_NOT_FOUND_ERROR,
  LAST_MANAGER_ERROR,
  GENERIC_ROLE_WRITE_ERROR,
]);

/**
 * Safe text for the `?error=` query param: null when absent or empty, the param itself when it is a known
 * message, GENERIC_ROLE_WRITE_ERROR otherwise (the URL is user-controlled, so unknown text is never rendered).
 */
export function resolveRoleFeedbackError(param: string | null): string | null {
  if (!param) {
    return null;
  }
  return ROLE_FEEDBACK_ERRORS.has(param) ? param : GENERIC_ROLE_WRITE_ERROR;
}

/** The `?user=` param when it is a well-formed user id, else null. */
export function parseFeedbackUser(param: string | null): string | null {
  return param && USER_ID_PATTERN.test(param) ? param : null;
}

/** Logs a raw /manager/users error server-side; its text is never shown to the user. */
export function logManagerUsersError(context: string, error: unknown): void {
  // eslint-disable-next-line no-console -- the only record of a raw database error is the Worker log
  console.error(`Manager users: ${context}`, error);
}

/** User-facing message for a failed role update. */
export function describeRoleWriteError(error: { code: string; message: string }): string {
  // The trigger raises a plain exception (P0001), so its message text is the only reliable signal.
  if (error.message === LAST_MANAGER_ERROR) {
    return LAST_MANAGER_ERROR;
  }
  logManagerUsersError("role update failed", { code: error.code, message: error.message });
  return GENERIC_ROLE_WRITE_ERROR;
}

/**
 * Redirect target for /api/manager/users/role. `error=`/`updated=1` is always the first param (smoke.mjs matches
 * the location with `startsWith("/manager/users?error=")`); `user` names the row the result belongs to.
 */
export function managerUsersUrl(result: { error: string } | { updated: true }, userId?: string): string {
  const status = "error" in result ? `error=${encodeURIComponent(result.error)}` : "updated=1";
  const user = userId && USER_ID_PATTERN.test(userId) ? `&user=${userId}` : "";
  return `/manager/users?${status}${user}`;
}

/** Visible text and accessible name for an account; a profile can have an empty email. */
export function accountLabel(profile: { id: string; email: string }): {
  text: string;
  missingEmail: boolean;
  accessibleName: string;
} {
  if (profile.email) {
    return { text: profile.email, missingEmail: false, accessibleName: profile.email };
  }
  const shortId = profile.id.slice(0, 8);
  return { text: `No email · ${shortId}`, missingEmail: true, accessibleName: `user ${shortId}` };
}

/**
 * Short name for a calendar day cell: the email before `@`, or the id's first 8 characters when the email is empty.
 * `public.get_published_schedule` repeats this rule in SQL as the fallback for an empty display name; keep them in step.
 */
export function calendarName(profile: { id: string; email: string }): string {
  const at = profile.email.indexOf("@");
  if (at > 0) return profile.email.slice(0, at);
  return profile.email || profile.id.slice(0, 8);
}
