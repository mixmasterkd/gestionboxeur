-- Independent overlapping communities extend the existing planning groups.
-- Membership grants shared content only; no personal calendar/feedback policy changes.
alter table public.training_groups add column description text not null default '' check(char_length(description)<=2000);
alter table public.training_group_members add column role text not null default 'member' check(role in ('member','admin'));
-- Existing roster assignments keep their original coaching permission requirements.
-- New explicit group invitations authorize only distribution through this group.
alter table public.training_group_members add column accepted_group_access boolean not null default false;
alter table public.training_sessions add column shared_group_authorized boolean not null default false;
alter table public.personal_events add column shared_group_authorized boolean not null default false;

create table public.group_invitations (
 id uuid primary key default gen_random_uuid(),
 group_id uuid not null references public.training_groups(id) on delete cascade,
 user_id uuid not null references public.profiles(id) on delete cascade,
 invited_by uuid not null references public.profiles(id) on delete cascade,
 role text not null default 'member' check(role in ('member','admin')),
 status text not null default 'pending' check(status in ('pending','accepted','declined','cancelled')),
 created_at timestamptz not null default now(), expires_at timestamptz not null default now()+interval '30 days', responded_at timestamptz,
 unique(group_id,user_id)
);
create index group_invitations_recipient_idx on public.group_invitations(user_id,status,expires_at);
create index group_invitations_sender_idx on public.group_invitations(invited_by,created_at);
create table public.group_posts (
 id uuid primary key default gen_random_uuid(), group_id uuid not null references public.training_groups(id) on delete cascade,
 author_id uuid references public.profiles(id) on delete set null,
 kind text not null check(kind in ('message','suggestion')), content text not null check(char_length(trim(content)) between 1 and 5000),
 pinned boolean not null default false, status text not null default 'open' check(status in ('open','planned','done')),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index group_posts_group_idx on public.group_posts(group_id,created_at desc);
create index group_posts_author_idx on public.group_posts(author_id);
create table public.group_post_supports (
 post_id uuid not null references public.group_posts(id) on delete cascade, user_id uuid not null references public.profiles(id) on delete cascade,
 primary key(post_id,user_id)
);
create index group_post_supports_user_idx on public.group_post_supports(user_id);
create table public.group_comments (
 id uuid primary key default gen_random_uuid(), post_id uuid not null references public.group_posts(id) on delete cascade,
 author_id uuid references public.profiles(id) on delete set null, content text not null check(char_length(trim(content)) between 1 and 2000), created_at timestamptz not null default now()
);
create index group_comments_post_idx on public.group_comments(post_id,created_at);
create index group_comments_author_idx on public.group_comments(author_id);
create table public.group_polls (
 id uuid primary key default gen_random_uuid(), group_id uuid not null references public.training_groups(id) on delete cascade,
 author_id uuid references public.profiles(id) on delete set null,
 question text not null check(char_length(trim(question)) between 1 and 500),
 closes_at timestamptz, closed_at timestamptz, created_at timestamptz not null default now()
);
create index group_polls_group_idx on public.group_polls(group_id,created_at desc);
create index group_polls_author_idx on public.group_polls(author_id);
create table public.group_poll_options (
 id uuid primary key default gen_random_uuid(), poll_id uuid not null references public.group_polls(id) on delete cascade,
 label text not null check(char_length(trim(label)) between 1 and 200), position integer not null check(position between 1 and 10),
 unique(poll_id,position), unique(poll_id,id)
);
create table public.group_poll_votes (
 poll_id uuid not null references public.group_polls(id) on delete cascade,
 user_id uuid not null references public.profiles(id) on delete cascade,
 option_id uuid not null,
 primary key(poll_id,user_id), foreign key(poll_id,option_id) references public.group_poll_options(poll_id,id) on delete cascade
);
create index group_poll_votes_option_idx on public.group_poll_votes(option_id);
create index group_poll_votes_user_idx on public.group_poll_votes(user_id);

-- RLS is deliberately paired with RPC-only access. Aggregates never reveal voters
-- or unrelated profiles, and mutations cannot bypass transaction checks.
do $$declare t text; begin
 foreach t in array array['group_invitations','group_posts','group_post_supports','group_comments','group_polls','group_poll_options','group_poll_votes'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant all on public.%I to service_role',t);
 end loop;
end$$;

create function app_private.community_role(p_group uuid)
returns text language sql stable security definer set search_path='' as $$
 select case when g.coach_id=auth.uid() then 'owner' else m.role end
 from public.training_groups g left join public.training_group_members m on m.group_id=g.id
 and m.athlete_id=(select id from public.athletes where user_id=auth.uid())
 where auth.uid() is not null and g.id=p_group;
$$;
create function app_private.community_manages(p_group uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select coalesce(app_private.community_role(p_group) in ('owner','admin'),false);
$$;
create function app_private.community_group_json(p_group uuid)
returns jsonb language sql stable set search_path='' as $$
 select to_jsonb(g)||jsonb_build_object('role',app_private.community_role(g.id),
 'athlete_ids',coalesce((select jsonb_agg(m.athlete_id order by m.athlete_id) from public.training_group_members m where m.group_id=g.id),'[]'::jsonb),
 'member_count',(select count(*) from (select coalesce(a.user_id::text,'athlete:'||a.id::text) from public.training_group_members m join public.athletes a on a.id=m.athlete_id where m.group_id=g.id union select g.coach_id::text) x))
 from public.training_groups g where g.id=p_group;
$$;
create function app_private.community_shared_access(p_id uuid,p_event boolean default false)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare v_creator uuid; v_groups uuid[]; v_direct uuid[];
begin
 if auth.uid() is null then return false; end if;
 if p_event then
  select created_by into v_creator from public.shared_calendar_events where id=p_id;
  select array_agg(group_id) into v_groups from public.shared_event_groups where event_id=p_id;
  select array_agg(athlete_id) into v_direct from public.shared_event_athletes where event_id=p_id;
 else
  select created_by into v_creator from public.shared_training_sessions where id=p_id;
  select array_agg(group_id) into v_groups from public.shared_session_groups where session_id=p_id;
  select array_agg(athlete_id) into v_direct from public.shared_session_athletes where session_id=p_id;
 end if;
 if v_creator is null then return false; end if;
 -- A master affecting several groups can only be changed by someone who manages
 -- all those groups. An admin cannot edit another group's or a private assignment.
 return (v_creator=auth.uid() or cardinality(coalesce(v_groups,'{}'))>0)
 and not exists(select 1 from unnest(coalesce(v_groups,'{}')) x where not app_private.community_manages(x))
 and not exists(select 1 from unnest(coalesce(v_direct,'{}')) x where not(public.owns_athlete(x) or public.coach_has_permission(x,'edit')));
end;
$$;
revoke all on function app_private.community_role(uuid),app_private.community_manages(uuid),app_private.community_group_json(uuid),app_private.community_shared_access(uuid,boolean) from public,anon,authenticated;
grant execute on function app_private.community_manages(uuid),app_private.community_shared_access(uuid,boolean) to authenticated;
-- Existing member table visibility remains limited to managers. Membership lists
-- exposed by the community RPC contain names/roles only, never private athlete data.
create policy community_admin_groups_read on public.training_groups for select to authenticated using(app_private.community_manages(id));
create policy community_admin_members_read on public.training_group_members for select to authenticated using(app_private.community_manages(group_id));
create policy community_admin_sessions_read on public.shared_training_sessions for select to authenticated using(app_private.community_shared_access(id));
create policy community_admin_session_groups_read on public.shared_session_groups for select to authenticated using(app_private.community_shared_access(session_id));
create policy community_admin_session_athletes_read on public.shared_session_athletes for select to authenticated using(app_private.community_shared_access(session_id));
create policy community_admin_events_read on public.shared_calendar_events for select to authenticated using(app_private.community_shared_access(id,true));
create policy community_admin_event_groups_read on public.shared_event_groups for select to authenticated using(app_private.community_shared_access(event_id,true));
create policy community_admin_event_athletes_read on public.shared_event_athletes for select to authenticated using(app_private.community_shared_access(event_id,true));

-- Keep calendar updates, group membership and deduplication atomic.
create or replace function app_private.sync_shared_session(p_id uuid,p_content boolean default false,p_allow_past boolean default false)
returns void language plpgsql set search_path='' as $$
declare v_session public.shared_training_sessions%rowtype; v_targets uuid[]; v_target uuid;
begin
  select * into strict v_session from public.shared_training_sessions where id=p_id for update;
  if auth.uid() is null then raise exception 'Accès refusé.' using errcode='42501'; end if;
  select coalesce(array_agg(distinct athlete_id),'{}'::uuid[]) into v_targets from (
    select a.athlete_id from public.shared_session_athletes a where a.session_id=p_id
    union select m.athlete_id from public.training_group_members m join public.shared_session_groups g on g.group_id=m.group_id where g.session_id=p_id
  ) recipients;
  -- Hold the identity/relationship rows while validating and distributing.
  perform 1 from public.athletes where id=any(v_targets) order by id for share;
  perform 1 from public.coach_athletes where athlete_id=any(v_targets) and coach_id=auth.uid() order by athlete_id for share;
  foreach v_target in array v_targets loop
    if (p_content or ((v_session.date>=current_date or p_allow_past) and not exists(select 1 from public.training_sessions where shared_session_id=p_id and athlete_id=v_target)))
      and not (exists(select 1 from public.training_group_members m join public.shared_session_groups g on g.group_id=m.group_id where g.session_id=p_id and m.athlete_id=v_target and app_private.community_delivery_allowed(m.group_id,v_target,'add')) or public.owns_athlete(v_target) or public.coach_has_permission(v_target,'add')) then
      raise exception 'Un destinataire ne permet plus l’ajout de séances. Vérifie les membres et leurs permissions.' using errcode='42501';
    end if;
    if p_content and exists(select 1 from public.training_sessions where shared_session_id=p_id and athlete_id=v_target)
      and not (exists(select 1 from public.training_group_members m join public.shared_session_groups g on g.group_id=m.group_id where g.session_id=p_id and m.athlete_id=v_target and app_private.community_delivery_allowed(m.group_id,v_target,'edit')) or public.owns_athlete(v_target) or public.coach_has_permission(v_target,'edit')) then
      raise exception 'Un destinataire ne permet plus la modification de séances.' using errcode='42501';
    end if;
  end loop;
  -- Remove only uncompleted future assignments which have no remaining source.
  -- Revoked access is never a reason to mutate an athlete's private calendar.
  delete from public.training_sessions s where s.shared_session_id=p_id and not(s.athlete_id=any(v_targets))
    and s.date>=current_date and s.completed_at is null
    and not exists(select 1 from public.session_feedback f where f.session_id=s.id)
    and (s.shared_group_authorized or public.owns_athlete(s.athlete_id) or public.coach_has_permission(s.athlete_id,'edit'));
  if v_session.date>=current_date or p_allow_past then
    insert into public.training_sessions(athlete_id,created_by,title,sport,date,sort_order,description,notes,blocks,workout_document,is_locked,shared_session_id,shared_group_authorized)
      select x,v_session.created_by,v_session.title,v_session.sport,v_session.date,v_session.sort_order,v_session.description,v_session.notes,v_session.blocks,v_session.workout_document,v_session.is_locked,p_id,exists(select 1 from public.training_group_members m join public.shared_session_groups g on g.group_id=m.group_id where g.session_id=p_id and m.athlete_id=x and m.accepted_group_access)
      from unnest(v_targets) x where not exists(select 1 from public.training_sessions s where s.shared_session_id=p_id and s.athlete_id=x);
  end if;
  if p_content then
    update public.training_sessions set title=v_session.title,sport=v_session.sport,date=v_session.date,sort_order=v_session.sort_order,
      description=v_session.description,notes=v_session.notes,blocks=v_session.blocks,workout_document=v_session.workout_document,is_locked=v_session.is_locked
    where shared_session_id=p_id and athlete_id=any(v_targets);
  end if;
end;
$$;

create or replace function app_private.sync_shared_event(p_id uuid,p_content boolean default false,p_allow_past boolean default false)
returns void language plpgsql set search_path='' as $$
declare v_event public.shared_calendar_events%rowtype; v_targets uuid[]; v_target uuid;
begin
 select * into strict v_event from public.shared_calendar_events where id=p_id for update;
 if auth.uid() is null then raise exception 'Accès refusé.' using errcode='42501'; end if;
 select coalesce(array_agg(distinct athlete_id),'{}'::uuid[]) into v_targets from (
   select a.athlete_id from public.shared_event_athletes a where a.event_id=p_id
   union select m.athlete_id from public.training_group_members m join public.shared_event_groups g on g.group_id=m.group_id where g.event_id=p_id
 ) recipients;
 perform 1 from public.athletes where id=any(v_targets) order by id for share;
 perform 1 from public.coach_athletes where athlete_id=any(v_targets) and coach_id=auth.uid() order by athlete_id for share;
 foreach v_target in array v_targets loop
   if (p_content or ((coalesce(v_event.end_date,v_event.date)>=current_date or p_allow_past) and not exists(select 1 from public.personal_events where shared_event_id=p_id and athlete_id=v_target)))
     and not(exists(select 1 from public.training_group_members m join public.shared_event_groups g on g.group_id=m.group_id where g.event_id=p_id and m.athlete_id=v_target and app_private.community_delivery_allowed(m.group_id,v_target,'add')) or public.owns_athlete(v_target) or public.coach_has_permission(v_target,'add')) then
     raise exception 'Un destinataire ne permet plus l’ajout de notes. Vérifie les membres et leurs permissions.' using errcode='42501';
   end if;
   if p_content and exists(select 1 from public.personal_events where shared_event_id=p_id and athlete_id=v_target)
     and not(exists(select 1 from public.training_group_members m join public.shared_event_groups g on g.group_id=m.group_id where g.event_id=p_id and m.athlete_id=v_target and app_private.community_delivery_allowed(m.group_id,v_target,'edit')) or public.owns_athlete(v_target) or public.coach_has_permission(v_target,'edit')) then
     raise exception 'Un destinataire ne permet plus la modification de notes.' using errcode='42501';
   end if;
 end loop;
 -- Notes which already began form part of the recipient's history.
 -- Never mutate a personal calendar after its editing permission was revoked.
 delete from public.personal_events e where e.shared_event_id=p_id and not(e.athlete_id=any(v_targets)) and e.date>=current_date
   and (e.shared_group_authorized or public.owns_athlete(e.athlete_id) or public.coach_has_permission(e.athlete_id,'edit'));
 if coalesce(v_event.end_date,v_event.date)>=current_date or p_allow_past then
   insert into public.personal_events(athlete_id,created_by,title,category,date,end_date,notes,color,sort_order,is_locked,is_private,shared_event_id,shared_group_authorized)
   select x,v_event.created_by,v_event.title,v_event.category,v_event.date,v_event.end_date,v_event.notes,v_event.color,v_event.sort_order,v_event.is_locked,false,p_id,exists(select 1 from public.training_group_members m join public.shared_event_groups g on g.group_id=m.group_id where g.event_id=p_id and m.athlete_id=x and m.accepted_group_access)
   from unnest(v_targets) x where not exists(select 1 from public.personal_events e where e.shared_event_id=p_id and e.athlete_id=x);
 end if;
 if p_content then
   update public.personal_events set title=v_event.title,category=v_event.category,date=v_event.date,end_date=v_event.end_date,notes=v_event.notes,
     color=v_event.color,sort_order=v_event.sort_order,is_locked=v_event.is_locked
   where shared_event_id=p_id and athlete_id=any(v_targets);
 end if;
end;
$$;

create or replace function app_private.training_groups_sessions_command(p_action text,p_data jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_id uuid:=nullif(p_data->>'id','')::uuid; v_group public.training_groups%rowtype;
  v_shared public.shared_training_sessions%rowtype; v_athletes uuid[]; v_groups uuid[]; v_sid uuid; v_new boolean:=false; v_payload jsonb;
begin
  if auth.uid() is null or not exists(select 1 from public.coach_profiles where user_id=auth.uid()) and not exists(select 1 from public.training_groups where app_private.community_manages(id)) then raise exception 'Compte coach requis.' using errcode='42501'; end if;
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
    select * into v_shared from public.shared_training_sessions where id=v_id and app_private.community_shared_access(id) for update;
    if not found then raise exception 'Séance commune inaccessible.' using errcode='42501'; end if;
    if v_shared.updated_at is distinct from (p_data->>'updated_at')::timestamptz then raise exception 'Cette séance commune a changé. Actualise le calendrier avant de réessayer.'; end if;
  elsif p_action='shared_delete' then raise exception 'Séance inaccessible.' using errcode='42501'; end if;
  if p_action='shared_delete' then
    delete from public.training_sessions s where s.shared_session_id=v_id and s.date>=current_date and s.completed_at is null
      and not exists(select 1 from public.session_feedback f where f.session_id=s.id)
      and (s.shared_group_authorized or public.owns_athlete(s.athlete_id) or public.coach_has_permission(s.athlete_id,'edit'));
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
  if exists(select 1 from unnest(v_groups) g where not app_private.community_manages(g)) then raise exception 'Groupe inaccessible.' using errcode='42501'; end if;
  if exists(select 1 from unnest(v_athletes) a where not(public.owns_athlete(a) or public.coach_has_permission(a,'add'))) then raise exception 'Un destinataire ne permet plus l’ajout de séances.' using errcode='42501'; end if;
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

create or replace function app_private.training_groups_command(p_action text,p_data jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_id uuid:=nullif(p_data->>'id','')::uuid; v_ids uuid[]; v_event_id uuid; v_result jsonb;
begin
 if auth.uid() is null or not exists(select 1 from public.coach_profiles where user_id=auth.uid()) and not exists(select 1 from public.training_groups where app_private.community_manages(id)) then raise exception 'Compte coach requis.' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(61030,1);
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

create or replace function app_private.shared_events_command(p_action text,p_data jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_id uuid:=nullif(p_data->>'id','')::uuid; v_event public.shared_calendar_events%rowtype;
 v_athletes uuid[]; v_groups uuid[]; v_new boolean:=false; v_payload jsonb;
begin
 if auth.uid() is null or not exists(select 1 from public.coach_profiles where user_id=auth.uid()) and not exists(select 1 from public.training_groups where app_private.community_manages(id)) then raise exception 'Compte coach requis.' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(61030,1);
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,61030));
 if p_action not in ('save','delete') then raise exception 'Action inconnue.'; end if;
 if v_id is not null then
   select * into v_event from public.shared_calendar_events where id=v_id and app_private.community_shared_access(id,true) for update;
   if not found then raise exception 'Note commune inaccessible.' using errcode='42501'; end if;
   if v_event.updated_at is distinct from (p_data->>'updated_at')::timestamptz then raise exception 'Cette note commune a changé. Actualise le calendrier avant de réessayer.'; end if;
 elsif p_action='delete' then raise exception 'Note commune inaccessible.' using errcode='42501'; end if;
 if p_action='delete' then
   delete from public.personal_events e where e.shared_event_id=v_id and e.date>=current_date
     and (e.shared_group_authorized or public.owns_athlete(e.athlete_id) or public.coach_has_permission(e.athlete_id,'edit'));
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
 if exists(select 1 from unnest(v_groups) g where not app_private.community_manages(g)) then raise exception 'Groupe inaccessible.' using errcode='42501'; end if;
 if exists(select 1 from unnest(v_athletes) a where not(public.owns_athlete(a) or public.coach_has_permission(a,'add'))) then raise exception 'Un destinataire ne permet plus l’ajout de notes.' using errcode='42501'; end if;
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

create function app_private.community_refresh_group(p_group uuid)
returns void language plpgsql set search_path='' as $$
declare sid uuid; begin
 for sid in select session_id from public.shared_session_groups where group_id=p_group order by session_id loop perform app_private.sync_shared_session(sid); end loop;
 for sid in select event_id from public.shared_event_groups where group_id=p_group order by event_id loop perform app_private.sync_shared_event(sid); end loop;
end;
$$;

create function app_private.community_detail(p_group uuid)
returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('group',app_private.community_group_json(p_group),
 'members',coalesce((select jsonb_agg(to_jsonb(x) order by case x.role when 'owner' then 0 when 'admin' then 1 else 2 end,x.name) from (
  select p.id user_id,a.id athlete_id,p.full_name name,'owner'::text role from public.training_groups g join public.profiles p on p.id=g.coach_id left join public.athletes a on a.user_id=p.id where g.id=p_group
  union all select a.user_id,a.id,coalesce(p.full_name,trim(a.first_name||' '||coalesce(a.last_name,''))),m.role from public.training_group_members m join public.athletes a on a.id=m.athlete_id left join public.profiles p on p.id=a.user_id join public.training_groups g on g.id=m.group_id where m.group_id=p_group and a.user_id is distinct from g.coach_id
 ) x),'[]'::jsonb),
 'posts',coalesce((select jsonb_agg(to_jsonb(x) order by x.pinned desc,x.created_at desc) from (
 select p.*,coalesce(a.full_name,'Ancien membre') author_name,
 (select count(*) from public.group_post_supports s where s.post_id=p.id) support_count,
 exists(select 1 from public.group_post_supports s where s.post_id=p.id and s.user_id=auth.uid()) supported_by_me,
 coalesce((select jsonb_agg(to_jsonb(c)||jsonb_build_object('author_name',coalesce(u.full_name,'Ancien membre')) order by c.created_at,c.id) from public.group_comments c left join public.profiles u on u.id=c.author_id where c.post_id=p.id),'[]'::jsonb) comments
 from public.group_posts p left join public.profiles a on a.id=p.author_id where p.group_id=p_group order by p.pinned desc,p.created_at desc limit 200
 ) x),'[]'::jsonb),
 'polls',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (
 select p.*,coalesce(a.full_name,'Ancien membre') author_name,
 (select count(*) from public.group_poll_votes v where v.poll_id=p.id) total_votes,
 (select option_id from public.group_poll_votes v where v.poll_id=p.id and v.user_id=auth.uid()) my_vote,
 coalesce((select jsonb_agg(to_jsonb(o)||jsonb_build_object('votes',(select count(*) from public.group_poll_votes v where v.option_id=o.id)) order by o.position) from public.group_poll_options o where o.poll_id=p.id),'[]'::jsonb) options
 from public.group_polls p left join public.profiles a on a.id=p.author_id where p.group_id=p_group order by p.created_at desc limit 100
 ) x),'[]'::jsonb),
 'invitations',case when app_private.community_manages(p_group) then coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'name',p.full_name,'role',i.role,'status',i.status,'created_at',i.created_at) order by i.created_at desc) from public.group_invitations i join public.profiles p on p.id=i.user_id where i.group_id=p_group and i.status='pending' and i.expires_at>now()),'[]'::jsonb) else '[]'::jsonb end);
$$;

create function app_private.community_command(p_action text,p_data jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 v_uid uuid:=auth.uid(); v_id uuid:=nullif(p_data->>'id','')::uuid; v_gid uuid:=nullif(p_data->>'group_id','')::uuid;
 v_user uuid:=nullif(p_data->>'user_id','')::uuid; v_aid uuid; v_role text; v_target_role text; v_new_role text; v_group public.training_groups%rowtype;
 v_inv public.group_invitations%rowtype; v_post public.group_posts%rowtype; v_poll public.group_polls%rowtype;
 v_sid uuid; v_sids uuid[]; v_eids uuid[]; v_items jsonb; v_accept boolean; v_options jsonb; v_option text; v_position integer:=0;
begin
 if v_uid is null or not exists(select 1 from public.profiles where id=v_uid) then raise exception 'Connecte-toi.' using errcode='42501'; end if;
 if p_data is null or jsonb_typeof(p_data)<>'object' then raise exception 'Données invalides.'; end if;
 if p_action='list_groups' then
  return coalesce((select jsonb_agg(app_private.community_group_json(g.id) order by lower(g.name),g.id) from public.training_groups g where app_private.community_role(g.id) is not null),'[]'::jsonb);
 end if;
 if p_action='notifications' then
  select coalesce(jsonb_agg(x.item order by x.created_at desc),'[]'::jsonb) into v_items from (
   select i.created_at,jsonb_build_object('id',i.id,'type','group_invitation','group_id',g.id,'title',g.name,'actor_name',p.full_name,'role',i.role,'message',p.full_name||' t’invite à rejoindre ce groupe.','created_at',i.created_at) item
   from public.group_invitations i join public.training_groups g on g.id=i.group_id join public.profiles p on p.id=i.invited_by
   where i.user_id=v_uid and i.status='pending' and i.expires_at>now()
   union all select i.created_at,jsonb_build_object('id',i.id,'type','coaching_invitation','coach_id',i.coach_id,'athlete_id',i.athlete_id,'title',p.full_name,'actor_name',p.full_name,'message',p.full_name||' propose de devenir ton coach.','created_at',i.created_at)
   from public.coaching_invitations i join public.athletes a on a.id=i.athlete_id join public.profiles p on p.id=i.coach_id where a.user_id=v_uid and i.status='pending' and i.expires_at>now()
   union all select r.created_at,jsonb_build_object('id',r.athlete_id,'type','coach_request','coach_id',r.coach_id,'athlete_id',r.athlete_id,'title',trim(a.first_name||' '||coalesce(a.last_name,'')),'actor_name',trim(a.first_name||' '||coalesce(a.last_name,'')),'message',trim(a.first_name||' '||coalesce(a.last_name,''))||' souhaite t’ajouter comme coach.','created_at',r.created_at)
   from public.coach_athletes r join public.athletes a on a.id=r.athlete_id where r.coach_id=v_uid and r.status='pending'
  ) x;
  return jsonb_build_object('items',v_items,'count',jsonb_array_length(v_items));
 end if;
 if p_action='group_detail' then
  v_gid:=coalesce(v_gid,v_id);
  if app_private.community_role(v_gid) is null then raise exception 'Groupe inaccessible.' using errcode='42501'; end if;
  return app_private.community_detail(v_gid);
 end if;
 -- The same transaction lock covers legacy planning APIs and membership changes.
 -- It avoids membership/save races that could otherwise restore removed copies.
 perform pg_advisory_xact_lock(61030,1);
 if p_action='save_group' then
  if v_id is null then
   insert into public.training_groups(coach_id,name,description) values(v_uid,trim(p_data->>'name'),coalesce(trim(p_data->>'description'),'')) returning id into v_id;
   select id into v_aid from public.athletes where user_id=v_uid;
   if v_aid is not null then insert into public.training_group_members(group_id,athlete_id,role,accepted_group_access) values(v_id,v_aid,'admin',true); end if;
  else
   select * into v_group from public.training_groups where id=v_id and coach_id=v_uid for update;
   if not found then raise exception 'Seul le créateur peut modifier le groupe.' using errcode='42501'; end if;
   if v_group.updated_at is distinct from (p_data->>'updated_at')::timestamptz then raise exception 'Ce groupe a changé. Actualise la liste.'; end if;
   update public.training_groups set name=coalesce(trim(p_data->>'name'),name),description=coalesce(trim(p_data->>'description'),description) where id=v_id;
  end if;
  return app_private.community_group_json(v_id);
 end if;
 if p_action='respond_invitation' then
  v_accept:=(p_data->>'accept')::boolean;
  if v_accept is null then raise exception 'Réponse invalide.'; end if;
  select * into v_inv from public.group_invitations where id=v_id and user_id=v_uid for update;
  if not found then raise exception 'Invitation inaccessible.' using errcode='42501'; end if;
  if v_inv.status<>'pending' or v_inv.expires_at<=now() then raise exception 'Invitation déjà traitée ou expirée.'; end if;
  if v_accept then
   if not exists(select 1 from public.training_groups g where g.id=v_inv.group_id and (g.coach_id=v_inv.invited_by or (v_inv.role='member' and exists(select 1 from public.training_group_members m join public.athletes a on a.id=m.athlete_id where m.group_id=g.id and a.user_id=v_inv.invited_by and m.role='admin')))) then raise exception 'Cette invitation n’est plus valide.'; end if;
   if (select count(*) from public.training_group_members where group_id=v_inv.group_id)>=500 then raise exception 'Le groupe est complet.'; end if;
   select id into v_aid from public.athletes where user_id=v_uid;
   if v_aid is null then raise exception 'Complète ton profil avant de rejoindre un groupe.'; end if;
   insert into public.training_group_members(group_id,athlete_id,role,accepted_group_access) values(v_inv.group_id,v_aid,v_inv.role,true)
    on conflict(group_id,athlete_id) do update set accepted_group_access=true;
   perform app_private.community_refresh_group(v_inv.group_id);
   update public.training_groups set updated_at=now() where id=v_inv.group_id;
  end if;
  update public.group_invitations set status=case when v_accept then 'accepted' else 'declined' end,responded_at=now() where id=v_id;
  return jsonb_build_object('id',v_id,'accepted',v_accept);
 end if;
 if p_action in ('support_post','comment_post','delete_post','pin_post','status_post') then
  select * into v_post from public.group_posts where id=v_id for update;
  if not found then raise exception 'Publication inaccessible.' using errcode='42501'; end if;
  v_gid:=v_post.group_id;
 elsif p_action in ('vote','close_poll') then
  v_id:=coalesce(nullif(p_data->>'poll_id','')::uuid,v_id);
  select * into v_poll from public.group_polls where id=v_id for update;
  if not found then raise exception 'Sondage inaccessible.' using errcode='42501'; end if;
  v_gid:=v_poll.group_id;
 end if;
 v_gid:=coalesce(v_gid,v_id);
 select * into v_group from public.training_groups where id=v_gid for update;
 v_role:=app_private.community_role(v_gid);
 if v_role is null then raise exception 'Groupe inaccessible.' using errcode='42501'; end if;
 if p_action='invite_member' then
  if v_role not in ('owner','admin') then raise exception 'Administration du groupe requise.' using errcode='42501'; end if;
  v_new_role:=coalesce(p_data->>'role','member');
  if v_new_role not in ('member','admin') or (v_new_role='admin' and v_role<>'owner') then raise exception 'Seul le créateur peut nommer un admin.' using errcode='42501'; end if;
  if char_length(trim(p_data->>'email')) not between 3 and 320 or position('@' in p_data->>'email')=0 then raise exception 'Courriel invalide.'; end if;
  select id into v_user from auth.users where lower(email)=lower(trim(p_data->>'email')) limit 1;
  if v_user is null then raise exception 'Aucun compte trouvé pour ce courriel.'; end if;
  if v_user=v_group.coach_id or exists(select 1 from public.training_group_members m join public.athletes a on a.id=m.athlete_id where m.group_id=v_gid and a.user_id=v_user) then raise exception 'Cette personne fait déjà partie du groupe.'; end if;
  select * into v_inv from public.group_invitations where group_id=v_gid and user_id=v_user;
  if found and v_inv.status='pending' and v_inv.expires_at>now() then return jsonb_build_object('id',v_inv.id); end if;
  if v_inv.responded_at>now()-interval '1 day' then raise exception 'Attends avant de renvoyer cette invitation.'; end if;
  if (select count(*) from public.group_invitations where invited_by=v_uid and created_at>now()-interval '1 day')>=50 then raise exception 'Limite quotidienne d’invitations atteinte.'; end if;
  insert into public.group_invitations(group_id,user_id,invited_by,role) values(v_gid,v_user,v_uid,v_new_role)
   on conflict(group_id,user_id) do update set invited_by=v_uid,role=v_new_role,status='pending',created_at=now(),expires_at=now()+interval '30 days',responded_at=null returning id into v_id;
  return jsonb_build_object('id',v_id);
 elsif p_action in ('set_role','remove_member','leave_group','transfer_group') then
  if p_action='leave_group' then v_user:=v_uid; end if;
  if v_user=v_group.coach_id and p_action<>'transfer_group' then raise exception 'Le créateur doit transférer son groupe avant de le quitter.'; end if;
  select a.id,a.user_id,m.role into v_aid,v_user,v_target_role from public.training_group_members m join public.athletes a on a.id=m.athlete_id where m.group_id=v_gid and (a.user_id=v_user or (p_action='remove_member' and v_user is null and a.id=nullif(p_data->>'athlete_id','')::uuid));
  if v_user=v_group.coach_id and p_action<>'transfer_group' then raise exception 'Le créateur doit transférer son groupe avant de le quitter.'; end if;
  if v_aid is null then raise exception 'Membre inaccessible.'; end if;
  if p_action='set_role' then
   if v_role<>'owner' then raise exception 'Seul le créateur peut nommer un admin.' using errcode='42501'; end if;
   v_new_role:=p_data->>'role';
   if v_new_role is null or v_new_role not in ('admin','member') then raise exception 'Rôle invalide.'; end if;
   update public.training_group_members set role=v_new_role where group_id=v_gid and athlete_id=v_aid;
  elsif p_action='transfer_group' then
   if v_role<>'owner' then raise exception 'Seul le créateur peut transférer le groupe.' using errcode='42501'; end if;
   if v_user=v_uid then raise exception 'Choisis un autre membre.'; end if;
   update public.training_group_members m set accepted_group_access=true where m.group_id=v_gid and app_private.community_delivery_allowed(v_gid,m.athlete_id,'add') and app_private.community_delivery_allowed(v_gid,m.athlete_id,'edit');
   update public.training_groups set coach_id=v_user where id=v_gid;
   update public.training_group_members set role='admin' where group_id=v_gid and athlete_id=v_aid;
   insert into public.training_group_members(group_id,athlete_id,role,accepted_group_access) select v_gid,id,'admin',true from public.athletes where user_id=v_uid on conflict(group_id,athlete_id) do update set role='admin';
  else
   if p_action='remove_member' and not(v_role='owner' or (v_role='admin' and v_target_role='member')) then raise exception 'Seul le créateur peut retirer un admin.' using errcode='42501'; end if;
   perform app_private.community_remove_assignments(v_gid,v_aid);
   delete from public.training_group_members where group_id=v_gid and athlete_id=v_aid;
   perform app_private.community_refresh_group(v_gid);
  end if;
  update public.training_groups set updated_at=now() where id=v_gid;
  return jsonb_build_object('id',v_gid);
 elsif p_action='delete_group' then
  if v_role<>'owner' then raise exception 'Seul le créateur peut supprimer le groupe.' using errcode='42501'; end if;
  select array_agg(session_id) into v_sids from public.shared_session_groups where group_id=v_gid;
  select array_agg(event_id) into v_eids from public.shared_event_groups where group_id=v_gid;
  perform app_private.community_remove_assignments(v_gid);
  delete from public.training_groups where id=v_gid;
  foreach v_sid in array coalesce(v_sids,'{}') loop perform app_private.sync_shared_session(v_sid); end loop;
  foreach v_sid in array coalesce(v_eids,'{}') loop perform app_private.sync_shared_event(v_sid); end loop;
  return jsonb_build_object('id',v_gid);
 elsif p_action='create_post' then
  insert into public.group_posts(group_id,author_id,kind,content) values(v_gid,v_uid,coalesce(p_data->>'kind','message'),trim(p_data->>'content')) returning id into v_id;
 elsif p_action='support_post' then
  if v_post.kind<>'suggestion' then raise exception 'Seules les suggestions peuvent recevoir des appuis.'; end if;
  delete from public.group_post_supports where post_id=v_id and user_id=v_uid;
  if not found then insert into public.group_post_supports(post_id,user_id) values(v_id,v_uid); end if;
 elsif p_action='comment_post' then
  insert into public.group_comments(post_id,author_id,content) values(v_id,v_uid,trim(p_data->>'content')) returning id into v_id;
 elsif p_action='delete_post' then
  if v_post.author_id is distinct from v_uid and v_role not in ('owner','admin') then raise exception 'Publication inaccessible.' using errcode='42501'; end if;
  delete from public.group_posts where id=v_id;
 elsif p_action in ('pin_post','status_post') then
  if v_role not in ('owner','admin') then raise exception 'Administration du groupe requise.' using errcode='42501'; end if;
  if p_action='pin_post' then update public.group_posts set pinned=not pinned,updated_at=now() where id=v_id;
  else
   if v_post.kind<>'suggestion' then raise exception 'Choisis une suggestion.'; end if;
   update public.group_posts set status=p_data->>'status',updated_at=now() where id=v_id;
  end if;
 elsif p_action='create_poll' then
  if v_role not in ('owner','admin') then raise exception 'Administration du groupe requise.' using errcode='42501'; end if;
  v_options:=p_data->'options';
  if jsonb_typeof(v_options) is distinct from 'array' then raise exception 'Ajoute de deux à dix choix.'; end if;
  if jsonb_array_length(v_options) not between 2 and 10 or exists(select 1 from jsonb_array_elements(v_options) x where jsonb_typeof(x)<>'string') then raise exception 'Ajoute de deux à dix choix.'; end if;
  if (select count(distinct lower(trim(value))) from jsonb_array_elements_text(v_options))<>jsonb_array_length(v_options) then raise exception 'Les choix doivent être différents.'; end if;
  if nullif(p_data->>'closes_at','')::timestamptz<=now() then raise exception 'Choisis une date de fin future.'; end if;
  insert into public.group_polls(group_id,author_id,question,closes_at) values(v_gid,v_uid,trim(p_data->>'question'),nullif(p_data->>'closes_at','')::timestamptz) returning id into v_id;
  for v_option in select value from jsonb_array_elements_text(v_options) loop
   v_position:=v_position+1; insert into public.group_poll_options(poll_id,label,position) values(v_id,trim(v_option),v_position);
  end loop;
 elsif p_action='vote' then
  if v_poll.closed_at is not null or v_poll.closes_at<=now() then raise exception 'Ce sondage est terminé.'; end if;
  if not exists(select 1 from public.group_poll_options where id=(p_data->>'option_id')::uuid and poll_id=v_id) then raise exception 'Choix invalide.'; end if;
  insert into public.group_poll_votes(poll_id,user_id,option_id) values(v_id,v_uid,(p_data->>'option_id')::uuid) on conflict(poll_id,user_id) do update set option_id=excluded.option_id;
 elsif p_action='close_poll' then
  if v_role not in ('owner','admin') then raise exception 'Administration du groupe requise.' using errcode='42501'; end if;
  update public.group_polls set closed_at=coalesce(closed_at,now()) where id=v_id;
 else raise exception 'Action inconnue.';
 end if;
 return jsonb_build_object('id',v_id);
end;
$$;
revoke all on function app_private.community_refresh_group(uuid),app_private.community_detail(uuid),app_private.community_command(text,jsonb) from public,anon,authenticated;
grant execute on function app_private.community_command(text,jsonb) to authenticated;
create function public.community_command(p_action text,p_data jsonb default '{}')
returns jsonb language sql security invoker set search_path='' as $$select app_private.community_command(p_action,p_data);$$;
revoke all on function public.community_command(text,jsonb) from public,anon,authenticated;
grant execute on function public.community_command(text,jsonb) to authenticated;

-- Group administrators can change the common lock through the guarded master API.
-- Direct recipient-copy edits remain blocked by restrictive RLS and column grants.
create or replace function public.protect_calendar_lock()
returns trigger language plpgsql set search_path='' as $$
declare v_shared_allowed boolean:=false;
begin
 if auth.uid() is not null and auth.role()='authenticated' then
  if new.created_by is distinct from old.created_by or new.athlete_id is distinct from old.athlete_id or new.author_name is distinct from old.author_name then
   raise exception 'Identité de la séance immuable.' using errcode='42501';
  end if;
  if new.is_locked is distinct from old.is_locked and old.created_by is distinct from auth.uid() then
   if tg_table_name='training_sessions' then
    v_shared_allowed:=old.shared_session_id is not null and app_private.community_shared_access(old.shared_session_id);
   elsif tg_table_name='personal_events' then
    v_shared_allowed:=old.shared_event_id is not null and app_private.community_shared_access(old.shared_event_id,true);
   end if;
   if not v_shared_allowed then raise exception 'Seul le créateur peut verrouiller ou déverrouiller cette séance.' using errcode='42501'; end if;
  end if;
 end if;
 return new;
end;
$$;

-- Read permission is intentionally distinct from write permission: an admin of
-- group A can see a plan shared to A+B, but cannot overwrite B's common content.
create function app_private.community_shared_readable(p_id uuid,p_event boolean default false)
returns boolean language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null then return false; end if;
 if p_event then
  return exists(select 1 from public.shared_event_groups g where g.event_id=p_id and app_private.community_manages(g.group_id))
   or (exists(select 1 from public.shared_calendar_events s where s.id=p_id and s.created_by=auth.uid()) and not exists(select 1 from public.shared_event_groups where event_id=p_id));
 end if;
 return exists(select 1 from public.shared_session_groups g where g.session_id=p_id and app_private.community_manages(g.group_id))
  or (exists(select 1 from public.shared_training_sessions s where s.id=p_id and s.created_by=auth.uid()) and not exists(select 1 from public.shared_session_groups where session_id=p_id));
end;
$$;
revoke all on function app_private.community_shared_readable(uuid,boolean) from public,anon,authenticated;
grant execute on function app_private.community_shared_readable(uuid,boolean) to authenticated;
drop policy shared_owner_read on public.shared_training_sessions;
drop policy shared_groups_owner_read on public.shared_session_groups;
drop policy shared_athletes_owner_read on public.shared_session_athletes;
drop policy shared_event_owner_read on public.shared_calendar_events;
drop policy shared_event_groups_owner_read on public.shared_event_groups;
drop policy shared_event_athletes_owner_read on public.shared_event_athletes;
alter policy community_admin_sessions_read on public.shared_training_sessions using(app_private.community_shared_readable(id));
alter policy community_admin_session_groups_read on public.shared_session_groups using(app_private.community_shared_readable(session_id));
alter policy community_admin_session_athletes_read on public.shared_session_athletes using(app_private.community_shared_readable(session_id) and (public.owns_athlete(athlete_id) or public.coach_has_permission(athlete_id,'calendar')));
alter policy community_admin_events_read on public.shared_calendar_events using(app_private.community_shared_readable(id,true));
alter policy community_admin_event_groups_read on public.shared_event_groups using(app_private.community_shared_readable(event_id,true));
alter policy community_admin_event_athletes_read on public.shared_event_athletes using(app_private.community_shared_readable(event_id,true) and (public.owns_athlete(athlete_id) or public.coach_has_permission(athlete_id,'calendar')));

-- Read common group content without exposing another group's roster or direct
-- personal targets. can_manage is evaluated on all actual destinations server-side.
alter function app_private.community_command(text,jsonb) rename to community_content_command;
revoke all on function app_private.community_content_command(text,jsonb) from public,anon,authenticated;
create function app_private.community_command(p_action text,p_data jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_gid uuid:=nullif(p_data->>'group_id','')::uuid; v_from date:=nullif(p_data->>'from','')::date; v_to date:=nullif(p_data->>'to','')::date;
begin
 if p_action<>'group_calendar' then return app_private.community_content_command(p_action,p_data); end if;
 if auth.uid() is null or not app_private.community_manages(v_gid) then raise exception 'Calendrier de groupe inaccessible.' using errcode='42501'; end if;
 if v_from is null or v_to is null or v_to<v_from or v_to-v_from>370 then raise exception 'Période du calendrier invalide.'; end if;
 return jsonb_build_object('sessions',coalesce((select jsonb_agg(app_private.shared_session_json(s.id)||jsonb_build_object('can_manage',app_private.community_shared_access(s.id),'athlete_ids',case when app_private.community_shared_access(s.id) then (app_private.shared_session_json(s.id)->'athlete_ids') else '[]'::jsonb end) order by s.date,s.sort_order,s.id)
  from public.shared_training_sessions s join public.shared_session_groups g on g.session_id=s.id where g.group_id=v_gid and s.date between v_from and v_to),'[]'::jsonb),
 'events',coalesce((select jsonb_agg(app_private.shared_event_json(e.id)||jsonb_build_object('can_manage',app_private.community_shared_access(e.id,true),'athlete_ids',case when app_private.community_shared_access(e.id,true) then (app_private.shared_event_json(e.id)->'athlete_ids') else '[]'::jsonb end) order by e.date,e.sort_order,e.id)
  from public.shared_calendar_events e join public.shared_event_groups g on g.event_id=e.id where g.group_id=v_gid and e.date<=v_to and coalesce(e.end_date,e.date)>=v_from),'[]'::jsonb),'feedback','[]'::jsonb);
end;
$$;
revoke all on function app_private.community_command(text,jsonb) from public,anon,authenticated;
grant execute on function app_private.community_command(text,jsonb) to authenticated;
-- Rebind the SQL wrapper after renaming its implementation.
create or replace function public.community_command(p_action text,p_data jsonb default '{}')
returns jsonb language sql security invoker set search_path='' as $$select app_private.community_command(p_action,p_data);$$;

-- Historical roster memberships continue to honor the owner's accepted coaching
-- permissions. Delegating group administration grants access to shared content,
-- never to those members' private calendars or feedback.
create function app_private.community_delivery_allowed(p_group uuid,p_athlete uuid,p_permission text)
returns boolean language sql stable set search_path='' as $$
 select exists(select 1 from public.training_groups g join public.training_group_members m on m.group_id=g.id
 join public.athletes a on a.id=m.athlete_id left join public.coach_athletes r on r.coach_id=g.coach_id and r.athlete_id=a.id
 where g.id=p_group and a.id=p_athlete and (m.accepted_group_access or a.user_id=g.coach_id
 or (a.user_id is not null and r.status='accepted' and r.can_view_calendar and case p_permission when 'add' then r.can_add_sessions when 'edit' then r.can_edit_own_sessions else false end)));
$$;
create function app_private.community_remove_assignments(p_group uuid,p_athlete uuid default null)
returns void language plpgsql set search_path='' as $$
begin
 -- Compute the disappearing source while membership still exists. Other sources
 -- and personal history always win over removal from this particular group.
 delete from public.training_sessions s using public.shared_session_groups sg
 where sg.group_id=p_group and sg.session_id=s.shared_session_id and (p_athlete is null or s.athlete_id=p_athlete)
 and app_private.community_delivery_allowed(p_group,s.athlete_id,'edit') and s.date>=current_date and s.completed_at is null
 and not exists(select 1 from public.session_feedback f where f.session_id=s.id)
 and not exists(select 1 from public.shared_session_athletes a where a.session_id=s.shared_session_id and a.athlete_id=s.athlete_id)
 and not exists(select 1 from public.shared_session_groups g join public.training_group_members m on m.group_id=g.group_id where g.session_id=s.shared_session_id and g.group_id<>p_group and m.athlete_id=s.athlete_id);
 delete from public.personal_events e using public.shared_event_groups eg
 where eg.group_id=p_group and eg.event_id=e.shared_event_id and (p_athlete is null or e.athlete_id=p_athlete)
 and app_private.community_delivery_allowed(p_group,e.athlete_id,'edit') and e.date>=current_date
 and not exists(select 1 from public.shared_event_athletes a where a.event_id=e.shared_event_id and a.athlete_id=e.athlete_id)
 and not exists(select 1 from public.shared_event_groups g join public.training_group_members m on m.group_id=g.group_id where g.event_id=e.shared_event_id and g.group_id<>p_group and m.athlete_id=e.athlete_id);
end;
$$;
revoke all on function app_private.community_delivery_allowed(uuid,uuid,text),app_private.community_remove_assignments(uuid,uuid) from public,anon,authenticated;
