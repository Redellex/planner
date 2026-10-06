-- Schedules: a manager generates a draft schedule for a locked month; S-04 will override and publish it.
-- Postgres (RLS + constraints + column grants + foreign keys) holds the hard guarantees, so every later write path
-- (the generator's replace RPC now, S-04 overrides later) inherits them.

-- 1. Drafts: one row per month that has a draft. The month must be locked, and the lock cannot be deleted while the
-- draft exists (on delete restrict), so availability cannot change under a draft.
create table public.schedules (
  month date primary key references public.availability_locks (month) on delete restrict,
  generated_at timestamptz not null default now(),
  generated_by uuid default auth.uid() references public.profiles (id) on delete set null
);

comment on table public.schedules is
  'One row per month (first day of the month) with a draft schedule. Requires the month''s availability_locks row; unlocking is refused while the draft exists.';

-- 2. Draft shifts. The station runs 24/7 and station day D is [D 06:00, D+1 06:00) in Europe/Warsaw wall-clock time,
-- so a shift belongs to the month of its station day: month = date_trunc('month', starts_at - 6h). The 00:00-06:00
-- shift on the 1st belongs to the previous month, and the one after the month's last day belongs to this month.
create table public.schedule_shifts (
  id uuid primary key default gen_random_uuid(),
  month date not null references public.schedules (month) on delete cascade,
  starts_at timestamp not null,
  ends_at timestamp not null,
  -- A deleted account's shifts become uncovered (null), never vanish.
  employee_id uuid references public.profiles (id) on delete set null,
  -- The 9 allowed shapes (start time, wall-clock length; no DST correction, as for availability windows).
  constraint schedule_shifts_allowed_shape
    check ((starts_at::time, ends_at - starts_at) in (
      ('06:00'::time, interval '12 hours'),
      ('18:00'::time, interval '12 hours'),
      ('06:00'::time, interval '8 hours'),
      ('14:00'::time, interval '8 hours'),
      ('22:00'::time, interval '8 hours'),
      ('06:00'::time, interval '6 hours'),
      ('12:00'::time, interval '6 hours'),
      ('18:00'::time, interval '6 hours'),
      ('00:00'::time, interval '6 hours')
    )),
  constraint schedule_shifts_month_matches_station_day
    check (month = date_trunc('month', starts_at - interval '6 hours')::date),
  -- One person on duty at a time: no two shifts overlap station-wide, whoever holds them. Ranges are half-open [),
  -- so touching shifts (18:00-06:00, 06:00-12:00) are allowed.
  constraint schedule_shifts_no_overlap
    exclude using gist (tsrange(starts_at, ends_at) with &&)
);

comment on table public.schedule_shifts is
  'One row per shift of a draft. starts_at/ends_at are Europe/Warsaw wall-clock times (timestamp without time zone); station day D is [D 06:00, D+1 06:00) and a shift belongs to the month of its station day (starts_at - 6h). employee_id null means uncovered.';

-- 3. Row level security: schedules (manager only; employees cannot see drafts in S-03)
alter table public.schedules enable row level security;

create policy schedules_select_manager
  on public.schedules
  for select
  to authenticated
  using (public.is_manager());

create policy schedules_insert_manager
  on public.schedules
  for insert
  to authenticated
  with check (public.is_manager());

create policy schedules_delete_manager
  on public.schedules
  for delete
  to authenticated
  using (public.is_manager());

-- 4. Row level security: schedule_shifts (manager only)
alter table public.schedule_shifts enable row level security;

create policy schedule_shifts_select_manager
  on public.schedule_shifts
  for select
  to authenticated
  using (public.is_manager());

create policy schedule_shifts_insert_manager
  on public.schedule_shifts
  for insert
  to authenticated
  with check (public.is_manager());

create policy schedule_shifts_delete_manager
  on public.schedule_shifts
  for delete
  to authenticated
  using (public.is_manager());

-- No update policies: a draft is replaced as a whole (S-04 adds what overrides need).
-- No anon policies.

-- 5. Column-level privileges: generated_at, generated_by (auth.uid()) and id always take their defaults.
revoke insert on public.schedules from authenticated, anon;
grant insert (month) on public.schedules to authenticated;

revoke insert on public.schedule_shifts from authenticated, anon;
grant insert (month, starts_at, ends_at, employee_id) on public.schedule_shifts to authenticated;

-- 6. Atomic replace of a month's draft. SECURITY INVOKER, so the caller's RLS and grants apply: a non-manager's
-- delete matches nothing and their insert is refused. One call is one statement, so any failing row (shape, month,
-- overlap, missing lock) rolls the whole call back and the previous draft stays intact.
create or replace function public.replace_schedule_draft(target_month date, shifts jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  -- Cascades to the old draft's shifts.
  delete from public.schedules s
  where s.month = target_month;

  insert into public.schedules (month)
  values (target_month);

  insert into public.schedule_shifts (month, starts_at, ends_at, employee_id)
  select target_month, s.starts_at, s.ends_at, s.employee_id
  from jsonb_to_recordset(shifts) as s (starts_at timestamp, ends_at timestamp, employee_id uuid);
end;
$$;

comment on function public.replace_schedule_draft(date, jsonb) is
  'Replaces the draft of target_month with the given shifts ([{starts_at, ends_at, employee_id}]) in one transaction.';

revoke execute on function public.replace_schedule_draft(date, jsonb) from public, anon;
grant execute on function public.replace_schedule_draft(date, jsonb) to authenticated;
