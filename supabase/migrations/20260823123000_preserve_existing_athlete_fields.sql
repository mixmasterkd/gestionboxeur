-- Champs nécessaires pour conserver l'interface et les fiches existantes.
alter table public.athletes
  add column sex text check (sex in ('M', 'F')),
  add column status text not null default 'available'
    check (status in ('available', 'unavailable', 'injured', 'sick', 'not_ready')),
  add column weight_kg numeric(5, 1),
  add column fights integer not null default 0 check (fights >= 0),
  add column wins integer check (wins >= 0),
  add column losses integer check (losses >= 0),
  add column selected boolean not null default false;

create table public.coach_contacts (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references public.profiles(id) on delete cascade,
  first_name text not null,
  last_name text,
  phone text,
  email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index coach_contacts_coach_id_idx on public.coach_contacts(coach_id);

create trigger coach_contacts_set_updated_at
before update on public.coach_contacts
for each row execute function public.set_updated_at();

alter table public.coach_contacts enable row level security;

create policy "Coaches can view their own contact coaches"
on public.coach_contacts for select to authenticated
using (coach_id = auth.uid());

create policy "Coaches can create their own contact coaches"
on public.coach_contacts for insert to authenticated
with check (coach_id = auth.uid());

create policy "Coaches can update their own contact coaches"
on public.coach_contacts for update to authenticated
using (coach_id = auth.uid()) with check (coach_id = auth.uid());

create policy "Coaches can delete their own contact coaches"
on public.coach_contacts for delete to authenticated
using (coach_id = auth.uid());
