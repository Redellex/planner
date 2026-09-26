import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { monthStart, parseMonth } from "@/lib/availability";

type LockAction = "lock" | "unlock";

function isLockAction(value: unknown): value is LockAction {
  return value === "lock" || value === "unlock";
}

function redirectWithError(context: Parameters<APIRoute>[0], message: string) {
  return context.redirect(`/manager/months?error=${encodeURIComponent(message)}`);
}

export const POST: APIRoute = async (context) => {
  const form = await context.request.formData();
  const month = parseMonth(form.get("month"));
  const action = form.get("action");

  if (!month) {
    return redirectWithError(context, "Invalid month");
  }
  if (!isLockAction(action)) {
    return redirectWithError(context, "Invalid action");
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return redirectWithError(context, "Supabase is not configured");
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
    return redirectWithError(context, error.message);
  }

  return context.redirect("/manager/months?updated=1");
};
