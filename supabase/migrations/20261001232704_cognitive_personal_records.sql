-- Private personal bests only; the submitted scores are not anti-cheat verified.
create table public.cognitive_records (
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  mode text not null check (mode in (
    'tiles-4', 'tiles-6', 'tiles-8',
    'bag-sequence-visible', 'bag-sequence-hidden',
    'bag-targets-visible', 'bag-targets-hidden'
  )),
  score integer not null check (score between 0 and 10000),
  primary key (owner_id, mode)
);

alter table public.cognitive_records enable row level security;
revoke all on public.cognitive_records from public, anon, authenticated;
grant select, delete on public.cognitive_records to authenticated;
grant insert (owner_id, mode, score), update (score) on public.cognitive_records to authenticated;

create policy cognitive_records_select on public.cognitive_records
  for select to authenticated using ((select auth.uid()) = owner_id);
create policy cognitive_records_insert on public.cognitive_records
  for insert to authenticated with check ((select auth.uid()) = owner_id);
create policy cognitive_records_update on public.cognitive_records
  for update to authenticated using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);
create policy cognitive_records_delete on public.cognitive_records
  for delete to authenticated using ((select auth.uid()) = owner_id);

create function public.save_cognitive_record(p_mode text, p_score integer, p_expected_owner uuid)
returns table (mode text, score integer)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  record_owner uuid := auth.uid();
begin
  if record_owner is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_expected_owner is distinct from record_owner then
    raise exception 'The account changed before the record could be saved' using errcode = '42501';
  end if;
  if p_mode is null or p_mode not in (
    'tiles-4', 'tiles-6', 'tiles-8',
    'bag-sequence-visible', 'bag-sequence-hidden',
    'bag-targets-visible', 'bag-targets-hidden'
  ) or p_score is null or p_score < 0 or p_score > 10000 then
    raise exception 'Invalid cognitive record' using errcode = '22023';
  end if;
  return query
    insert into public.cognitive_records as saved (owner_id, mode, score)
    values (record_owner, p_mode, p_score)
    on conflict on constraint cognitive_records_pkey
    do update set score = greatest(saved.score, excluded.score)
    returning saved.mode, saved.score;
end;
$$;

revoke all on function public.save_cognitive_record(text, integer, uuid) from public, anon, authenticated;
grant execute on function public.save_cognitive_record(text, integer, uuid) to authenticated;

comment on table public.cognitive_records is 'Records personnels privés par compte et variante. Aucune validation anti-triche ni partage coach-athlète.';
comment on function public.save_cognitive_record(text, integer, uuid) is 'Conserve atomiquement le meilleur score de auth.uid(). Le compte attendu bloque les écritures provenant d’une ancienne session; il ne choisit pas le propriétaire.';
