import type { Tables } from "@/db/database.types";

/** The window columns `/availability` reads and its components render. */
export type WindowRow = Pick<Tables<"availability_windows">, "id" | "starts_at" | "ends_at">;
