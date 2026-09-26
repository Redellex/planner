declare namespace App {
  interface Locals {
    user: import("@supabase/supabase-js").User | null;
    /** `null` when anonymous, Supabase is unconfigured, or no profile row exists. */
    role: import("@/lib/roles").AppRole | null;
  }
}
