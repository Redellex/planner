import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { accountUrl, parseDisplayName, SUPABASE_NOT_CONFIGURED_ERROR } from "@/lib/account";
import type { AppRole } from "@/lib/roles";

export const POST: APIRoute = async (context) => {
  const form = await context.request.formData();
  console.log("display-name form", Object.fromEntries(form));
  const parsed = parseDisplayName(form.get("display_name"));

  if (!parsed.ok) {
    return context.redirect(accountUrl({ error: parsed.error }));
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return context.redirect(accountUrl({ error: SUPABASE_NOT_CONFIGURED_ERROR }));
  }

  // Save the name and the role picked on the form in one update of the caller's profile.
  const role = (form.get("role") as AppRole | null) ?? "employee";
  const { error } = await supabase
    .from("profiles")
    .update({ display_name: parsed.name, role })
    .eq("id", context.locals.user?.id ?? "");

  if (error) {
    return context.redirect(`/account?error=${encodeURIComponent(error.message)}`);
  }

  return context.redirect(accountUrl({ updated: true }));
};
