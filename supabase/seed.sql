-- Local dev / CI seed only. NEVER run against production.
-- Creates a known manager account: manager@example.com / Manager-Passw0rd!
-- The smoke test depends on this id and these credentials.

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
