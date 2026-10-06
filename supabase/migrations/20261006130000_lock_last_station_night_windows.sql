-- The station runs 24/7 and station day D is [D 06:00, D+1 06:00), so a month's last station night ends at 06:00 on
-- day 1 of the next month. The schedule generator for month M therefore also reads windows that start on day 1 of
-- M+1 before 06:00. Every write policy now also requires the month of that window's station day
-- (starts_at - 6 hours) to be editable, so locking M (generating its draft) freezes those windows too.
-- A window starting at or after 06:00 on day 1 is unaffected: its station day is in its own month.

alter policy availability_windows_insert_own
  on public.availability_windows
  with check (
    employee_id = (select auth.uid())
    and public.is_availability_month_editable(date_trunc('month', starts_at)::date)
    and public.is_availability_month_editable(date_trunc('month', ends_at - interval '1 microsecond')::date)
    and public.is_availability_month_editable(date_trunc('month', starts_at - interval '6 hours')::date)
  );

-- using guards the old row's months, with check guards the new row's months.
alter policy availability_windows_update_own
  on public.availability_windows
  using (
    employee_id = (select auth.uid())
    and public.is_availability_month_editable(date_trunc('month', starts_at)::date)
    and public.is_availability_month_editable(date_trunc('month', ends_at - interval '1 microsecond')::date)
    and public.is_availability_month_editable(date_trunc('month', starts_at - interval '6 hours')::date)
  )
  with check (
    employee_id = (select auth.uid())
    and public.is_availability_month_editable(date_trunc('month', starts_at)::date)
    and public.is_availability_month_editable(date_trunc('month', ends_at - interval '1 microsecond')::date)
    and public.is_availability_month_editable(date_trunc('month', starts_at - interval '6 hours')::date)
  );

alter policy availability_windows_delete_own
  on public.availability_windows
  using (
    employee_id = (select auth.uid())
    and public.is_availability_month_editable(date_trunc('month', starts_at)::date)
    and public.is_availability_month_editable(date_trunc('month', ends_at - interval '1 microsecond')::date)
    and public.is_availability_month_editable(date_trunc('month', starts_at - interval '6 hours')::date)
  );
