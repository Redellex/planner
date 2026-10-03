import type { TeamMember, TeamWindowRow } from "@/components/availability/types";

import { windowMinutes } from "./availability";

// Test plan risk #6: a failed or truncated read must never look like "nobody submitted". Every team list is read in
// full or reported as an error, and the team view shows availability only when all of its lists were read in full.

export type PagedResult<T> = { data: T[]; error: null } | { data: null; error: unknown };

/** One `.range(from, to)` request with `{ count: "exact" }`: the rows returned and the total the query matches. */
export type FetchPage<T> = (
  from: number,
  to: number,
) => PromiseLike<{ data: T[] | null; error: unknown; count: number | null }>;

/**
 * Reads every row a query matches. PostgREST silently caps each response at its `max_rows`, which may be below
 * `pageSize`, so the offset advances by the rows actually received and the loop stops once the rows reach the
 * reported count; a lower cap costs requests, never rows. An error on any page, a missing count or an empty page
 * before the count is reached is a read error, never partial data. The query must order by a unique tiebreak
 * (`id`) so pages neither overlap nor skip rows.
 */
export async function loadAllPages<T>(fetchPage: FetchPage<T>, pageSize: number): Promise<PagedResult<T>> {
  const rows: T[] = [];
  for (;;) {
    const from = rows.length;
    const { data, error, count } = await fetchPage(from, from + pageSize - 1);
    if (error) {
      return { data: null, error };
    }
    if (data === null || count === null) {
      return { data: null, error: new Error("Paged read returned no row count") };
    }
    rows.push(...data);
    // Never request past the count: PostgREST answers an offset beyond the end with an error.
    if (rows.length >= count) {
      return { data: rows, error: null };
    }
    if (data.length === 0) {
      return { data: null, error: new Error(`Paged read stopped at ${rows.length} of ${count} rows`) };
    }
  }
}

export interface TeamTotal {
  windows: number;
  minutes: number;
}

export type TeamView =
  | { status: "unknown" }
  | {
      status: "ready";
      members: TeamMember[];
      windows: TeamWindowRow[];
      carryOvers: TeamWindowRow[];
      /** employee_id -> windows starting in the month and their wall-clock minutes; absent = nothing submitted. */
      totals: Map<string, TeamTotal>;
    };

/**
 * The team view may show availability only when the members, the month's windows and the carry-overs were all read
 * in full. Totals exist only then, so a failed read can never flag an account "No availability submitted".
 */
export function buildTeamView(results: {
  members: PagedResult<TeamMember>;
  windows: PagedResult<TeamWindowRow>;
  carryOvers: PagedResult<TeamWindowRow>;
}): TeamView {
  const { members, windows, carryOvers } = results;
  if (members.data === null || windows.data === null || carryOvers.data === null) {
    return { status: "unknown" };
  }

  // Totals count windows starting in the month only; a previous-month window belongs to its own month.
  const totals = new Map<string, TeamTotal>();
  for (const row of windows.data) {
    const total = totals.get(row.employee_id) ?? { windows: 0, minutes: 0 };
    totals.set(row.employee_id, { windows: total.windows + 1, minutes: total.minutes + windowMinutes(row) });
  }
  return { status: "ready", members: members.data, windows: windows.data, carryOvers: carryOvers.data, totals };
}
