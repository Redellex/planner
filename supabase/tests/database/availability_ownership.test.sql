-- Risk #2: an employee never reads, edits or deletes another employee's availability, and a manager reads but
-- never writes it. Oracles: PRD NFR (windows visible only to their employee and the manager), PRD Access Control,
-- "no manager editing on another user's behalf" (archived availability plan), archive impl review F5 (created_at).
-- Refused writes are checked as postgres afterwards: as the denied actor, RLS would hide the row anyway.
begin;
select plan(30);

-- Station month + 1, derived once; now() is fixed for the transaction.
select (date_trunc('month', now() at time zone 'Europe/Warsaw') + interval '1 month')::date as m1
\gset

-- Fixtures: employees A and B, manager Mg. The signup trigger creates their employee profiles.
insert into auth.users (id, email) values
  ('10000000-0000-4000-8000-0000000000a1', 'a@db-rules.test'),
  ('10000000-0000-4000-8000-0000000000b1', 'b@db-rules.test'),
  ('10000000-0000-4000-8000-0000000000c1', 'mg@db-rules.test');
update public.profiles set role = 'manager' where id = '10000000-0000-4000-8000-0000000000c1';

-- M+1 must be open whatever the local or CI state.
delete from public.schedules where month = :'m1';
delete from public.availability_locks where month = :'m1';

-- A's target window: day 5 of M+1, 09:00-17:00.
insert into public.availability_windows (id, employee_id, starts_at, ends_at)
values ('10000000-0000-4000-8000-00000000f001', '10000000-0000-4000-8000-0000000000a1',
  :'m1'::date + interval '4 days 09:00', :'m1'::date + interval '4 days 17:00');

select row(employee_id, starts_at, ends_at, created_at)::text as a_win
from public.availability_windows
where id = '10000000-0000-4000-8000-00000000f001'
\gset

-- B against A's window
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-0000000000b1","role":"authenticated"}';

select is_empty(
  $$ select id from public.availability_windows where id = '10000000-0000-4000-8000-00000000f001' $$,
  'B cannot read A''s window'
);
select is_empty(
  format($$ update public.availability_windows set starts_at = %L, ends_at = %L
    where id = '10000000-0000-4000-8000-00000000f001' returning id $$,
    :'m1'::date + interval '4 days 10:00', :'m1'::date + interval '4 days 18:00'),
  'B updating A''s window by id matches no rows'
);
reset role;
select is(
  (select row(employee_id, starts_at, ends_at, created_at)::text from public.availability_windows
    where id = '10000000-0000-4000-8000-00000000f001'),
  :'a_win',
  'A''s window is unchanged after B''s update'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-0000000000b1","role":"authenticated"}';
select is_empty(
  $$ delete from public.availability_windows where id = '10000000-0000-4000-8000-00000000f001' returning id $$,
  'B deleting A''s window by id matches no rows'
);
reset role;
select is(
  (select row(employee_id, starts_at, ends_at, created_at)::text from public.availability_windows
    where id = '10000000-0000-4000-8000-00000000f001'),
  :'a_win',
  'A''s window is unchanged after B''s delete'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-0000000000b1","role":"authenticated"}';
select throws_ok(
  format($$ insert into public.availability_windows (employee_id, starts_at, ends_at)
    values ('10000000-0000-4000-8000-0000000000a1', %L, %L) $$,
    :'m1'::date + interval '5 days 09:00', :'m1'::date + interval '5 days 10:00'),
  '42501', null,
  'B cannot insert a window owned by A'
);
reset role;
select is(
  (select count(*) from public.availability_windows where employee_id = '10000000-0000-4000-8000-0000000000a1'),
  1::bigint,
  'A still has exactly one window after B''s forged insert'
);

-- A cannot write columns outside (starts_at, ends_at)
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-0000000000a1","role":"authenticated"}';
select throws_ok(
  $$ update public.availability_windows set employee_id = '10000000-0000-4000-8000-0000000000b1'
    where id = '10000000-0000-4000-8000-00000000f001' $$,
  '42501', null,
  'A cannot hand their window to B'
);
select throws_ok(
  format($$ insert into public.availability_windows (starts_at, ends_at, created_at)
    values (%L, %L, now() - interval '1 year') $$,
    :'m1'::date + interval '6 days 09:00', :'m1'::date + interval '6 days 10:00'),
  '42501', null,
  'A cannot set created_at on insert'
);
select throws_ok(
  $$ update public.availability_windows set created_at = now() - interval '1 year'
    where id = '10000000-0000-4000-8000-00000000f001' $$,
  '42501', null,
  'A cannot backdate created_at on update'
);
reset role;
select is(
  (select row(employee_id, starts_at, ends_at, created_at)::text from public.availability_windows
    where id = '10000000-0000-4000-8000-00000000f001'),
  :'a_win',
  'A''s window is unchanged after the refused column writes'
);

-- Mg reads A's window but cannot write it
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-0000000000c1","role":"authenticated"}';
select isnt_empty(
  $$ select id from public.availability_windows where id = '10000000-0000-4000-8000-00000000f001' $$,
  'Mg can read A''s window'
);
select is_empty(
  format($$ update public.availability_windows set starts_at = %L, ends_at = %L
    where id = '10000000-0000-4000-8000-00000000f001' returning id $$,
    :'m1'::date + interval '4 days 10:00', :'m1'::date + interval '4 days 18:00'),
  'Mg updating A''s window by id matches no rows'
);
select is_empty(
  $$ delete from public.availability_windows where id = '10000000-0000-4000-8000-00000000f001' returning id $$,
  'Mg deleting A''s window by id matches no rows'
);
reset role;
select is(
  (select row(employee_id, starts_at, ends_at, created_at)::text from public.availability_windows
    where id = '10000000-0000-4000-8000-00000000f001'),
  :'a_win',
  'A''s window is unchanged after Mg''s update and delete'
);

-- Mg manages their own window in M+1 like any user (control)
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-0000000000c1","role":"authenticated"}';
select lives_ok(
  format($$ insert into public.availability_windows (starts_at, ends_at) values (%L, %L) $$,
    :'m1'::date + interval '7 days 09:00', :'m1'::date + interval '7 days 12:00'),
  'Mg can insert their own window in M+1'
);
select isnt_empty(
  format($$ update public.availability_windows set ends_at = %L
    where employee_id = auth.uid() and starts_at = %L returning id $$,
    :'m1'::date + interval '7 days 13:00', :'m1'::date + interval '7 days 09:00'),
  'Mg can update their own window in M+1'
);
select isnt_empty(
  format($$ delete from public.availability_windows
    where employee_id = auth.uid() and starts_at = %L returning id $$,
    :'m1'::date + interval '7 days 09:00'),
  'Mg can delete their own window in M+1'
);

-- A manages their own window in M+1 (control)
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-0000000000a1","role":"authenticated"}';
select lives_ok(
  format($$ insert into public.availability_windows (starts_at, ends_at) values (%L, %L) $$,
    :'m1'::date + interval '8 days 09:00', :'m1'::date + interval '8 days 12:00'),
  'A can insert their own window in M+1 without sending employee_id'
);
select is(
  (select employee_id::text from public.availability_windows where starts_at = :'m1'::date + interval '8 days 09:00'),
  '10000000-0000-4000-8000-0000000000a1',
  'A''s inserted window is owned by A and readable by A'
);
select isnt_empty(
  format($$ update public.availability_windows set starts_at = %L, ends_at = %L
    where starts_at = %L returning id $$,
    :'m1'::date + interval '8 days 10:00', :'m1'::date + interval '8 days 13:00',
    :'m1'::date + interval '8 days 09:00'),
  'A can update their own window in M+1'
);
select isnt_empty(
  format($$ delete from public.availability_windows where starts_at = %L returning id $$,
    :'m1'::date + interval '8 days 10:00'),
  'A can delete their own window in M+1'
);

-- anon gets nothing
reset role;
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select is_empty(
  $$ select id from public.availability_windows where id = '10000000-0000-4000-8000-00000000f001' $$,
  'anon cannot read A''s window'
);
select is_empty(
  $$ delete from public.availability_windows where id = '10000000-0000-4000-8000-00000000f001' returning id $$,
  'anon deleting A''s window by id matches no rows'
);
select throws_ok(
  format($$ insert into public.availability_windows (starts_at, ends_at) values (%L, %L) $$,
    :'m1'::date + interval '9 days 09:00', :'m1'::date + interval '9 days 10:00'),
  '42501', null,
  'anon cannot insert a window'
);
select throws_ok(
  format($$ update public.availability_windows set starts_at = %L, ends_at = %L
    where id = '10000000-0000-4000-8000-00000000f001' $$,
    :'m1'::date + interval '4 days 10:00', :'m1'::date + interval '4 days 18:00'),
  '42501', null,
  'anon cannot update window times'
);
reset role;
select is(
  (select row(employee_id, starts_at, ends_at, created_at)::text from public.availability_windows
    where id = '10000000-0000-4000-8000-00000000f001'),
  :'a_win',
  'A''s window is unchanged after anon''s writes'
);

-- Overlap is per employee, half-open
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-0000000000b1","role":"authenticated"}';
select lives_ok(
  format($$ insert into public.availability_windows (starts_at, ends_at) values (%L, %L) $$,
    :'m1'::date + interval '4 days 09:00', :'m1'::date + interval '4 days 17:00'),
  'B can insert a window with exactly A''s times'
);
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-0000000000a1","role":"authenticated"}';
select throws_ok(
  format($$ insert into public.availability_windows (starts_at, ends_at) values (%L, %L) $$,
    :'m1'::date + interval '4 days 12:00', :'m1'::date + interval '4 days 20:00'),
  '23P01', null,
  'A cannot insert a window overlapping their own'
);
select lives_ok(
  format($$ insert into public.availability_windows (starts_at, ends_at) values (%L, %L) $$,
    :'m1'::date + interval '4 days 17:00', :'m1'::date + interval '4 days 20:00'),
  'A can insert a window starting exactly at their own window''s end'
);
reset role;

select * from finish();
rollback;
