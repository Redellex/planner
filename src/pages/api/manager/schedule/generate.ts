import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { monthStart, parseMonth } from "@/lib/availability";
import { generateSchedule } from "@/lib/schedule-generator";
import {
  CONFIRM_REPLACE_ERROR,
  describeScheduleWriteError,
  GENERATE_LOAD_ERROR,
  generatableMonths,
  INVALID_MONTH_ERROR,
  loadScheduleInputs,
  logScheduleError,
  managerScheduleUrl,
  SUPABASE_NOT_CONFIGURED_ERROR,
} from "@/lib/schedule";

// Lock, read the whole team's availability in full, generate and atomically replace the month's draft. RLS
// (manager-only locks, schedules and shifts) and the schedules/shifts constraints are the real enforcement.
export const POST: APIRoute = async (context) => {
  const form = await context.request.formData();
  const month = parseMonth(form.get("month"));
  if (!month || !generatableMonths().includes(month)) {
    return context.redirect(managerScheduleUrl({ month, error: INVALID_MONTH_ERROR }));
  }
  const replace = form.get("confirm") === "replace";

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return context.redirect(managerScheduleUrl({ month, error: SUPABASE_NOT_CONFIGURED_ERROR }));
  }

  // An existing draft is replaced only after the explicit confirm step.
  const existing = await supabase.from("schedules").select("month").eq("month", monthStart(month)).maybeSingle();
  if (existing.error) {
    logScheduleError("could not read the draft", existing.error);
    return context.redirect(managerScheduleUrl({ month, error: describeScheduleWriteError(existing.error) }));
  }
  if (existing.data && !replace) {
    return context.redirect(managerScheduleUrl({ month, error: CONFIRM_REPLACE_ERROR }));
  }

  // Lock first, then read, so availability cannot change under the draft (idempotent: ON CONFLICT DO NOTHING).
  const lock = await supabase
    .from("availability_locks")
    .upsert({ month: monthStart(month) }, { onConflict: "month", ignoreDuplicates: true });
  if (lock.error) {
    logScheduleError("could not lock the month", lock.error);
    return context.redirect(managerScheduleUrl({ month, error: describeScheduleWriteError(lock.error) }));
  }

  // A partial read would leave people out of the draft, so nothing is generated unless every list is complete.
  // The lock stays; the manager can unlock on /manager/months.
  const inputs = await loadScheduleInputs(supabase, month);
  if (inputs.status === "unknown") {
    return context.redirect(managerScheduleUrl({ month, error: GENERATE_LOAD_ERROR }));
  }

  // The previous month's last night ends at 06:00 on day 1, so its assignee cannot start then.
  const { shifts } = generateSchedule({
    month,
    windows: inputs.windows,
    previousNight: inputs.previousNight?.employee_id ?? null,
  });

  // The only write: deletes the old draft (its shifts cascade) and inserts the new one in one transaction. If the
  // month was unlocked since the lock above, the schedules.month foreign key refuses it (23503).
  const replaced = await supabase.rpc("replace_schedule_draft", {
    target_month: monthStart(month),
    shifts: shifts.map(({ starts_at, ends_at, employee_id }) => ({ starts_at, ends_at, employee_id })),
  });
  if (replaced.error) {
    logScheduleError("could not replace the draft", replaced.error);
    return context.redirect(managerScheduleUrl({ month, error: describeScheduleWriteError(replaced.error) }));
  }

  return context.redirect(managerScheduleUrl({ month, generated: true }));
};
