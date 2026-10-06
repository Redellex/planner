import { daysInMonth, timestampFromWallClockMinutes, wallClockMinutes } from "./availability";

// The pure schedule generator (roadmap S-03). One month's availability in, one draft out: every station day is split
// into one of five fixed shift patterns, and each shift goes to one employee whose availability contains it, or stays
// uncovered (employee_id null). All times are wall-clock minutes from `wallClockMinutes` (no DST), so an 18:00–06:00
// night is 720 minutes even on a DST day, and timestamps are never passed through `new Date(...)`.
//
// Station day D = [D 06:00, D+1 06:00) for every calendar date D of the month. Hard rules: an assignment is inside the
// assignee's merged availability, a person has at most one shift per station day, and never two shifts where one ends
// exactly when the other starts (including the previous month's last night, passed in as `previousNight`). Priorities, in order: cover as many minutes as possible; the 12h rule and the night
// rule (an assignee's count is at most the lowest count among the shift's eligible members + 1); even total hours;
// fewer shifts. Coverage looks one day ahead: a night is kept off the only person who can start the next day at
// 06:00. The work is bounded: a greedy pass over days × 5 patterns × at most 4 shifts × members, then a repair
// pass capped at the number of shifts, then one fill pass.

const DAY_MINUTES = 24 * 60;
const LONG_SHIFT_MINUTES = 12 * 60;

export interface ShiftShape {
  /** Wall-clock start time, `HH:MM`. */
  start: string;
  /** Wall-clock length in minutes. */
  minutes: number;
  /** Minutes from the station day's 06:00 start. */
  offset: number;
}

/** The 9 allowed shift shapes (start, length); `schedule_shifts` accepts only these. */
export const SHIFT_SHAPES: readonly ShiftShape[] = [
  { start: "06:00", minutes: 720, offset: 0 },
  { start: "18:00", minutes: 720, offset: 720 },
  { start: "06:00", minutes: 480, offset: 0 },
  { start: "14:00", minutes: 480, offset: 480 },
  { start: "22:00", minutes: 480, offset: 960 },
  { start: "06:00", minutes: 360, offset: 0 },
  { start: "12:00", minutes: 360, offset: 360 },
  { start: "18:00", minutes: 360, offset: 720 },
  { start: "00:00", minutes: 360, offset: 1080 },
];

// Indices into SHIFT_SHAPES. Every pattern starts at 06:00 and ends with the night shift (the one ending at 06:00).
const PATTERN_SHAPES: readonly (readonly number[])[] = [
  [0, 1], // 12+12 = 06–18 | 18–06
  [2, 3, 4], // 8+8+8 = 06–14 | 14–22 | 22–06
  [0, 7, 8], // 12+6+6 = 06–18 | 18–24 | 00–06
  [5, 6, 1], // 6+6+12 = 06–12 | 12–18 | 18–06
  [5, 6, 7, 8], // 6×4 = 06–12 | 12–18 | 18–24 | 00–06
];

/** The 5 ways to split a station day, each a gap-free sequence of shapes from 06:00 to the next 06:00. */
export const STATION_DAY_PATTERNS: readonly (readonly ShiftShape[])[] = PATTERN_SHAPES.map((shapes) =>
  shapes.map((index) => SHIFT_SHAPES[index]),
);

const SHAPE_COUNT = SHIFT_SHAPES.length;
/** The 06:00/6h shape: every pattern starts with a 06:00 shape, and any availability for one holds this one. */
const MORNING_SHAPE = 5;
const MAX_PATTERN_LENGTH = 4;

/** A night shift covers 00:00–06:00, i.e. it ends at the station day's end. */
export function isNightShape(shape: ShiftShape): boolean {
  return shape.offset + shape.minutes === DAY_MINUTES;
}

/** A 12h shift (06–18 or 18–06), counted for the 12h rule. */
export function isLongShape(shape: ShiftShape): boolean {
  return shape.minutes === LONG_SHIFT_MINUTES;
}

export interface StationDay {
  /** The calendar date the station day starts on, `YYYY-MM-DD`. */
  date: string;
  /** Wall-clock minutes of `date` 06:00. */
  start: number;
  /** Wall-clock minutes of the next day's 06:00. */
  end: number;
}

/** Every station day of `month` (`YYYY-MM`), in date order. */
export function stationDays(month: string): StationDay[] {
  return daysInMonth(month).map((date) => {
    const start = wallClockMinutes(`${date}T06:00:00`);
    return { date, start, end: start + DAY_MINUTES };
  });
}

export interface ScheduleWindow {
  employee_id: string;
  starts_at: string;
  ends_at: string;
}

/** A half-open span of wall-clock minutes. */
export interface AvailabilitySpan {
  start: number;
  end: number;
}

/**
 * Each employee's windows as sorted spans of wall-clock minutes, with touching or overlapping windows merged into one
 * span (so 18–24 and 00–06 on the next day become 18–06). Employees are in ascending id order.
 */
export function mergeAvailability(windows: readonly ScheduleWindow[]): Map<string, AvailabilitySpan[]> {
  const byEmployee = new Map<string, AvailabilitySpan[]>();
  for (const window of windows) {
    const spans = byEmployee.get(window.employee_id) ?? [];
    spans.push({ start: wallClockMinutes(window.starts_at), end: wallClockMinutes(window.ends_at) });
    byEmployee.set(window.employee_id, spans);
  }

  const merged = new Map<string, AvailabilitySpan[]>();
  for (const id of [...byEmployee.keys()].sort(compareIds)) {
    const spans = (byEmployee.get(id) ?? []).sort((a, b) => a.start - b.start || a.end - b.end);
    const result: AvailabilitySpan[] = [];
    for (const span of spans) {
      const last = result.at(-1);
      if (last && span.start <= last.end) {
        last.end = Math.max(last.end, span.end);
      } else {
        result.push({ start: span.start, end: span.end });
      }
    }
    merged.set(id, result);
  }
  return merged;
}

/** Code-unit order, so the result never depends on the runtime's locale. */
export function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** `spans` (sorted, merged) clipped to `[from, to)`; empty parts are dropped. */
export function clipSpans(spans: readonly AvailabilitySpan[], from: number, to: number): AvailabilitySpan[] {
  const clipped: AvailabilitySpan[] = [];
  for (const span of spans) {
    const start = Math.max(span.start, from);
    const end = Math.min(span.end, to);
    if (start < end) {
      clipped.push({ start, end });
    }
  }
  return clipped;
}

export interface GeneratedShift {
  starts_at: string;
  ends_at: string;
  employee_id: string | null;
}

export interface GenerateScheduleInput {
  /** `YYYY-MM`. */
  month: string;
  /**
   * The month's windows plus carry-overs from the previous month and next-month windows starting on day 1 before
   * 06:00; parts outside the station days are ignored.
   */
  windows: readonly ScheduleWindow[];
  /**
   * The assignee of the previous month's last night shift (it ends at 06:00 on day 1), if that month has a draft.
   * They are blocked from the shifts starting at 06:00 on day 1, as if that night were part of this month.
   */
  previousNight?: string | null;
}

const UNASSIGNED = -1;

/** A repair move: `to` takes the shift at `position`; with `otherPosition >= 0` its holder takes `to`'s shift. */
interface RepairMove {
  day: number;
  position: number;
  to: number;
  otherPosition: number;
  change: number;
}

interface PatternResult {
  members: number[];
  uncoveredMinutes: number;
  /** Minutes of the next station day's 06:00 start that this pattern's night assignee was the only one for. */
  nextMorningLoss: number;
  breaks: number;
  /** Sum of squared hours over members with availability: lower is evener, and any move of hours from a busier to
   * a less busy member lowers it (max − min would miss a gain while someone else stays at 0). */
  hoursSquared: number;
  shiftCount: number;
}

function betterPattern(a: PatternResult, b: PatternResult): boolean {
  if (a.uncoveredMinutes !== b.uncoveredMinutes) return a.uncoveredMinutes < b.uncoveredMinutes;
  if (a.nextMorningLoss !== b.nextMorningLoss) return a.nextMorningLoss < b.nextMorningLoss;
  if (a.breaks !== b.breaks) return a.breaks < b.breaks;
  if (a.hoursSquared !== b.hoursSquared) return a.hoursSquared < b.hoursSquared;
  return a.shiftCount < b.shiftCount;
}

/**
 * A deterministic draft for `month`: exactly one pattern per station day, sorted by `starts_at`. The result depends
 * only on the set of windows, not on their order; profile id breaks every tie.
 */
export function generateSchedule(input: GenerateScheduleInput): { shifts: GeneratedShift[] } {
  const days = stationDays(input.month);
  const dayCount = days.length;
  const monthStart = days[0].start;
  const monthEnd = days[dayCount - 1].end;

  // Members: everyone with a window, in id order, so the member index is also the id tiebreak.
  const ids: string[] = [];
  const spansByMember: AvailabilitySpan[][] = [];
  for (const [id, spans] of mergeAvailability(input.windows)) {
    ids.push(id);
    spansByMember.push(clipSpans(spans, monthStart, monthEnd));
  }
  const memberCount = ids.length;

  // eligible[day * SHAPE_COUNT + shape]: members whose merged availability contains that shift, ascending.
  const eligible: number[][] = Array.from({ length: dayCount * SHAPE_COUNT }, () => []);
  // The same as a bitmap, for O(1) membership: eligibleMask[(day * SHAPE_COUNT + shape) * memberCount + member].
  const eligibleMask = new Uint8Array(dayCount * SHAPE_COUNT * memberCount);
  const hasEligibleShift = new Uint8Array(memberCount);
  for (let member = 0; member < memberCount; member++) {
    for (const span of spansByMember[member]) {
      const firstDay = Math.floor((span.start - monthStart) / DAY_MINUTES);
      const lastDay = Math.min(dayCount - 1, Math.floor((span.end - 1 - monthStart) / DAY_MINUTES));
      for (let day = firstDay; day <= lastDay; day++) {
        const dayStart = monthStart + day * DAY_MINUTES;
        for (let shape = 0; shape < SHAPE_COUNT; shape++) {
          const start = dayStart + SHIFT_SHAPES[shape].offset;
          if (span.start <= start && start + SHIFT_SHAPES[shape].minutes <= span.end) {
            eligible[day * SHAPE_COUNT + shape].push(member);
            eligibleMask[(day * SHAPE_COUNT + shape) * memberCount + member] = 1;
            hasEligibleShift[member] = 1;
          }
        }
      }
    }
  }
  const activeMembers: number[] = [];
  for (let member = 0; member < memberCount; member++) {
    if (hasEligibleShift[member]) activeMembers.push(member);
  }

  const minutes = new Int32Array(memberCount);
  const longCount = new Int32Array(memberCount);
  const nightCount = new Int32Array(memberCount);
  // shapeOf[member * dayCount + day]: the shape that member works that station day, or UNASSIGNED.
  const shapeOf = new Int8Array(memberCount * dayCount).fill(UNASSIGNED);
  const patternOf = new Int8Array(dayCount);
  // memberAt[day * MAX_PATTERN_LENGTH + position]: assignee of that pattern position, or UNASSIGNED.
  const memberAt = new Int32Array(dayCount * MAX_PATTERN_LENGTH).fill(UNASSIGNED);

  const shapeAt = (day: number, position: number): number => PATTERN_SHAPES[patternOf[day]][position];
  const nightPosition = (day: number): number => PATTERN_SHAPES[patternOf[day]].length - 1;
  // The previous month's last night (station day -1) only blocks; it is never moved or counted.
  const previousNightMember = input.previousNight ? ids.indexOf(input.previousNight) : UNASSIGNED;
  const nightMember = (day: number): number =>
    day === -1
      ? previousNightMember
      : day >= 0 && day < dayCount
        ? memberAt[day * MAX_PATTERN_LENGTH + nightPosition(day)]
        : UNASSIGNED;
  const morningMember = (day: number): number =>
    day >= 0 && day < dayCount ? memberAt[day * MAX_PATTERN_LENGTH] : UNASSIGNED;

  const addCounts = (member: number, shape: number, sign: 1 | -1): void => {
    const shiftShape = SHIFT_SHAPES[shape];
    minutes[member] += sign * shiftShape.minutes;
    if (isLongShape(shiftShape)) longCount[member] += sign;
    if (isNightShape(shiftShape)) nightCount[member] += sign;
  };

  /**
   * One-day lookahead for coverage: a night ends at the next station day's 06:00, so its assignee cannot take the
   * next day's first shift. Availability holding 06–18 or 06–14 also holds 06–12, so the next day's 06:00 start is
   * lost exactly when `member` is the only one eligible for its 06–12 shape.
   */
  const nextMorningLoss = (day: number, member: number): number => {
    if (day + 1 >= dayCount) return 0;
    const candidates = eligible[(day + 1) * SHAPE_COUNT + MORNING_SHAPE];
    return candidates.length === 1 && candidates[0] === member ? SHIFT_SHAPES[MORNING_SHAPE].minutes : 0;
  };

  /**
   * Lower is better: for a night shift, a candidate who does not cost the next day's 06:00 start first (coverage is
   * priority 1); then the agreed key per shift kind; member index (id order) breaks ties.
   */
  const candidateBefore = (a: number, b: number, day: number, shape: number): boolean => {
    const shiftShape = SHIFT_SHAPES[shape];
    const long = isLongShape(shiftShape);
    const night = isNightShape(shiftShape);
    if (night) {
      const lossA = nextMorningLoss(day, a);
      const lossB = nextMorningLoss(day, b);
      if (lossA !== lossB) return lossA < lossB;
    }
    if (long && longCount[a] !== longCount[b]) return longCount[a] < longCount[b];
    if (night && nightCount[a] !== nightCount[b]) return nightCount[a] < nightCount[b];
    if (minutes[a] !== minutes[b]) return minutes[a] < minutes[b];
    return a < b;
  };

  const minCount = (counts: Int32Array, members: readonly number[]): number => {
    let min = Infinity;
    for (const member of members) {
      if (counts[member] < min) min = counts[member];
    }
    return min;
  };

  /** 12h-rule and night-rule breaks of one assigned shift under the current counts (0, 1 or 2). */
  const breaksOf = (day: number, shape: number, member: number): number => {
    const shiftShape = SHIFT_SHAPES[shape];
    const members = eligible[day * SHAPE_COUNT + shape];
    let breaks = 0;
    if (isLongShape(shiftShape) && longCount[member] > minCount(longCount, members) + 1) breaks++;
    if (isNightShape(shiftShape) && nightCount[member] > minCount(nightCount, members) + 1) breaks++;
    return breaks;
  };

  // ---- Greedy pass: station days in date order, the best of the 5 patterns per day. ----
  const chosen: number[] = [];
  const simulate = (day: number, pattern: number): PatternResult => {
    const shapes = PATTERN_SHAPES[pattern];
    const previousNight = nightMember(day - 1);
    const assigned = new Array<number>(shapes.length).fill(UNASSIGNED);
    const done = new Array<boolean>(shapes.length).fill(false);
    chosen.length = 0;
    const blocked = (member: number, shape: number): boolean =>
      chosen.includes(member) || (SHIFT_SHAPES[shape].offset === 0 && member === previousNight);

    // Most constrained shift first: the fewest eligible-and-unblocked candidates; pattern order breaks ties.
    for (const _step of shapes) {
      let position = -1;
      let fewest = Infinity;
      for (let index = 0; index < shapes.length; index++) {
        if (done[index]) continue;
        // Eligible minus the blocked ones: at most 3 already chosen today, plus last night's assignee at 06:00.
        const slot = day * SHAPE_COUNT + shapes[index];
        let candidates = eligible[slot].length;
        for (const member of chosen) {
          if (eligibleMask[slot * memberCount + member] === 1) candidates--;
        }
        if (
          SHIFT_SHAPES[shapes[index]].offset === 0 &&
          previousNight !== UNASSIGNED &&
          !chosen.includes(previousNight) &&
          eligibleMask[slot * memberCount + previousNight] === 1
        ) {
          candidates--;
        }
        // On a tie the night shift (last position) goes first, so a rested team's night goes to the fewest nights.
        if (candidates < fewest || (candidates === fewest && index === shapes.length - 1)) {
          fewest = candidates;
          position = index;
        }
      }
      done[position] = true;
      const shape = shapes[position];
      let best = UNASSIGNED;
      for (const member of eligible[day * SHAPE_COUNT + shape]) {
        if (!blocked(member, shape) && (best === UNASSIGNED || candidateBefore(member, best, day, shape)))
          best = member;
      }
      if (best !== UNASSIGNED) {
        assigned[position] = best;
        chosen.push(best);
        addCounts(best, shape, 1);
      }
    }

    let uncoveredMinutes = 0;
    let breaks = 0;
    const nightAssignee = assigned[shapes.length - 1];
    const lookaheadLoss = nightAssignee === UNASSIGNED ? 0 : nextMorningLoss(day, nightAssignee);
    for (let position = 0; position < shapes.length; position++) {
      const member = assigned[position];
      if (member === UNASSIGNED) {
        uncoveredMinutes += SHIFT_SHAPES[shapes[position]].minutes;
      } else {
        breaks += breaksOf(day, shapes[position], member);
      }
    }
    let hoursSquared = 0;
    for (const member of activeMembers) {
      const hours = minutes[member] / 60;
      hoursSquared += hours * hours;
    }
    for (let position = 0; position < shapes.length; position++) {
      if (assigned[position] !== UNASSIGNED) addCounts(assigned[position], shapes[position], -1);
    }
    return {
      members: assigned,
      uncoveredMinutes,
      nextMorningLoss: lookaheadLoss,
      breaks,
      hoursSquared,
      shiftCount: shapes.length,
    };
  };

  const assign = (day: number, position: number, member: number): void => {
    const shape = shapeAt(day, position);
    memberAt[day * MAX_PATTERN_LENGTH + position] = member;
    shapeOf[member * dayCount + day] = shape;
    addCounts(member, shape, 1);
  };

  const unassign = (day: number, position: number): void => {
    const member = memberAt[day * MAX_PATTERN_LENGTH + position];
    const shape = shapeAt(day, position);
    memberAt[day * MAX_PATTERN_LENGTH + position] = UNASSIGNED;
    shapeOf[member * dayCount + day] = UNASSIGNED;
    addCounts(member, shape, -1);
  };

  for (let day = 0; day < dayCount; day++) {
    let best: PatternResult | null = null;
    let bestPattern = 0;
    for (let pattern = 0; pattern < PATTERN_SHAPES.length; pattern++) {
      const result = simulate(day, pattern);
      if (best === null || betterPattern(result, best)) {
        best = result;
        bestPattern = pattern;
      }
    }
    patternOf[day] = bestPattern;
    best?.members.forEach((member, position) => {
      if (member !== UNASSIGNED) assign(day, position, member);
    });
  }

  /** Whether `member` may take `shape` on `day` in the full schedule: free that day and no touching shift. */
  const free = (member: number, day: number, shape: number): boolean =>
    shapeOf[member * dayCount + day] === UNASSIGNED && clearOfNeighbours(member, day, shape);

  /** Whether `member` working `shape` on `day` touches none of their shifts on the neighbouring station days. */
  const clearOfNeighbours = (member: number, day: number, shape: number): boolean => {
    const shiftShape = SHIFT_SHAPES[shape];
    if (shiftShape.offset === 0 && nightMember(day - 1) === member) return false;
    if (isNightShape(shiftShape) && morningMember(day + 1) === member) return false;
    return true;
  };

  /** Change of the sum of squared 12h and night counts when `member` swaps shape `from` for shape `to`. */
  const squaredCountChange = (member: number, from: number, to: number): number => {
    let change = 0;
    for (const [counts, kindOf] of [
      [longCount, isLongShape],
      [nightCount, isNightShape],
    ] as const) {
      const step =
        (to === UNASSIGNED ? 0 : Number(kindOf(SHIFT_SHAPES[to]))) -
        (from === UNASSIGNED ? 0 : Number(kindOf(SHIFT_SHAPES[from])));
      change += 2 * step * counts[member] + step * step;
    }
    return change;
  };

  // ---- Repair pass: for a person who breaks the 12h or night rule, hand one of their shifts of that kind to an
  // eligible person with a count at least 2 lower, either to someone free that day or by swapping with someone who
  // works another shift that day (when each is eligible for the other's shift). Every accepted move strictly lowers
  // the sum of squared 12h and night counts, so the pass terminates; the cap bounds the work anyway. ----
  let repairCap = 0;
  for (let day = 0; day < dayCount; day++) repairCap += PATTERN_SHAPES[patternOf[day]].length;
  const tryMoveOff = (member: number, long: boolean): boolean => {
    const counts = long ? longCount : nightCount;
    const ofKind = long ? isLongShape : isNightShape;
    const best: { move: RepairMove | null } = { move: null };
    const consider = (day: number, position: number, to: number, otherPosition: number, change: number): void => {
      if (change >= 0) return;
      const current = best.move;
      const better =
        current === null ||
        change < current.change ||
        (change === current.change && minutes[to] < minutes[current.to]) ||
        (change === current.change && minutes[to] === minutes[current.to] && to < current.to);
      if (better) best.move = { day, position, to, otherPosition, change };
    };
    for (let day = 0; day < dayCount; day++) {
      const shape = shapeOf[member * dayCount + day];
      if (shape === UNASSIGNED || !ofKind(SHIFT_SHAPES[shape])) continue;
      const shapes = PATTERN_SHAPES[patternOf[day]];
      const position = shapes.indexOf(shape);
      for (const to of eligible[day * SHAPE_COUNT + shape]) {
        if (to === member || counts[to] > counts[member] - 2 || !clearOfNeighbours(to, day, shape)) continue;
        const toShape = shapeOf[to * dayCount + day];
        if (toShape === UNASSIGNED) {
          consider(
            day,
            position,
            to,
            -1,
            squaredCountChange(member, shape, UNASSIGNED) + squaredCountChange(to, UNASSIGNED, shape),
          );
          continue;
        }
        // A swap: `member` takes the shift `to` works that day.
        if (
          eligibleMask[(day * SHAPE_COUNT + toShape) * memberCount + member] !== 1 ||
          !clearOfNeighbours(member, day, toShape)
        )
          continue;
        consider(
          day,
          position,
          to,
          shapes.indexOf(toShape),
          squaredCountChange(member, shape, toShape) + squaredCountChange(to, toShape, shape),
        );
      }
    }
    if (best.move === null) return false;
    const { day, position, to, otherPosition } = best.move;
    unassign(day, position);
    if (otherPosition >= 0) {
      unassign(day, otherPosition);
      assign(day, otherPosition, member);
    }
    assign(day, position, to);
    return true;
  };

  // tryMoveOff depends only on the schedule, which changes only when a move succeeds, so within one iteration a
  // person whose move failed is not tried again for the same kind.
  const failedLong = new Uint8Array(memberCount);
  const failedNight = new Uint8Array(memberCount);
  for (let iteration = 0; iteration < repairCap; iteration++) {
    let moved = false;
    failedLong.fill(0);
    failedNight.fill(0);
    for (let day = 0; day < dayCount && !moved; day++) {
      const shapes = PATTERN_SHAPES[patternOf[day]];
      for (let position = 0; position < shapes.length && !moved; position++) {
        const member = memberAt[day * MAX_PATTERN_LENGTH + position];
        if (member === UNASSIGNED) continue;
        const shape = shapes[position];
        const shiftShape = SHIFT_SHAPES[shape];
        const members = eligible[day * SHAPE_COUNT + shape];
        if (!failedLong[member] && isLongShape(shiftShape) && longCount[member] > minCount(longCount, members) + 1) {
          moved = tryMoveOff(member, true);
          if (!moved) failedLong[member] = 1;
        }
        if (
          !moved &&
          !failedNight[member] &&
          isNightShape(shiftShape) &&
          nightCount[member] > minCount(nightCount, members) + 1
        ) {
          moved = tryMoveOff(member, false);
          if (!moved) failedNight[member] = 1;
        }
      }
    }
    if (!moved) break;
  }

  // ---- Fill pass: a move can free someone for a shift the greedy pass had to leave uncovered. ----
  for (let day = 0; day < dayCount; day++) {
    const shapes = PATTERN_SHAPES[patternOf[day]];
    for (let position = 0; position < shapes.length; position++) {
      if (memberAt[day * MAX_PATTERN_LENGTH + position] !== UNASSIGNED) continue;
      const shape = shapes[position];
      let best = UNASSIGNED;
      for (const member of eligible[day * SHAPE_COUNT + shape]) {
        if (free(member, day, shape) && (best === UNASSIGNED || candidateBefore(member, best, day, shape)))
          best = member;
      }
      if (best !== UNASSIGNED) assign(day, position, best);
    }
  }

  const shifts: GeneratedShift[] = [];
  for (let day = 0; day < dayCount; day++) {
    const shapes = PATTERN_SHAPES[patternOf[day]];
    for (let position = 0; position < shapes.length; position++) {
      const shape = SHIFT_SHAPES[shapes[position]];
      const start = days[day].start + shape.offset;
      const member = memberAt[day * MAX_PATTERN_LENGTH + position];
      shifts.push({
        starts_at: timestampFromWallClockMinutes(start),
        ends_at: timestampFromWallClockMinutes(start + shape.minutes),
        employee_id: member === UNASSIGNED ? null : ids[member],
      });
    }
  }
  return { shifts };
}
