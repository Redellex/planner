-- Availability: employees declare dated windows when they can work; managers lock a month to start scheduling.
-- Postgres (RLS + constraints + column grants) is the single source of truth for who may write which window.

-- 1. Extension for the per-employee no-overlap exclusion constraint (uuid equality inside a GiST index).
create extension if not exists btree_gist with schema extensions;

-- 2. Month locks: a row means the month is locked and its windows are read-only.
create table public.availability_locks (
  month date primary key,
  locked_at timestamptz not null default now(),
  constraint availability_locks_month_is_first_day check (month = date_trunc('month', month)::date)
);

comment on table public.availability_locks is 'One row per locked month (first day of the month); a locked month rejects availability writes.';

-- 3. Availability windows
create table public.availability_windows (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  starts_at timestamp not null,
  ends_at timestamp not null,
  created_at timestamptz not null default now(),
  constraint availability_windows_valid_range
    check (ends_at > starts_at and ends_at - starts_at <= interval '24 hours'),
  -- Ranges are half-open [), so back-to-back windows (..-07:00, 07:00-..) are allowed.
  constraint availability_windows_no_overlap
    exclude using gist (employee_id with =, tsrange(starts_at, ends_at) with &&)
);

comment on table public.availability_windows is
  'One row per availability window. starts_at/ends_at are Europe/Warsaw wall-clock times (timestamp without time zone); a window belongs to the month of its starts_at.';

-- 4. Month editability check used by RLS policies.
-- A month is editable when it is after the current station month and has no lock row.
-- The 'Europe/Warsaw' literal must match STATION_TIME_ZONE in src/lib/availability.ts.
create or replace function public.is_availability_month_editable(target_month date)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select target_month > date_trunc('month', now() at time zone 'Europe/Warsaw')::date
    and not exists (
      select 1
      from public.availability_locks l
      where l.month = target_month
    );
$$;

revoke execute on function public.is_availability_month_editable(date) from public, anon;
grant execute on function public.is_availability_month_editable(date) to authenticated;

-- 5. Row level security: availability_locks
alter table public.availability_locks enable row level security;

create policy availability_locks_select_all
  on public.availability_locks
  for select
  to authenticated
  using (true);

create policy availability_locks_insert_manager
  on public.availability_locks
  for insert
  to authenticated
  with check (public.is_manager());

create policy availability_locks_delete_manager
  on public.availability_locks
  for delete
  to authenticated
  using (public.is_manager());

-- No update policy: unlock is a delete, relock is an insert.
-- No anon policies.

-- 6. Row level security: availability_windows
alter table public.availability_windows enable row level security;

create policy availability_windows_select_own
  on public.availability_windows
  for select
  to authenticated
  using (employee_id = (select auth.uid()));

create policy availability_windows_select_manager
  on public.availability_windows
  for select
  to authenticated
  using (public.is_manager());

create policy availability_windows_insert_own
  on public.availability_windows
  for insert
  to authenticated
  with check (
    employee_id = (select auth.uid())
    and public.is_availability_month_editable(date_trunc('month', starts_at)::date)
  );

-- using guards the old row's month, with check guards the new row's month,
-- so a time edit cannot move a window into a past or locked month.
create policy availability_windows_update_own
  on public.availability_windows
  for update
  to authenticated
  using (
    employee_id = (select auth.uid())
    and public.is_availability_month_editable(date_trunc('month', starts_at)::date)
  )
  with check (
    employee_id = (select auth.uid())
    and public.is_availability_month_editable(date_trunc('month', starts_at)::date)
  );

create policy availability_windows_delete_own
  on public.availability_windows
  for delete
  to authenticated
  using (
    employee_id = (select auth.uid())
    and public.is_availability_month_editable(date_trunc('month', starts_at)::date)
  );

-- No manager write policies: managers only read windows (and manage their own like any user).
-- No anon policies.

-- 7. Column-level privileges: only the window times are updatable through the API.
revoke update on public.availability_windows from authenticated, anon;
grant update (starts_at, ends_at) on public.availability_windows to authenticated;
