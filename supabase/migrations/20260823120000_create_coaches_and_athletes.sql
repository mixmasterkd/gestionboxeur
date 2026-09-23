-- Gestionnaire Arhlete - schema de base multi-coachs

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.profiles is 'Profil de chaque coach, lié à auth.users.';

create table public.gym_settings (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null unique references public.profiles(id) on delete cascade,
  gym_name text not null default 'Mon gym',
  primary_color text not null default '#111827',
  address text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint gym_settings_primary_color_check
    check (primary_color ~ '^#[0-9A-Fa-f]{6}$')
);

comment on table public.gym_settings is 'Personnalisation minimaliste du gym de chaque coach.';

create table public.athletes (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references public.profiles(id) on delete cascade,
  first_name text not null,
  last_name text not null,
  birth_date date,
  weight_class text,
  phone text,
  email text,
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index athletes_coach_id_idx on public.athletes(coach_id);
create index athletes_name_idx on public.athletes(last_name, first_name);

-- Mise à jour automatique des dates de modification.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

create trigger gym_settings_set_updated_at
before update on public.gym_settings
for each row execute function public.set_updated_at();

create trigger athletes_set_updated_at
before update on public.athletes
for each row execute function public.set_updated_at();

-- Création automatique du profil et des réglages au moment de l'inscription.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, new.raw_user_meta_data ->> 'full_name');

  insert into public.gym_settings (coach_id)
  values (new.id);

  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- RLS : chaque coach ne voit et ne modifie que ses propres données.
alter table public.profiles enable row level security;
alter table public.gym_settings enable row level security;
alter table public.athletes enable row level security;

create policy "Coaches can view their own profile"
on public.profiles for select
to authenticated
using (id = auth.uid());

create policy "Coaches can update their own profile"
on public.profiles for update
to authenticated
using (id = auth.uid())
with check (id = auth.uid());

create policy "Coaches can view their own gym settings"
on public.gym_settings for select
to authenticated
using (coach_id = auth.uid());

create policy "Coaches can update their own gym settings"
on public.gym_settings for update
to authenticated
using (coach_id = auth.uid())
with check (coach_id = auth.uid());

create policy "Coaches can view their own athletes"
on public.athletes for select
to authenticated
using (coach_id = auth.uid());

create policy "Coaches can create their own athletes"
on public.athletes for insert
to authenticated
with check (coach_id = auth.uid());

create policy "Coaches can update their own athletes"
on public.athletes for update
to authenticated
using (coach_id = auth.uid())
with check (coach_id = auth.uid());

create policy "Coaches can delete their own athletes"
on public.athletes for delete
to authenticated
using (coach_id = auth.uid());
