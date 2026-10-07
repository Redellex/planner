import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { monthOfDate, monthStart, parseDate, parseMonth } from "@/lib/availability";
import { applyOverride, overrideWarnings } from "@/lib/schedule-override";
import { summarizeSchedule } from "@/lib/schedule-summary";
import { loadAllPages } from "@/lib/team-availability";
import {
  describeScheduleWriteError,
  GENERIC_SCHEDULE_WRITE_ERROR,
  INVALID_ASSIGNEE_ERROR,
  INVALID_MONTH_ERROR,
  loadScheduleInputs,
  logScheduleError,
  managerScheduleUrl,
  NO_SCHEDULE_ERROR,
  parseShiftParam,
  SCHEDULE_PAGE_SIZE,
  SCHEDULE_PUBLISHED_ERROR,
  scheduleMonths,
  STALE_SHIFT_ERROR,
  SUPABASE_NOT_CONFIGURED_ERROR,
} from "@/lib/schedule";

// Changes one draft shift's assignee (FR-005). The warnings are recomputed here from a full read, never taken from
// the confirm panel: a change that introduces a problem is refused without `confirm=override` and sent back to the
// page's confirm panel instead (FR-004). RLS (manager-only update of `employee_id` on an unpublished month) is the
// real enforcement; a refused update affects zero rows.
export const POST: APIRoute = async (context) => {
  const form = await context.request.formData();
  const month = parseMonth(form.get("month"));
  const requestedDay = parseDate(form.get("day"));
  // Every calendar date of the month starts one station day; any other day is dropped, not an error.
  const day = month && requestedDay && monthOfDate(requestedDay) === month ? requestedDay : null;
  const shift = parseShiftParam(form.get("shift"));
  // Every redirect keeps the shift, so the page renders the result in that shift's row.
  const fail = (error: string) => context.redirect(managerScheduleUrl({ month, day, shift, error }));

  if (!month || !scheduleMonths().includes(month)) {
    return fail(INVALID_MONTH_ERROR);
  }
  if (!shift) {
    return fail(STALE_SHIFT_ERROR);
  }
  // `""` is Uncovered; anything else must be a loaded member id (checked after the read).
  const employeeField = form.get("employee");
  if (typeof employeeField !== "string") {
    return fail(INVALID_ASSIGNEE_ERROR);
  }
  const employee = employeeField === "" ? null : employeeField;
  const confirmed = form.get("confirm") === "override";

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
  const shifts = shiftsResult.data;
  const target = shifts.find((row) => row.id === shift);
  if (!target) {
    return fail(STALE_SHIFT_ERROR);
  }
  if (employee !== null && !inputs.members.some((member) => member.id === employee)) {
    return fail(INVALID_ASSIGNEE_ERROR);
  }

  if (target.employee_id === employee) {
    return context.redirect(managerScheduleUrl({ month, day, overridden: true, shift }));
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
    after: summarizeSchedule({ ...common, shifts: applyOverride(shifts, shift, employee) }),
    shiftId: shift,
  });
  if (warnings.length > 0 && !confirmed) {
    // Not an error: the page rebuilds the same warnings from its own reads and asks for the explicit confirm.
    return context.redirect(managerScheduleUrl({ month, day, confirm: "override", shift, employee }));
  }

  // The month filter keeps the write inside the month that was read; a regenerate in between replaced every shift id,
  // and a publish in between makes RLS hide the row, so both affect zero rows.
  const { data, error } = await supabase
    .from("schedule_shifts")
    .update({ employee_id: employee })
    .eq("id", shift)
    .eq("month", monthStart(month))
    .select("id");
  if (error) {
    logScheduleError("could not override the shift", error);
    return fail(describeScheduleWriteError(error));
  }
  if (data.length === 0) {
    return fail(STALE_SHIFT_ERROR);
  }

  return context.redirect(managerScheduleUrl({ month, day, overridden: true, shift }));
};
