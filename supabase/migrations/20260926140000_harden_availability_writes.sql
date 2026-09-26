-- A window may cross midnight into the next month. Every write policy now also requires the month
-- holding the window's last instant (ends_at - 1 microsecond) to be editable, so an overnight window
-- that starts in an open month cannot change a locked month's first day.
-- A window ending exactly at 00:00 on the 1st stays entirely in the earlier month.

alter policy availability_windows_insert_own
  on public.availability_windows
  with check (
    employee_id = (select auth.uid())
    and public.is_availability_month_editable(date_trunc('month', starts_at)::date)
    and public.is_availability_month_editable(date_trunc('month', ends_at - interval '1 microsecond')::date)
  );

-- using guards the old row's months, with check guards the new row's months.
alter policy availability_windows_update_own
  on public.availability_windows
  using (
    employee_id = (select auth.uid())
    and public.is_availability_month_editable(date_trunc('month', starts_at)::date)
    and public.is_availability_month_editable(date_trunc('month', ends_at - interval '1 microsecond')::date)
  )
  with check (
    employee_id = (select auth.uid())
    and public.is_availability_month_editable(date_trunc('month', starts_at)::date)
    and public.is_availability_month_editable(date_trunc('month', ends_at - interval '1 microsecond')::date)
  );

alter policy availability_windows_delete_own
  on public.availability_windows
  using (
    employee_id = (select auth.uid())
    and public.is_availability_month_editable(date_trunc('month', starts_at)::date)
    and public.is_availability_month_editable(date_trunc('month', ends_at - interval '1 microsecond')::date)
  );

-- Only the window times are insertable through the API; id, employee_id (auth.uid()) and created_at
-- always take their defaults, so a client cannot backdate created_at.
revoke insert on public.availability_windows from authenticated, anon;
grant insert (starts_at, ends_at) on public.availability_windows to authenticated;
