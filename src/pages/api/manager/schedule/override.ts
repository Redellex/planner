import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { monthOfDate, monthStart, parseDate, parseMonth } from "@/lib/availability";
import { alreadySaved, changedRows, matchesStored, parseDaySaveForm, sameRows } from "@/lib/schedule-day-save";
import { applyOverrides, overrideWarnings } from "@/lib/schedule-override";
import { summarizeSchedule } from "@/lib/schedule-summary";
import { loadAllPages } from "@/lib/team-availability";
import {
  DAY_CHANGED_ERROR,
  describeScheduleWriteError,
  GENERIC_SCHEDULE_WRITE_ERROR,
  INVALID_ASSIGNEE_ERROR,
  INVALID_MONTH_ERROR,
  loadScheduleInputs,
  logScheduleError,
  managerScheduleUrl,
  NO_SCHEDULE_ERROR,
  SCHEDULE_PAGE_SIZE,
  SCHEDULE_PUBLISHED_ERROR,
  scheduleMonths,
  stationDayOf,
  SUPABASE_NOT_CONFIGURED_ERROR,
  type DayRow,
} from "@/lib/schedule";

// Saves every assignee change of one station day of a draft at once (FR-005, S-08), all or nothing, through
// save_schedule_day. The form posts each shift of the day with the assignee the manager saw (`was-<id>`) and the one
// chosen (`employee-<id>`). The warnings of the combined change are recomputed here from a full read, never taken from
// the confirm panel: a day whose changes introduce a problem is sent back to the page's confirm panel instead
// (FR-004), and `confirm=override` is honoured only for exactly the rows that panel listed. RLS (manager-only update
// of `employee_id` on an unpublished month) and the function's own checks are the real enforcement.
export const POST: APIRoute = async (context) => {
  const form = await context.request.formData();
  const month = parseMonth(form.get("month"));
  const requestedDay = parseDate(form.get("day"));
  // Every calendar date of the month starts one station day; any other day is dropped.
  const day = month && requestedDay && monthOfDate(requestedDay) === month ? requestedDay : null;
  const fail = (error: string) => context.redirect(managerScheduleUrl({ month, day, error }));

  if (!month || !scheduleMonths().includes(month)) {
    return fail(INVALID_MONTH_ERROR);
  }
  // A missing day or malformed rows (e.g. a page rendered before a deploy) cannot be matched to the stored day.
  const parsed = parseDaySaveForm(form);
  if (!day || !parsed) {
    return fail(DAY_CHANGED_ERROR);
  }
  const { rows, confirmed } = parsed;

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return fail(SUPABASE_NOT_CONFIGURED_ERROR);
  }

  const [inputs, draftResult, shiftsResult] = await Promise.all([
    loadScheduleInputs(supabase, month),
    supabase.from("schedules").select("month, published_at").eq("month", monthStart(month)).maybeSingle(),
    loadAllPages(
      (from, to) =>
        supabase
          .from("schedule_shifts")
          .select("id, starts_at, ends_at, employee_id", { count: "exact" })
          .eq("month", monthStart(month))
          .order("starts_at", { ascending: true })
          .order("id", { ascending: true })
          .range(from, to),
      SCHEDULE_PAGE_SIZE,
    ),
  ]);
  if (draftResult.error) {
    logScheduleError("could not read the draft", draftResult.error);
  }
  if (shiftsResult.error) {
    logScheduleError("could not read the draft shifts", shiftsResult.error);
  }
  // Warnings from a partial read could miss a problem, so nothing is written unless every list is complete.
  if (inputs.status === "unknown" || draftResult.error || shiftsResult.data === null) {
    return fail(GENERIC_SCHEDULE_WRITE_ERROR);
  }
  if (!draftResult.data) {
    return fail(NO_SCHEDULE_ERROR);
  }
  if (draftResult.data.published_at !== null) {
    return fail(SCHEDULE_PUBLISHED_ERROR);
  }

  const changes = changedRows(rows);
  if (changes.length === 0) {
    return context.redirect(managerScheduleUrl({ month, day, unchanged: true }));
  }
  const shifts = shiftsResult.data;
  const dayShifts = shifts.filter((shift) => stationDayOf(shift.starts_at) === day);
  // Before the stale check: the second click of a double submit finds the day already saved as requested.
  if (alreadySaved(rows, dayShifts)) {
    return context.redirect(managerScheduleUrl({ month, day, overridden: true }));
  }
  if (!matchesStored(rows, dayShifts)) {
    return fail(DAY_CHANGED_ERROR);
  }
  if (changes.some((row) => row.to !== null && !inputs.members.some((member) => member.id === row.to))) {
    return fail(INVALID_ASSIGNEE_ERROR);
  }

  const common = {
    month,
    members: inputs.members,
    windows: inputs.windows,
    previousNight: inputs.previousNight,
    nextMorning: inputs.nextMorning,
  };
  const warnings = overrideWarnings({
    before: summarizeSchedule({ ...common, shifts }),
    after: summarizeSchedule({
      ...common,
      shifts: applyOverrides(shifts, new Map(changes.map((row) => [row.shift, row.to]))),
    }),
    shiftIds: new Set(changes.map((row) => row.shift)),
  });
  // "Assign anyway" accepts only the set the confirm panel listed; a pick changed during the confirm is checked again.
  const accepted = confirmed !== null && sameRows(rows, confirmed);
  if (warnings.length > 0 && !accepted) {
    // Not an error: the page rebuilds the same warnings from its own reads and asks for the explicit confirm. The rows
    // go in start order (matchesStored made the posted set equal the stored day).
    const rowsByShift = new Map(rows.map((row) => [row.shift, row]));
    const ordered = dayShifts.map((shift) => rowsByShift.get(shift.id)).filter((row): row is DayRow => !!row);
    return context.redirect(managerScheduleUrl({ month, day, confirm: "override", rows: ordered }));
  }

  // One transaction: the function re-checks the stored day under row locks (SP004 if it moved since the read above),
  // refuses a published month (SP001) and writes every change or none.
  const { error } = await supabase.rpc("save_schedule_day", {
    target_month: monthStart(month),
    station_day: day,
    rows: rows.map((row) => ({ id: row.shift, was: row.was, employee_id: row.to })),
  });
  if (error) {
    logScheduleError("could not save the schedule day", error);
    // Only the assignee foreign key can fail on an employee_id update (an account deleted since the read).
    if (error.code === "23503") {
      return fail(INVALID_ASSIGNEE_ERROR);
    }
    // A deadlock: a discard or regenerate of this month ran at the same moment (it locks the schedules row before the
    // shifts, the save the other way round), so the day changed under the save.
    if (error.code === "40P01") {
      return fail(DAY_CHANGED_ERROR);
    }
    return fail(describeScheduleWriteError(error));
  }

  return context.redirect(managerScheduleUrl({ month, day, overridden: true }));
};
