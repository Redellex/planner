import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import {
  availabilityUrl,
  buildWindow,
  describeWriteError,
  INVALID_DATE_ERROR,
  INVALID_TIME_ERROR,
  monthOfDate,
  parseDate,
  parseTime,
  sameWeekdayDatesInMonth,
  SUPABASE_NOT_CONFIGURED_ERROR,
} from "@/lib/availability";

export const POST: APIRoute = async (context) => {
  const form = await context.request.formData();
  const date = parseDate(form.get("date"));
  if (!date) {
    return context.redirect(availabilityUrl(null, { error: INVALID_DATE_ERROR }));
  }

  const month = monthOfDate(date);
  const start = parseTime(form.get("start"));
  const end = parseTime(form.get("end"));
  if (!start || !end) {
    return context.redirect(availabilityUrl(month, { error: INVALID_TIME_ERROR }, date));
  }

  const dates = form.has("repeat") ? sameWeekdayDatesInMonth(date) : [date];
  const windows = dates.map((day) => buildWindow(day, start, end));

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return context.redirect(availabilityUrl(month, { error: SUPABASE_NOT_CONFIGURED_ERROR }, date));
  }

  // One statement: employee_id defaults to auth.uid(), and RLS (own row, editable month) plus the
  // range/overlap constraints reject the whole batch if any window fails.
  const { error } = await supabase.from("availability_windows").insert(windows);

  if (error) {
    return context.redirect(availabilityUrl(month, { error: describeWriteError(error) }, date));
  }

  return context.redirect(availabilityUrl(month, { updated: true }, date));
};
