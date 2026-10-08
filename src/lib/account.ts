// Validation, messages and redirect URLs for /account and POST /api/account/display-name.

/** The longest display name; `profiles_display_name_shape` and `public.set_display_name` enforce the same limit. */
export const DISPLAY_NAME_MAX = 40;

// Every message /api/account/display-name can put in `?error=`. smoke.mjs matches DISPLAY_NAME_TOO_LONG_ERROR, so
// change a message only together with its callers.
export const DISPLAY_NAME_TOO_LONG_ERROR = `Use at most ${DISPLAY_NAME_MAX} characters for your name.`;
export const DISPLAY_NAME_CHARACTERS_ERROR = "Remove tabs, line breaks and invisible characters from your name.";
/** Shown for any name write failure without a specific message; the raw error is logged, never shown. */
export const GENERIC_DISPLAY_NAME_WRITE_ERROR = "Could not save your name. Try again.";
export const SUPABASE_NOT_CONFIGURED_ERROR = "Supabase is not configured";
export const DISPLAY_NAME_UPDATED_MESSAGE = "Name saved.";
/** Shown when /account cannot read the user's own profile; the raw error is logged, never shown. */
export const ACCOUNT_LOAD_ERROR = "Could not load your account. Reload the page.";

/** The `?error=` values /account shows as-is; anything else is replaced by GENERIC_DISPLAY_NAME_WRITE_ERROR. */
export const ACCOUNT_FEEDBACK_ERRORS: ReadonlySet<string> = new Set([
  DISPLAY_NAME_TOO_LONG_ERROR,
  DISPLAY_NAME_CHARACTERS_ERROR,
  GENERIC_DISPLAY_NAME_WRITE_ERROR,
  SUPABASE_NOT_CONFIGURED_ERROR,
]);

/**
 * Characters a name may not contain anywhere: controls (tab, line breaks), zero-width characters and bidi controls,
 * which would render a colleague's name blank or reordered. `profiles_display_name_shape` and
 * `public.set_display_name` (migration 20261007150000) refuse the same set; keep the two in step.
 */
const DISPLAY_NAME_FORBIDDEN =
  // eslint-disable-next-line no-control-regex -- refusing control characters is the point of this pattern
  /[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u2028\u2029\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/;

/**
 * The form value as the name to store: trimmed (`String.prototype.trim`, the same whitespace the database trims),
 * empty becomes null (back to the email prefix).
 */
export function parseDisplayName(value: unknown): { ok: true; name: string | null } | { ok: false; error: string } {
  if (typeof value !== "string") {
    return { ok: false, error: GENERIC_DISPLAY_NAME_WRITE_ERROR };
  }
  const name = value.trim();
  // Code points, like the database's char_length (`.length` counts an emoji as 2).
  // eslint-disable-next-line @typescript-eslint/no-misused-spread -- code points are the unit the database counts
  if ([...name].length > DISPLAY_NAME_MAX) {
    return { ok: false, error: DISPLAY_NAME_TOO_LONG_ERROR };
  }
  if (DISPLAY_NAME_FORBIDDEN.test(name)) {
    return { ok: false, error: DISPLAY_NAME_CHARACTERS_ERROR };
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
  // 22023: a control, zero-width or bidi-control character (a direct RPC call that skipped parseDisplayName).
  if (error.code === "22023") {
    return DISPLAY_NAME_CHARACTERS_ERROR;
  }
  logAccountError("display name update failed", { code: error.code, message: error.message });
  return GENERIC_DISPLAY_NAME_WRITE_ERROR;
}
