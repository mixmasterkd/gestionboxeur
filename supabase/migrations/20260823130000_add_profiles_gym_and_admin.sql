alter table public.profiles
  add column phone text,
  add column is_admin boolean not null default false;

-- Le premier administrateur est explicitement attribué dans la base, pas dans le navigateur.
update public.profiles as profile
set is_admin = true
from auth.users as auth_user
where profile.id = auth_user.id
  and lower(auth_user.email) = 'mixmasterkd@gmail.com';

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and is_admin = true
  );
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, is_admin)
  values (
    new.id,
    new.raw_user_meta_data ->> 'full_name',
    lower(new.email) = 'mixmasterkd@gmail.com'
  );

  insert into public.gym_settings (coach_id, gym_name, address)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data ->> 'gym_name', ''), 'Mon gym'),
    nullif(new.raw_user_meta_data ->> 'gym_address', '')
  );

  return new;
end;
$$;
