import { describe, expect, it, vi } from "vitest";

import {
  accountUrl,
  describeDisplayNameWriteError,
  DISPLAY_NAME_TOO_LONG_ERROR,
  GENERIC_DISPLAY_NAME_WRITE_ERROR,
  parseDisplayName,
  resolveAccountFeedbackError,
  SUPABASE_NOT_CONFIGURED_ERROR,
} from "./account";

describe("parseDisplayName stores what colleagues will see", () => {
  it("trims the name", () => {
    expect(parseDisplayName("  Ann  ")).toEqual({ ok: true, name: "Ann" });
  });
  it("turns an empty or blank value into null, back to the email prefix", () => {
    expect(parseDisplayName("")).toEqual({ ok: true, name: null });
    expect(parseDisplayName("   ")).toEqual({ ok: true, name: null });
  });
  it("accepts exactly 40 characters and refuses 41", () => {
    expect(parseDisplayName("x".repeat(40))).toEqual({ ok: true, name: "x".repeat(40) });
    expect(parseDisplayName("x".repeat(41))).toEqual({ ok: false, error: DISPLAY_NAME_TOO_LONG_ERROR });
  });
  it("counts the length after trimming", () => {
    expect(parseDisplayName(` ${"x".repeat(40)} `)).toEqual({ ok: true, name: "x".repeat(40) });
  });
  it("refuses a missing field or a file", () => {
    expect(parseDisplayName(null)).toEqual({ ok: false, error: GENERIC_DISPLAY_NAME_WRITE_ERROR });
    expect(parseDisplayName(new Blob(["Ann"]))).toEqual({ ok: false, error: GENERIC_DISPLAY_NAME_WRITE_ERROR });
  });
});

describe("only allow-listed ?error= text is shown", () => {
  it("returns null without an error", () => {
    expect(resolveAccountFeedbackError(null)).toBeNull();
    expect(resolveAccountFeedbackError("")).toBeNull();
  });
  it("keeps a known message", () => {
    expect(resolveAccountFeedbackError(DISPLAY_NAME_TOO_LONG_ERROR)).toBe(DISPLAY_NAME_TOO_LONG_ERROR);
    expect(resolveAccountFeedbackError(SUPABASE_NOT_CONFIGURED_ERROR)).toBe(SUPABASE_NOT_CONFIGURED_ERROR);
  });
  it("replaces unknown text with the generic message", () => {
    expect(resolveAccountFeedbackError("<script>alert(1)</script>")).toBe(GENERIC_DISPLAY_NAME_WRITE_ERROR);
  });
});

describe("accountUrl puts the status param first", () => {
  it("builds the success URL", () => {
    expect(accountUrl({ updated: true })).toBe("/account?updated=1");
  });
  it("encodes the error message", () => {
    expect(accountUrl({ error: DISPLAY_NAME_TOO_LONG_ERROR })).toBe(
      `/account?error=${encodeURIComponent(DISPLAY_NAME_TOO_LONG_ERROR)}`,
    );
  });
});

describe("describeDisplayNameWriteError", () => {
  it("maps 22001 to the too-long message", () => {
    expect(describeDisplayNameWriteError({ code: "22001", message: "too long" })).toBe(DISPLAY_NAME_TOO_LONG_ERROR);
  });
  it("logs anything else and returns the generic message", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(describeDisplayNameWriteError({ code: "42501", message: "not signed in" })).toBe(
      GENERIC_DISPLAY_NAME_WRITE_ERROR,
    );
    expect(log).toHaveBeenCalledOnce();
    log.mockRestore();
  });
});
