import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import {
  availabilityUrl,
  describeWriteError,
  INVALID_MONTH_ERROR,
  INVALID_WINDOW_ID_ERROR,
  monthOfDate,
  NOT_FOUND_ERROR,
  parseDate,
  parseMonth,
  SUPABASE_NOT_CONFIGURED_ERROR,
} from "@/lib/availability";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const POST: APIRoute = async (context) => {
  const form = await context.request.formData();
  const month = parseMonth(form.get("month"));
  if (!month) {
    return context.redirect(availabilityUrl(null, { error: INVALID_MONTH_ERROR }));
  }

  // Keep the selected day on redirect only when it belongs to the submitted month.
  const submittedDay = parseDate(form.get("day"));
  const day = submittedDay && monthOfDate(submittedDay) === month ? submittedDay : null;

  const id = form.get("id");
  if (typeof id !== "string" || !UUID_PATTERN.test(id)) {
    return context.redirect(availabilityUrl(month, { error: INVALID_WINDOW_ID_ERROR }, day));
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return context.redirect(availabilityUrl(month, { error: SUPABASE_NOT_CONFIGURED_ERROR }, day));
  }

  // RLS (own window, editable month) is the enforcement; a refused delete affects zero rows.
  const { data, error } = await supabase.from("availability_windows").delete().eq("id", id).select("id");

  if (error) {
    return context.redirect(availabilityUrl(month, { error: describeWriteError(error) }, day));
  }
  if (data.length === 0) {
    return context.redirect(availabilityUrl(month, { error: NOT_FOUND_ERROR }, day));
  }

  return context.redirect(availabilityUrl(month, { updated: true }, day));
};
