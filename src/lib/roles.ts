import type { Database } from "@/db/database.types";

export type AppRole = Database["public"]["Enums"]["app_role"];

export const APP_ROLES: readonly AppRole[] = ["manager", "employee"];

export function isAppRole(value: unknown): value is AppRole {
  return typeof value === "string" && (APP_ROLES as readonly string[]).includes(value);
}
