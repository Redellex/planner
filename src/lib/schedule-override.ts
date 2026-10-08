import type { ScheduleSummary, SummaryShift } from "./schedule-summary";

// What a set of assignee changes on a draft introduces (FR-004): a station day's changes are checked together, so two
// changes that only conflict with each other are caught. The override endpoint and /manager/schedule both run
// summarizeSchedule on the stored shifts (before) and on the same shifts with the changes applied (after), then call
// overrideWarnings, so they agree on when a confirmation is needed and what it lists. Pure: no reads, no clock.

/** A stored draft shift: the summary's fields plus the row id an override targets. */
export type OverrideShift = SummaryShift & { id: string };

/**
 * One problem the changes introduce. `outside`, `sameDay`, `backToBack`, `previousNight` and `nextMorning` always
 * involve a changed shift (a pair of two changed shifts is one warning); `fairness` can land on another shift (its count or the lowest eligible count moved);
 * `noOne` is a station date (`YYYY-MM-DD`) left with no assigned shift.
 */
export type OverrideWarning<S extends OverrideShift = OverrideShift> =
  | { kind: "outside"; shift: S; assignee: string }
  | { kind: "sameDay"; assignee: string; shifts: [S, S] }
  | { kind: "backToBack"; assignee: string; first: S; second: S }
  | { kind: "previousNight"; shift: S; assignee: string }
  | { kind: "nextMorning"; shift: S; assignee: string }
  | { kind: "fairness"; rule: "long" | "night"; shift: S; assignee: string; eligibleMin: number }
  | { kind: "noOne"; date: string };

/**
 * A copy of `shifts` with the assignee of every id in `changes` replaced (null: Uncovered); every other shift is
 * unchanged, and an id that is not in `shifts` changes nothing.
 */
export function applyOverrides<S extends OverrideShift>(
  shifts: readonly S[],
  changes: ReadonlyMap<string, string | null>,
): S[] {
  return shifts.map((shift) => {
    const employeeId = changes.get(shift.id);
    return employeeId === undefined ? shift : { ...shift, employee_id: employeeId };
  });
}

/**
 * Every warning `summary` holds about a shift in `shiftIds`, plus its fairness breaks and days with no one, in kind
 * order.
 */
function candidates<S extends OverrideShift>(
  summary: ScheduleSummary<S>,
  shiftIds: ReadonlySet<string>,
): OverrideWarning<S>[] {
  const warnings: OverrideWarning<S>[] = [];
  for (const shift of summary.outsideAvailability) {
    if (shiftIds.has(shift.id) && shift.employee_id !== null) {
      warnings.push({ kind: "outside", shift, assignee: shift.employee_id });
    }
  }
  for (const { assignee, shifts } of summary.sameDay) {
    if (shifts.some((shift) => shiftIds.has(shift.id))) {
      warnings.push({ kind: "sameDay", assignee, shifts });
    }
  }
  for (const { assignee, first, second } of summary.backToBack) {
    if (shiftIds.has(first.id) || shiftIds.has(second.id)) {
      warnings.push({ kind: "backToBack", assignee, first, second });
    }
  }
  for (const shift of summary.touchesPreviousNight) {
    if (shiftIds.has(shift.id) && shift.employee_id !== null) {
      warnings.push({ kind: "previousNight", shift, assignee: shift.employee_id });
    }
  }
  for (const shift of summary.touchesNextMorning) {
    if (shiftIds.has(shift.id) && shift.employee_id !== null) {
      warnings.push({ kind: "nextMorning", shift, assignee: shift.employee_id });
    }
  }
  for (const { kind, shift, assignee, eligibleMin } of summary.ruleBreaks) {
    warnings.push({ kind: "fairness", rule: kind, shift, assignee, eligibleMin });
  }
  for (const date of summary.daysWithNoOne) {
    warnings.push({ kind: "noOne", date });
  }
  return warnings;
}

/** Identity of a warning: its kind, the shifts and the person it is about (not the counts it reports). */
function warningKey(warning: OverrideWarning): string {
  switch (warning.kind) {
    case "outside":
    case "previousNight":
    case "nextMorning":
      return `${warning.kind}|${warning.shift.id}|${warning.assignee}`;
    case "sameDay":
      return `sameDay|${warning.shifts[0].id}|${warning.shifts[1].id}|${warning.assignee}`;
    case "backToBack":
      return `backToBack|${warning.first.id}|${warning.second.id}|${warning.assignee}`;
    case "fairness":
      return `fairness|${warning.rule}|${warning.shift.id}|${warning.assignee}`;
    case "noOne":
      return `noOne|${warning.date}`;
  }
}

/**
 * The problems the changes of `shiftIds` introduce: what `after` reports about those shifts (outside availability, a
 * second shift that station day, back to back inside the month or across either boundary; a pair of two changed
 * shifts is reported once), every 12h or night break and every day with no one, minus what `before` already
 * reported. Empty means no confirmation is needed; no change gives `after` equal to `before`, so it always gives none.
 */
export function overrideWarnings<S extends OverrideShift>(input: {
  before: ScheduleSummary<S>;
  after: ScheduleSummary<S>;
  shiftIds: ReadonlySet<string>;
}): OverrideWarning<S>[] {
  const existing = new Set(candidates(input.before, input.shiftIds).map(warningKey));
  return candidates(input.after, input.shiftIds).filter((warning) => !existing.has(warningKey(warning)));
}
