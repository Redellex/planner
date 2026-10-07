-- Publish and override (S-04): a manager changes a draft shift's assignee and publishes the month. A published month
-- is frozen in Postgres: RLS keeps every shift write and the discard out of it, replace_schedule_draft refuses it, and
-- its schedules row keeps the month locked (on delete restrict). Unpublishing returns it to a draft. Freezing uses RLS,
-- not triggers, so superuser cleanup and foreign-key actions (on delete cascade / set null) keep working.

-- 1. Published state: null means draft. Written only by publish_schedule / unpublish_schedule (SECURITY DEFINER), so
-- schedules keeps no UPDATE grant and no update policy.
alter table public.schedules
  add column published_at timestamptz,
  add column published_by uuid references public.profiles (id) on delete set null;

comment on column public.schedules.published_at is
  'When the month was published; null means draft. Set by publish_schedule, cleared by unpublish_schedule.';
comment on column public.schedules.published_by is
  'The manager who published the month (auth.uid() at publish time); null for a draft or a deleted account.';

-- 2. Discarding a published month matches no rows.
drop policy schedules_delete_manager on public.schedules;

create policy schedules_delete_manager
  on public.schedules
  for delete
  to authenticated
  using (public.is_manager() and published_at is null);

-- 3. Shift writes only while the month is a draft. Managers can read schedules, so its RLS does not hide the row
-- from the subquery.
drop policy schedule_shifts_insert_manager on public.schedule_shifts;

create policy schedule_shifts_insert_manager
  on public.schedule_shifts
  for insert
  to authenticated
  with check (
    public.is_manager()
    and exists (
      select 1
      from public.schedules s
      where s.month = schedule_shifts.month
        and s.published_at is null
    )
  );

drop policy schedule_shifts_delete_manager on public.schedule_shifts;

create policy schedule_shifts_delete_manager
  on public.schedule_shifts
  for delete
  to authenticated
  using (
    public.is_manager()
    and exists (
      select 1
      from public.schedules s
      where s.month = schedule_shifts.month
        and s.published_at is null
    )
  );

-- Override: a manager changes a draft shift's assignee (employee_id only, see the grant below).
create policy schedule_shifts_update_manager
  on public.schedule_shifts
  for update
  to authenticated
  using (
    public.is_manager()
    and exists (
      select 1
      from public.schedules s
      where s.month = schedule_shifts.month
        and s.published_at is null
    )
  )
  with check (
    public.is_manager()
    and exists (
      select 1
      from public.schedules s
      where s.month = schedule_shifts.month
        and s.published_at is null
    )
  );

-- 4. Column-level privileges: only the assignee is updatable; the table-level UPDATE stays revoked
-- (20261006140000_revoke_schedule_updates.sql), so the shape, times and month of a shift never change.
grant update (employee_id) on public.schedule_shifts to authenticated;

-- 5. Replace refuses a published month before touching anything (SP001). The rest is unchanged.
create or replace function public.replace_schedule_draft(target_month date, shifts jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.schedules s
    where s.month = target_month
      and s.published_at is not null
  ) then
    raise exception 'schedule is published' using errcode = 'SP001';
  end if;

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
  'Replaces the draft of target_month with the given shifts ([{starts_at, ends_at, employee_id}]) in one transaction. Raises SP001 when the month is published.';

-- 6. Publish. SECURITY DEFINER so no UPDATE grant on schedules is needed; it checks the manager role itself.
-- Coverage matches the app's daysWithNoOne: station date D is covered when an assigned shift starts in
-- [D 06:00, D+1 06:00), i.e. (starts_at - 6h)::date = D. schedule_shifts_month_matches_station_day keeps every shift
-- inside the month's station days, so counting the distinct dates is enough (the 00:00-06:00 shift on day 1 of M+1
-- counts for M's last day).
create or replace function public.publish_schedule(target_month date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  draft public.schedules%rowtype;
  covered_days integer;
begin
  if not public.is_manager() then
    raise exception 'only managers can publish a schedule' using errcode = '42501';
  end if;

  select *
  into draft
  from public.schedules s
  where s.month = target_month
  for update;

  if not found then
    raise exception 'no draft schedule for this month' using errcode = 'SP002';
  end if;

  if draft.published_at is not null then
    return;
  end if;

  select count(distinct (sh.starts_at - interval '6 hours')::date)
  into covered_days
  from public.schedule_shifts sh
  where sh.month = target_month
    and sh.employee_id is not null;

  if covered_days < (target_month + interval '1 month')::date - target_month then
    raise exception 'schedule has a day with no one assigned' using errcode = 'SP003';
  end if;

  update public.schedules s
  set published_at = now(),
      published_by = auth.uid()
  where s.month = target_month
    and s.published_at is null;
end;
$$;

comment on function public.publish_schedule(date) is
  'Publishes the draft of target_month (sets published_at, published_by). 42501 for a non-manager, SP002 without a draft, SP003 while a station day has no one assigned; a no-op when already published.';

revoke execute on function public.publish_schedule(date) from public, anon;
grant execute on function public.publish_schedule(date) to authenticated;

-- 7. Unpublish: the month becomes a draft again (a no-op for a draft).
create or replace function public.unpublish_schedule(target_month date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_manager() then
    raise exception 'only managers can unpublish a schedule' using errcode = '42501';
  end if;

  update public.schedules s
  set published_at = null,
      published_by = null
  where s.month = target_month;

  if not found then
    raise exception 'no draft schedule for this month' using errcode = 'SP002';
  end if;
end;
$$;

comment on function public.unpublish_schedule(date) is
  'Returns the published month target_month to a draft (clears published_at, published_by). 42501 for a non-manager, SP002 without a draft; a no-op for a draft.';

revoke execute on function public.unpublish_schedule(date) from public, anon;
grant execute on function public.unpublish_schedule(date) to authenticated;
