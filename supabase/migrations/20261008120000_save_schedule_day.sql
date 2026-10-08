-- Day save (S-08): a manager stores every assignee change of one station day in one call, all or nothing. The manager
-- posts each shift of the day with the assignee they saw (was) and the one they picked (employee_id); if any stored
-- shift of the day differs from what they saw (another assignee, or another set of shifts after a regenerate), nothing
-- is written. SECURITY INVOKER, so the manager-only update policy, the employee_id column grant and the publish guard
-- trigger still apply to every row; the function adds only what PostgREST cannot express: one transaction, row locks,
-- the seen-value check and an updated-row count (RLS filters a refused UPDATE to 0 rows without an error).
create or replace function public.save_schedule_day(target_month date, station_day date, rows jsonb)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  draft_published_at timestamptz;
  requested_count integer;
  distinct_count integer;
  changed_count integer;
  updated_count integer;
begin
  if not public.is_manager() then
    raise exception 'only managers can save a schedule day' using errcode = '42501';
  end if;

  select count(*), count(distinct r.id)
  into requested_count, distinct_count
  from jsonb_to_recordset(rows) as r (id uuid, was uuid, employee_id uuid);

  if requested_count <> distinct_count then
    raise exception 'duplicate shift id in rows' using errcode = '22023';
  end if;

  select s.published_at
  into draft_published_at
  from public.schedules s
  where s.month = target_month;

  if not found then
    raise exception 'no draft schedule for this month' using errcode = 'SP002';
  end if;

  if draft_published_at is not null then
    raise exception 'schedule is published' using errcode = 'SP001';
  end if;

  -- Lock the day's stored shifts, so the comparison below and the update see the same values. The schedules row is
  -- locked FOR SHARE by the guard trigger on each update (serializing with publish_schedule).
  perform 1
  from public.schedule_shifts sh
  where sh.month = target_month
    and (sh.starts_at - interval '6 hours')::date = station_day
  for update;

  if exists (
    select 1
    from (
      select sh.id, sh.employee_id
      from public.schedule_shifts sh
      where sh.month = target_month
        and (sh.starts_at - interval '6 hours')::date = station_day
    ) stored
    full join jsonb_to_recordset(rows) as r (id uuid, was uuid, employee_id uuid)
      on r.id = stored.id
    where stored.id is null
      or r.id is null
      or stored.employee_id is distinct from r.was
  ) then
    raise exception 'schedule day changed' using errcode = 'SP004';
  end if;

  select count(*)
  into changed_count
  from jsonb_to_recordset(rows) as r (id uuid, was uuid, employee_id uuid)
  where r.employee_id is distinct from r.was;

  update public.schedule_shifts sh
  set employee_id = r.employee_id
  from jsonb_to_recordset(rows) as r (id uuid, was uuid, employee_id uuid)
  where sh.id = r.id
    and sh.month = target_month
    and r.employee_id is distinct from r.was;

  get diagnostics updated_count = row_count;

  if updated_count <> changed_count then
    raise exception 'schedule day changed' using errcode = 'SP004';
  end if;

  return updated_count;
end;
$$;

comment on function public.save_schedule_day(date, date, jsonb) is
  'Saves the assignees of station day station_day of the draft target_month in one transaction. rows = [{id, was, employee_id}], one per shift of the day; only rows with employee_id distinct from was are updated. Returns the number of shifts updated. 42501 for a non-manager, 22023 for a duplicate id, SP002 without a draft, SP001 when published, SP004 when the stored shifts of the day differ from rows (ids or was), 23503 for an unknown assignee.';

revoke execute on function public.save_schedule_day(date, date, jsonb) from public, anon;
grant execute on function public.save_schedule_day(date, date, jsonb) to authenticated;
