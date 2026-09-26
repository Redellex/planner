import { defineMiddleware } from "astro:middleware";
import { createClient } from "@/lib/supabase";
import { isAppRole } from "@/lib/roles";

const PROTECTED_ROUTES = ["/dashboard", "/availability", "/api/availability"];
const MANAGER_ROUTES = ["/manager", "/api/manager"];

function matchesRoute(pathname: string, routes: readonly string[]): boolean {
  return routes.some((route) => pathname === route || pathname.startsWith(`${route}/`));
}

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
      // Fail closed: any error or missing row leaves role as null.
      const { data, error } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
      if (!error && isAppRole(data?.role)) {
        context.locals.role = data.role;
      }
    }
  }

  if (matchesRoute(context.url.pathname, PROTECTED_ROUTES)) {
    if (!context.locals.user) {
      return context.redirect("/auth/signin");
    }
  }

  if (matchesRoute(context.url.pathname, MANAGER_ROUTES)) {
    if (!context.locals.user) {
      return context.redirect("/auth/signin");
    }
    if (context.locals.role !== "manager") {
      return context.rewrite("/403");
    }
  }

  return next();
});
