import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { describeAuthError, logAuthError, SUPABASE_NOT_CONFIGURED_ERROR } from "@/lib/auth-feedback";

export const POST: APIRoute = async (context) => {
  const form = await context.request.formData();
  const email = form.get("email") as string;
  const password = form.get("password") as string;

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return context.redirect(`/auth/signup?error=${encodeURIComponent(SUPABASE_NOT_CONFIGURED_ERROR)}`);
  }
  const { error } = await supabase.auth.signUp({ email, password });

  if (error) {
    logAuthError("sign-up failed", error);
    return context.redirect(`/auth/signup?error=${encodeURIComponent(describeAuthError("signup", error))}`);
  }

  return context.redirect("/auth/confirm-email");
};
