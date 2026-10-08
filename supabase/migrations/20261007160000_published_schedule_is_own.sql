-- S-05 review fix: get_published_schedule gave every signed-in user every colleague's profile id, which the app used
-- only to mark the viewer's own shifts. Return is_own instead, so the published read discloses names and times only.
-- The result type changes, so the function is dropped and recreated (create or replace cannot change it).

drop function public.get_published_schedule(date);

-- Rows only while the month is published, so a draft never reaches an employee; one statement, so the read never
-- straddles an unpublish. No id, email, role or availability of another person leaves the function: assignee_name is
-- the display name, else the calendarName rule of src/lib/manager-users.ts (keep the two in step): the email before '@'
-- when '@' is past the first character, else the whole email, else the id's first 8 characters. Null = uncovered.
-- is_own is true on the caller's own shifts, false on everyone else's and on uncovered ones.
create function public.get_published_schedule(target_month date)
returns table (
  id uuid,
  starts_at timestamp,
  ends_at timestamp,
  assignee_name text,
  is_own boolean,
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
    coalesce(sh.employee_id = auth.uid(), false) as is_own,
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
  'Shifts of target_month with assignee names (display name, else email prefix, else id prefix; null when uncovered) and is_own (the caller''s shift), only while the month is published. Readable by every signed-in user; returns no profile id, email, role or availability.';

revoke execute on function public.get_published_schedule(date) from public, anon;
grant execute on function public.get_published_schedule(date) to authenticated;
