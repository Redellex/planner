// The station-day form on /manager/schedule and the rules POST /api/manager/schedule/override and the page share for
// it. The form posts every shift of the day with the assignee the manager saw (`was-<id>`) and the one chosen
// (`employee-<id>`); only rows whose choice differs are changes. Pure: no reads, no clock.

import { formatDayRow, parseDayRow, parseShiftParam, type DayRow } from "./schedule";
import { STATION_DAY_PATTERNS } from "./schedule-generator";

/** The most shifts a station day holds (6×4); a form with more rows cannot match a stored day. */
const MAX_DAY_ROWS = Math.max(...STATION_DAY_PATTERNS.map((pattern) => pattern.length));

/** A stored shift of the day, as far as these comparisons need it. */
interface StoredDayShift {
  id: string;
  employee_id: string | null;
}

export interface DaySaveForm {
  /** Every posted row of the day, in the order the `shift` fields were posted. */
  rows: DayRow[];
  /** The rows the confirm panel listed (`confirmed` fields), only when `confirm=override` was posted; else null. */
  confirmed: DayRow[] | null;
}

/** An assignee field: `""` is Uncovered (null), a UUID is a profile id; anything else (or a missing field) is invalid. */
function parseAssigneeField(values: FormDataEntryValue[]): string | null | undefined {
  if (values.length !== 1) {
    return undefined;
  }
  const [value] = values;
  if (value === "") {
    return null;
  }
  return parseShiftParam(value) ?? undefined;
}

/**
 * The day form's rows: one per repeated `shift` field (a UUID, each once), with exactly one `was-<id>` and one
 * `employee-<id>` field (`""` is Uncovered, else a UUID). `confirmed` is read only with `confirm=override`, each value
 * through `parseDayRow`. Null when there is no row, or any row or confirmed value is missing or malformed.
 */
export function parseDaySaveForm(form: FormData): DaySaveForm | null {
  const shiftValues = form.getAll("shift");
  // The cap also bounds the per-row field scans below on a crafted form.
  if (shiftValues.length === 0 || shiftValues.length > MAX_DAY_ROWS) {
    return null;
  }
  const rows: DayRow[] = [];
  const seen = new Set<string>();
  for (const value of shiftValues) {
    const shift = parseShiftParam(value);
    if (!shift || seen.has(shift)) {
      return null;
    }
    seen.add(shift);
    const was = parseAssigneeField(form.getAll(`was-${shift}`));
    const to = parseAssigneeField(form.getAll(`employee-${shift}`));
    if (was === undefined || to === undefined) {
      return null;
    }
    rows.push({ shift, was, to });
  }

  if (form.get("confirm") !== "override") {
    return { rows, confirmed: null };
  }
  const confirmed: DayRow[] = [];
  for (const value of form.getAll("confirmed")) {
    const row = parseDayRow(value);
    if (!row) {
      return null;
    }
    confirmed.push(row);
  }
  return { rows, confirmed };
}

/** The rows whose chosen assignee differs from the one the manager saw: the day's changes. */
export function changedRows(rows: readonly DayRow[]): DayRow[] {
  return rows.filter((row) => row.to !== row.was);
}

/** True when `rows` name exactly the stored shifts of the day, each once, and `assigneeOf(row)` matches every one. */
function sameDayAs(
  rows: readonly DayRow[],
  dayShifts: readonly StoredDayShift[],
  assigneeOf: (row: DayRow) => string | null,
): boolean {
  if (rows.length !== dayShifts.length || new Set(rows.map((row) => row.shift)).size !== rows.length) {
    return false;
  }
  const stored = new Map(dayShifts.map((shift) => [shift.id, shift.employee_id]));
  return rows.every((row) => stored.has(row.shift) && stored.get(row.shift) === assigneeOf(row));
}

/**
 * The manager saw the day as it is stored: the same set of shifts, and every row's `was` equals the stored assignee.
 * False means another save, a regenerate or a discard changed the day in between.
 */
export function matchesStored(rows: readonly DayRow[], dayShifts: readonly StoredDayShift[]): boolean {
  return sameDayAs(rows, dayShifts, (row) => row.was);
}

/**
 * The day is already stored as requested: the same set of shifts, and every row's `to` equals the stored assignee
 * (the second click of a double submit after the first one saved).
 */
export function alreadySaved(rows: readonly DayRow[], dayShifts: readonly StoredDayShift[]): boolean {
  return sameDayAs(rows, dayShifts, (row) => row.to);
}

/** The two lists hold the same rows (shift, seen and chosen assignee) as sets, in any order. */
export function sameRows(a: readonly DayRow[], b: readonly DayRow[]): boolean {
  const keysA = new Set(a.map(formatDayRow));
  const keysB = new Set(b.map(formatDayRow));
  return keysA.size === keysB.size && [...keysA].every((key) => keysB.has(key));
}
