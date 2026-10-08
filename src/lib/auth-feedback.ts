// Messages for /auth/signin, /auth/signup and their POST endpoints. Supabase's own error text is logged, never shown:
// the endpoints map `AuthError.code` to one of these and the pages render only allow-listed `?error=` values.

export type AuthForm = "signin" | "signup";

export const INVALID_CREDENTIALS_ERROR = "Wrong email or password.";
export const EMAIL_NOT_CONFIRMED_ERROR = "Confirm your email first: open the link we sent you.";
export const ACCOUNT_EXISTS_ERROR = "An account with this email already exists. Sign in instead.";
export const WEAK_PASSWORD_ERROR = "Choose a longer or stronger password.";
export const RATE_LIMIT_ERROR = "Too many attempts. Wait a minute and try again.";
/** Shown for any sign-in failure without a specific message. */
export const GENERIC_SIGNIN_ERROR = "Could not sign in. Try again.";
/** Shown for any sign-up failure without a specific message. */
export const GENERIC_SIGNUP_ERROR = "Could not create your account. Try again.";
export const SUPABASE_NOT_CONFIGURED_ERROR = "Supabase is not configured";

const GENERIC_ERROR: Record<AuthForm, string> = {
  signin: GENERIC_SIGNIN_ERROR,
  signup: GENERIC_SIGNUP_ERROR,
};

/** `AuthError.code` values (`@supabase/auth-js` `ErrorCode`) with a message of their own. */
const MESSAGE_BY_CODE: Readonly<Record<string, string>> = {
  invalid_credentials: INVALID_CREDENTIALS_ERROR,
  email_not_confirmed: EMAIL_NOT_CONFIRMED_ERROR,
  user_already_exists: ACCOUNT_EXISTS_ERROR,
  email_exists: ACCOUNT_EXISTS_ERROR,
  weak_password: WEAK_PASSWORD_ERROR,
  over_request_rate_limit: RATE_LIMIT_ERROR,
  over_email_send_rate_limit: RATE_LIMIT_ERROR,
};

/** The `?error=` values /auth/signin shows as-is; anything else is replaced by GENERIC_SIGNIN_ERROR. */
export const SIGNIN_FEEDBACK_ERRORS: ReadonlySet<string> = new Set([
  INVALID_CREDENTIALS_ERROR,
  EMAIL_NOT_CONFIRMED_ERROR,
  RATE_LIMIT_ERROR,
  GENERIC_SIGNIN_ERROR,
  SUPABASE_NOT_CONFIGURED_ERROR,
]);

/** The `?error=` values /auth/signup shows as-is; anything else is replaced by GENERIC_SIGNUP_ERROR. */
export const SIGNUP_FEEDBACK_ERRORS: ReadonlySet<string> = new Set([
  ACCOUNT_EXISTS_ERROR,
  WEAK_PASSWORD_ERROR,
  RATE_LIMIT_ERROR,
  GENERIC_SIGNUP_ERROR,
  SUPABASE_NOT_CONFIGURED_ERROR,
]);

const FEEDBACK_ERRORS: Record<AuthForm, ReadonlySet<string>> = {
  signin: SIGNIN_FEEDBACK_ERRORS,
  signup: SIGNUP_FEEDBACK_ERRORS,
};

/**
 * User-facing message for a failed sign-in or sign-up. A code without a message of its own, or no code at all,
 * gives the form's generic message, so Supabase's text never reaches the URL.
 */
export function describeAuthError(form: AuthForm, error: { code?: string; message: string }): string {
  const message = error.code === undefined ? undefined : MESSAGE_BY_CODE[error.code];
  // A message that belongs to the other form (e.g. "account exists" on sign-in) would be refused by this page's
  // allow-list anyway, so fall back to the generic text here already.
  return message !== undefined && FEEDBACK_ERRORS[form].has(message) ? message : GENERIC_ERROR[form];
}

/**
 * Safe text for the `?error=` query param of one form: null when absent or empty, the param itself when it is a
 * known message of that form, the form's generic message otherwise (the URL is user-controlled).
 */
export function resolveAuthFeedbackError(form: AuthForm, param: string | null): string | null {
  if (!param) {
    return null;
  }
  return FEEDBACK_ERRORS[form].has(param) ? param : GENERIC_ERROR[form];
}

/** Logs a raw auth error server-side: Supabase's code and message, never the submitted form fields. */
export function logAuthError(context: string, error: { code?: string; message: string }): void {
  // eslint-disable-next-line no-console -- the only record of a raw auth error is the Worker log
  console.error(`Auth: ${context}`, { code: error.code, message: error.message });
}
