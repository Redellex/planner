// Validation, messages and redirect URLs for /account and POST /api/account/display-name.

/** The longest display name; `profiles_display_name_shape` and `public.set_display_name` enforce the same limit. */
export const DISPLAY_NAME_MAX = 40;

// Every message /api/account/display-name can put in `?error=`. smoke.mjs matches DISPLAY_NAME_TOO_LONG_ERROR, so
// change a message only together with its callers.
export const DISPLAY_NAME_TOO_LONG_ERROR = `Use at most ${DISPLAY_NAME_MAX} characters for your name.`;
/** Shown for any name write failure without a specific message; the raw error is logged, never shown. */
export const GENERIC_DISPLAY_NAME_WRITE_ERROR = "Could not save your name. Try again.";
export const SUPABASE_NOT_CONFIGURED_ERROR = "Supabase is not configured";
export const DISPLAY_NAME_UPDATED_MESSAGE = "Name saved.";
/** Shown when /account cannot read the user's own profile; the raw error is logged, never shown. */
export const ACCOUNT_LOAD_ERROR = "Could not load your account. Reload the page.";

/** The `?error=` values /account shows as-is; anything else is replaced by GENERIC_DISPLAY_NAME_WRITE_ERROR. */
export const ACCOUNT_FEEDBACK_ERRORS: ReadonlySet<string> = new Set([
  DISPLAY_NAME_TOO_LONG_ERROR,
  GENERIC_DISPLAY_NAME_WRITE_ERROR,
  SUPABASE_NOT_CONFIGURED_ERROR,
]);

/** The form value as the name to store: trimmed, empty becomes null (back to the email prefix). */
export function parseDisplayName(value: unknown): { ok: true; name: string | null } | { ok: false; error: string } {
  if (typeof value !== "string") {
    return { ok: false, error: GENERIC_DISPLAY_NAME_WRITE_ERROR };
  }
  const name = value.trim();
  if (name.length > DISPLAY_NAME_MAX) {
    return { ok: false, error: DISPLAY_NAME_TOO_LONG_ERROR };
  }
  return { ok: true, name: name === "" ? null : name };
}

/**
 * Safe text for the `?error=` query param: null when absent or empty, the param itself when it is a known
 * message, GENERIC_DISPLAY_NAME_WRITE_ERROR otherwise (the URL is user-controlled, so unknown text is never rendered).
 */
export function resolveAccountFeedbackError(param: string | null): string | null {
  if (!param) {
    return null;
  }
  return ACCOUNT_FEEDBACK_ERRORS.has(param) ? param : GENERIC_DISPLAY_NAME_WRITE_ERROR;
}

/** Redirect target for /api/account/display-name: `error=`/`updated=1` is always the first param. */
export function accountUrl(result: { error: string } | { updated: true }): string {
  const status = "error" in result ? `error=${encodeURIComponent(result.error)}` : "updated=1";
  return `/account?${status}`;
}

/** Logs a raw /account error server-side; its text is never shown to the user. */
export function logAccountError(context: string, error: unknown): void {
  // eslint-disable-next-line no-console -- the only record of a raw database error is the Worker log
  console.error(`Account: ${context}`, error);
}

/** User-facing message for a failed `set_display_name` call. */
export function describeDisplayNameWriteError(error: { code: string; message: string }): string {
  // 22001: the function's own length check (the form's maxlength can be bypassed).
  if (error.code === "22001") {
    return DISPLAY_NAME_TOO_LONG_ERROR;
  }
  logAccountError("display name update failed", { code: error.code, message: error.message });
  return GENERIC_DISPLAY_NAME_WRITE_ERROR;
}
