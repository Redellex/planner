import type { Tables } from "@/db/database.types";

/** The window columns `/availability` reads and its components render. */
export type WindowRow = Pick<Tables<"availability_windows">, "id" | "starts_at" | "ends_at">;

/** The window columns `/manager/availability` reads; managers see every account's windows. */
export type TeamWindowRow = Pick<Tables<"availability_windows">, "id" | "employee_id" | "starts_at" | "ends_at">;

/** The profile columns `/manager/availability` reads; email is the only label a profile has. */
export type TeamMember = Pick<Tables<"profiles">, "id" | "email" | "role">;

/** One account's window on a /manager/availability day; `carryOver` marks a previous-month window shown on day 1. */
export interface DayEntry {
  member: TeamMember;
  window: TeamWindowRow;
  carryOver: boolean;
}
