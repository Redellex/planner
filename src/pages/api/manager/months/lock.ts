import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { monthStart, parseMonth } from "@/lib/availability";
import {
  GENERIC_LOCK_WRITE_ERROR,
  INVALID_ACTION_ERROR,
  INVALID_MONTH_ERROR,
  logMonthsError,
  monthsUrl,
  SUPABASE_NOT_CONFIGURED_ERROR,
  UNLOCK_WITH_DRAFT_ERROR,
  UNLOCK_WITH_PUBLISHED_ERROR,
} from "@/lib/manager-months";

type LockAction = "lock" | "unlock";

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
    // A month with a draft or published schedule cannot be unlocked: schedules.month restricts deleting its lock row.
    if (action === "unlock" && error.code === "23503") {
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
      const published = schedule.data !== null && schedule.data.published_at !== null;
      return context.redirect(
        monthsUrl({ error: published ? UNLOCK_WITH_PUBLISHED_ERROR : UNLOCK_WITH_DRAFT_ERROR }, month),
      );
    }
    logMonthsError(`${action} failed`, { code: error.code, message: error.message });
    return context.redirect(monthsUrl({ error: GENERIC_LOCK_WRITE_ERROR }, month));
  }

  return context.redirect(monthsUrl({ updated: true }, month));
};
