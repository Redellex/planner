import { defineMiddleware } from "astro:middleware";
import { createClient } from "@/lib/supabase";
import { roleFromProfile, routeAccess } from "@/lib/route-access";

export const onRequest = defineMiddleware(async (context, next) => {
  const supabase = createClient(context.request.headers, context.cookies);

  context.locals.user = null;
  context.locals.role = null;

  if (supabase) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    context.locals.user = user ?? null;

    if (user) {
      context.locals.role = roleFromProfile(
        await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle(),
      );
    }
  }

  // The route lists and the decision live in src/lib/route-access.ts.
  const access = routeAccess(context.url.pathname, {
    signedIn: context.locals.user !== null,
    role: context.locals.role,
  });
  if (access === "signin") {
    return context.redirect("/auth/signin");
  }
  if (access === "forbidden") {
    return context.rewrite("/403");
  }

  return next();
});
