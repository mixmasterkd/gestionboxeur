-- A private, persistent marker prevents deleted bases from being recreated.
create table public.library_initialization (
 owner_id uuid primary key default auth.uid() references public.profiles(id) on delete cascade,
 initialized_at timestamptz not null default now()
);
alter table public.library_initialization enable row level security;
revoke all on public.library_initialization from public,anon,authenticated;
grant select on public.library_initialization to authenticated;
grant insert(owner_id) on public.library_initialization to authenticated;
grant all on public.library_initialization to service_role;
create policy library_initialization_owner on public.library_initialization for select to authenticated using(owner_id=(select auth.uid()));
create policy library_initialization_insert on public.library_initialization for insert to authenticated with check(owner_id=(select auth.uid()));

-- Invoker rights: the same ownership policies and insert grants as the editor.
-- The marker and every base are committed together, including concurrent opens.
create function public.initialize_training_library(p_templates jsonb) returns boolean
language plpgsql security invoker set search_path='' as $$
declare v_owner uuid:=auth.uid(); v_created uuid; v_item jsonb; v_folder uuid; v_name text;
begin
 if v_owner is null then raise exception 'Connexion requise.' using errcode='42501'; end if;
 if exists(select 1 from public.library_initialization where owner_id=v_owner) then return false; end if;
 if jsonb_typeof(p_templates) is distinct from 'array' then raise exception 'Bases invalides.'; end if;
 if jsonb_array_length(p_templates) not between 1 and 30 or octet_length(p_templates::text)>500000 then raise exception 'Bases invalides.'; end if;
 insert into public.library_initialization(owner_id) values(v_owner) on conflict(owner_id) do nothing returning owner_id into v_created;
 if v_created is null then return false; end if;
 for v_item in select value from jsonb_array_elements(p_templates) loop
  if v_item->>'sport' not in ('running','boxing') or v_item->>'sport' is null then raise exception 'Discipline de base invalide.'; end if;
  v_name:=case when v_item->>'sport'='running' then 'Jog - Base' else 'Boxe - Base' end;
  insert into public.library_folders(name) values(v_name) on conflict(owner_id,name) do nothing;
  select id into strict v_folder from public.library_folders where owner_id=v_owner and name=v_name;
  insert into public.session_templates(coach_id,title,sport,description,notes,blocks,kind,folder_id,workout_document)
   values(v_owner,v_item->>'title',v_item->>'sport',coalesce(v_item->>'description',''),coalesce(v_item->>'notes',''),v_item->'blocks','session',v_folder,v_item->'workout_document');
 end loop;
 return true;
end;
$$;

-- Delete only the folder and exact versions confirmed by its owner.
-- Parent/child locks prevent new or moved content from escaping the snapshot.
create function public.delete_training_library_folder(p_folder_id uuid,p_expected_name text,p_contents jsonb) returns integer
language plpgsql security invoker set search_path='' as $$
declare v_owner uuid:=auth.uid(); v_name text; v_count integer; v_deleted integer;
begin
 if v_owner is null then raise exception 'Connexion requise.' using errcode='42501'; end if;
 select name into v_name from public.library_folders where id=p_folder_id and owner_id=v_owner for update;
 if v_name is null then raise exception 'Ce dossier n’est plus accessible.' using errcode='42501'; end if;
 if v_name is distinct from p_expected_name then raise exception 'Le dossier a changé. Rouvre-le et vérifie son contenu avant de réessayer.'; end if;
 if jsonb_typeof(p_contents) is distinct from 'array' then raise exception 'Confirmation du contenu requise.'; end if;
 perform id from public.session_templates where coach_id=v_owner and folder_id=p_folder_id order by id for update;
 select count(*) into v_count from public.session_templates where coach_id=v_owner and folder_id=p_folder_id;
 if v_count<>jsonb_array_length(p_contents) or exists(
  select 1 from public.session_templates t where t.coach_id=v_owner and t.folder_id=p_folder_id
   and not exists(select 1 from jsonb_to_recordset(p_contents) as e(id uuid,updated_at timestamptz) where e.id=t.id and e.updated_at=t.updated_at)
 ) then raise exception 'Le contenu du dossier a changé. Rouvre-le et vérifie son contenu avant de réessayer.'; end if;
 delete from public.session_templates where coach_id=v_owner and folder_id=p_folder_id;
 get diagnostics v_deleted=row_count;
 delete from public.library_folders where id=p_folder_id and owner_id=v_owner;
 return v_deleted;
end;
$$;
revoke all on function public.initialize_training_library(jsonb),public.delete_training_library_folder(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.initialize_training_library(jsonb),public.delete_training_library_folder(uuid,text,jsonb) to authenticated;
