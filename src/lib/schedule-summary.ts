import { wallClockMinutes } from "./availability";
import {
  clipSpans,
  mergeAvailability,
  stationDays,
  type AvailabilitySpan,
  type ScheduleWindow,
} from "./schedule-generator";

// Everything /manager/schedule shows about a draft, from a stored or a freshly generated one. S-04 reuses it to warn
// on overrides, so it never trusts the generator: it recounts from the shifts and the raw windows, and reports every
// rule break instead of hiding it.

const DAY_MINUTES = 24 * 60;
const LONG_SHIFT_MINUTES = 12 * 60;
const NIGHT_OFFSET = 18 * 60; // 00:00 is 18h after the station day's 06:00 start
const NIGHT_MINUTES = 6 * 60;

export interface SummaryShift {
  starts_at: string;
  ends_at: string;
  employee_id: string | null;
}

export interface MemberSummary {
  id: string;
  shifts: number;
  minutes: number;
  longCount: number;
  nightCount: number;
  /** Any availability inside the month's station days. */
  hasAvailability: boolean;
  /** Has availability but no assigned shift. */
  zeroShifts: boolean;
}

export interface RuleBreak<S extends SummaryShift = SummaryShift> {
  kind: "long" | "night";
  shift: S;
  assignee: string;
  /** The lowest 12h or night count among the members whose availability contains the shift. */
  eligibleMin: number;
}

export interface ScheduleSummary<S extends SummaryShift = SummaryShift> {
  /** In `members` order. */
  perMember: MemberSummary[];
  uncovered: S[];
  /** Station dates (`YYYY-MM-DD`) on which no shift is assigned to anyone. */
  daysWithNoOne: string[];
  ruleBreaks: RuleBreak<S>[];
  /** Assigned shifts that are not inside the assignee's merged availability. */
  outsideAvailability: S[];
  /**
   * Shifts starting when the previous month's last night ends (06:00 on day 1), held by that night's assignee:
   * back-to-back across months. Empty for a draft generated after the previous month's draft.
   */
  touchesPreviousNight: S[];
}

interface Counts {
  shifts: number;
  minutes: number;
  longCount: number;
  nightCount: number;
}

function contains(spans: readonly AvailabilitySpan[] | undefined, start: number, end: number): boolean {
  return spans?.some((span) => span.start <= start && end <= span.end) ?? false;
}

/**
 * Counts, uncovered shifts, days with no one, 12h/night rule breaks and outside-availability assignments of a draft.
 * The 12h rule (and the night rule, the same with night counts): an assigned shift breaks it when its assignee's count
 * is more than 1 above the lowest count among the members whose merged availability contains the shift.
 */
export function summarizeSchedule<S extends SummaryShift>(input: {
  month: string;
  members: readonly { id: string }[];
  windows: readonly ScheduleWindow[];
  shifts: readonly S[];
  /** The previous month's draft shift ending at 06:00 on day 1, if that month has a draft. */
  previousNight?: SummaryShift | null;
}): ScheduleSummary<S> {
  const days = stationDays(input.month);
  const monthStart = days[0].start;
  const monthEnd = days[days.length - 1].end;

  const availability = new Map<string, AvailabilitySpan[]>();
  for (const [id, spans] of mergeAvailability(input.windows)) {
    availability.set(id, clipSpans(spans, monthStart, monthEnd));
  }

  const timed = input.shifts.map((shift) => {
    const start = wallClockMinutes(shift.starts_at);
    const end = wallClockMinutes(shift.ends_at);
    const nightStart = monthStart + Math.floor((start - monthStart) / DAY_MINUTES) * DAY_MINUTES + NIGHT_OFFSET;
    return {
      shift,
      start,
      end,
      day: Math.floor((start - monthStart) / DAY_MINUTES),
      long: end - start === LONG_SHIFT_MINUTES,
      night: start <= nightStart && end >= nightStart + NIGHT_MINUTES,
    };
  });

  const counts = new Map<string, Counts>();
  const countsOf = (id: string): Counts => counts.get(id) ?? { shifts: 0, minutes: 0, longCount: 0, nightCount: 0 };
  const coveredDays = new Set<number>();
  const uncovered: S[] = [];
  const outsideAvailability: S[] = [];
  for (const { shift, start, end, day, long, night } of timed) {
    if (shift.employee_id === null) {
      uncovered.push(shift);
      continue;
    }
    coveredDays.add(day);
    const current = countsOf(shift.employee_id);
    counts.set(shift.employee_id, {
      shifts: current.shifts + 1,
      minutes: current.minutes + (end - start),
      longCount: current.longCount + (long ? 1 : 0),
      nightCount: current.nightCount + (night ? 1 : 0),
    });
    if (!contains(availability.get(shift.employee_id), start, end)) {
      outsideAvailability.push(shift);
    }
  }

  const ruleBreaks: RuleBreak<S>[] = [];
  for (const { shift, start, end, long, night } of timed) {
    const assignee = shift.employee_id;
    if (assignee === null || (!long && !night)) continue;
    const eligible = [...availability].filter(([, spans]) => contains(spans, start, end)).map(([id]) => id);
    if (eligible.length === 0) continue;
    if (long) {
      const eligibleMin = Math.min(...eligible.map((id) => countsOf(id).longCount));
      if (countsOf(assignee).longCount > eligibleMin + 1) {
        ruleBreaks.push({ kind: "long", shift, assignee, eligibleMin });
      }
    }
    if (night) {
      const eligibleMin = Math.min(...eligible.map((id) => countsOf(id).nightCount));
      if (countsOf(assignee).nightCount > eligibleMin + 1) {
        ruleBreaks.push({ kind: "night", shift, assignee, eligibleMin });
      }
    }
  }

  const perMember = input.members.map(({ id }): MemberSummary => {
    const memberCounts = countsOf(id);
    const hasAvailability = (availability.get(id)?.length ?? 0) > 0;
    return { id, ...memberCounts, hasAvailability, zeroShifts: hasAvailability && memberCounts.shifts === 0 };
  });

  const previousNight = input.previousNight;
  const touchesPreviousNight =
    previousNight?.employee_id != null
      ? timed
          .filter(
            ({ shift, start }) =>
              shift.employee_id === previousNight.employee_id && start === wallClockMinutes(previousNight.ends_at),
          )
          .map(({ shift }) => shift)
      : [];

  return {
    perMember,
    uncovered,
    daysWithNoOne: days.filter((_, index) => !coveredDays.has(index)).map((day) => day.date),
    ruleBreaks,
    outsideAvailability,
    touchesPreviousNight,
  };
}
