-- Risk #3: no availability write reaches a current, past or locked month, by any path: create, update (old and new
-- row), delete, an overnight spill into a locked next month and a weekday-repeat batch. Each refusal has an open-month
-- control. Oracles: PRD FR-001, CLAUDE.md Availability, archive impl review F1 ("Oct 31 00:00 -> Nov 1 00:00 still
-- allowed"), migration intent in 20260926140000_harden_availability_writes.sql. Also who may write lock rows, and the
-- window range constraint.
begin;
select plan(40);

-- Station months, derived once; now() is fixed for the transaction.
select
  (s - interval '1 month')::date as m_prev,
  s::date as m_cur,
  (s + interval '1 month')::date as m1,
  (s + interval '2 months')::date as m2,
  (s + interval '3 months')::date as m3,
  (s + interval '2 months')::date - 1 as m1_last
from (select date_trunc('month', now() at time zone 'Europe/Warsaw') as s) station
\gset

-- Fixtures: employee A, manager Mg.
insert into auth.users (id, email) values
  ('10000000-0000-4000-8000-0000000000a2', 'a@db-rules.test'),
  ('10000000-0000-4000-8000-0000000000c2', 'mg@db-rules.test');
update public.profiles set role = 'manager' where id = '10000000-0000-4000-8000-0000000000c2';

-- M-1 and M are refused by the time rule alone, M+1 and M+3 are open, M+2 is locked.
delete from public.availability_locks where month in (:'m_prev', :'m_cur', :'m1', :'m3');
insert into public.availability_locks (month) values (:'m2') on conflict do nothing;

-- A's target windows: in current M, in locked M+2, in open M+1, and on the last evening of M+1.
insert into public.availability_windows (id, employee_id, starts_at, ends_at) values
  ('10000000-0000-4000-8000-00000000e002', '10000000-0000-4000-8000-0000000000a2',
    :'m_cur'::date + interval '9 days 09:00', :'m_cur'::date + interval '9 days 12:00'),
  ('10000000-0000-4000-8000-00000000e003', '10000000-0000-4000-8000-0000000000a2',
    :'m2'::date + interval '9 days 09:00', :'m2'::date + interval '9 days 12:00'),
  ('10000000-0000-4000-8000-00000000e004', '10000000-0000-4000-8000-0000000000a2',
    :'m1'::date + interval '9 days 09:00', :'m1'::date + interval '9 days 12:00'),
  ('10000000-0000-4000-8000-00000000e005', '10000000-0000-4000-8000-0000000000a2',
    :'m1_last'::date + interval '18:00', :'m1_last'::date + interval '20:00');

select
  max(row(employee_id, starts_at, ends_at)::text) filter (where id = '10000000-0000-4000-8000-00000000e002') as w_cur,
  max(row(employee_id, starts_at, ends_at)::text) filter (where id = '10000000-0000-4000-8000-00000000e003') as w_lock,
  max(row(employee_id, starts_at, ends_at)::text) filter (where id = '10000000-0000-4000-8000-00000000e004') as w_open,
  max(row(employee_id, starts_at, ends_at)::text) filter (where id = '10000000-0000-4000-8000-00000000e005') as w_last
from public.availability_windows
\gset

set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-0000000000a2","role":"authenticated"}';

-- Editability as A sees it
select is(public.is_availability_month_editable(:'m_prev'), false, 'past month M-1 is not editable');
select is(public.is_availability_month_editable(:'m_cur'), false, 'current month M is not editable');
select is(public.is_availability_month_editable(:'m1'), true, 'open month M+1 is editable');
select is(public.is_availability_month_editable(:'m2'), false, 'locked month M+2 is not editable');

-- Create
select throws_ok(
  format($$ insert into public.availability_windows (starts_at, ends_at) values (%L, %L) $$,
    :'m_prev'::date + interval '14 days 09:00', :'m_prev'::date + interval '14 days 12:00'),
  '42501', null,
  'A cannot insert into past month M-1'
);
select throws_ok(
  format($$ insert into public.availability_windows (starts_at, ends_at) values (%L, %L) $$,
    :'m_cur'::date + interval '14 days 09:00', :'m_cur'::date + interval '14 days 12:00'),
  '42501', null,
  'A cannot insert into current month M'
);
select throws_ok(
  format($$ insert into public.availability_windows (starts_at, ends_at) values (%L, %L) $$,
    :'m2'::date + interval '14 days 09:00', :'m2'::date + interval '14 days 12:00'),
  '42501', null,
  'A cannot insert into locked month M+2'
);
select lives_ok(
  format($$ insert into public.availability_windows (starts_at, ends_at) values (%L, %L) $$,
    :'m1'::date + interval '14 days 09:00', :'m1'::date + interval '14 days 12:00'),
  'A can insert into open month M+1'
);
select lives_ok(
  format($$ insert into public.availability_windows (starts_at, ends_at) values (%L, %L) $$,
    :'m3'::date + interval '14 days 09:00', :'m3'::date + interval '14 days 12:00'),
  'A can insert into open month M+3'
);

-- Update and delete in current M and locked M+2 (old row refused)
select is_empty(
  format($$ update public.availability_windows set starts_at = %L, ends_at = %L
    where id = '10000000-0000-4000-8000-00000000e002' returning id $$,
    :'m_cur'::date + interval '9 days 10:00', :'m_cur'::date + interval '9 days 13:00'),
  'A updating own window in current month M matches no rows'
);
select is_empty(
  format($$ update public.availability_windows set starts_at = %L, ends_at = %L
    where id = '10000000-0000-4000-8000-00000000e003' returning id $$,
    :'m2'::date + interval '9 days 10:00', :'m2'::date + interval '9 days 13:00'),
  'A updating own window in locked month M+2 matches no rows'
);
select is_empty(
  $$ delete from public.availability_windows where id = '10000000-0000-4000-8000-00000000e002' returning id $$,
  'A deleting own window in current month M matches no rows'
);
select is_empty(
  $$ delete from public.availability_windows where id = '10000000-0000-4000-8000-00000000e003' returning id $$,
  'A deleting own window in locked month M+2 matches no rows'
);
reset role;
select is(
  (select row(employee_id, starts_at, ends_at)::text from public.availability_windows
    where id = '10000000-0000-4000-8000-00000000e002'),
  :'w_cur',
  'A''s window in current month M is unchanged after the refused update'
);
select is(
  (select row(employee_id, starts_at, ends_at)::text from public.availability_windows
    where id = '10000000-0000-4000-8000-00000000e003'),
  :'w_lock',
  'A''s window in locked month M+2 is unchanged after the refused update'
);
select is(
  (select count(*) from public.availability_windows where id = '10000000-0000-4000-8000-00000000e002'),
  1::bigint,
  'A''s window in current month M still exists after the refused delete'
);
select is(
  (select count(*) from public.availability_windows where id = '10000000-0000-4000-8000-00000000e003'),
  1::bigint,
  'A''s window in locked month M+2 still exists after the refused delete'
);

-- Moving or extending an open-month window into locked M+2 (new row refused)
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-0000000000a2","role":"authenticated"}';
select throws_ok(
  format($$ update public.availability_windows set starts_at = %L, ends_at = %L
    where id = '10000000-0000-4000-8000-00000000e004' $$,
    :'m2'::date + interval '10 days 09:00', :'m2'::date + interval '10 days 12:00'),
  '42501', null,
  'A cannot move an M+1 window into locked month M+2'
);
select throws_ok(
  format($$ update public.availability_windows set ends_at = %L
    where id = '10000000-0000-4000-8000-00000000e005' $$,
    :'m2'::date + interval '01:00'),
  '42501', null,
  'A cannot extend a window on the last day of M+1 into locked month M+2'
);
reset role;
select is(
  (select row(employee_id, starts_at, ends_at)::text from public.availability_windows
    where id = '10000000-0000-4000-8000-00000000e004'),
  :'w_open',
  'A''s M+1 window is unchanged after the refused move'
);
select is(
  (select row(employee_id, starts_at, ends_at)::text from public.availability_windows
    where id = '10000000-0000-4000-8000-00000000e005'),
  :'w_last',
  'A''s last-day window is unchanged after the refused extension'
);

-- Weekday repeat: every M+1 date with the weekday of M+1's last day, overnight, as one statement. Only the last row
-- spills into locked M+2, and it must take the whole batch down with it.
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-0000000000a2","role":"authenticated"}';
select throws_ok(
  format($$ insert into public.availability_windows (starts_at, ends_at)
    select d + interval '22:00', d + interval '1 day 02:00'
    from generate_series(%L::date, %L::date, interval '1 day') d
    where extract(isodow from d) = extract(isodow from %L::date) $$,
    :'m1', :'m1_last', :'m1_last'),
  '42501', null,
  'A weekday-repeat batch whose last overnight row spills into locked M+2 is refused'
);
reset role;
select is(
  (select count(*) from public.availability_windows
    where employee_id = '10000000-0000-4000-8000-0000000000a2' and starts_at::time = '22:00'),
  0::bigint,
  'no row of the refused weekday batch was inserted'
);

-- The same weekday batch inside open M+1 (control)
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-0000000000a2","role":"authenticated"}';
select lives_ok(
  format($$ insert into public.availability_windows (starts_at, ends_at)
    select d + interval '13:00', d + interval '14:00'
    from generate_series(%L::date, %L::date, interval '1 day') d
    where extract(isodow from d) = extract(isodow from %L::date) $$,
    :'m1', :'m1_last', :'m1_last'),
  'A weekday-repeat batch that stays inside open M+1 is accepted'
);

-- Overnight spill and its half-open edge
select throws_ok(
  format($$ insert into public.availability_windows (starts_at, ends_at) values (%L, %L) $$,
    :'m1_last'::date + interval '22:00', :'m2'::date + interval '02:00'),
  '42501', null,
  'A cannot insert an overnight window from the last day of M+1 into locked month M+2'
);
select lives_ok(
  format($$ insert into public.availability_windows (starts_at, ends_at) values (%L, %L) $$,
    :'m1_last'::date + interval '20:00', :'m2'::date),
  'A can insert a window ending exactly at 00:00 on the first day of locked M+2'
);

-- Update and delete in open M+1 (control)
select isnt_empty(
  format($$ update public.availability_windows set starts_at = %L, ends_at = %L
    where id = '10000000-0000-4000-8000-00000000e004' returning id $$,
    :'m1'::date + interval '9 days 10:00', :'m1'::date + interval '9 days 13:00'),
  'A can update own window in open month M+1'
);
select isnt_empty(
  $$ delete from public.availability_windows where id = '10000000-0000-4000-8000-00000000e004' returning id $$,
  'A can delete own window in open month M+1'
);

-- Lock rows: everyone reads them, only a manager inserts or deletes them, nobody updates them
select isnt_empty(
  format($$ select month from public.availability_locks where month = %L $$, :'m2'),
  'A can read the M+2 lock'
);
select throws_ok(
  format($$ insert into public.availability_locks (month) values (%L) $$, :'m3'),
  '42501', null,
  'A cannot insert a lock'
);
select is_empty(
  format($$ delete from public.availability_locks where month = %L returning month $$, :'m2'),
  'A deleting the M+2 lock matches no rows'
);
select is_empty(
  format($$ update public.availability_locks set locked_at = now() where month = %L returning month $$, :'m2'),
  'A updating the M+2 lock matches no rows'
);
reset role;
select is(
  (select count(*) from public.availability_locks where month = :'m2'),
  1::bigint,
  'the M+2 lock remains after A''s delete'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-0000000000c2","role":"authenticated"}';
select is_empty(
  format($$ update public.availability_locks set locked_at = now() where month = %L returning month $$, :'m2'),
  'Mg updating the M+2 lock matches no rows'
);
select lives_ok(
  format($$ insert into public.availability_locks (month) values (%L) $$, :'m3'),
  'Mg can lock M+3'
);
select isnt_empty(
  format($$ delete from public.availability_locks where month = %L returning month $$, :'m3'),
  'Mg can unlock M+3'
);
select throws_ok(
  format($$ insert into public.availability_locks (month) values (%L) $$, :'m3'::date + 1),
  '23514', null,
  'Mg cannot lock a month by a day other than the first'
);

-- Window range: longer than 0 and at most 24h
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-0000000000a2","role":"authenticated"}';
select lives_ok(
  format($$ insert into public.availability_windows (starts_at, ends_at) values (%L, %L) $$,
    :'m1'::date + interval '19 days', :'m1'::date + interval '20 days'),
  'A can insert a window of exactly 24h'
);
select throws_ok(
  format($$ insert into public.availability_windows (starts_at, ends_at) values (%L, %L) $$,
    :'m1'::date + interval '21 days', :'m1'::date + interval '22 days 00:01'),
  '23514', null,
  'A cannot insert a window of 24h and 1 minute'
);
select throws_ok(
  format($$ insert into public.availability_windows (starts_at, ends_at) values (%L, %L) $$,
    :'m1'::date + interval '23 days 10:00', :'m1'::date + interval '23 days 10:00'),
  '23514', null,
  'A cannot insert a zero-length window'
);
reset role;

select * from finish();
rollback;
