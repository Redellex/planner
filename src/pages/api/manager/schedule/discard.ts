import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { monthStart, parseMonth } from "@/lib/availability";
import {
  describeScheduleWriteError,
  INVALID_MONTH_ERROR,
  logScheduleError,
  managerScheduleUrl,
  NO_DRAFT_ERROR,
  SCHEDULE_PUBLISHED_ERROR,
  scheduleMonths,
  SUPABASE_NOT_CONFIGURED_ERROR,
} from "@/lib/schedule";

// Deletes a month's draft (its shifts cascade) so the month can be regenerated from scratch or unlocked. The lock is
// left in place. RLS (manager-only delete on schedules, and only while the month is unpublished) is the real
// enforcement; a refused delete affects zero rows.
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

  const { data, error } = await supabase.from("schedules").delete().eq("month", monthStart(month)).select("month");
  if (error) {
    logScheduleError("could not discard the draft", error);
    return context.redirect(managerScheduleUrl({ month, error: describeScheduleWriteError(error) }));
  }
  if (data.length === 0) {
    // RLS hides a published month's row from the delete, so tell "published" apart from "no draft".
    const existing = await supabase
      .from("schedules")
      .select("month, published_at")
      .eq("month", monthStart(month))
      .maybeSingle();
    if (existing.error) {
      logScheduleError("could not read the draft", existing.error);
      return context.redirect(managerScheduleUrl({ month, error: describeScheduleWriteError(existing.error) }));
    }
    const published = existing.data !== null && existing.data.published_at !== null;
    return context.redirect(
      managerScheduleUrl({ month, error: published ? SCHEDULE_PUBLISHED_ERROR : NO_DRAFT_ERROR }),
    );
  }

  return context.redirect(managerScheduleUrl({ month, discarded: true }));
};
