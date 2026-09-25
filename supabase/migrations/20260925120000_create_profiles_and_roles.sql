-- Role model: every auth user has exactly one profile carrying an app role.
-- Postgres (RLS + column grants + guard trigger) is the single source of truth for access control.

-- 1. Role enum
create type public.app_role as enum ('manager', 'employee');

-- 2. Profiles table
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  role public.app_role not null default 'employee',
  created_at timestamptz not null default now()
);

comment on table public.profiles is 'One row per auth user; role drives access control.';

-- 3. Create a profile for every new auth user
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 4. Backfill profiles for users that existed before this migration
insert into public.profiles (id, email, role)
select u.id, coalesce(u.email, ''), 'employee'
from auth.users u
on conflict (id) do nothing;

-- 5. Manager check used by RLS policies.
-- SECURITY DEFINER bypasses RLS on profiles, avoiding infinite policy recursion.
create or replace function public.is_manager()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'manager'
  );
$$;

revoke execute on function public.is_manager() from public, anon;
grant execute on function public.is_manager() to authenticated;

-- 6. Row level security
alter table public.profiles enable row level security;

create policy profiles_select_own
  on public.profiles
  for select
  to authenticated
  using (id = (select auth.uid()));

create policy profiles_select_manager
  on public.profiles
  for select
  to authenticated
  using (public.is_manager());

create policy profiles_update_manager
  on public.profiles
  for update
  to authenticated
  using (public.is_manager())
  with check (public.is_manager());

-- No insert/delete policies: profiles are created by the signup trigger and removed by the FK cascade.
-- No anon policies.

-- 7. Column-level privileges: only the role column is updatable through the API.
revoke update on public.profiles from authenticated, anon;
grant update (role) on public.profiles to authenticated;

-- 8. Guard: never demote the last remaining manager.
create or replace function public.prevent_last_manager_demotion()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.role = 'manager' and new.role <> 'manager' then
    -- Lock all manager rows so concurrent demotions serialize before counting.
    perform 1
    from public.profiles p
    where p.role = 'manager'
    for update;

    if not exists (
      select 1
      from public.profiles p
      where p.role = 'manager'
        and p.id <> old.id
    ) then
      raise exception 'Cannot demote the last manager';
    end if;
  end if;

  return new;
end;
$$;

create trigger prevent_last_manager_demotion
  before update of role on public.profiles
  for each row execute function public.prevent_last_manager_demotion();
