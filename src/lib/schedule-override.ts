import type { ScheduleSummary, SummaryShift } from "./schedule-summary";

// What one assignee change on a draft introduces (FR-004). The override endpoint and /manager/schedule both run
// summarizeSchedule on the stored shifts (before) and on the same shifts with the change applied (after), then call
// overrideWarnings, so they agree on when a confirmation is needed and what it lists. Pure: no reads, no clock.

/** A stored draft shift: the summary's fields plus the row id an override targets. */
export type OverrideShift = SummaryShift & { id: string };

/**
 * One problem the change introduces. `outside`, `sameDay`, `backToBack`, `previousNight` and `nextMorning` always
 * involve the overridden shift; `fairness` can land on another shift (its count or the lowest eligible count moved);
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

/** A copy of `shifts` with the assignee of `shiftId` replaced (null: Uncovered); every other shift is unchanged. */
export function applyOverride<S extends OverrideShift>(
  shifts: readonly S[],
  shiftId: string,
  employeeId: string | null,
): S[] {
  return shifts.map((shift) => (shift.id === shiftId ? { ...shift, employee_id: employeeId } : shift));
}

/** Every warning `summary` holds about `shiftId`, plus its fairness breaks and days with no one, in kind order. */
function candidates<S extends OverrideShift>(summary: ScheduleSummary<S>, shiftId: string): OverrideWarning<S>[] {
  const warnings: OverrideWarning<S>[] = [];
  for (const shift of summary.outsideAvailability) {
    if (shift.id === shiftId && shift.employee_id !== null) {
      warnings.push({ kind: "outside", shift, assignee: shift.employee_id });
    }
  }
  for (const { assignee, shifts } of summary.sameDay) {
    if (shifts.some((shift) => shift.id === shiftId)) {
      warnings.push({ kind: "sameDay", assignee, shifts });
    }
  }
  for (const { assignee, first, second } of summary.backToBack) {
    if (first.id === shiftId || second.id === shiftId) {
      warnings.push({ kind: "backToBack", assignee, first, second });
    }
  }
  for (const shift of summary.touchesPreviousNight) {
    if (shift.id === shiftId && shift.employee_id !== null) {
      warnings.push({ kind: "previousNight", shift, assignee: shift.employee_id });
    }
  }
  for (const shift of summary.touchesNextMorning) {
    if (shift.id === shiftId && shift.employee_id !== null) {
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
 * The problems an override of `shiftId` introduces: what `after` reports about that shift (outside availability, a
 * second shift that station day, back to back inside the month or across either boundary), every 12h or night break
 * and every day with no one, minus what `before` already reported. Empty means no confirmation is needed; an
 * unchanged assignee gives `after` equal to `before`, so it always gives none.
 */
export function overrideWarnings<S extends OverrideShift>(input: {
  before: ScheduleSummary<S>;
  after: ScheduleSummary<S>;
  shiftId: string;
}): OverrideWarning<S>[] {
  const existing = new Set(candidates(input.before, input.shiftId).map(warningKey));
  return candidates(input.after, input.shiftId).filter((warning) => !existing.has(warningKey(warning)));
}
