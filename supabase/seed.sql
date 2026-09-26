-- Local dev / CI seed only. NEVER run against production.
-- Creates known accounts:
--   manager@example.com  / Manager-Passw0rd!   (id 00000000-0000-4000-8000-000000000001, role manager)
--   employee@example.com / Employee-Passw0rd!  (id 00000000-0000-4000-8000-000000000002, role employee)
-- The smoke test depends on the manager id and credentials; keep both accounts stable.

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
