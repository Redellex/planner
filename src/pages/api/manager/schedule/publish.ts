import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { monthStart, parseMonth } from "@/lib/availability";
import { summarizeSchedule } from "@/lib/schedule-summary";
import { loadAllPages } from "@/lib/team-availability";
import {
  describeScheduleWriteError,
  GENERIC_SCHEDULE_WRITE_ERROR,
  INVALID_MONTH_ERROR,
  loadScheduleInputs,
  logScheduleError,
  managerScheduleUrl,
  NO_SCHEDULE_ERROR,
  PUBLISH_GAPS_ERROR,
  SCHEDULE_PAGE_SIZE,
  scheduleMonths,
  SUPABASE_NOT_CONFIGURED_ERROR,
} from "@/lib/schedule";

// Publishes a month's draft (FR-006). Refused while any station day has no one assigned, from this endpoint's own full
// read; publish_schedule (SECURITY DEFINER, manager-only) re-checks the same coverage rule (SP003) and is the real
// enforcement. A published month is frozen until it is unpublished.
export const POST: APIRoute = async (context) => {
  const form = await context.request.formData();
  const month = parseMonth(form.get("month"));
  if (!month || !scheduleMonths().includes(month)) {
    return context.redirect(managerScheduleUrl({ month, error: INVALID_MONTH_ERROR }));
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return context.redirect(managerScheduleUrl({ month, error: SUPABASE_NOT_CONFIGURED_ERROR }));
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
  // A partial read could miss a day with no one, so nothing is published unless every list is complete.
  if (inputs.status === "unknown" || draftResult.error || shiftsResult.data === null) {
    return context.redirect(managerScheduleUrl({ month, error: GENERIC_SCHEDULE_WRITE_ERROR }));
  }
  if (!draftResult.data) {
    return context.redirect(managerScheduleUrl({ month, error: NO_SCHEDULE_ERROR }));
  }
  // Idempotent: a double submit lands on the published card.
  if (draftResult.data.published_at !== null) {
    return context.redirect(managerScheduleUrl({ month, published: true }));
  }

  const summary = summarizeSchedule({
    month,
    members: inputs.members,
    windows: inputs.windows,
    shifts: shiftsResult.data,
    previousNight: inputs.previousNight,
    nextMorning: inputs.nextMorning,
  });
  if (summary.daysWithNoOne.length > 0) {
    return context.redirect(managerScheduleUrl({ month, error: PUBLISH_GAPS_ERROR }));
  }

  // An override that left a day with no one in between is refused here (SP003); a discard in between is SP002.
  const { error } = await supabase.rpc("publish_schedule", { target_month: monthStart(month) });
  if (error) {
    logScheduleError("could not publish the schedule", error);
    return context.redirect(managerScheduleUrl({ month, error: describeScheduleWriteError(error) }));
  }

  return context.redirect(managerScheduleUrl({ month, published: true }));
};
