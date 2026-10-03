import { describe, expect, it } from "vitest";

import type { TeamMember, TeamWindowRow } from "@/components/availability/types";

import { buildTeamView, loadAllPages, type FetchPage, type PagedResult } from "./team-availability";

// Test plan risk #6: "an empty list means there is no data" is the assumption under test. Pages come from a fake
// fetcher over a literal row array, standing in for one PostgREST `.range()` request with `count: "exact"`.

const ROWS = ["r1", "r2", "r3", "r4", "r5", "r6", "r7"];

/** Serves `rows` like PostgREST: the requested range, cut at `cap` rows per response, with the exact count. */
function fakePages(rows: string[], cap = Infinity) {
  const requests: number[] = [];
  const fetchPage: FetchPage<string> = (from, to) => {
    requests.push(from);
    const data = rows.slice(from, Math.min(to + 1, from + cap));
    return Promise.resolve({ data, error: null, count: rows.length });
  };
  return { fetchPage, requests };
}

describe("a month with more rows than one response is read in full", () => {
  it("pages through every row in order", async () => {
    const { fetchPage, requests } = fakePages(ROWS);
    expect(await loadAllPages(fetchPage, 3)).toEqual({
      data: ["r1", "r2", "r3", "r4", "r5", "r6", "r7"],
      error: null,
    });
    expect(requests).toEqual([0, 3, 6]);
  });

  it("still gets every row when the server caps responses below the page size", async () => {
    // The archive F1 scenario: a short first page used to end the read and flag everyone after the cut-off.
    const { fetchPage, requests } = fakePages(ROWS, 3);
    expect(await loadAllPages(fetchPage, 5)).toEqual({
      data: ["r1", "r2", "r3", "r4", "r5", "r6", "r7"],
      error: null,
    });
    expect(requests).toEqual([0, 3, 6]);
  });

  it("stops after one request for an empty result", async () => {
    const { fetchPage, requests } = fakePages([]);
    expect(await loadAllPages(fetchPage, 3)).toEqual({ data: [], error: null });
    expect(requests).toEqual([0]);
  });

  it("does not request past the count when the last page is exactly full", async () => {
    const { fetchPage, requests } = fakePages(["r1", "r2", "r3", "r4", "r5", "r6"]);
    expect((await loadAllPages(fetchPage, 3)).data).toEqual(["r1", "r2", "r3", "r4", "r5", "r6"]);
    expect(requests).toEqual([0, 3]);
  });
});

describe("a failed or incomplete read is an error, never partial data", () => {
  it("fails when a later page errors", async () => {
    const failure = { message: "connection reset" };
    const fetchPage: FetchPage<string> = (from) =>
      Promise.resolve(
        from === 0 ? { data: ["r1", "r2", "r3"], error: null, count: 7 } : { data: null, error: failure, count: null },
      );
    expect(await loadAllPages(fetchPage, 3)).toEqual({ data: null, error: failure });
  });

  it("fails when the response carries no count", async () => {
    const fetchPage: FetchPage<string> = () => Promise.resolve({ data: ["r1"], error: null, count: null });
    const result = await loadAllPages(fetchPage, 3);
    expect(result.data).toBeNull();
    expect(result.error).toBeInstanceOf(Error);
  });

  it("fails, instead of throwing, when a response carries a count but no rows", async () => {
    const fetchPage: FetchPage<string> = () => Promise.resolve({ data: null, error: null, count: 3 });
    const result = await loadAllPages(fetchPage, 3);
    expect(result.data).toBeNull();
    expect(result.error).toBeInstanceOf(Error);
  });

  it("fails when a page comes back empty before the count is reached", async () => {
    const fetchPage: FetchPage<string> = (from) =>
      Promise.resolve({ data: from < 5 ? ROWS.slice(from, Math.min(from + 5, 5)) : [], error: null, count: 7 });
    const result = await loadAllPages(fetchPage, 5);
    expect(result.data).toBeNull();
    expect(String(result.error)).toContain("5 of 7");
  });
});

const ALICE: TeamMember = { id: "a", email: "alice@example.com", role: "employee" };
const BOB: TeamMember = { id: "b", email: "bob@example.com", role: "employee" };
const DAY_WINDOW: TeamWindowRow = {
  id: "w1",
  employee_id: "a",
  starts_at: "2026-11-02T08:00:00",
  ends_at: "2026-11-02T16:00:00",
};
const NIGHT_WINDOW: TeamWindowRow = {
  id: "w2",
  employee_id: "a",
  starts_at: "2026-11-03T22:00:00",
  ends_at: "2026-11-04T02:00:00",
};
const CARRY_OVER: TeamWindowRow = {
  id: "w0",
  employee_id: "b",
  starts_at: "2026-10-31T22:00:00",
  ends_at: "2026-11-01T06:00:00",
};

function ok<T>(data: T[]): PagedResult<T> {
  return { data, error: null };
}
const FAILED: PagedResult<never> = { data: null, error: { message: "boom" } };

describe("the team view shows availability only when every list was read in full", () => {
  it.each([
    ["the members read failed", { members: FAILED, windows: ok([DAY_WINDOW]), carryOvers: ok([]) }],
    ["the windows read failed", { members: ok([ALICE, BOB]), windows: FAILED, carryOvers: ok([]) }],
    ["the carry-over read failed", { members: ok([ALICE, BOB]), windows: ok([DAY_WINDOW]), carryOvers: FAILED }],
  ])("is unknown when %s", (_name, results) => {
    expect(buildTeamView(results)).toEqual({ status: "unknown" });
  });

  it("totals each member's windows starting in the month", () => {
    const view = buildTeamView({
      members: ok([ALICE, BOB]),
      windows: ok([DAY_WINDOW, NIGHT_WINDOW]),
      carryOvers: ok([CARRY_OVER]),
    });
    expect(view.status).toBe("ready");
    if (view.status !== "ready") return;
    // 08:00–16:00 is 480 minutes, 22:00–02:00 is 240.
    expect(view.totals.get("a")).toEqual({ windows: 2, minutes: 720 });
    expect(view.members).toEqual([ALICE, BOB]);
    expect(view.carryOvers).toEqual([CARRY_OVER]);
  });

  it("leaves a member without windows out of the totals only after a complete read", () => {
    // The legitimate "No availability submitted": Bob's only window is a carry-over from the previous month.
    const view = buildTeamView({ members: ok([ALICE, BOB]), windows: ok([DAY_WINDOW]), carryOvers: ok([CARRY_OVER]) });
    expect(view.status).toBe("ready");
    if (view.status !== "ready") return;
    expect(view.totals.has("b")).toBe(false);
    expect([...view.totals.keys()]).toEqual(["a"]);
  });
});
