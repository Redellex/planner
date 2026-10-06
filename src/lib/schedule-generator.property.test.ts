import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { generateSchedule, type GeneratedShift, type ScheduleWindow } from "./schedule-generator";
import { summarizeSchedule } from "./schedule-summary";

// Test plan risk #5 (Phase 4): the generator's guardrails over generated inputs. Every oracle below is computed from
// the generated input with this file's own code: windows are built on a 30-minute slot grid, eligibility is "every
// 30-minute slot of the shift is inside one of the person's raw windows" (no merging), and 12h/night counts are
// recounted from the shifts. Nothing is compared with a stored generator output. A failure prints fast-check's seed
// and path; replay with `fc.assert(property, { seed, path, endOnFailure: true })`.

const SLOT = 30;
const SLOTS_PER_DAY = 48;
const DAY = 24 * 60;

// Includes both 2026 DST months, a leap February and a 30-day month.
const MONTHS = ["2026-03", "2026-10", "2026-11", "2027-01", "2028-02"] as const;

// The 5 agreed station-day patterns as (start time, minutes), written out here rather than imported.
const PATTERNS = [
  "06:00/720 18:00/720",
  "06:00/480 14:00/480 22:00/480",
  "06:00/720 18:00/360 00:00/360",
  "06:00/360 12:00/360 18:00/720",
  "06:00/360 12:00/360 18:00/360 00:00/360",
];

interface Fixture {
  month: string;
  members: string[];
  windows: ScheduleWindow[];
  /** member id -> available 30-minute slot numbers (minute / 30), straight from the raw windows. */
  slots: Map<string, Set<number>>;
  /** Minutes of M-01 06:00 and of M+1-01 06:00. */
  stationStart: number;
  stationEnd: number;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** Minutes of M-01 00:00 on the test's own calendar axis. */
function monthMidnight(month: string): number {
  const [year, monthNumber] = month.split("-").map(Number);
  return Date.UTC(year, monthNumber - 1, 1) / 60000;
}

function daysIn(month: string): number {
  const [year, monthNumber] = month.split("-").map(Number);
  return new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
}

function toTimestamp(minutes: number): string {
  const date = new Date(minutes * 60000); // a number, never a wall-clock string
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}T${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:00`;
}

function toMinutes(timestamp: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):00$/.exec(timestamp);
  if (!match) throw new Error(`Not a wall-clock timestamp: ${timestamp}`);
  const [, year, month, day, hours, minutes] = match.map(Number);
  return Date.UTC(year, month - 1, day) / 60000 + hours * 60 + minutes;
}

function memberId(index: number): string {
  return `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
}

/** Builds the fixture from per-member windows given as [startSlot, endSlot) relative to M-01 00:00. */
function buildFixture(month: string, slotWindows: [number, number][][]): Fixture {
  const midnight = monthMidnight(month);
  const members = slotWindows.map((_, index) => memberId(index));
  const windows: ScheduleWindow[] = [];
  const slots = new Map<string, Set<number>>();
  slotWindows.forEach((memberWindows, index) => {
    const available = new Set<number>();
    for (const [from, to] of memberWindows) {
      windows.push({
        employee_id: members[index],
        starts_at: toTimestamp(midnight + from * SLOT),
        ends_at: toTimestamp(midnight + to * SLOT),
      });
      for (let slot = from; slot < to; slot++) available.add(midnight / SLOT + slot);
    }
    slots.set(members[index], available);
  });
  return {
    month,
    members,
    windows,
    slots,
    stationStart: midnight + 6 * 60,
    stationEnd: midnight + daysIn(month) * DAY + 6 * 60,
  };
}

// Per member: an optional carry-over starting on M−1's last day, then non-overlapping windows of 30 min–24h that
// start in M, separated by gaps from 0 (touching) to 5 days.
const memberWindowsArb = fc.record({
  carryOver: fc.option(fc.record({ start: fc.integer({ min: 0, max: 47 }), length: fc.integer({ min: 1, max: 48 }) }), {
    nil: undefined,
  }),
  steps: fc.array(
    fc.record({
      gap: fc.oneof(fc.constant(0), fc.integer({ min: 0, max: 12 }), fc.integer({ min: 0, max: 240 })),
      length: fc.oneof(fc.integer({ min: 1, max: 48 }), fc.constantFrom(12, 16, 24, 36, 48)),
    }),
    { maxLength: 40 },
  ),
});

const fixtureArb = fc
  .tuple(fc.constantFrom(...MONTHS), fc.array(memberWindowsArb, { minLength: 1, maxLength: 10 }))
  .map(([month, members]) => {
    const monthSlots = daysIn(month) * SLOTS_PER_DAY;
    const slotWindows = members.map(({ carryOver, steps }) => {
      const result: [number, number][] = [];
      let cursor = 0;
      if (carryOver) {
        const from = -SLOTS_PER_DAY + carryOver.start;
        result.push([from, from + carryOver.length]);
        cursor = Math.max(0, from + carryOver.length);
      }
      for (const { gap, length } of steps) {
        const from = cursor + gap;
        if (from >= monthSlots) break; // every window starts in M
        result.push([from, from + length]);
        cursor = from + length;
      }
      return result;
    });
    return buildFixture(month, slotWindows);
  });

// 4–10 members, each covering every station day of the month with touching windows of random lengths; the first
// window may be a carry-over from M−1's last day.
const fullyAvailableArb = fc
  .tuple(
    fc.constantFrom(...MONTHS),
    fc.array(
      fc.record({
        lead: fc.integer({ min: 0, max: 47 }),
        firstExtra: fc.nat(),
        lengths: fc.array(fc.integer({ min: 1, max: 48 }), { maxLength: 80 }),
      }),
      { minLength: 4, maxLength: 10 },
    ),
  )
  .map(([month, members]) => {
    const monthSlots = daysIn(month) * SLOTS_PER_DAY;
    const stationStart = 12; // M-01 06:00
    const stationEnd = monthSlots + 12; // M+1-01 06:00
    const slotWindows = members.map(({ lead, firstExtra, lengths }) => {
      const from = stationStart - lead;
      const firstEnd = from + lead + 1 + (firstExtra % (SLOTS_PER_DAY - lead));
      const result: [number, number][] = [[from, firstEnd]];
      let cursor = firstEnd;
      let step = 0;
      while (cursor < stationEnd) {
        const remaining = stationEnd - cursor;
        let length = remaining <= SLOTS_PER_DAY ? remaining : (lengths[step] ?? SLOTS_PER_DAY);
        // Never leave a remainder that would have to start in M+1 (after M+1-01 00:00).
        if (remaining > SLOTS_PER_DAY && remaining - length <= 12) length = remaining - 13;
        result.push([cursor, cursor + length]);
        cursor += length;
        step++;
      }
      return result;
    });
    return buildFixture(month, slotWindows);
  });

interface TimedShift {
  shift: GeneratedShift;
  start: number;
  end: number;
  /** Station day index: 0 is M-01 06:00 – M-02 06:00. */
  day: number;
}

function timed(fixture: Fixture, shifts: GeneratedShift[]): TimedShift[] {
  return shifts.map((shift) => {
    const start = toMinutes(shift.starts_at);
    return { shift, start, end: toMinutes(shift.ends_at), day: Math.floor((start - fixture.stationStart) / DAY) };
  });
}

/** Every 30-minute slot of [start, end) is inside one of the member's raw windows. */
function eligibleBySlots(fixture: Fixture, member: string, start: number, end: number): boolean {
  const available = fixture.slots.get(member);
  for (let minute = start; minute < end; minute += SLOT) {
    if (!available?.has(minute / SLOT)) return false;
  }
  return true;
}

function isLong(shift: TimedShift): boolean {
  return shift.end - shift.start === 12 * 60;
}

/** Covers 00:00–06:00 of the calendar day after the station day's start. */
function isNight(fixture: Fixture, shift: TimedShift): boolean {
  const midnight = fixture.stationStart + shift.day * DAY + 18 * 60;
  return shift.start <= midnight && shift.end >= midnight + 6 * 60;
}

/** The 12h/night rule breaks by this file's own counting, as comparable strings. */
function expectedRuleBreaks(fixture: Fixture, shifts: TimedShift[]): string[] {
  const longs = new Map<string, number>();
  const nights = new Map<string, number>();
  for (const shift of shifts) {
    const id = shift.shift.employee_id;
    if (id === null) continue;
    if (isLong(shift)) longs.set(id, (longs.get(id) ?? 0) + 1);
    if (isNight(fixture, shift)) nights.set(id, (nights.get(id) ?? 0) + 1);
  }
  const breaks: string[] = [];
  for (const shift of shifts) {
    const id = shift.shift.employee_id;
    if (id === null) continue;
    const eligible = fixture.members.filter((member) => eligibleBySlots(fixture, member, shift.start, shift.end));
    for (const [kind, counts, applies] of [
      ["long", longs, isLong(shift)],
      ["night", nights, isNight(fixture, shift)],
    ] as const) {
      if (!applies || eligible.length === 0) continue;
      const eligibleMin = Math.min(...eligible.map((member) => counts.get(member) ?? 0));
      if ((counts.get(id) ?? 0) > eligibleMin + 1) breaks.push(`${kind} ${shift.shift.starts_at} ${id} ${eligibleMin}`);
    }
  }
  return breaks.sort();
}

function generate(fixture: Fixture): TimedShift[] {
  return timed(fixture, generateSchedule({ month: fixture.month, windows: fixture.windows }).shifts);
}

describe("generated schedules keep the hard rules for any availability", () => {
  it("1. every assigned shift is inside the assignee's raw windows, slot by slot", () => {
    fc.assert(
      fc.property(fixtureArb, (fixture) => {
        for (const shift of generate(fixture)) {
          const id = shift.shift.employee_id;
          if (id !== null)
            expect(eligibleBySlots(fixture, id, shift.start, shift.end), shift.shift.starts_at).toBe(true);
        }
      }),
    );
  });

  it("2. each station day is exactly one of the 5 patterns and the month is covered with no gap or overlap", () => {
    fc.assert(
      fc.property(fixtureArb, (fixture) => {
        const shifts = generate(fixture);
        let cursor = fixture.stationStart;
        const perDay = new Map<number, string[]>();
        for (const shift of shifts) {
          expect(shift.start).toBe(cursor);
          expect(shift.end).toBeLessThanOrEqual(fixture.stationStart + (shift.day + 1) * DAY);
          cursor = shift.end;
          perDay.set(shift.day, [
            ...(perDay.get(shift.day) ?? []),
            `${shift.shift.starts_at.slice(11, 16)}/${shift.end - shift.start}`,
          ]);
        }
        expect(cursor).toBe(fixture.stationEnd);
        expect(perDay.size).toBe(daysIn(fixture.month));
        for (const sequence of perDay.values()) {
          expect(PATTERNS).toContain(sequence.join(" "));
        }
      }),
    );
  });

  it("3. no person has two shifts on one station day or two touching shifts", () => {
    fc.assert(
      fc.property(fixtureArb, (fixture) => {
        const byMember = new Map<string, TimedShift[]>();
        for (const shift of generate(fixture)) {
          const id = shift.shift.employee_id;
          if (id !== null) byMember.set(id, [...(byMember.get(id) ?? []), shift]);
        }
        for (const own of byMember.values()) {
          expect(new Set(own.map((shift) => shift.day)).size).toBe(own.length);
          const starts = new Set(own.map((shift) => shift.start));
          for (const shift of own) expect(starts.has(shift.end), shift.shift.ends_at).toBe(false);
        }
      }),
    );
  });

  it("4. a shift is uncovered only when every eligible member is blocked by a hard rule", () => {
    fc.assert(
      fc.property(fixtureArb, (fixture) => {
        const shifts = generate(fixture);
        for (const uncovered of shifts.filter((shift) => shift.shift.employee_id === null)) {
          for (const member of fixture.members) {
            if (!eligibleBySlots(fixture, member, uncovered.start, uncovered.end)) continue;
            const blocked = shifts.some(
              (shift) =>
                shift.shift.employee_id === member &&
                (shift.day === uncovered.day || shift.end === uncovered.start || shift.start === uncovered.end),
            );
            expect(blocked, `${member} could take ${uncovered.shift.starts_at}`).toBe(true);
          }
        }
      }),
    );
  });

  it("5. every 12h or night rule break is reported by summarizeSchedule", () => {
    fc.assert(
      fc.property(fixtureArb, (fixture) => {
        const shifts = generate(fixture);
        const summary = summarizeSchedule({
          month: fixture.month,
          members: fixture.members.map((id) => ({ id })),
          windows: fixture.windows,
          shifts: shifts.map((shift) => shift.shift),
        });
        const reported = summary.ruleBreaks
          .map((entry) => `${entry.kind} ${entry.shift.starts_at} ${entry.assignee} ${entry.eligibleMin}`)
          .sort();
        expect(reported).toEqual(expectedRuleBreaks(fixture, shifts));
      }),
    );
  });

  it("6. with 4–10 members available all month: nothing uncovered, no rule breaks, hours within 12h", () => {
    fc.assert(
      fc.property(fullyAvailableArb, (fixture) => {
        const shifts = generate(fixture);
        expect(shifts.filter((shift) => shift.shift.employee_id === null)).toEqual([]);
        expect(expectedRuleBreaks(fixture, shifts)).toEqual([]);
        const minutes = fixture.members.map((member) =>
          shifts
            .filter((shift) => shift.shift.employee_id === member)
            .reduce((sum, shift) => sum + shift.end - shift.start, 0),
        );
        expect(Math.max(...minutes) - Math.min(...minutes)).toBeLessThanOrEqual(12 * 60);
      }),
    );
  });

  it("7. the output is deterministic and does not depend on the order of the windows", () => {
    fc.assert(
      fc.property(fixtureArb, (fixture) => {
        const first = generateSchedule({ month: fixture.month, windows: fixture.windows });
        expect(generateSchedule({ month: fixture.month, windows: fixture.windows })).toEqual(first);
        expect(generateSchedule({ month: fixture.month, windows: [...fixture.windows].reverse() })).toEqual(first);
      }),
    );
  });
});
