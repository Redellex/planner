import type { Database } from "@/db/database.types";

export type AppRole = Database["public"]["Enums"]["app_role"];

export const APP_ROLES: readonly AppRole[] = ["manager", "employee"];

export function isAppRole(value: unknown): value is AppRole {
  return typeof value === "string" && (APP_ROLES as readonly string[]).includes(value);
}

const ROLE_LABELS: Record<AppRole, string> = {
  manager: "Manager",
  employee: "Employee",
};

/** The role as people read it, e.g. on the dashboard's role pill. */
export function roleLabel(role: AppRole): string {
  return ROLE_LABELS[role];
}
