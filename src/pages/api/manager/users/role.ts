import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { isAppRole } from "@/lib/roles";
import {
  describeRoleWriteError,
  INVALID_ROLE_ERROR,
  INVALID_USER_ID_ERROR,
  managerUsersUrl,
  SUPABASE_NOT_CONFIGURED_ERROR,
  USER_ID_PATTERN,
  USER_NOT_FOUND_ERROR,
} from "@/lib/manager-users";

export const POST: APIRoute = async (context) => {
  const form = await context.request.formData();
  const userId = form.get("userId");
  const role = form.get("role");

  if (typeof userId !== "string" || !USER_ID_PATTERN.test(userId)) {
    return context.redirect(managerUsersUrl({ error: INVALID_USER_ID_ERROR }));
  }
  if (!isAppRole(role)) {
    return context.redirect(managerUsersUrl({ error: INVALID_ROLE_ERROR }, userId));
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return context.redirect(managerUsersUrl({ error: SUPABASE_NOT_CONFIGURED_ERROR }, userId));
  }

  // RLS (manager may update only `role`) and the last-manager trigger are the real enforcement.
  const { data, error } = await supabase.from("profiles").update({ role }).eq("id", userId).select("id");

  if (error) {
    return context.redirect(managerUsersUrl({ error: describeRoleWriteError(error) }, userId));
  }
  if (data.length === 0) {
    return context.redirect(managerUsersUrl({ error: USER_NOT_FOUND_ERROR }, userId));
  }

  // A manager who just demoted themselves can no longer open /manager/users (it would render 403).
  if (userId === context.locals.user?.id && role !== "manager") {
    return context.redirect("/");
  }

  return context.redirect(managerUsersUrl({ updated: true }, userId));
};
