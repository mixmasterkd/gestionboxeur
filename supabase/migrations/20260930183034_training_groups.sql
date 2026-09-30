-- A shared plan owns common content; each athlete keeps an independent session,
-- completion and feedback. Group membership never rewrites a personal history.
create table public.training_groups (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references public.profiles(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index training_groups_owner_idx on public.training_groups(coach_id);
create table public.training_group_members (
  group_id uuid not null references public.training_groups(id) on delete cascade,
  athlete_id uuid not null references public.athletes(id) on delete cascade,
  primary key(group_id,athlete_id)
);
create index training_group_members_athlete_idx on public.training_group_members(athlete_id);
create table public.shared_training_sessions (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references public.profiles(id) on delete cascade,
  author_name text not null default '',
  title text not null check(char_length(trim(title)) between 1 and 200),
  sport text not null default 'other' check(char_length(sport) between 1 and 50),
  date date not null,
  sort_order numeric not null default 1024 check(sort_order > '-1e20'::numeric and sort_order < '1e20'::numeric),
  description text not null default '' check(char_length(description)<=20000),
  notes text not null default '' check(char_length(notes)<=20000),
  blocks jsonb not null default '[]' check(public.valid_training_blocks(blocks)),
  workout_document jsonb check(app_private.valid_workout_document(workout_document)),
  is_locked boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index shared_training_sessions_owner_date_idx on public.shared_training_sessions(created_by,date);
create table public.shared_session_groups (
  session_id uuid not null references public.shared_training_sessions(id) on delete cascade,
  group_id uuid not null references public.training_groups(id) on delete cascade,
  primary key(session_id,group_id)
);
create index shared_session_groups_group_idx on public.shared_session_groups(group_id,session_id);
create table public.shared_session_athletes (
  session_id uuid not null references public.shared_training_sessions(id) on delete cascade,
  athlete_id uuid not null references public.athletes(id) on delete cascade,
  primary key(session_id,athlete_id)
);
create index shared_session_athletes_athlete_idx on public.shared_session_athletes(athlete_id);
alter table public.training_sessions add column shared_session_id uuid references public.shared_training_sessions(id) on delete set null;
create unique index training_sessions_shared_athlete_idx on public.training_sessions(shared_session_id,athlete_id) where shared_session_id is not null;
-- The existing completion/feedback RPCs still work; common content is only changed
-- through the checked shared-plan transaction, never by editing an individual copy.
create policy shared_copy_insert on public.training_sessions as restrictive for insert to authenticated with check(shared_session_id is null);
create policy shared_copy_update on public.training_sessions as restrictive for update to authenticated
  using(shared_session_id is null) with check(shared_session_id is null);
create policy shared_copy_delete on public.training_sessions as restrictive for delete to authenticated using(shared_session_id is null);

alter table public.training_groups enable row level security;
alter table public.training_group_members enable row level security;
alter table public.shared_training_sessions enable row level security;
alter table public.shared_session_groups enable row level security;
alter table public.shared_session_athletes enable row level security;
revoke all on public.training_groups,public.training_group_members,public.shared_training_sessions,public.shared_session_groups,public.shared_session_athletes from public,anon,authenticated;
grant select on public.training_groups,public.training_group_members,public.shared_training_sessions,public.shared_session_groups,public.shared_session_athletes to authenticated;
grant all on public.training_groups,public.training_group_members,public.shared_training_sessions,public.shared_session_groups,public.shared_session_athletes to service_role;
create policy groups_owner_read on public.training_groups for select to authenticated using(coach_id=(select auth.uid()));
create policy group_members_owner_read on public.training_group_members for select to authenticated using(exists(select 1 from public.training_groups g where g.id=group_id and g.coach_id=(select auth.uid())));
create policy shared_owner_read on public.shared_training_sessions for select to authenticated using(created_by=(select auth.uid()));
create policy shared_groups_owner_read on public.shared_session_groups for select to authenticated using(exists(select 1 from public.shared_training_sessions s where s.id=session_id and s.created_by=(select auth.uid())));
create policy shared_athletes_owner_read on public.shared_session_athletes for select to authenticated using(exists(select 1 from public.shared_training_sessions s where s.id=session_id and s.created_by=(select auth.uid())));
create trigger training_groups_updated before update on public.training_groups for each row execute function public.set_updated_at();
create trigger shared_training_updated before update on public.shared_training_sessions for each row execute function public.set_updated_at();

create function app_private.shared_session_json(p_id uuid)
returns jsonb language sql stable set search_path='' as $$
  select to_jsonb(s)||jsonb_build_object('is_group_session',true,'shared_session_id',s.id,'athlete_id',null,'completed_at',null,
    'athlete_ids',coalesce((select jsonb_agg(a.athlete_id order by a.athlete_id) from public.shared_session_athletes a where a.session_id=s.id),'[]'::jsonb),
    'group_ids',coalesce((select jsonb_agg(g.group_id order by g.group_id) from public.shared_session_groups g where g.session_id=s.id),'[]'::jsonb))
  from public.shared_training_sessions s where s.id=p_id;
$$;

create function app_private.sync_shared_session(p_id uuid,p_content boolean default false,p_allow_past boolean default false)
returns void language plpgsql set search_path='' as $$
declare v_session public.shared_training_sessions%rowtype; v_targets uuid[]; v_target uuid;
begin
  select * into strict v_session from public.shared_training_sessions where id=p_id for update;
  if auth.uid() is null or v_session.created_by<>auth.uid() then raise exception 'Accès refusé.' using errcode='42501'; end if;
  select coalesce(array_agg(distinct athlete_id),'{}'::uuid[]) into v_targets from (
    select a.athlete_id from public.shared_session_athletes a where a.session_id=p_id
    union select m.athlete_id from public.training_group_members m join public.shared_session_groups g on g.group_id=m.group_id where g.session_id=p_id
  ) recipients;
  -- Hold the identity/relationship rows while validating and distributing.
  perform 1 from public.athletes where id=any(v_targets) order by id for share;
  perform 1 from public.coach_athletes where athlete_id=any(v_targets) and coach_id=auth.uid() order by athlete_id for share;
  foreach v_target in array v_targets loop
    if (p_content or ((v_session.date>=current_date or p_allow_past) and not exists(select 1 from public.training_sessions where shared_session_id=p_id and athlete_id=v_target)))
      and not (public.owns_athlete(v_target) or public.coach_has_permission(v_target,'add')) then
      raise exception 'Un destinataire ne permet plus l’ajout de séances. Vérifie les membres et leurs permissions.' using errcode='42501';
    end if;
    if p_content and exists(select 1 from public.training_sessions where shared_session_id=p_id and athlete_id=v_target)
      and not (public.owns_athlete(v_target) or public.coach_has_permission(v_target,'edit')) then
      raise exception 'Un destinataire ne permet plus la modification de séances.' using errcode='42501';
    end if;
  end loop;
  -- Remove only uncompleted future assignments which have no remaining source.
  -- Revoked access is never a reason to mutate an athlete's private calendar.
  delete from public.training_sessions s where s.shared_session_id=p_id and not(s.athlete_id=any(v_targets))
    and s.date>=current_date and s.completed_at is null
    and not exists(select 1 from public.session_feedback f where f.session_id=s.id)
    and (public.owns_athlete(s.athlete_id) or public.coach_has_permission(s.athlete_id,'edit'));
  if v_session.date>=current_date or p_allow_past then
    insert into public.training_sessions(athlete_id,created_by,title,sport,date,sort_order,description,notes,blocks,workout_document,is_locked,shared_session_id)
      select x,v_session.created_by,v_session.title,v_session.sport,v_session.date,v_session.sort_order,v_session.description,v_session.notes,v_session.blocks,v_session.workout_document,v_session.is_locked,p_id
      from unnest(v_targets) x where not exists(select 1 from public.training_sessions s where s.shared_session_id=p_id and s.athlete_id=x);
  end if;
  if p_content then
    update public.training_sessions set title=v_session.title,sport=v_session.sport,date=v_session.date,sort_order=v_session.sort_order,
      description=v_session.description,notes=v_session.notes,blocks=v_session.blocks,workout_document=v_session.workout_document,is_locked=v_session.is_locked
    where shared_session_id=p_id and athlete_id=any(v_targets);
  end if;
end;
$$;

-- Only this private entry point has elevated rights. Each operation authenticates
-- the owner; public wrappers are invokers. Per-owner locks serialize membership
-- and assignment changes so a concurrent save cannot leave stale assignments.
create function app_private.training_groups_command(p_action text,p_data jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_id uuid:=nullif(p_data->>'id','')::uuid; v_group public.training_groups%rowtype;
  v_shared public.shared_training_sessions%rowtype; v_athletes uuid[]; v_groups uuid[]; v_sid uuid; v_new boolean:=false; v_payload jsonb;
begin
  if auth.uid() is null or not exists(select 1 from public.coach_profiles where user_id=auth.uid()) then raise exception 'Compte coach requis.' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,61030));
  if p_action in ('group_save','group_delete') then
    if v_id is not null then
      select * into v_group from public.training_groups where id=v_id and coach_id=auth.uid() for update;
      if not found then raise exception 'Groupe inaccessible.' using errcode='42501'; end if;
      if v_group.updated_at is distinct from (p_data->>'updated_at')::timestamptz then raise exception 'Ce groupe a changé. Actualise la liste avant de réessayer.'; end if;
    elsif p_action='group_delete' then raise exception 'Groupe inaccessible.' using errcode='42501'; end if;
    if p_action='group_delete' then
      -- Remove sources first, then reconcile while the affected master IDs remain known.
      for v_sid in select session_id from public.shared_session_groups where group_id=v_id order by session_id loop
        delete from public.shared_session_groups where session_id=v_sid and group_id=v_id;
        perform app_private.sync_shared_session(v_sid);
      end loop;
      delete from public.training_groups where id=v_id;
      return jsonb_build_object('id',v_id);
    end if;
    select coalesce(array_agg(distinct value::uuid),'{}'::uuid[]) into v_athletes from jsonb_array_elements_text(coalesce(p_data->'athlete_ids','[]'));
    if cardinality(v_athletes)>500 then raise exception 'Un groupe peut contenir au maximum 500 personnes.'; end if;
    perform 1 from public.athletes where id=any(v_athletes) order by id for share;
    perform 1 from public.coach_athletes where athlete_id=any(v_athletes) and coach_id=auth.uid() order by athlete_id for share;
    if exists(select 1 from unnest(v_athletes) a where not(public.owns_athlete(a) or public.coach_has_permission(a,'add'))) then
      raise exception 'Choisis ton profil ou des athlètes associés qui autorisent la planification.' using errcode='42501'; end if;
    if v_id is null then
      insert into public.training_groups(coach_id,name) values(auth.uid(),trim(p_data->>'name')) returning id into v_id;
    else update public.training_groups set name=trim(p_data->>'name') where id=v_id; end if;
    delete from public.training_group_members where group_id=v_id and not(athlete_id=any(v_athletes));
    insert into public.training_group_members(group_id,athlete_id) select v_id,x from unnest(v_athletes) x on conflict do nothing;
    for v_sid in select session_id from public.shared_session_groups where group_id=v_id order by session_id loop
      perform app_private.sync_shared_session(v_sid);
    end loop;
    return (select to_jsonb(g)||jsonb_build_object('athlete_ids',to_jsonb(v_athletes)) from public.training_groups g where id=v_id);
  end if;
  if p_action not in ('shared_save','shared_delete') then raise exception 'Action inconnue.'; end if;
  if v_id is not null then
    select * into v_shared from public.shared_training_sessions where id=v_id and created_by=auth.uid() for update;
    if not found then raise exception 'Séance commune inaccessible.' using errcode='42501'; end if;
    if v_shared.updated_at is distinct from (p_data->>'updated_at')::timestamptz then raise exception 'Cette séance commune a changé. Actualise le calendrier avant de réessayer.'; end if;
  elsif p_action='shared_delete' then raise exception 'Séance inaccessible.' using errcode='42501'; end if;
  if p_action='shared_delete' then
    delete from public.training_sessions s where s.shared_session_id=v_id and s.date>=current_date and s.completed_at is null
      and not exists(select 1 from public.session_feedback f where f.session_id=s.id)
      and (public.owns_athlete(s.athlete_id) or public.coach_has_permission(s.athlete_id,'edit'));
    -- Detach retained history without deleting the athlete's session or feedback.
    delete from public.shared_training_sessions where id=v_id;
    return jsonb_build_object('id',v_id);
  end if;
  v_payload:=coalesce(p_data->'payload','{}');
  select coalesce(array_agg(distinct value::uuid),'{}'::uuid[]) into v_athletes from jsonb_array_elements_text(coalesce(v_payload->'athlete_ids',
    (select jsonb_agg(athlete_id) from public.shared_session_athletes where session_id=v_id),'[]'));
  select coalesce(array_agg(distinct value::uuid),'{}'::uuid[]) into v_groups from jsonb_array_elements_text(coalesce(v_payload->'group_ids',
    (select jsonb_agg(group_id) from public.shared_session_groups where session_id=v_id),'[]'));
  if cardinality(v_athletes)+cardinality(v_groups)=0 then raise exception 'Choisis au moins une personne ou un groupe.'; end if;
  if cardinality(v_athletes)>500 or cardinality(v_groups)>100 then raise exception 'Trop de destinataires.'; end if;
  if exists(select 1 from unnest(v_groups) g where not exists(select 1 from public.training_groups where id=g and coach_id=auth.uid())) then raise exception 'Groupe inaccessible.' using errcode='42501'; end if;
  if v_id is null then
    v_new:=true;
    insert into public.shared_training_sessions(created_by,author_name,title,sport,date,sort_order,description,notes,blocks,workout_document,is_locked)
      values(auth.uid(),(select full_name from public.profiles where id=auth.uid()),v_payload->>'title',coalesce(v_payload->>'sport','other'),(v_payload->>'date')::date,
      coalesce((v_payload->>'sort_order')::numeric,1024),coalesce(v_payload->>'description',''),coalesce(v_payload->>'notes',''),coalesce(v_payload->'blocks','[]'),
      nullif(v_payload->'workout_document','null'::jsonb),coalesce((v_payload->>'is_locked')::boolean,false)) returning id into v_id;
  else
    update public.shared_training_sessions set
      title=coalesce(v_payload->>'title',title),sport=coalesce(v_payload->>'sport',sport),date=coalesce((v_payload->>'date')::date,date),
      sort_order=coalesce((v_payload->>'sort_order')::numeric,sort_order),description=coalesce(v_payload->>'description',description),notes=coalesce(v_payload->>'notes',notes),
      blocks=coalesce(v_payload->'blocks',blocks),workout_document=case when v_payload?'workout_document' then nullif(v_payload->'workout_document','null'::jsonb) else workout_document end,
      is_locked=coalesce((v_payload->>'is_locked')::boolean,is_locked) where id=v_id;
  end if;
  delete from public.shared_session_groups where session_id=v_id and not(group_id=any(v_groups));
  insert into public.shared_session_groups(session_id,group_id) select v_id,x from unnest(v_groups) x on conflict do nothing;
  delete from public.shared_session_athletes where session_id=v_id and not(athlete_id=any(v_athletes));
  insert into public.shared_session_athletes(session_id,athlete_id) select v_id,x from unnest(v_athletes) x on conflict do nothing;
  perform app_private.sync_shared_session(v_id,true,v_new);
  return app_private.shared_session_json(v_id);
end;
$$;
revoke all on function app_private.shared_session_json(uuid),app_private.sync_shared_session(uuid,boolean,boolean),app_private.training_groups_command(text,jsonb) from public,anon,authenticated;
grant usage on schema app_private to authenticated;
grant execute on function app_private.training_groups_command(text,jsonb) to authenticated;
create function public.save_training_group(p_name text,p_athlete_ids uuid[],p_id uuid default null,p_updated_at timestamptz default null)
returns jsonb language sql security invoker set search_path='' as $$select app_private.training_groups_command('group_save',jsonb_build_object('id',p_id,'name',p_name,'athlete_ids',to_jsonb(p_athlete_ids),'updated_at',p_updated_at));$$;
create function public.delete_training_group(p_id uuid,p_updated_at timestamptz)
returns jsonb language sql security invoker set search_path='' as $$select app_private.training_groups_command('group_delete',jsonb_build_object('id',p_id,'updated_at',p_updated_at));$$;
create function public.save_shared_training_session(p_payload jsonb,p_id uuid default null,p_updated_at timestamptz default null)
returns jsonb language sql security invoker set search_path='' as $$select app_private.training_groups_command('shared_save',jsonb_build_object('id',p_id,'payload',p_payload,'updated_at',p_updated_at));$$;
create function public.delete_shared_training_session(p_id uuid,p_updated_at timestamptz)
returns jsonb language sql security invoker set search_path='' as $$select app_private.training_groups_command('shared_delete',jsonb_build_object('id',p_id,'updated_at',p_updated_at));$$;
revoke all on function public.save_training_group(text,uuid[],uuid,timestamptz),public.delete_training_group(uuid,timestamptz),public.save_shared_training_session(jsonb,uuid,timestamptz),public.delete_shared_training_session(uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.save_training_group(text,uuid[],uuid,timestamptz),public.delete_training_group(uuid,timestamptz),public.save_shared_training_session(jsonb,uuid,timestamptz),public.delete_shared_training_session(uuid,timestamptz) to authenticated;
