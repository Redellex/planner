import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildMonthLocks,
  GENERIC_LOCK_WRITE_ERROR,
  INVALID_ACTION_ERROR,
  INVALID_MONTH_ERROR,
  MONTHS_FEEDBACK_ERRORS,
  monthsUrl,
  parseMonthParam,
  resolveMonthsFeedbackError,
  SUPABASE_NOT_CONFIGURED_ERROR,
  UNLOCK_WITH_DRAFT_ERROR,
  UNLOCK_WITH_PUBLISHED_ERROR,
} from "./manager-months";

function freezeClockAt(instant: string): void {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(instant));
}

afterEach(() => {
  vi.useRealTimers();
});

describe("only allow-listed ?error= text is shown on /manager/months", () => {
  it("returns null without an error", () => {
    expect(resolveMonthsFeedbackError(null)).toBeNull();
    expect(resolveMonthsFeedbackError("")).toBeNull();
  });
  it("keeps every message the lock endpoint sends", () => {
    for (const message of [
      INVALID_MONTH_ERROR,
      INVALID_ACTION_ERROR,
      SUPABASE_NOT_CONFIGURED_ERROR,
      GENERIC_LOCK_WRITE_ERROR,
      UNLOCK_WITH_DRAFT_ERROR,
      UNLOCK_WITH_PUBLISHED_ERROR,
    ]) {
      expect(resolveMonthsFeedbackError(message)).toBe(message);
    }
  });
  it("keeps the exact unlock-refused texts smoke and the schedule flow rely on", () => {
    expect(MONTHS_FEEDBACK_ERRORS.has("Discard this month's draft schedule before unlocking it.")).toBe(true);
    expect(MONTHS_FEEDBACK_ERRORS.has("Unpublish and discard this month's schedule before unlocking it.")).toBe(true);
  });
  it("replaces crafted or raw database text with the generic message", () => {
    expect(resolveMonthsFeedbackError("anything")).toBe(GENERIC_LOCK_WRITE_ERROR);
    expect(
      resolveMonthsFeedbackError('new row violates row-level security policy for table "availability_locks"'),
    ).toBe(GENERIC_LOCK_WRITE_ERROR);
  });
});

describe("monthsUrl puts the status param first", () => {
  it("builds the success URL with and without the month", () => {
    expect(monthsUrl({ updated: true }, "2026-11")).toBe("/manager/months?updated=1&month=2026-11");
    expect(monthsUrl({ updated: true })).toBe("/manager/months?updated=1");
  });
  it("encodes the error message and appends the month after it", () => {
    expect(monthsUrl({ error: UNLOCK_WITH_DRAFT_ERROR }, "2027-01")).toBe(
      `/manager/months?error=${encodeURIComponent(UNLOCK_WITH_DRAFT_ERROR)}&month=2027-01`,
    );
    expect(monthsUrl({ error: INVALID_MONTH_ERROR })).toBe(
      `/manager/months?error=${encodeURIComponent(INVALID_MONTH_ERROR)}`,
    );
  });
  it("drops a month that is not YYYY-MM", () => {
    expect(monthsUrl({ updated: true }, "2026-11&error=x")).toBe("/manager/months?updated=1");
  });
});

describe("parseMonthParam keeps only a month the page lists", () => {
  it("keeps each of the next 3 station months", () => {
    freezeClockAt("2026-10-08T10:00:00Z");
    expect(parseMonthParam("2026-11")).toBe("2026-11");
    expect(parseMonthParam("2026-12")).toBe("2026-12");
    expect(parseMonthParam("2027-01")).toBe("2027-01");
  });
  it("drops the current, a past, a later or a malformed month", () => {
    freezeClockAt("2026-10-08T10:00:00Z");
    expect(parseMonthParam("2026-10")).toBeNull();
    expect(parseMonthParam("2026-09")).toBeNull();
    expect(parseMonthParam("2027-02")).toBeNull();
    expect(parseMonthParam("2026-13")).toBeNull();
    expect(parseMonthParam("november")).toBeNull();
    expect(parseMonthParam(null)).toBeNull();
  });
});

describe("buildMonthLocks fails closed", () => {
  it("is ready with the lock times keyed by YYYY-MM", () => {
    const locks = buildMonthLocks({
      data: [{ month: "2026-11-01", locked_at: "2026-10-05T08:00:00+00:00" }],
      error: null,
    });
    expect(locks).toEqual({ state: "ready", lockedAt: new Map([["2026-11", "2026-10-05T08:00:00+00:00"]]) });
  });
  it("is ready with no rows, so every month is open", () => {
    const locks = buildMonthLocks({ data: [], error: null });
    expect(locks).toEqual({ state: "ready", lockedAt: new Map() });
  });
  it("is unknown when the read failed", () => {
    expect(buildMonthLocks({ data: null, error: { code: "42P01", message: "relation does not exist" } })).toEqual({
      state: "unknown",
    });
    expect(buildMonthLocks({ data: [], error: { code: "42501", message: "permission denied" } })).toEqual({
      state: "unknown",
    });
  });
  it("is unknown when no data came back", () => {
    expect(buildMonthLocks({ data: null, error: null })).toEqual({ state: "unknown" });
  });
});
