import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { isAppRole } from "@/lib/roles";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function redirectWithError(context: Parameters<APIRoute>[0], message: string) {
  return context.redirect(`/manager/users?error=${encodeURIComponent(message)}`);
}

export const POST: APIRoute = async (context) => {
  const form = await context.request.formData();
  const userId = form.get("userId");
  const role = form.get("role");

  if (typeof userId !== "string" || !UUID_PATTERN.test(userId)) {
    return redirectWithError(context, "Invalid user id");
  }
  if (!isAppRole(role)) {
    return redirectWithError(context, "Invalid role");
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return redirectWithError(context, "Supabase is not configured");
  }

  // RLS (manager may update only `role`) and the last-manager trigger are the real enforcement.
  const { data, error } = await supabase.from("profiles").update({ role }).eq("id", userId).select("id");

  if (error) {
    return redirectWithError(context, error.message);
  }
  if (data.length === 0) {
    return redirectWithError(context, "User not found or not permitted");
  }

  // A manager who just demoted themselves can no longer open /manager/users (it would render 403).
  if (userId === context.locals.user?.id && role !== "manager") {
    return context.redirect("/dashboard");
  }

  return context.redirect("/manager/users?updated=1");
};
