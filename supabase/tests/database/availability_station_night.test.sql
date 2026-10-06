-- A month's last station night ends at 06:00 on day 1 of the next month, and the schedule generator reads windows
-- starting in that slot for the earlier month. So a window starting on day 1 before 06:00 is editable only while the
-- previous month is editable too: locking a month (or generating its draft) freezes them. Oracles: CLAUDE.md
-- Availability/Schedule, migration intent in 20261006130000_lock_last_station_night_windows.sql, impl review F1.
begin;
select plan(8);

-- Station months, derived once; now() is fixed for the transaction.
select
  (s + interval '1 month')::date as m1,
  (s + interval '2 months')::date as m2,
  (s + interval '3 months')::date as m3,
  (s + interval '4 months')::date as m4
from (select date_trunc('month', now() at time zone 'Europe/Warsaw') as s) station
\gset

-- Fixture: employee A.
insert into auth.users (id, email) values
  ('10000000-0000-4000-8000-0000000000a5', 'a@db-station-night.test');

-- M+2 is locked; M+1, M+3 and M+4 are open (a local draft would hold its lock, so drop drafts first).
delete from public.schedules where month in (:'m1', :'m2', :'m3', :'m4');
delete from public.availability_locks where month in (:'m1', :'m3', :'m4');
insert into public.availability_locks (month) values (:'m2') on conflict do nothing;

-- A's window in the last station night of locked M+2 (01:00-05:00 on day 1 of M+3), inserted as the owner.
insert into public.availability_windows (id, employee_id, starts_at, ends_at) values
  ('10000000-0000-4000-8000-00000000e501', '10000000-0000-4000-8000-0000000000a5',
    :'m3'::date + interval '01:00', :'m3'::date + interval '05:00');

set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-0000000000a5","role":"authenticated"}';

-- Create
select throws_ok(
  format($$ insert into public.availability_windows (starts_at, ends_at) values (%L, %L) $$,
    :'m3'::date + interval '02:00', :'m3'::date + interval '04:00'),
  '42501', null,
  'A cannot insert a window starting on day 1 of open M+3 before 06:00 while M+2 is locked'
);
select throws_ok(
  format($$ insert into public.availability_windows (starts_at, ends_at) values (%L, %L) $$,
    :'m1'::date + interval '00:00', :'m1'::date + interval '08:00'),
  '42501', null,
  'A cannot insert a window starting on day 1 of open M+1 before 06:00 (the current month''s last night)'
);
select lives_ok(
  format($$ insert into public.availability_windows (starts_at, ends_at) values (%L, %L) $$,
    :'m3'::date + interval '06:00', :'m3'::date + interval '10:00'),
  'A can insert a window starting at 06:00 on day 1 of open M+3 (its own station day)'
);
select lives_ok(
  format($$ insert into public.availability_windows (starts_at, ends_at) values (%L, %L) $$,
    :'m4'::date + interval '02:00', :'m4'::date + interval '04:00'),
  'A can insert a window starting on day 1 of M+4 before 06:00 while M+3 is open (control)'
);

-- Update and delete of the frozen window match nothing.
select is_empty(
  format($$ update public.availability_windows set starts_at = %L, ends_at = %L
    where id = '10000000-0000-4000-8000-00000000e501' returning id $$,
    :'m3'::date + interval '07:00', :'m3'::date + interval '09:00'),
  'A cannot move a window out of locked M+2''s last station night'
);
select is_empty(
  $$ delete from public.availability_windows where id = '10000000-0000-4000-8000-00000000e501' returning id $$,
  'A cannot delete a window in locked M+2''s last station night'
);

reset role;
select is(
  (select row(starts_at, ends_at)::text from public.availability_windows
    where id = '10000000-0000-4000-8000-00000000e501'),
  row(:'m3'::date + interval '01:00', :'m3'::date + interval '05:00')::text,
  'the frozen window is unchanged'
);

-- Unlocking M+2 makes it editable again.
delete from public.availability_locks where month = :'m2';
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-0000000000a5","role":"authenticated"}';
select isnt_empty(
  $$ delete from public.availability_windows where id = '10000000-0000-4000-8000-00000000e501' returning id $$,
  'A can delete that window once M+2 is unlocked'
);

select * from finish();
rollback;
