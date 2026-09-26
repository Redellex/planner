-- profiles.email is NOT NULL, but auth users created without an email (phone or anonymous sign-in)
-- have new.email = null. Mirror the backfill in 20260925120000 and store '' instead of failing signup.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, coalesce(new.email, ''));
  return new;
end;
$$;
