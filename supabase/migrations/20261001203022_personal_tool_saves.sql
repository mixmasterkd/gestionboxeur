-- Additive, private per-account tool storage. Existing data is untouched.
create table public.timer_presets (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null check (length(btrim(title)) between 1 and 100),
  payload jsonb not null check (
    jsonb_typeof(payload) = 'object' and octet_length(payload::text) <= 100000
    and case payload->>'mode'
      when 'advanced' then jsonb_typeof(payload->'text') = 'string'
        and length(payload->>'text') between 1 and 20000
        and payload - array['mode','text']::text[] = '{}'::jsonb
      when 'base' then jsonb_typeof(payload->'config') = 'object'
        and jsonb_typeof(payload->'units') = 'object'
        and payload - array['mode','config','units']::text[] = '{}'::jsonb
      else false
    end is true
  ),
  created_at timestamptz not null default now()
);
create index timer_presets_owner_created_idx on public.timer_presets(owner_id, created_at desc, id);
alter table public.timer_presets enable row level security;
revoke all on public.timer_presets from public, anon, authenticated;
grant select, delete on public.timer_presets to authenticated;
grant insert (owner_id,title,payload) on public.timer_presets to authenticated;
create policy timer_presets_select on public.timer_presets for select to authenticated using ((select auth.uid()) = owner_id);
create policy timer_presets_insert on public.timer_presets for insert to authenticated with check ((select auth.uid()) = owner_id);
create policy timer_presets_delete on public.timer_presets for delete to authenticated using ((select auth.uid()) = owner_id);

create table public.bulletin_boards (
  owner_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  notes jsonb not null check (jsonb_typeof(notes) = 'array' and jsonb_array_length(notes) <= 30 and octet_length(notes::text) <= 500000),
  revision uuid not null default gen_random_uuid()
);
alter table public.bulletin_boards enable row level security;
revoke all on public.bulletin_boards from public, anon, authenticated;
grant select on public.bulletin_boards to authenticated;
grant insert (owner_id,notes,revision), update (notes,revision) on public.bulletin_boards to authenticated;
create policy bulletin_boards_select on public.bulletin_boards for select to authenticated using ((select auth.uid()) = owner_id);
create policy bulletin_boards_insert on public.bulletin_boards for insert to authenticated with check ((select auth.uid()) = owner_id);
create policy bulletin_boards_update on public.bulletin_boards for update to authenticated using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
comment on table public.timer_presets is 'Timers à intervalles privés. Uniquement le mode actif, jamais le chrono en cours.';
comment on table public.bulletin_boards is 'Babillard personnel, privé même entre un coach et ses athlètes. Révision pour éviter les écrasements concurrents.';
