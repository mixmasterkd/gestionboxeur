-- Private personal bests only; submitted times are not anti-cheat verified.
create table public.reaction_records (
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  mode text not null check (mode in ('simple', 'locate', 'choice')),
  input text not null check (input in ('touch', 'mouse', 'keyboard')),
  best_ms integer not null check (best_ms between 1 and 10000),
  primary key (owner_id, mode, input)
);

alter table public.reaction_records enable row level security;
revoke all on public.reaction_records from public, anon, authenticated;
grant select, delete on public.reaction_records to authenticated;
grant insert (owner_id, mode, input, best_ms), update (best_ms) on public.reaction_records to authenticated;

create policy reaction_records_select on public.reaction_records
  for select to authenticated using ((select auth.uid()) = owner_id);
create policy reaction_records_insert on public.reaction_records
  for insert to authenticated with check ((select auth.uid()) = owner_id);
create policy reaction_records_update on public.reaction_records
  for update to authenticated using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);
create policy reaction_records_delete on public.reaction_records
  for delete to authenticated using ((select auth.uid()) = owner_id);

create function public.save_reaction_record(p_mode text, p_input text, p_best_ms integer, p_expected_owner uuid)
returns table (mode text, input text, best_ms integer)
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
  if p_mode is null or p_mode not in ('simple', 'locate', 'choice')
    or p_input is null or p_input not in ('touch', 'mouse', 'keyboard')
    or p_best_ms is null or p_best_ms < 1 or p_best_ms > 10000 then
    raise exception 'Invalid reaction record' using errcode = '22023';
  end if;
  return query
    insert into public.reaction_records as saved (owner_id, mode, input, best_ms)
    values (record_owner, p_mode, p_input, p_best_ms)
    on conflict on constraint reaction_records_pkey
    do update set best_ms = least(saved.best_ms, excluded.best_ms)
    returning saved.mode, saved.input, saved.best_ms;
end;
$$;

revoke all on function public.save_reaction_record(text, text, integer, uuid) from public, anon, authenticated;
grant execute on function public.save_reaction_record(text, text, integer, uuid) to authenticated;

comment on table public.reaction_records is 'Meilleurs temps personnels privés par compte, mode et type de commande. Aucune validation anti-triche ni partage coach-athlète.';
comment on function public.save_reaction_record(text, text, integer, uuid) is 'Conserve atomiquement le plus petit temps de auth.uid(). Le compte attendu bloque les écritures provenant d’une ancienne session; il ne choisit pas le propriétaire.';
