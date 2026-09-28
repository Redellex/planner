import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import {
  availabilityUrl,
  buildWindow,
  dateOf,
  describeWriteError,
  GENERIC_WRITE_ERROR,
  INVALID_TIME_ERROR,
  INVALID_WINDOW_ID_ERROR,
  logAvailabilityError,
  monthOfDate,
  NOT_FOUND_ERROR,
  parseDate,
  parseTime,
  SUPABASE_NOT_CONFIGURED_ERROR,
} from "@/lib/availability";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const POST: APIRoute = async (context) => {
  const form = await context.request.formData();
  // The submitted date only picks where to redirect on early errors; the window's date comes from the row.
  const submittedDate = parseDate(form.get("date"));
  const redirectWithError = (message: string) =>
    context.redirect(availabilityUrl(submittedDate && monthOfDate(submittedDate), { error: message }, submittedDate));

  const id = form.get("id");
  const start = parseTime(form.get("start"));
  const end = parseTime(form.get("end"));

  if (typeof id !== "string" || !UUID_PATTERN.test(id)) {
    return redirectWithError(INVALID_WINDOW_ID_ERROR);
  }
  if (!start || !end) {
    return redirectWithError(INVALID_TIME_ERROR);
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return redirectWithError(SUPABASE_NOT_CONFIGURED_ERROR);
  }

  // Editing never moves a window to another date: rebuild the times on the date it already starts on.
  const { data: existing, error: readError } = await supabase
    .from("availability_windows")
    .select("starts_at")
    .eq("id", id)
    .maybeSingle();

  if (readError) {
    logAvailabilityError("could not read the window to update", readError);
    return redirectWithError(GENERIC_WRITE_ERROR);
  }
  if (!existing) {
    return redirectWithError(NOT_FOUND_ERROR);
  }

  const date = dateOf(existing.starts_at);
  const month = monthOfDate(date);

  // RLS checks the old and the new row (own window, editable months); column grants allow only the times.
  const { starts_at, ends_at } = buildWindow(date, start, end);
  const { data, error } = await supabase
    .from("availability_windows")
    .update({ starts_at, ends_at })
    .eq("id", id)
    .select("id");

  if (error) {
    return context.redirect(availabilityUrl(month, { error: describeWriteError(error) }, date));
  }
  if (data.length === 0) {
    return context.redirect(availabilityUrl(month, { error: NOT_FOUND_ERROR }, date));
  }

  return context.redirect(availabilityUrl(month, { updated: true }, date));
};
