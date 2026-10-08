-- S-08, database half: save_schedule_day stores a station day's assignee changes all or nothing. It refuses a
-- non-manager, a duplicate id, a month with no draft, a published month and a day that changed since the manager saw
-- it (another assignee, a missing shift or a shift of another day), and an unknown assignee fails the whole call on
-- the foreign key. Oracles: plan schedule-day-save (Phase 1 contract), roadmap S-08 default b (refuse the whole day).
-- Refused calls are checked as postgres afterwards, against a snapshot of every fixture shift.
begin;
select plan(20);

-- Station months, derived once; now() is fixed for the transaction.
select
  (s + interval '1 month')::date as m1,
  (s + interval '2 months')::date as m2
from (select date_trunc('month', now() at time zone 'Europe/Warsaw') as s) station
\gset

-- Fixtures: employees A and B, manager Mg. The signup trigger creates their employee profiles.
insert into auth.users (id, email) values
  ('10000000-0000-4000-8000-0000000000a6', 'da@db-rules.test'),
  ('10000000-0000-4000-8000-0000000000b6', 'db@db-rules.test'),
  ('10000000-0000-4000-8000-0000000000c6', 'dmg@db-rules.test');
update public.profiles set role = 'manager' where id = '10000000-0000-4000-8000-0000000000c6';

-- M+1 is locked with a draft, M+2 has neither, whatever the local or CI state. Station day 1 of M+1 is 8+8+8
-- (shifts ..11 A, ..12 Mg, ..13 Uncovered); station day 2 has one Uncovered 12h shift (..14).
delete from public.schedules where month in (:'m1', :'m2');
delete from public.availability_locks where month = :'m2';
insert into public.availability_locks (month) values (:'m1') on conflict do nothing;
insert into public.schedules (month) values (:'m1');
insert into public.schedule_shifts (id, month, starts_at, ends_at, employee_id) values
  ('20000000-0000-4000-8000-000000000011', :'m1', :'m1'::date + interval '06:00', :'m1'::date + interval '14:00',
    '10000000-0000-4000-8000-0000000000a6'),
  ('20000000-0000-4000-8000-000000000012', :'m1', :'m1'::date + interval '14:00', :'m1'::date + interval '22:00',
    '10000000-0000-4000-8000-0000000000c6'),
  ('20000000-0000-4000-8000-000000000013', :'m1', :'m1'::date + interval '22:00',
    :'m1'::date + interval '1 day 06:00', null),
  ('20000000-0000-4000-8000-000000000014', :'m1', :'m1'::date + interval '1 day 06:00',
    :'m1'::date + interval '1 day 18:00', null);

-- Mg saves two changes of day 1 in one call: ..11 A -> B, ..13 Uncovered -> A, ..12 left as Mg.
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-0000000000c6","role":"authenticated"}';
select is(
  (select public.save_schedule_day(:'m1'::date, :'m1'::date, '[
    {"id":"20000000-0000-4000-8000-000000000011","was":"10000000-0000-4000-8000-0000000000a6","employee_id":"10000000-0000-4000-8000-0000000000b6"},
    {"id":"20000000-0000-4000-8000-000000000012","was":"10000000-0000-4000-8000-0000000000c6","employee_id":"10000000-0000-4000-8000-0000000000c6"},
    {"id":"20000000-0000-4000-8000-000000000013","was":null,"employee_id":"10000000-0000-4000-8000-0000000000a6"}
  ]'::jsonb)),
  2,
  'Mg saves two changes of station day 1 in one call and gets 2 updated shifts'
);
reset role;
select is(
  (select string_agg(right(id::text, 2) || '=' || coalesce(right(employee_id::text, 2), '-'), ',' order by id)
   from public.schedule_shifts where id::text like '20000000-0000-4000-8000-0000000000%'),
  '11=b6,12=c6,13=a6,14=-',
  'both changes of day 1 are stored and day 2 is untouched'
);

-- Mg saves the day exactly as stored: nothing changes.
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-0000000000c6","role":"authenticated"}';
select is(
  (select public.save_schedule_day(:'m1'::date, :'m1'::date, '[
    {"id":"20000000-0000-4000-8000-000000000011","was":"10000000-0000-4000-8000-0000000000b6","employee_id":"10000000-0000-4000-8000-0000000000b6"},
    {"id":"20000000-0000-4000-8000-000000000012","was":"10000000-0000-4000-8000-0000000000c6","employee_id":"10000000-0000-4000-8000-0000000000c6"},
    {"id":"20000000-0000-4000-8000-000000000013","was":"10000000-0000-4000-8000-0000000000a6","employee_id":"10000000-0000-4000-8000-0000000000a6"}
  ]'::jsonb)),
  0,
  'Mg saving day 1 with every row as stored updates 0 shifts'
);
reset role;
select is(
  (select string_agg(right(id::text, 2) || '=' || coalesce(right(employee_id::text, 2), '-'), ',' order by id)
   from public.schedule_shifts where id::text like '20000000-0000-4000-8000-0000000000%'),
  '11=b6,12=c6,13=a6,14=-',
  'the no-change save left every shift as it was'
);

-- Stale: ..11 was A when Mg opened the day, but B is stored now. The valid change of ..13 must not land either.
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-0000000000c6","role":"authenticated"}';
select throws_ok(
  format($$ select public.save_schedule_day(%L::date, %L::date, '[
    {"id":"20000000-0000-4000-8000-000000000011","was":"10000000-0000-4000-8000-0000000000a6","employee_id":"10000000-0000-4000-8000-0000000000c6"},
    {"id":"20000000-0000-4000-8000-000000000012","was":"10000000-0000-4000-8000-0000000000c6","employee_id":"10000000-0000-4000-8000-0000000000c6"},
    {"id":"20000000-0000-4000-8000-000000000013","was":"10000000-0000-4000-8000-0000000000a6","employee_id":null}
  ]'::jsonb) $$, :'m1', :'m1'),
  'SP004', 'schedule day changed',
  'Mg saving two changes with one stale was gets SP004'
);
reset role;
select is(
  (select string_agg(right(id::text, 2) || '=' || coalesce(right(employee_id::text, 2), '-'), ',' order by id)
   from public.schedule_shifts where id::text like '20000000-0000-4000-8000-0000000000%'),
  '11=b6,12=c6,13=a6,14=-',
  'neither change of the stale save was stored'
);

-- The posted shift set differs from the stored day: one shift missing, or a shift of another day added.
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-0000000000c6","role":"authenticated"}';
select throws_ok(
  format($$ select public.save_schedule_day(%L::date, %L::date, '[
    {"id":"20000000-0000-4000-8000-000000000011","was":"10000000-0000-4000-8000-0000000000b6","employee_id":"10000000-0000-4000-8000-0000000000c6"},
    {"id":"20000000-0000-4000-8000-000000000012","was":"10000000-0000-4000-8000-0000000000c6","employee_id":"10000000-0000-4000-8000-0000000000c6"}
  ]'::jsonb) $$, :'m1', :'m1'),
  'SP004', 'schedule day changed',
  'Mg saving day 1 without one of its shifts gets SP004'
);
select throws_ok(
  format($$ select public.save_schedule_day(%L::date, %L::date, '[
    {"id":"20000000-0000-4000-8000-000000000011","was":"10000000-0000-4000-8000-0000000000b6","employee_id":"10000000-0000-4000-8000-0000000000c6"},
    {"id":"20000000-0000-4000-8000-000000000012","was":"10000000-0000-4000-8000-0000000000c6","employee_id":"10000000-0000-4000-8000-0000000000c6"},
    {"id":"20000000-0000-4000-8000-000000000013","was":"10000000-0000-4000-8000-0000000000a6","employee_id":"10000000-0000-4000-8000-0000000000a6"},
    {"id":"20000000-0000-4000-8000-000000000014","was":null,"employee_id":"10000000-0000-4000-8000-0000000000b6"}
  ]'::jsonb) $$, :'m1', :'m1'),
  'SP004', 'schedule day changed',
  'Mg saving day 1 with a shift of day 2 added gets SP004'
);

-- An unknown assignee among valid changes fails the whole call on the foreign key.
select throws_ok(
  format($$ select public.save_schedule_day(%L::date, %L::date, '[
    {"id":"20000000-0000-4000-8000-000000000011","was":"10000000-0000-4000-8000-0000000000b6","employee_id":"10000000-0000-4000-8000-0000000000c6"},
    {"id":"20000000-0000-4000-8000-000000000012","was":"10000000-0000-4000-8000-0000000000c6","employee_id":"10000000-0000-4000-8000-0000000000c6"},
    {"id":"20000000-0000-4000-8000-000000000013","was":"10000000-0000-4000-8000-0000000000a6","employee_id":"10000000-0000-4000-8000-0000000000e9"}
  ]'::jsonb) $$, :'m1', :'m1'),
  '23503', null,
  'Mg saving day 1 with an unknown assignee among valid changes gets 23503'
);

-- A duplicate id is refused before anything is read.
select throws_ok(
  format($$ select public.save_schedule_day(%L::date, %L::date, '[
    {"id":"20000000-0000-4000-8000-000000000011","was":"10000000-0000-4000-8000-0000000000b6","employee_id":"10000000-0000-4000-8000-0000000000c6"},
    {"id":"20000000-0000-4000-8000-000000000011","was":"10000000-0000-4000-8000-0000000000b6","employee_id":"10000000-0000-4000-8000-0000000000a6"},
    {"id":"20000000-0000-4000-8000-000000000012","was":"10000000-0000-4000-8000-0000000000c6","employee_id":"10000000-0000-4000-8000-0000000000c6"},
    {"id":"20000000-0000-4000-8000-000000000013","was":"10000000-0000-4000-8000-0000000000a6","employee_id":"10000000-0000-4000-8000-0000000000a6"}
  ]'::jsonb) $$, :'m1', :'m1'),
  '22023', 'duplicate shift id in rows',
  'Mg saving day 1 with a duplicate shift id gets 22023'
);
reset role;
select is(
  (select string_agg(right(id::text, 2) || '=' || coalesce(right(employee_id::text, 2), '-'), ',' order by id)
   from public.schedule_shifts where id::text like '20000000-0000-4000-8000-0000000000%'),
  '11=b6,12=c6,13=a6,14=-',
  'no refused call (shift set, unknown assignee, duplicate id) changed a shift'
);

-- Employee A cannot save a day, not even with a valid change set.
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-0000000000a6","role":"authenticated"}';
select throws_ok(
  format($$ select public.save_schedule_day(%L::date, %L::date, '[
    {"id":"20000000-0000-4000-8000-000000000011","was":"10000000-0000-4000-8000-0000000000b6","employee_id":"10000000-0000-4000-8000-0000000000a6"},
    {"id":"20000000-0000-4000-8000-000000000012","was":"10000000-0000-4000-8000-0000000000c6","employee_id":"10000000-0000-4000-8000-0000000000c6"},
    {"id":"20000000-0000-4000-8000-000000000013","was":"10000000-0000-4000-8000-0000000000a6","employee_id":"10000000-0000-4000-8000-0000000000a6"}
  ]'::jsonb) $$, :'m1', :'m1'),
  '42501', 'only managers can save a schedule day',
  'A (employee) saving day 1 gets 42501'
);
reset role;
select is(
  (select string_agg(right(id::text, 2) || '=' || coalesce(right(employee_id::text, 2), '-'), ',' order by id)
   from public.schedule_shifts where id::text like '20000000-0000-4000-8000-0000000000%'),
  '11=b6,12=c6,13=a6,14=-',
  'A''s refused save changed no shift'
);

-- A month with no draft.
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-0000000000c6","role":"authenticated"}';
select throws_ok(
  format($$ select public.save_schedule_day(%L::date, %L::date, '[]'::jsonb) $$, :'m2', :'m2'),
  'SP002', 'no draft schedule for this month',
  'Mg saving a day of M+2, which has no draft, gets SP002'
);

-- Published (set as the owner): refused up front, although RLS alone would only filter the update to 0 rows.
reset role;
update public.schedules set published_at = '2000-01-01 00:00:00+00' where month = :'m1';
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-0000000000c6","role":"authenticated"}';
select throws_ok(
  format($$ select public.save_schedule_day(%L::date, %L::date, '[
    {"id":"20000000-0000-4000-8000-000000000011","was":"10000000-0000-4000-8000-0000000000b6","employee_id":"10000000-0000-4000-8000-0000000000a6"},
    {"id":"20000000-0000-4000-8000-000000000012","was":"10000000-0000-4000-8000-0000000000c6","employee_id":"10000000-0000-4000-8000-0000000000c6"},
    {"id":"20000000-0000-4000-8000-000000000013","was":"10000000-0000-4000-8000-0000000000a6","employee_id":"10000000-0000-4000-8000-0000000000a6"}
  ]'::jsonb) $$, :'m1', :'m1'),
  'SP001', 'schedule is published',
  'Mg saving a day of the published M+1 gets SP001'
);
reset role;
select is(
  (select string_agg(right(id::text, 2) || '=' || coalesce(right(employee_id::text, 2), '-'), ',' order by id)
   from public.schedule_shifts where id::text like '20000000-0000-4000-8000-0000000000%'),
  '11=b6,12=c6,13=a6,14=-',
  'the refused save of the published month changed no shift'
);

-- Unpublished again (as the owner): the same call succeeds.
update public.schedules set published_at = null where month = :'m1';
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-0000000000c6","role":"authenticated"}';
select is(
  (select public.save_schedule_day(:'m1'::date, :'m1'::date, '[
    {"id":"20000000-0000-4000-8000-000000000011","was":"10000000-0000-4000-8000-0000000000b6","employee_id":"10000000-0000-4000-8000-0000000000a6"},
    {"id":"20000000-0000-4000-8000-000000000012","was":"10000000-0000-4000-8000-0000000000c6","employee_id":"10000000-0000-4000-8000-0000000000c6"},
    {"id":"20000000-0000-4000-8000-000000000013","was":"10000000-0000-4000-8000-0000000000a6","employee_id":"10000000-0000-4000-8000-0000000000a6"}
  ]'::jsonb)),
  1,
  'after unpublishing, Mg''s same save updates 1 shift'
);
reset role;
select is(
  (select string_agg(right(id::text, 2) || '=' || coalesce(right(employee_id::text, 2), '-'), ',' order by id)
   from public.schedule_shifts where id::text like '20000000-0000-4000-8000-0000000000%'),
  '11=a6,12=c6,13=a6,14=-',
  'the save after unpublishing is stored'
);

-- anon cannot execute the function.
select is(has_function_privilege('anon', 'public.save_schedule_day(date, date, jsonb)', 'execute'), false,
  'anon has no execute privilege on save_schedule_day');
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select throws_ok(
  format($$ select public.save_schedule_day(%L::date, %L::date, '[]'::jsonb) $$, :'m1', :'m1'),
  '42501', null,
  'anon calling save_schedule_day gets 42501'
);
reset role;

select * from finish();
rollback;
