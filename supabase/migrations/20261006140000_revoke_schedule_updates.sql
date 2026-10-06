-- Supabase's default privileges give anon and authenticated table-level UPDATE on new public tables. Drafts are
-- replaced as a whole (replace_schedule_draft) and neither table has an update policy, so RLS refuses every update
-- today; revoke the privilege too, like the earlier migrations, so a future update policy (S-04 overrides) exposes
-- only the columns it grants explicitly (e.g. `grant update (employee_id) on public.schedule_shifts`).
revoke update on public.schedules from authenticated, anon;
revoke update on public.schedule_shifts from authenticated, anon;
