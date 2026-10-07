-- S-05: every signed-in user reads a published month, with assignee names, and sets their own display name.
-- The schedule tables and profiles keep their manager-only / own-row select policies: the two SECURITY DEFINER
-- functions below are the only new access paths. No column grant covers display_name, and there is no self-update
-- policy on profiles (authenticated holds `update (role)`, so such a policy would let a user change their own role).

-- 1. Display name: chosen by the user, shown to colleagues on /schedule. Null = fall back to the email prefix.
alter table public.profiles
  add column display_name text null
  constraint profiles_display_name_shape
    check (display_name is null or (display_name = btrim(display_name) and char_length(display_name) between 1 and 40));

comment on column public.profiles.display_name is
  'Name colleagues see on the published schedule (1-40 characters, trimmed). Null shows the email prefix. Written only by public.set_display_name.';

-- 2. Own display name. SECURITY DEFINER so no column grant on display_name is needed; it writes only the caller's row.
create or replace function public.set_display_name(new_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalised text := nullif(btrim(new_name), '');
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  if char_length(normalised) > 40 then
    raise exception 'display name is longer than 40 characters' using errcode = '22001';
  end if;

  update public.profiles p
  set display_name = normalised
  where p.id = auth.uid();
end;
$$;

comment on function public.set_display_name(text) is
  'Sets the caller''s own display_name (trimmed; empty clears it). 42501 when not signed in, 22001 when longer than 40 characters.';

revoke execute on function public.set_display_name(text) from public, anon;
grant execute on function public.set_display_name(text) to authenticated;

-- 3. Published read. Rows only while the month is published, so a draft never reaches an employee; one statement, so
-- the read never straddles an unpublish. No email, role or availability leaves the function: assignee_name is the
-- display name, else the calendarName rule of src/lib/manager-users.ts (keep the two in step): the email before '@'
-- when '@' is past the first character, else the whole email, else the id's first 8 characters. Null = uncovered.
create or replace function public.get_published_schedule(target_month date)
returns table (
  id uuid,
  starts_at timestamp,
  ends_at timestamp,
  employee_id uuid,
  assignee_name text,
  published_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    sh.id,
    sh.starts_at,
    sh.ends_at,
    sh.employee_id,
    case
      when sh.employee_id is null then null
      else coalesce(
        p.display_name,
        case
          when position('@' in p.email) > 1 then left(p.email, position('@' in p.email) - 1)
          else nullif(p.email, '')
        end,
        left(sh.employee_id::text, 8)
      )
    end as assignee_name,
    s.published_at
  from public.schedule_shifts sh
  join public.schedules s
    on s.month = sh.month
   and s.published_at is not null
  left join public.profiles p
    on p.id = sh.employee_id
  where sh.month = target_month
  order by sh.starts_at, sh.id;
$$;

comment on function public.get_published_schedule(date) is
  'Shifts of target_month with assignee names (display name, else email prefix, else id prefix; null when uncovered), only while the month is published. Readable by every signed-in user; returns no email, role or availability.';

revoke execute on function public.get_published_schedule(date) from public, anon;
grant execute on function public.get_published_schedule(date) to authenticated;
