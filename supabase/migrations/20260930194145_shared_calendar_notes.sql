-- Common calendar notes use one author-owned master and private recipient copies.
-- Recipient lists are visible only to the author; all mutations are atomic.
create table public.shared_calendar_events (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references public.profiles(id) on delete cascade,
  author_name text not null default '',
  title text not null check(char_length(trim(title)) between 1 and 200),
  category text not null default 'note' check(char_length(category) between 1 and 50),
  date date not null,
  end_date date check(end_date is null or end_date>=date),
  notes text not null default '' check(char_length(notes)<=20000),
  color text not null default 'sand' check(color in ('sand','coral','blue','lavender','mint')),
  sort_order numeric not null default 1024 check(sort_order > '-1e20'::numeric and sort_order < '1e20'::numeric),
  is_locked boolean not null default true check(is_locked),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index shared_calendar_events_owner_date_idx on public.shared_calendar_events(created_by,date);
create table public.shared_event_groups (
  event_id uuid not null references public.shared_calendar_events(id) on delete cascade,
  group_id uuid not null references public.training_groups(id) on delete cascade,
  primary key(event_id,group_id)
);
create index shared_event_groups_group_idx on public.shared_event_groups(group_id,event_id);
create table public.shared_event_athletes (
  event_id uuid not null references public.shared_calendar_events(id) on delete cascade,
  athlete_id uuid not null references public.athletes(id) on delete cascade,
  primary key(event_id,athlete_id)
);
create index shared_event_athletes_athlete_idx on public.shared_event_athletes(athlete_id);
alter table public.personal_events add column shared_event_id uuid references public.shared_calendar_events(id) on delete set null;
create unique index personal_events_shared_athlete_idx on public.personal_events(shared_event_id,athlete_id) where shared_event_id is not null;
alter table public.personal_events add constraint shared_event_not_private check(shared_event_id is null or not is_private);
create policy shared_event_copy_insert on public.personal_events as restrictive for insert to authenticated with check(shared_event_id is null);
create policy shared_event_copy_update on public.personal_events as restrictive for update to authenticated using(shared_event_id is null) with check(shared_event_id is null);
create policy shared_event_copy_delete on public.personal_events as restrictive for delete to authenticated using(shared_event_id is null);
alter table public.shared_calendar_events enable row level security;
alter table public.shared_event_groups enable row level security;
alter table public.shared_event_athletes enable row level security;
revoke all on public.shared_calendar_events,public.shared_event_groups,public.shared_event_athletes from public,anon,authenticated;
grant select on public.shared_calendar_events,public.shared_event_groups,public.shared_event_athletes to authenticated;
grant all on public.shared_calendar_events,public.shared_event_groups,public.shared_event_athletes to service_role;
create policy shared_event_owner_read on public.shared_calendar_events for select to authenticated using(created_by=(select auth.uid()));
create policy shared_event_groups_owner_read on public.shared_event_groups for select to authenticated using(exists(select 1 from public.shared_calendar_events e where e.id=event_id and e.created_by=(select auth.uid())));
create policy shared_event_athletes_owner_read on public.shared_event_athletes for select to authenticated using(exists(select 1 from public.shared_calendar_events e where e.id=event_id and e.created_by=(select auth.uid())));
create trigger shared_calendar_event_updated before update on public.shared_calendar_events for each row execute function public.set_updated_at();

create function app_private.shared_event_json(p_id uuid)
returns jsonb language sql stable set search_path='' as $$
 select to_jsonb(e)||jsonb_build_object('is_group_event',true,'shared_event_id',e.id,'athlete_id',null,'is_private',false,
   'athlete_ids',coalesce((select jsonb_agg(a.athlete_id order by a.athlete_id) from public.shared_event_athletes a where a.event_id=e.id),'[]'::jsonb),
   'group_ids',coalesce((select jsonb_agg(g.group_id order by g.group_id) from public.shared_event_groups g where g.event_id=e.id),'[]'::jsonb))
 from public.shared_calendar_events e where e.id=p_id;
$$;
create function app_private.sync_shared_event(p_id uuid,p_content boolean default false,p_allow_past boolean default false)
returns void language plpgsql set search_path='' as $$
declare v_event public.shared_calendar_events%rowtype; v_targets uuid[]; v_target uuid;
begin
 select * into strict v_event from public.shared_calendar_events where id=p_id for update;
 if auth.uid() is null or v_event.created_by<>auth.uid() then raise exception 'Accès refusé.' using errcode='42501'; end if;
 select coalesce(array_agg(distinct athlete_id),'{}'::uuid[]) into v_targets from (
   select a.athlete_id from public.shared_event_athletes a where a.event_id=p_id
   union select m.athlete_id from public.training_group_members m join public.shared_event_groups g on g.group_id=m.group_id where g.event_id=p_id
 ) recipients;
 perform 1 from public.athletes where id=any(v_targets) order by id for share;
 perform 1 from public.coach_athletes where athlete_id=any(v_targets) and coach_id=auth.uid() order by athlete_id for share;
 foreach v_target in array v_targets loop
   if (p_content or ((coalesce(v_event.end_date,v_event.date)>=current_date or p_allow_past) and not exists(select 1 from public.personal_events where shared_event_id=p_id and athlete_id=v_target)))
     and not(public.owns_athlete(v_target) or public.coach_has_permission(v_target,'add')) then
     raise exception 'Un destinataire ne permet plus l’ajout de notes. Vérifie les membres et leurs permissions.' using errcode='42501';
   end if;
   if p_content and exists(select 1 from public.personal_events where shared_event_id=p_id and athlete_id=v_target)
     and not(public.owns_athlete(v_target) or public.coach_has_permission(v_target,'edit')) then
     raise exception 'Un destinataire ne permet plus la modification de notes.' using errcode='42501';
   end if;
 end loop;
 -- Notes which already began form part of the recipient's history.
 -- Never mutate a personal calendar after its editing permission was revoked.
 delete from public.personal_events e where e.shared_event_id=p_id and not(e.athlete_id=any(v_targets)) and e.date>=current_date
   and (public.owns_athlete(e.athlete_id) or public.coach_has_permission(e.athlete_id,'edit'));
 if coalesce(v_event.end_date,v_event.date)>=current_date or p_allow_past then
   insert into public.personal_events(athlete_id,created_by,title,category,date,end_date,notes,color,sort_order,is_locked,is_private,shared_event_id)
   select x,v_event.created_by,v_event.title,v_event.category,v_event.date,v_event.end_date,v_event.notes,v_event.color,v_event.sort_order,v_event.is_locked,false,p_id
   from unnest(v_targets) x where not exists(select 1 from public.personal_events e where e.shared_event_id=p_id and e.athlete_id=x);
 end if;
 if p_content then
   update public.personal_events set title=v_event.title,category=v_event.category,date=v_event.date,end_date=v_event.end_date,notes=v_event.notes,
     color=v_event.color,sort_order=v_event.sort_order,is_locked=v_event.is_locked
   where shared_event_id=p_id and athlete_id=any(v_targets);
 end if;
end;
$$;

-- Reuse the existing checked group/session transaction and owner advisory lock.
-- Group changes reconcile notes in the same transaction as session membership.
alter function app_private.training_groups_command(text,jsonb) rename to training_groups_sessions_command;
revoke all on function app_private.training_groups_sessions_command(text,jsonb) from public,anon,authenticated;
create function app_private.training_groups_command(p_action text,p_data jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_id uuid:=nullif(p_data->>'id','')::uuid; v_ids uuid[]; v_event_id uuid; v_result jsonb;
begin
 if auth.uid() is null or not exists(select 1 from public.coach_profiles where user_id=auth.uid()) then raise exception 'Compte coach requis.' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,61030));
 if p_action='group_delete' then
   select array_agg(event_id order by event_id) into v_ids from public.shared_event_groups where group_id=v_id;
 end if;
 v_result:=app_private.training_groups_sessions_command(p_action,p_data);
 if p_action='group_save' then
   select array_agg(event_id order by event_id) into v_ids from public.shared_event_groups where group_id=(v_result->>'id')::uuid;
 end if;
 foreach v_event_id in array coalesce(v_ids,'{}'::uuid[]) loop perform app_private.sync_shared_event(v_event_id); end loop;
 return v_result;
end;
$$;
create function app_private.shared_events_command(p_action text,p_data jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_id uuid:=nullif(p_data->>'id','')::uuid; v_event public.shared_calendar_events%rowtype;
 v_athletes uuid[]; v_groups uuid[]; v_new boolean:=false; v_payload jsonb;
begin
 if auth.uid() is null or not exists(select 1 from public.coach_profiles where user_id=auth.uid()) then raise exception 'Compte coach requis.' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,61030));
 if p_action not in ('save','delete') then raise exception 'Action inconnue.'; end if;
 if v_id is not null then
   select * into v_event from public.shared_calendar_events where id=v_id and created_by=auth.uid() for update;
   if not found then raise exception 'Note commune inaccessible.' using errcode='42501'; end if;
   if v_event.updated_at is distinct from (p_data->>'updated_at')::timestamptz then raise exception 'Cette note commune a changé. Actualise le calendrier avant de réessayer.'; end if;
 elsif p_action='delete' then raise exception 'Note commune inaccessible.' using errcode='42501'; end if;
 if p_action='delete' then
   delete from public.personal_events e where e.shared_event_id=v_id and e.date>=current_date
     and (public.owns_athlete(e.athlete_id) or public.coach_has_permission(e.athlete_id,'edit'));
   delete from public.shared_calendar_events where id=v_id;
   return jsonb_build_object('id',v_id);
 end if;
 v_payload:=coalesce(p_data->'payload','{}');
 select coalesce(array_agg(distinct value::uuid),'{}'::uuid[]) into v_athletes from jsonb_array_elements_text(coalesce(v_payload->'athlete_ids',
   (select jsonb_agg(athlete_id) from public.shared_event_athletes where event_id=v_id),'[]'));
 select coalesce(array_agg(distinct value::uuid),'{}'::uuid[]) into v_groups from jsonb_array_elements_text(coalesce(v_payload->'group_ids',
   (select jsonb_agg(group_id) from public.shared_event_groups where event_id=v_id),'[]'));
 if cardinality(v_athletes)+cardinality(v_groups)=0 then raise exception 'Choisis au moins une personne ou un groupe.'; end if;
 if cardinality(v_athletes)>500 or cardinality(v_groups)>100 then raise exception 'Trop de destinataires.'; end if;
 if exists(select 1 from unnest(v_groups) g where not exists(select 1 from public.training_groups where id=g and coach_id=auth.uid())) then raise exception 'Groupe inaccessible.' using errcode='42501'; end if;
 if v_id is null then
   v_new:=true;
   insert into public.shared_calendar_events(created_by,author_name,title,category,date,end_date,notes,color,sort_order,is_locked)
     values(auth.uid(),(select full_name from public.profiles where id=auth.uid()),v_payload->>'title',coalesce(v_payload->>'category','note'),(v_payload->>'date')::date,
       nullif(v_payload->>'end_date','')::date,coalesce(v_payload->>'notes',''),coalesce(v_payload->>'color','sand'),coalesce((v_payload->>'sort_order')::numeric,1024),true) returning id into v_id;
 else
   update public.shared_calendar_events set title=coalesce(v_payload->>'title',title),category=coalesce(v_payload->>'category',category),date=coalesce((v_payload->>'date')::date,date),
     end_date=case when v_payload?'end_date' then nullif(v_payload->>'end_date','')::date else end_date end,
     notes=coalesce(v_payload->>'notes',notes),color=coalesce(v_payload->>'color',color),sort_order=coalesce((v_payload->>'sort_order')::numeric,sort_order),
     is_locked=true where id=v_id;
 end if;
 delete from public.shared_event_groups where event_id=v_id and not(group_id=any(v_groups));
 insert into public.shared_event_groups(event_id,group_id) select v_id,x from unnest(v_groups) x on conflict do nothing;
 delete from public.shared_event_athletes where event_id=v_id and not(athlete_id=any(v_athletes));
 insert into public.shared_event_athletes(event_id,athlete_id) select v_id,x from unnest(v_athletes) x on conflict do nothing;
 perform app_private.sync_shared_event(v_id,true,v_new);
 return app_private.shared_event_json(v_id);
end;
$$;
revoke all on function app_private.shared_event_json(uuid),app_private.sync_shared_event(uuid,boolean,boolean),app_private.training_groups_command(text,jsonb),app_private.shared_events_command(text,jsonb) from public,anon,authenticated;
grant execute on function app_private.training_groups_command(text,jsonb),app_private.shared_events_command(text,jsonb) to authenticated;
create function public.save_shared_calendar_event(p_payload jsonb,p_id uuid default null,p_updated_at timestamptz default null)
returns jsonb language sql security invoker set search_path='' as $$select app_private.shared_events_command('save',jsonb_build_object('id',p_id,'payload',p_payload,'updated_at',p_updated_at));$$;
create function public.delete_shared_calendar_event(p_id uuid,p_updated_at timestamptz)
returns jsonb language sql security invoker set search_path='' as $$select app_private.shared_events_command('delete',jsonb_build_object('id',p_id,'updated_at',p_updated_at));$$;
revoke all on function public.save_shared_calendar_event(jsonb,uuid,timestamptz),public.delete_shared_calendar_event(uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.save_shared_calendar_event(jsonb,uuid,timestamptz),public.delete_shared_calendar_event(uuid,timestamptz) to authenticated;
