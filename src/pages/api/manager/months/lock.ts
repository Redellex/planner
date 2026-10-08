import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { monthStart, parseMonth } from "@/lib/availability";
import {
  describeLockWriteError,
  INVALID_ACTION_ERROR,
  INVALID_MONTH_ERROR,
  isUnlockBlockedBySchedule,
  type LockAction,
  logMonthsError,
  monthsUrl,
  SUPABASE_NOT_CONFIGURED_ERROR,
} from "@/lib/manager-months";

function isLockAction(value: unknown): value is LockAction {
  return value === "lock" || value === "unlock";
}

export const POST: APIRoute = async (context) => {
  const form = await context.request.formData();
  const month = parseMonth(form.get("month"));
  const action = form.get("action");

  if (!month) {
    return context.redirect(monthsUrl({ error: INVALID_MONTH_ERROR }));
  }
  if (!isLockAction(action)) {
    return context.redirect(monthsUrl({ error: INVALID_ACTION_ERROR }));
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return context.redirect(monthsUrl({ error: SUPABASE_NOT_CONFIGURED_ERROR }, month));
  }

  // RLS (manager-only insert/delete on availability_locks) is the real enforcement.
  // Both actions are idempotent: lock emits ON CONFLICT DO NOTHING, and unlocking an open month deletes zero rows.
  const { error } =
    action === "lock"
      ? await supabase
          .from("availability_locks")
          .upsert({ month: monthStart(month) }, { onConflict: "month", ignoreDuplicates: true })
      : await supabase.from("availability_locks").delete().eq("month", monthStart(month));

  if (error) {
    let published = false;
    if (isUnlockBlockedBySchedule(action, error)) {
      logMonthsError("unlock refused while a schedule exists", { code: error.code, message: error.message });
      // A published month must be unpublished before its draft can be discarded; any read failure falls back to the
      // draft message (smoke.mjs matches it).
      const schedule = await supabase
        .from("schedules")
        .select("published_at")
        .eq("month", monthStart(month))
        .maybeSingle();
      if (schedule.error) {
        logMonthsError("could not read the schedule after a refused unlock", {
          code: schedule.error.code,
          message: schedule.error.message,
        });
      }
      published = schedule.data !== null && schedule.data.published_at !== null;
    } else {
      logMonthsError(`${action} failed`, { code: error.code, message: error.message });
    }
    return context.redirect(monthsUrl({ error: describeLockWriteError(action, error, published) }, month));
  }

  return context.redirect(monthsUrl({ updated: true }, month));
};
