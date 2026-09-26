import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import {
  availabilityUrl,
  buildWindow,
  describeWriteError,
  monthOfDate,
  parseDate,
  parseTime,
} from "@/lib/availability";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const POST: APIRoute = async (context) => {
  const form = await context.request.formData();
  const date = parseDate(form.get("date"));
  if (!date) {
    return context.redirect(availabilityUrl(null, { error: "Invalid date" }));
  }

  const month = monthOfDate(date);
  const id = form.get("id");
  const start = parseTime(form.get("start"));
  const end = parseTime(form.get("end"));

  if (typeof id !== "string" || !UUID_PATTERN.test(id)) {
    return context.redirect(availabilityUrl(month, { error: "Invalid window id" }, date));
  }
  if (!start || !end) {
    return context.redirect(availabilityUrl(month, { error: "Invalid time" }, date));
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return context.redirect(availabilityUrl(month, { error: "Supabase is not configured" }, date));
  }

  // RLS checks the old and the new row (own window, editable month); column grants allow only the times.
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
    return context.redirect(availabilityUrl(month, { error: "Not found, locked or not permitted" }, date));
  }

  return context.redirect(availabilityUrl(month, { updated: true }, date));
};
