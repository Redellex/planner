import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ACCOUNT_EXISTS_ERROR,
  describeAuthError,
  EMAIL_NOT_CONFIRMED_ERROR,
  GENERIC_SIGNIN_ERROR,
  GENERIC_SIGNUP_ERROR,
  INVALID_CREDENTIALS_ERROR,
  logAuthError,
  RATE_LIMIT_ERROR,
  resolveAuthFeedbackError,
  SIGNIN_FEEDBACK_ERRORS,
  SIGNUP_FEEDBACK_ERRORS,
  SUPABASE_NOT_CONFIGURED_ERROR,
  WEAK_PASSWORD_ERROR,
} from "./auth-feedback";

const raw = (code: string | undefined) => ({ code, message: `raw Supabase text for ${String(code)}` });

describe("describeAuthError maps an AuthError code to a known message", () => {
  it("maps the sign-in codes", () => {
    expect(describeAuthError("signin", raw("invalid_credentials"))).toBe(INVALID_CREDENTIALS_ERROR);
    expect(describeAuthError("signin", raw("email_not_confirmed"))).toBe(EMAIL_NOT_CONFIRMED_ERROR);
    expect(describeAuthError("signin", raw("over_request_rate_limit"))).toBe(RATE_LIMIT_ERROR);
    expect(describeAuthError("signin", raw("over_email_send_rate_limit"))).toBe(RATE_LIMIT_ERROR);
  });
  it("maps the sign-up codes", () => {
    expect(describeAuthError("signup", raw("user_already_exists"))).toBe(ACCOUNT_EXISTS_ERROR);
    expect(describeAuthError("signup", raw("email_exists"))).toBe(ACCOUNT_EXISTS_ERROR);
    expect(describeAuthError("signup", raw("weak_password"))).toBe(WEAK_PASSWORD_ERROR);
    expect(describeAuthError("signup", raw("over_request_rate_limit"))).toBe(RATE_LIMIT_ERROR);
    expect(describeAuthError("signup", raw("over_email_send_rate_limit"))).toBe(RATE_LIMIT_ERROR);
  });
  it("gives the form's generic message for an unknown or missing code", () => {
    expect(describeAuthError("signin", raw("unexpected_failure"))).toBe(GENERIC_SIGNIN_ERROR);
    expect(describeAuthError("signin", raw(undefined))).toBe(GENERIC_SIGNIN_ERROR);
    expect(describeAuthError("signup", raw("unexpected_failure"))).toBe(GENERIC_SIGNUP_ERROR);
    expect(describeAuthError("signup", raw(undefined))).toBe(GENERIC_SIGNUP_ERROR);
  });
  it("gives the generic message for a code whose message belongs to the other form", () => {
    expect(describeAuthError("signin", raw("weak_password"))).toBe(GENERIC_SIGNIN_ERROR);
    expect(describeAuthError("signup", raw("invalid_credentials"))).toBe(GENERIC_SIGNUP_ERROR);
  });
  it("never returns Supabase's own text", () => {
    expect(describeAuthError("signin", { message: "Invalid login credentials" })).toBe(GENERIC_SIGNIN_ERROR);
  });
  it("only ever returns a message its own page shows", () => {
    const codes = [
      "invalid_credentials",
      "email_not_confirmed",
      "user_already_exists",
      "email_exists",
      "weak_password",
      "over_request_rate_limit",
      "over_email_send_rate_limit",
      "unexpected_failure",
      undefined,
    ];
    for (const code of codes) {
      expect(SIGNIN_FEEDBACK_ERRORS.has(describeAuthError("signin", raw(code)))).toBe(true);
      expect(SIGNUP_FEEDBACK_ERRORS.has(describeAuthError("signup", raw(code)))).toBe(true);
    }
  });
});

describe("resolveAuthFeedbackError shows only allow-listed ?error= text", () => {
  it("returns null without an error", () => {
    expect(resolveAuthFeedbackError("signin", null)).toBeNull();
    expect(resolveAuthFeedbackError("signin", "")).toBeNull();
    expect(resolveAuthFeedbackError("signup", null)).toBeNull();
    expect(resolveAuthFeedbackError("signup", "")).toBeNull();
  });
  it("keeps a known message of the same form", () => {
    expect(resolveAuthFeedbackError("signin", INVALID_CREDENTIALS_ERROR)).toBe(INVALID_CREDENTIALS_ERROR);
    expect(resolveAuthFeedbackError("signin", SUPABASE_NOT_CONFIGURED_ERROR)).toBe(SUPABASE_NOT_CONFIGURED_ERROR);
    expect(resolveAuthFeedbackError("signup", ACCOUNT_EXISTS_ERROR)).toBe(ACCOUNT_EXISTS_ERROR);
    expect(resolveAuthFeedbackError("signup", WEAK_PASSWORD_ERROR)).toBe(WEAK_PASSWORD_ERROR);
  });
  it("replaces a crafted sentence with the form's generic message", () => {
    expect(resolveAuthFeedbackError("signin", "Your account is suspended, call 555-0100")).toBe(GENERIC_SIGNIN_ERROR);
    expect(resolveAuthFeedbackError("signup", "<script>alert(1)</script>")).toBe(GENERIC_SIGNUP_ERROR);
    // Supabase's raw text, as the endpoints redirected with before this change.
    expect(resolveAuthFeedbackError("signin", "Invalid login credentials")).toBe(GENERIC_SIGNIN_ERROR);
  });
  it("replaces the other form's message with this form's generic message", () => {
    expect(resolveAuthFeedbackError("signin", ACCOUNT_EXISTS_ERROR)).toBe(GENERIC_SIGNIN_ERROR);
    expect(resolveAuthFeedbackError("signin", GENERIC_SIGNUP_ERROR)).toBe(GENERIC_SIGNIN_ERROR);
    expect(resolveAuthFeedbackError("signup", INVALID_CREDENTIALS_ERROR)).toBe(GENERIC_SIGNUP_ERROR);
    expect(resolveAuthFeedbackError("signup", GENERIC_SIGNIN_ERROR)).toBe(GENERIC_SIGNUP_ERROR);
  });
});

describe("logAuthError", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });
  it("logs only the code and the message", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const error = Object.assign(new Error("Invalid login credentials"), {
      code: "invalid_credentials",
      email: "ann@example.com",
    });
    logAuthError("sign-in failed", error);
    expect(spy).toHaveBeenCalledWith("Auth: sign-in failed", {
      code: "invalid_credentials",
      message: "Invalid login credentials",
    });
  });
});
