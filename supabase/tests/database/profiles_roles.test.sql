-- Risk #4, database half: an employee cannot change any role (their own included), a manager changes only the role
-- column, and the last manager cannot be demoted by any path. Oracles: roadmap F-01 ("the last Manager can never be
-- demoted"), CLAUDE.md Auth flow (managers update only role; the trigger rejects demoting the last manager),
-- test-plan §2 row #4. The seed's manager shares the database, so the last-manager section first makes M1 the only
-- manager inside this transaction.
begin;
select plan(36);

-- Fixtures: employees E1, E2, E3 and manager M1. The signup trigger creates their employee profiles.
insert into auth.users (id, email) values
  ('10000000-0000-4000-8000-0000000000d1', 'e1@db-rules.test'),
  ('10000000-0000-4000-8000-0000000000d2', 'e2@db-rules.test'),
  ('10000000-0000-4000-8000-0000000000d3', 'e3@db-rules.test'),
  ('10000000-0000-4000-8000-0000000000c3', 'm1@db-rules.test');
update public.profiles set role = 'manager' where id = '10000000-0000-4000-8000-0000000000c3';

select row(email, role)::text as e2_profile
from public.profiles
where id = '10000000-0000-4000-8000-0000000000d2'
\gset

-- E1 cannot promote anyone
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-0000000000d1","role":"authenticated"}';
select is_empty(
  $$ update public.profiles set role = 'manager' where id = '10000000-0000-4000-8000-0000000000d1' returning id $$,
  'E1 promoting themselves matches no rows'
);
select is_empty(
  $$ update public.profiles set role = 'manager' where id = '10000000-0000-4000-8000-0000000000d2' returning id $$,
  'E1 promoting E2 matches no rows'
);
select results_eq(
  $$ select id::text from public.profiles where email like '%@db-rules.test' order by id $$,
  $$ values ('10000000-0000-4000-8000-0000000000d1') $$,
  'E1 reads only their own profile'
);
reset role;
select is(
  (select role::text from public.profiles where id = '10000000-0000-4000-8000-0000000000d1'),
  'employee',
  'E1 is still an employee'
);
select is(
  (select row(email, role)::text from public.profiles where id = '10000000-0000-4000-8000-0000000000d2'),
  :'e2_profile',
  'E2 is unchanged after E1''s update'
);

-- M1 reads every profile and changes only role
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-0000000000c3","role":"authenticated"}';
select is(
  (select count(*) from public.profiles where email like '%@db-rules.test'),
  4::bigint,
  'M1 reads every fixture profile'
);
select throws_ok(
  $$ update public.profiles set email = 'changed@db-rules.test' where id = '10000000-0000-4000-8000-0000000000d2' $$,
  '42501', null,
  'M1 cannot change E2''s email'
);
select isnt_empty(
  $$ update public.profiles set role = 'manager' where id = '10000000-0000-4000-8000-0000000000d3' returning id $$,
  'M1 can promote E3'
);
select is(
  (select role::text from public.profiles where id = '10000000-0000-4000-8000-0000000000d3'),
  'manager',
  'E3 is a manager after the promotion'
);
select isnt_empty(
  $$ update public.profiles set role = 'employee' where id = '10000000-0000-4000-8000-0000000000d3' returning id $$,
  'M1 can demote E3 while M1 remains a manager'
);
select is(
  (select role::text from public.profiles where id = '10000000-0000-4000-8000-0000000000d3'),
  'employee',
  'E3 is an employee after the demotion'
);
reset role;
select is(
  (select row(email, role)::text from public.profiles where id = '10000000-0000-4000-8000-0000000000d2'),
  :'e2_profile',
  'E2 is unchanged after M1''s email update'
);

-- anon gets nothing
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select is_empty(
  $$ select id from public.profiles where email like '%@db-rules.test' $$,
  'anon cannot read profiles'
);
select throws_ok(
  $$ update public.profiles set role = 'manager' where id = '10000000-0000-4000-8000-0000000000d1' $$,
  '42501', null,
  'anon cannot update a role'
);
reset role;

-- Profiles are created by the signup trigger and removed by the FK cascade only
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-0000000000d1","role":"authenticated"}';
select throws_ok(
  $$ insert into public.profiles (id, email) values ('10000000-0000-4000-8000-0000000000d9', 'e9@db-rules.test') $$,
  '42501', null,
  'E1 cannot insert a profile'
);
select is_empty(
  $$ delete from public.profiles where id = '10000000-0000-4000-8000-0000000000d1' returning id $$,
  'E1 deleting their own profile matches no rows'
);
reset role;
select is(
  (select count(*) from public.profiles where id = '10000000-0000-4000-8000-0000000000d1'),
  1::bigint,
  'E1''s profile remains after the refused delete'
);

-- S-05 display name: only set_display_name writes it, only on the caller's row, and it never touches a role. Oracle:
-- plan view-published-schedule ("Critical Implementation Details": no self-update policy, no column grant).
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-0000000000d1","role":"authenticated"}';
select lives_ok(
  $$ select public.set_display_name('  Ann  ') $$,
  'E1 can set their display name'
);
reset role;
select is(
  (select display_name from public.profiles where id = '10000000-0000-4000-8000-0000000000d1'),
  'Ann',
  'E1''s display name is stored trimmed'
);
select results_eq(
  $$ select id::text from public.profiles where email like '%@db-rules.test' and display_name is not null $$,
  $$ values ('10000000-0000-4000-8000-0000000000d1') $$,
  'only E1''s row has a display name after E1''s call'
);
select is(
  (select role::text from public.profiles where id = '10000000-0000-4000-8000-0000000000d1'),
  'employee',
  'E1 is still an employee after setting a display name'
);
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-0000000000d1","role":"authenticated"}';
select lives_ok(
  $$ select public.set_display_name('') $$,
  'E1 can clear their display name'
);
select throws_ok(
  format($$ select public.set_display_name(%L) $$, repeat('x', 41)),
  '22001', null,
  'E1 cannot set a 41-character display name'
);
select throws_ok(
  $$ update public.profiles set display_name = 'Direct' where id = '10000000-0000-4000-8000-0000000000d1' $$,
  '42501', null,
  'E1 cannot update their own display_name directly'
);
select results_eq(
  $$ select id::text from public.profiles where email like '%@db-rules.test' $$,
  $$ values ('10000000-0000-4000-8000-0000000000d1') $$,
  'control: E1 still reads their own profile'
);
reset role;
select is(
  (select display_name from public.profiles where id = '10000000-0000-4000-8000-0000000000d1'),
  null::text,
  'E1''s display name is null after clearing it and the refused writes'
);
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-0000000000c3","role":"authenticated"}';
select throws_ok(
  $$ update public.profiles set display_name = 'Renamed' where id = '10000000-0000-4000-8000-0000000000d2' $$,
  '42501', null,
  'M1 cannot update E2''s display_name directly'
);
select isnt_empty(
  $$ update public.profiles set role = 'employee' where id = '10000000-0000-4000-8000-0000000000d2' returning id $$,
  'control: M1 can still update E2''s role'
);
reset role;
select is(
  (select display_name from public.profiles where id = '10000000-0000-4000-8000-0000000000d2'),
  null::text,
  'E2''s display name is unchanged after M1''s update'
);
select is(has_column_privilege('authenticated', 'public.profiles', 'display_name', 'UPDATE'), false,
  'authenticated cannot update profiles.display_name');
select is(has_function_privilege('anon', 'public.set_display_name(text)', 'EXECUTE'), false,
  'anon cannot execute set_display_name');
select is(has_function_privilege('authenticated', 'public.set_display_name(text)', 'EXECUTE'), true,
  'authenticated can execute set_display_name');

-- Last manager: make M1 the only manager (seed included), then no path may demote them.
update public.profiles set role = 'employee'
where role = 'manager' and id <> '10000000-0000-4000-8000-0000000000c3';

set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-0000000000c3","role":"authenticated"}';
select throws_ok(
  $$ update public.profiles set role = 'employee' where id = '10000000-0000-4000-8000-0000000000c3' $$,
  'P0001', 'Cannot demote the last manager',
  'the last manager cannot demote themselves'
);
reset role;
select is(
  (select role::text from public.profiles where id = '10000000-0000-4000-8000-0000000000c3'),
  'manager',
  'M1 is still a manager after demoting themselves was refused'
);
select throws_ok(
  $$ update public.profiles set role = 'employee' where id = '10000000-0000-4000-8000-0000000000c3' $$,
  'P0001', 'Cannot demote the last manager',
  'postgres cannot demote the last manager either'
);
select is(
  (select role::text from public.profiles where id = '10000000-0000-4000-8000-0000000000c3'),
  'manager',
  'M1 is still a manager after postgres''s demotion was refused'
);

select * from finish();
rollback;
