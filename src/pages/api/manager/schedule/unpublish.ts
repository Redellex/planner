import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { monthStart, parseMonth } from "@/lib/availability";
import {
  describeScheduleWriteError,
  INVALID_MONTH_ERROR,
  logScheduleError,
  managerScheduleUrl,
  scheduleMonths,
  SUPABASE_NOT_CONFIGURED_ERROR,
} from "@/lib/schedule";

// Returns a published month to a draft, so it can be overridden, regenerated or discarded again. unpublish_schedule
// (SECURITY DEFINER, manager-only) is the real enforcement: 42501 for a non-manager, SP002 without a schedule, and a
// no-op for a month that is already a draft.
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

  const { error } = await supabase.rpc("unpublish_schedule", { target_month: monthStart(month) });
  if (error) {
    logScheduleError("could not unpublish the schedule", error);
    return context.redirect(managerScheduleUrl({ month, error: describeScheduleWriteError(error) }));
  }

  return context.redirect(managerScheduleUrl({ month, unpublished: true }));
};
