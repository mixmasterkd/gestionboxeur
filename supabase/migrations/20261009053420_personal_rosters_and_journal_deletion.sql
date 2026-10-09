-- Local preproduction only. No account, role, group or existing content is changed.
-- A personal list belongs to an authenticated profile, independently of coaching tools.
alter table public.coach_athletes drop constraint coach_athletes_coach_id_fkey;
alter table public.coach_athletes add constraint coach_athletes_coach_id_fkey
 foreign key (coach_id) references public.profiles(id) on delete cascade;

-- Preserve the validated roster fields and the atomic private relation created by
-- athlete_link_coach. Privileged insertion is kept internal because the relation
-- granting SELECT access is created by the AFTER INSERT trigger.
create function coaching_private.create_personal_roster_athlete(p_data jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid;
begin
 if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid()) then
  raise exception 'Connecte-toi pour ajouter un athlète à ta liste.' using errcode='42501';
 end if;
 if jsonb_typeof(p_data) is distinct from 'object' or coalesce(length(trim(p_data->>'first_name')),0) not between 1 and 200 or length(coalesce(p_data->>'last_name',''))>200 then
  raise exception 'Prénom requis (200 caractères maximum).';
 end if;
 insert into public.athletes(coach_id,first_name,last_name,birth_date,sex,weight_kg,fights,wins,losses,status,phone,email)
 values(auth.uid(),trim(p_data->>'first_name'),trim(coalesce(p_data->>'last_name','')),nullif(p_data->>'birth_date','')::date,
  nullif(p_data->>'sex',''),nullif(p_data->>'weight_kg','')::numeric,coalesce((p_data->>'fights')::integer,0),
  nullif(p_data->>'wins','')::integer,nullif(p_data->>'losses','')::integer,coalesce(nullif(p_data->>'status',''),'available'),p_data->>'phone',p_data->>'email')
 returning id into v_id;
 update public.coach_athletes set private_notes=left(coalesce(p_data->>'private_notes',''),20000),selected=coalesce((p_data->>'selected')::boolean,false)
 where athlete_id=v_id and coach_id=auth.uid();
 return v_id;
end $$;
create or replace function public.create_roster_athlete(p_data jsonb)
returns uuid language sql security invoker set search_path='' as $$
 select coaching_private.create_personal_roster_athlete(p_data);
$$;
revoke all on function coaching_private.create_personal_roster_athlete(jsonb),public.create_roster_athlete(jsonb) from public,anon,authenticated;
grant execute on function coaching_private.create_personal_roster_athlete(jsonb),public.create_roster_athlete(jsonb) to authenticated;

-- Deletion is an explicit, version-checked operation, never a general table grant.
-- The parent lock also serializes child inserts through their FK key-share lock.
-- If a new observation was saved since the confirmation, preserve it and require
-- another review instead of silently deleting an unseen contribution.
create function coaching_private.delete_journal_entry(p_id uuid,p_updated_at timestamptz,p_update_ids uuid[])
returns uuid language plpgsql security definer set search_path='' as $$
declare v_entry public.journal_entries%rowtype; v_updates uuid[]; v_expected uuid[];
begin
 if auth.uid() is null then raise exception 'Connecte-toi pour supprimer un sujet.' using errcode='42501'; end if;
 select * into v_entry from public.journal_entries where id=p_id for update;
 if not found or not (public.owns_athlete(v_entry.athlete_id) or
  (v_entry.created_by=auth.uid() and public.coach_has_permission(v_entry.athlete_id,'add'))) then
  raise exception 'Tu ne peux pas supprimer ce sujet.' using errcode='42501';
 end if;
 select coalesce(array_agg(id order by id),'{}'::uuid[]) into v_updates from public.journal_updates where entry_id=p_id;
 select coalesce(array_agg(id order by id),'{}'::uuid[]) into v_expected from unnest(p_update_ids) id;
 if p_updated_at is null or v_entry.updated_at is distinct from p_updated_at or p_update_ids is null or v_updates is distinct from v_expected then
  raise exception 'Ce sujet ou ses suivis ont changé. Rouvre-le avant de le supprimer.' using errcode='40001';
 end if;
 delete from public.journal_entries where id=p_id;
 return p_id;
end $$;
create function public.delete_journal_entry(p_id uuid,p_updated_at timestamptz,p_update_ids uuid[])
returns uuid language sql security invoker set search_path='' as $$
 select coaching_private.delete_journal_entry(p_id,p_updated_at,p_update_ids);
$$;
revoke all on function coaching_private.delete_journal_entry(uuid,timestamptz,uuid[]),public.delete_journal_entry(uuid,timestamptz,uuid[]) from public,anon,authenticated;
grant execute on function coaching_private.delete_journal_entry(uuid,timestamptz,uuid[]),public.delete_journal_entry(uuid,timestamptz,uuid[]) to authenticated;
