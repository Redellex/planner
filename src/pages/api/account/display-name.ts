import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import {
  accountUrl,
  describeDisplayNameWriteError,
  parseDisplayName,
  SUPABASE_NOT_CONFIGURED_ERROR,
} from "@/lib/account";

export const POST: APIRoute = async (context) => {
  const form = await context.request.formData();
  const parsed = parseDisplayName(form.get("display_name"));

  if (!parsed.ok) {
    return context.redirect(accountUrl({ error: parsed.error }));
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return context.redirect(accountUrl({ error: SUPABASE_NOT_CONFIGURED_ERROR }));
  }

  // set_display_name writes only the caller's own row; there is no column grant on display_name.
  const { error } = await supabase.rpc("set_display_name", { new_name: parsed.name ?? "" });

  if (error) {
    return context.redirect(accountUrl({ error: describeDisplayNameWriteError(error) }));
  }

  return context.redirect(accountUrl({ updated: true }));
};
