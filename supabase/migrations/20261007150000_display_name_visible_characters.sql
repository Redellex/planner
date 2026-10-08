-- S-05 review fix: a display name colleagues see must be visible text. btrim() strips only ASCII spaces, so a direct
-- /rpc/set_display_name call could store a name that renders blank (U+3000), padded with tabs or no-break spaces, or
-- reordered by a bidi override. Trim the same whitespace JS String.prototype.trim strips (src/lib/account.ts trims
-- first, so both agree), and refuse control, zero-width and bidi-control characters anywhere in the name with 22023.
-- The whitespace pattern is exactly the set String.prototype.trim strips; keep the forbidden pattern in step with
-- DISPLAY_NAME_FORBIDDEN in src/lib/account.ts.
--   whitespace: [\u0009-\u000D \u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]
--   forbidden:  [\u0001-\u001F\u007F-\u009F\u200B-\u200F\u2028\u2029\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]

-- 1. Existing names that the tighter check would refuse: trim them, and clear any that still hold a forbidden
-- character (they fall back to the email prefix).
update public.profiles
set display_name = nullif(
  regexp_replace(
    display_name,
    '^[\u0009-\u000D \u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]+|[\u0009-\u000D \u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]+$',
    '', 'g'),
  '')
where display_name is not null;

update public.profiles
set display_name = null
where display_name ~ '[\u0001-\u001F\u007F-\u009F\u200B-\u200F\u2028\u2029\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]';

-- 2. The shape check: trimmed of every whitespace above, 1-40 characters, no forbidden character.
alter table public.profiles drop constraint profiles_display_name_shape;
alter table public.profiles
  add constraint profiles_display_name_shape
    check (
      display_name is null
      or (
        display_name !~ '^[\u0009-\u000D \u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]|[\u0009-\u000D \u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]$'
        and display_name !~ '[\u0001-\u001F\u007F-\u009F\u200B-\u200F\u2028\u2029\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]'
        and char_length(display_name) between 1 and 40
      )
    );

comment on column public.profiles.display_name is
  'Name colleagues see on the published schedule (1-40 characters, trimmed of Unicode whitespace, no control, zero-width or bidi-control characters). Null shows the email prefix. Written only by public.set_display_name.';

-- 3. The write path: same trim, then 22001 over 40 characters, then 22023 for a forbidden character.
create or replace function public.set_display_name(new_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalised text := nullif(
    regexp_replace(
      new_name,
      '^[\u0009-\u000D \u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]+|[\u0009-\u000D \u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]+$',
      '', 'g'),
    '');
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  if char_length(normalised) > 40 then
    raise exception 'display name is longer than 40 characters' using errcode = '22001';
  end if;

  if normalised ~ '[\u0001-\u001F\u007F-\u009F\u200B-\u200F\u2028\u2029\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]' then
    raise exception 'display name contains a control or invisible character' using errcode = '22023';
  end if;

  update public.profiles p
  set display_name = normalised
  where p.id = auth.uid();

  -- The signup trigger always creates the row; without it, say so instead of reporting a save that did not happen.
  if not found then
    raise exception 'no profile for the caller' using errcode = 'P0002';
  end if;
end;
$$;

comment on function public.set_display_name(text) is
  'Sets the caller''s own display_name (trimmed of Unicode whitespace; empty clears it). 42501 when not signed in, 22001 when longer than 40 characters, 22023 for a control, zero-width or bidi-control character, P0002 when the caller has no profile row.';
