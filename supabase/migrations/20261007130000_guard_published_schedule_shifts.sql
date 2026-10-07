-- Closes the READ COMMITTED gap in the published-month freeze (impl review F1). The RLS check
-- `exists (... schedules ... published_at is null)` reads the statement's snapshot and locks nothing, so an override or
-- a direct shift insert/delete racing publish_schedule could commit into a month that was just published, or change it
-- under publish's coverage count. This trigger locks the month's schedules row FOR SHARE before every direct shift
-- write: a publish in progress holds FOR UPDATE, so the write waits, re-reads the committed row and raises SP001 when
-- the month is now published; a publish that starts later waits for the share lock, and its coverage count then sees
-- the write. RLS still decides who may write; the trigger only serializes against publish.
-- Foreign-key actions run as nested triggers (pg_trigger_depth() > 1) and are skipped, so discarding a schedule
-- (on delete cascade), deleting an account (on delete set null) and superuser cleanups through public.schedules keep
-- working. SECURITY DEFINER because FOR SHARE needs a privilege authenticated does not have on schedules.
create or replace function public.guard_published_schedule_shift()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_month date;
  published timestamptz;
begin
  if pg_trigger_depth() > 1 then
    return coalesce(new, old);
  end if;

  foreach target_month in array (
    case tg_op
      when 'INSERT' then array[new.month]
      when 'DELETE' then array[old.month]
      else array[old.month, new.month]
    end
  ) loop
    -- Lock whether or not it is published: the race is exactly the row that is still a draft in this snapshot.
    select s.published_at
    into published
    from public.schedules s
    where s.month = target_month
    for share;

    if published is not null then
      raise exception 'schedule is published' using errcode = 'SP001';
    end if;
  end loop;

  return coalesce(new, old);
end;
$$;

comment on function public.guard_published_schedule_shift() is
  'Trigger on schedule_shifts: locks the month''s schedules row FOR SHARE (serializing with publish_schedule''s FOR UPDATE) and raises SP001 when the month is published. Skipped for foreign-key actions (pg_trigger_depth() > 1).';

revoke execute on function public.guard_published_schedule_shift() from public, anon, authenticated;

create trigger schedule_shifts_published_guard
  before insert or update or delete on public.schedule_shifts
  for each row execute function public.guard_published_schedule_shift();
