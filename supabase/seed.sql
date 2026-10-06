-- Local dev / CI seed only. NEVER run against production.
-- Creates known accounts:
--   manager@example.com  / Manager-Passw0rd!   (id 00000000-0000-4000-8000-000000000001, role manager)
--   employee@example.com / Employee-Passw0rd!  (id 00000000-0000-4000-8000-000000000002, role employee)
-- The smoke test depends on the manager id and credentials; keep both accounts stable. A demo team follows below.

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change)
values ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-000000000001',
  'authenticated', 'authenticated', 'manager@example.com',
  extensions.crypt('Manager-Passw0rd!', extensions.gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');

insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
values (gen_random_uuid(), '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', 'email',
  '{"sub":"00000000-0000-4000-8000-000000000001","email":"manager@example.com","email_verified":true}', now(), now(), now());

-- The signup trigger created an employee profile; promote it.
update public.profiles set role = 'manager' where id = '00000000-0000-4000-8000-000000000001';

-- Employee account. The signup trigger creates its profile with the default 'employee' role; no update needed.
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change)
values ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-000000000002',
  'authenticated', 'authenticated', 'employee@example.com',
  extensions.crypt('Employee-Passw0rd!', extensions.gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');

insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
values (gen_random_uuid(), '00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000002', 'email',
  '{"sub":"00000000-0000-4000-8000-000000000002","email":"employee@example.com","email_verified":true}', now(), now(), now());

-- Demo team for manual checks and future e2e tests: the "5-person team with 3 part-timers and 2 days nobody is
-- available" case from src/lib/schedule-generator.test.ts, with the same A–E ids. scripts/seed-demo-team.mjs writes the
-- same team to a hosted project or another month; keep the two in step. All five sign in with Demo-Passw0rd!.
-- Month: the station month + 1 when the seed runs (first day: date_trunc('month', now() at time zone 'Europe/Warsaw')
-- + 1 month, the editability helper's "now"). Generating it on /manager/schedule lists only days 10 and 20 with no
-- one assigned. A month later it is the current month and no longer generatable: run `npx supabase db reset` (or
-- `npm run seed:demo`) for fresh data.
with team (id, email) as (
  values
    ('00000000-0000-4000-8000-00000000000a'::uuid, 'demo-full-a@example.com'),
    ('00000000-0000-4000-8000-00000000000b'::uuid, 'demo-full-b@example.com'),
    ('00000000-0000-4000-8000-00000000000c'::uuid, 'demo-part-c@example.com'),
    ('00000000-0000-4000-8000-00000000000d'::uuid, 'demo-part-d@example.com'),
    ('00000000-0000-4000-8000-00000000000e'::uuid, 'demo-part-e@example.com')
)
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change)
select '00000000-0000-0000-0000-000000000000', id, 'authenticated', 'authenticated', email,
  extensions.crypt('Demo-Passw0rd!', extensions.gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', ''
from team;

insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
select gen_random_uuid(), u.id, u.id::text, 'email',
  jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true), now(), now(), now()
from auth.users u
where u.email like 'demo-%@example.com';

-- Full-timers A and B: every station day (D 06:00 → D+1 06:00) except days 10 and 20. Part-timers C, D, E: 12:00–18:00
-- in turn (C on day % 3 = 1, D on 2, E on 0), never on days 10 and 20.
with month_days as (
  select day::date as d, extract(day from day)::int as n
  from (select (date_trunc('month', now() at time zone 'Europe/Warsaw') + interval '1 month')::date as first_day) m,
    generate_series(m.first_day, m.first_day + interval '1 month' - interval '1 day', interval '1 day') as day
)
insert into public.availability_windows (employee_id, starts_at, ends_at)
select full_timer, d + time '06:00', (d + 1) + time '06:00'
from month_days
cross join (values ('00000000-0000-4000-8000-00000000000a'::uuid), ('00000000-0000-4000-8000-00000000000b'::uuid))
  as full_timers (full_timer)
where n not in (10, 20)
union all
select case n % 3
    when 1 then '00000000-0000-4000-8000-00000000000c'::uuid
    when 2 then '00000000-0000-4000-8000-00000000000d'::uuid
    else '00000000-0000-4000-8000-00000000000e'::uuid
  end,
  d + time '12:00', d + time '18:00'
from month_days
where n not in (10, 20);
