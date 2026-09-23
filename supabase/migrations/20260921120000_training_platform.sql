-- Additive upgrade: existing accounts, gyms, contacts and athlete UUIDs are retained.
-- Private roster fields move into each coach's relation; old columns are retained
-- for backup compatibility but cannot be read or written by browser roles.

alter table public.profiles add column account_type text not null default 'coach'
  check (account_type in ('coach', 'athlete'));
comment on table public.profiles is 'Compte authentifié; le rôle et is_admin sont administrés côté serveur.';

create table public.coach_profiles (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  display_name text not null default '',
  join_code text not null unique default replace(gen_random_uuid()::text, '-', ''),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
insert into public.coach_profiles(user_id, display_name)
select id, coalesce(full_name, '') from public.profiles;

alter table public.athletes drop constraint athletes_coach_id_fkey;
alter table public.athletes alter column coach_id drop not null;
alter table public.athletes add constraint athletes_coach_id_fkey
  foreign key (coach_id) references public.profiles(id) on delete set null;
alter table public.athletes add column user_id uuid unique references public.profiles(id) on delete set null;
alter table public.athletes add column onboarding_stub boolean not null default false;

create table public.coach_athletes (
  coach_id uuid not null references public.coach_profiles(user_id) on delete cascade,
  athlete_id uuid not null references public.athletes(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','accepted','revoked')),
  can_view_calendar boolean not null default true,
  can_add_sessions boolean not null default true,
  can_edit_own_sessions boolean not null default true,
  can_view_feedback boolean not null default true,
  private_notes text not null default '',
  selected boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (coach_id, athlete_id)
);
create index coach_athletes_athlete_idx on public.coach_athletes(athlete_id, status);
insert into public.coach_athletes(coach_id, athlete_id, status, private_notes, selected)
select coach_id, id, 'accepted', coalesce(notes, ''), selected from public.athletes where coach_id is not null;

-- Database validation mirrors the shared session editor, including nested repeats.
create function public.valid_training_blocks(p_blocks jsonb, p_depth integer default 0)
returns boolean language plpgsql immutable set search_path = '' as $$
declare b jsonb; k text; n numeric; v_nodes bigint; v_expanded numeric;
begin
  if p_blocks is null or jsonb_typeof(p_blocks) <> 'array' then return false; end if;
  if p_depth > 3 and jsonb_array_length(p_blocks)>0 then return false; end if;
  if jsonb_array_length(p_blocks) > 100 or octet_length(p_blocks::text) > 200000 then return false; end if;
  for b in select value from jsonb_array_elements(p_blocks) loop
    if jsonb_typeof(b) <> 'object' or coalesce(b->>'kind','') not in ('step','repeat') then return false; end if;
    if char_length(coalesce(b->>'title','')) > 500 or char_length(coalesce(b->>'description','')) > 10000
      or char_length(coalesce(b->>'notes','')) > 10000 then return false; end if;
    foreach k in array array['duration_seconds','distance_m','repetitions','rounds','work_seconds','rest_seconds','zone','repeat_count'] loop
      if b ? k and b->k <> 'null'::jsonb then
        if jsonb_typeof(b->k) <> 'number' then return false; end if;
        n := (b->>k)::numeric;
        if n < 0 or n > 1000000 then return false; end if;
        if k in ('repetitions','rounds','zone','repeat_count') and n <> trunc(n) then return false; end if;
        if k in ('repetitions','rounds') and (n < 1 or n > 10000) then return false; end if;
        if k = 'zone' and (n < 1 or n > 7) then return false; end if;
        if k = 'repeat_count' and (n < 1 or n > 100) then return false; end if;
      end if;
    end loop;
    if b->>'kind' = 'repeat' and (not (b ? 'repeat_count') or b->'repeat_count' = 'null'::jsonb) then return false; end if;
    if b ? 'intensity' and b->'intensity' <> 'null'::jsonb and b->>'intensity' not in ('easy','moderate','hard','max') then return false; end if;
    if b ? 'children' then
      if not public.valid_training_blocks(b->'children',p_depth+1) then return false; end if;
      if b->>'kind' = 'step' and jsonb_array_length(b->'children') > 0 then return false; end if;
      if b->>'kind' = 'repeat' and jsonb_array_length(b->'children') = 0 then return false; end if;
    elsif b->>'kind' = 'repeat' then return false;
    end if;
  end loop;
  if p_depth=0 then
    with recursive tree(block,multiplier) as (
      select value,1::numeric from jsonb_array_elements(p_blocks)
      union all
      select child.value,tree.multiplier*case when tree.block->>'kind'='repeat' then (tree.block->>'repeat_count')::numeric else 1 end
      from tree cross join lateral jsonb_array_elements(coalesce(tree.block->'children','[]'::jsonb)) child
    ) select count(*),coalesce(sum(case when block->>'kind'='step' then multiplier else 0 end),0)
      into v_nodes,v_expanded from tree;
    if v_nodes>200 or v_expanded>10000 then return false; end if;
  end if;
  return true;
exception when others then return false;
end;
$$;

create table public.training_sessions (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references public.athletes(id) on delete cascade,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  author_name text not null default '',
  title text not null check (char_length(title) between 1 and 200),
  sport text not null default 'other' check (char_length(sport) between 1 and 50),
  date date not null,
  sort_order numeric not null default 1024 check (sort_order > '-1e20'::numeric and sort_order < '1e20'::numeric),
  description text not null default '' check (char_length(description) <= 20000),
  notes text not null default '' check (char_length(notes) <= 20000),
  blocks jsonb not null default '[]'::jsonb check (public.valid_training_blocks(blocks)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index training_sessions_calendar_idx on public.training_sessions(athlete_id,date,sort_order);

create table public.personal_events (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references public.athletes(id) on delete cascade,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  title text not null check (char_length(title) between 1 and 200),
  category text not null default 'other' check (char_length(category) between 1 and 50),
  date date not null,
  end_date date check (end_date is null or end_date >= date),
  notes text not null default '' check (char_length(notes) <= 20000),
  sort_order numeric not null default 1024 check (sort_order > '-1e20'::numeric and sort_order < '1e20'::numeric),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index personal_events_calendar_idx on public.personal_events(athlete_id,date);

create table public.session_feedback (
  session_id uuid primary key references public.training_sessions(id) on delete cascade,
  athlete_id uuid not null references public.athletes(id) on delete cascade,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  rpe integer check (rpe between 1 and 10),
  feeling integer check (feeling between 1 and 5),
  comment text not null default '' check (char_length(comment) <= 20000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index session_feedback_athlete_idx on public.session_feedback(athlete_id);

create table public.session_templates (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references public.coach_profiles(user_id) on delete cascade default auth.uid(),
  title text not null check (char_length(title) between 1 and 200),
  sport text not null default 'other' check (char_length(sport) between 1 and 50),
  description text not null default '' check (char_length(description) <= 20000),
  notes text not null default '' check (char_length(notes) <= 20000),
  blocks jsonb not null default '[]'::jsonb check (public.valid_training_blocks(blocks)),
  kind text not null default 'session' check (kind in ('session','block')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.athlete_invitations (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references public.athletes(id) on delete cascade,
  coach_id uuid not null references public.coach_profiles(user_id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null default (now() + interval '7 days'),
  accepted_at timestamptz,
  accepted_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create function public.owns_athlete(p_athlete_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.athletes where id=p_athlete_id and user_id=auth.uid());
$$;
create function public.coach_has_permission(p_athlete_id uuid, p_permission text default 'roster')
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.coach_athletes where athlete_id=p_athlete_id and coach_id=auth.uid()
    and status='accepted' and case p_permission
      when 'roster' then true when 'calendar' then can_view_calendar
      when 'add' then can_view_calendar and can_add_sessions
      when 'edit' then can_view_calendar and can_edit_own_sessions
      when 'feedback' then can_view_calendar and can_view_feedback else false end);
$$;

-- Limit updates at the column level as well as with RLS: profiles.is_admin is NEVER browser-writable.
revoke all on public.profiles, public.athletes from public, anon, authenticated;
grant select on public.profiles to authenticated;
grant update(full_name,phone) on public.profiles to authenticated;
grant select(id,coach_id,user_id,first_name,last_name,birth_date,weight_class,phone,email,is_active,
  created_at,updated_at,sex,status,weight_kg,fights,wins,losses) on public.athletes to authenticated;
grant update(first_name,last_name,birth_date,weight_class,phone,email,sex,status,weight_kg,fights,wins,losses) on public.athletes to authenticated;
grant insert(coach_id,first_name,last_name,birth_date,weight_class,phone,email,sex,status,weight_kg,fights,wins,losses) on public.athletes to authenticated;

drop policy "Coaches can view their own athletes" on public.athletes;
drop policy "Coaches can create their own athletes" on public.athletes;
drop policy "Coaches can update their own athletes" on public.athletes;
drop policy "Coaches can delete their own athletes" on public.athletes;
create policy athletes_read on public.athletes for select to authenticated using (
  user_id=auth.uid() or public.coach_has_permission(id,'roster') or exists(
    select 1 from public.coach_athletes ca where ca.athlete_id=id and ca.coach_id=auth.uid() and ca.status='pending'
  )
);
create policy athletes_insert on public.athletes for insert to authenticated with check (
  coach_id=auth.uid() and user_id is null and exists(select 1 from public.coach_profiles where user_id=auth.uid())
);
create policy athletes_update on public.athletes for update to authenticated
  using (user_id=auth.uid() or public.coach_has_permission(id,'roster'))
  with check (user_id=auth.uid() or public.coach_has_permission(id,'roster'));

alter table public.coach_profiles enable row level security;
alter table public.coach_athletes enable row level security;
alter table public.training_sessions enable row level security;
alter table public.personal_events enable row level security;
alter table public.session_feedback enable row level security;
alter table public.session_templates enable row level security;
alter table public.athlete_invitations enable row level security;

revoke all on public.coach_profiles,public.coach_athletes,public.training_sessions,public.personal_events,
  public.session_feedback,public.session_templates,public.athlete_invitations from public,anon,authenticated;
grant select on public.coach_profiles,public.coach_athletes to authenticated;
grant update(display_name) on public.coach_profiles to authenticated;
grant update(private_notes,selected) on public.coach_athletes to authenticated;
grant select,delete on public.training_sessions,public.personal_events,public.session_feedback,public.session_templates to authenticated;
grant insert(id,athlete_id,created_by,title,sport,date,sort_order,description,notes,blocks) on public.training_sessions to authenticated;
grant insert(id,athlete_id,created_by,title,category,date,end_date,notes,sort_order) on public.personal_events to authenticated;
grant insert(session_id,athlete_id,created_by,rpe,feeling,comment) on public.session_feedback to authenticated;
grant insert(id,coach_id,title,sport,description,notes,blocks,kind) on public.session_templates to authenticated;
grant update(title,sport,date,sort_order,description,notes,blocks) on public.training_sessions to authenticated;
grant update(title,category,date,end_date,notes,sort_order) on public.personal_events to authenticated;
grant update(rpe,feeling,comment) on public.session_feedback to authenticated;
grant update(title,sport,description,notes,blocks,kind) on public.session_templates to authenticated;
grant all on public.coach_profiles,public.coach_athletes,public.training_sessions,public.personal_events,
  public.session_feedback,public.session_templates,public.athlete_invitations to service_role;

create policy coach_profiles_own on public.coach_profiles for select to authenticated using(user_id=auth.uid());
create policy coach_profiles_update on public.coach_profiles for update to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
create policy coach_relation_own on public.coach_athletes for select to authenticated using(coach_id=auth.uid());
create policy coach_relation_private on public.coach_athletes for update to authenticated using(coach_id=auth.uid() and status='accepted') with check(coach_id=auth.uid() and status='accepted');
create policy session_read on public.training_sessions for select to authenticated using(public.owns_athlete(athlete_id) or public.coach_has_permission(athlete_id,'calendar'));
create policy session_insert on public.training_sessions for insert to authenticated with check(created_by=auth.uid() and public.coach_has_permission(athlete_id,'add'));
create policy session_update on public.training_sessions for update to authenticated using(created_by=auth.uid() and public.coach_has_permission(athlete_id,'edit')) with check(created_by=auth.uid() and public.coach_has_permission(athlete_id,'edit'));
create policy session_delete on public.training_sessions for delete to authenticated using(created_by=auth.uid() and public.coach_has_permission(athlete_id,'edit'));
create policy event_read on public.personal_events for select to authenticated using(public.owns_athlete(athlete_id) or public.coach_has_permission(athlete_id,'calendar'));
create policy event_insert on public.personal_events for insert to authenticated with check(created_by=auth.uid() and public.owns_athlete(athlete_id));
create policy event_update on public.personal_events for update to authenticated using(created_by=auth.uid() and public.owns_athlete(athlete_id)) with check(created_by=auth.uid() and public.owns_athlete(athlete_id));
create policy event_delete on public.personal_events for delete to authenticated using(created_by=auth.uid() and public.owns_athlete(athlete_id));
create policy feedback_read on public.session_feedback for select to authenticated using(public.owns_athlete(athlete_id) or public.coach_has_permission(athlete_id,'feedback'));
create policy feedback_insert on public.session_feedback for insert to authenticated with check(created_by=auth.uid() and public.owns_athlete(athlete_id) and exists(select 1 from public.training_sessions s where s.id=session_id and s.athlete_id=session_feedback.athlete_id));
create policy feedback_update on public.session_feedback for update to authenticated using(created_by=auth.uid() and public.owns_athlete(athlete_id)) with check(created_by=auth.uid() and public.owns_athlete(athlete_id));
create policy feedback_delete on public.session_feedback for delete to authenticated using(created_by=auth.uid() and public.owns_athlete(athlete_id));
create policy template_own on public.session_templates for all to authenticated using(coach_id=auth.uid()) with check(coach_id=auth.uid() and exists(select 1 from public.coach_profiles where user_id=auth.uid()));

create function public.stamp_training_author()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  select coalesce(nullif(cp.display_name,''),p.full_name,'Coach') into new.author_name
    from public.profiles p left join public.coach_profiles cp on cp.user_id=p.id where p.id=new.created_by;
  new.author_name := coalesce(new.author_name,'Coach');
  return new;
end;
$$;
create trigger training_session_author before insert on public.training_sessions for each row execute function public.stamp_training_author();

-- Legacy safe-column inserts still create the many-to-many relation atomically.
create function public.link_new_roster_athlete()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.coach_id is not null then
    insert into public.coach_athletes(coach_id,athlete_id,status) values(new.coach_id,new.id,'accepted') on conflict do nothing;
  end if;
  return new;
end;
$$;
create trigger athlete_link_coach after insert on public.athletes for each row execute function public.link_new_roster_athlete();
create function public.mark_athlete_profile_used()
returns trigger language plpgsql set search_path='' as $$
begin
  if row(new.first_name,new.last_name,new.birth_date,new.phone,new.email,new.weight_class,new.weight_kg,new.sex,new.status,new.fights,new.wins,new.losses)
    is distinct from row(old.first_name,old.last_name,old.birth_date,old.phone,old.email,old.weight_class,old.weight_kg,old.sex,old.status,old.fights,old.wins,old.losses)
  then new.onboarding_stub=false; end if;
  return new;
end;
$$;
create trigger athlete_profile_used before update on public.athletes for each row execute function public.mark_athlete_profile_used();

create function public.sync_coach_display_name()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  update public.coach_profiles set display_name=coalesce(new.full_name,'') where user_id=new.id;
  return new;
end;
$$;
create trigger profile_coach_display_name after update of full_name on public.profiles for each row execute function public.sync_coach_display_name();

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_role text := case when new.raw_user_meta_data->>'account_type'='athlete' then 'athlete' else 'coach' end;
begin
  insert into public.profiles(id,full_name,account_type,is_admin)
    values(new.id,left(new.raw_user_meta_data->>'full_name',200),v_role,false);
  if v_role='coach' then
    insert into public.coach_profiles(user_id,display_name) values(new.id,coalesce(left(new.raw_user_meta_data->>'full_name',200),''));
    insert into public.gym_settings(coach_id,gym_name,address)
      values(new.id,coalesce(nullif(left(new.raw_user_meta_data->>'gym_name',200),''),'Mon gym'),left(new.raw_user_meta_data->>'gym_address',500));
  else
    insert into public.athletes(user_id,first_name,last_name,onboarding_stub)
      values(new.id,coalesce(nullif(left(new.raw_user_meta_data->>'full_name',200),''),'Athlète'),'',true);
  end if;
  return new;
end;
$$;

create function public.create_roster_athlete(p_data jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid;
begin
  if auth.uid() is null or not exists(select 1 from public.coach_profiles where user_id=auth.uid()) then raise exception 'Compte coach requis.' using errcode='42501'; end if;
  if jsonb_typeof(p_data)<>'object' or coalesce(length(trim(p_data->>'first_name')),0) not between 1 and 200 or length(coalesce(p_data->>'last_name',''))>200 then raise exception 'Prénom requis (200 caractères maximum).'; end if;
  insert into public.athletes(coach_id,first_name,last_name,birth_date,sex,weight_kg,fights,wins,losses,status,phone,email)
  values(auth.uid(),trim(p_data->>'first_name'),trim(coalesce(p_data->>'last_name','')),nullif(p_data->>'birth_date','')::date,
    nullif(p_data->>'sex',''),nullif(p_data->>'weight_kg','')::numeric,coalesce((p_data->>'fights')::integer,0),
    nullif(p_data->>'wins','')::integer,nullif(p_data->>'losses','')::integer,coalesce(nullif(p_data->>'status',''),'available'),p_data->>'phone',p_data->>'email') returning id into v_id;
  update public.coach_athletes set private_notes=left(coalesce(p_data->>'private_notes',''),20000),selected=coalesce((p_data->>'selected')::boolean,false)
    where athlete_id=v_id and coach_id=auth.uid();
  return v_id;
end;
$$;

create function public.update_roster_athlete(p_athlete_id uuid,p_data jsonb)
returns void language plpgsql security definer set search_path='' as $$
begin
  if not public.coach_has_permission(p_athlete_id,'roster') then raise exception 'Accès au roster refusé.' using errcode='42501'; end if;
  if jsonb_typeof(p_data)<>'object' or (p_data ? 'first_name' and coalesce(length(trim(p_data->>'first_name')),0) not between 1 and 200) or length(coalesce(p_data->>'last_name',''))>200 then raise exception 'Nom invalide.'; end if;
  update public.athletes set
    first_name=case when p_data?'first_name' then trim(p_data->>'first_name') else first_name end,
    last_name=case when p_data?'last_name' then trim(coalesce(p_data->>'last_name','')) else last_name end,
    birth_date=case when p_data?'birth_date' then nullif(p_data->>'birth_date','')::date else birth_date end,
    sex=case when p_data?'sex' then nullif(p_data->>'sex','') else sex end,
    weight_kg=case when p_data?'weight_kg' then nullif(p_data->>'weight_kg','')::numeric else weight_kg end,
    fights=case when p_data?'fights' then coalesce((p_data->>'fights')::integer,0) else fights end,
    wins=case when p_data?'wins' then nullif(p_data->>'wins','')::integer else wins end,
    losses=case when p_data?'losses' then nullif(p_data->>'losses','')::integer else losses end,
    status=case when p_data?'status' then p_data->>'status' else status end,
    phone=case when p_data?'phone' then p_data->>'phone' else phone end,
    email=case when p_data?'email' then p_data->>'email' else email end
  where id=p_athlete_id;
  update public.coach_athletes set
    private_notes=case when p_data?'private_notes' then left(coalesce(p_data->>'private_notes',''),20000) else private_notes end,
    selected=case when p_data?'selected' then coalesce((p_data->>'selected')::boolean,false) else selected end
  where athlete_id=p_athlete_id and coach_id=auth.uid();
end;
$$;

create function public.archive_roster_athlete(p_athlete_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  if not public.coach_has_permission(p_athlete_id,'roster') then raise exception 'Accès au roster refusé.' using errcode='42501'; end if;
  update public.coach_athletes set status='revoked',selected=false where athlete_id=p_athlete_id and coach_id=auth.uid();
  delete from public.athlete_invitations where athlete_id=p_athlete_id and coach_id=auth.uid() and accepted_at is null;
end;
$$;

create function public.create_invitation(p_athlete_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_token text := replace(gen_random_uuid()::text||gen_random_uuid()::text,'-',''); v_expires timestamptz := now()+interval '7 days';
begin
  if not public.coach_has_permission(p_athlete_id,'roster') then raise exception 'Accès au roster refusé.' using errcode='42501'; end if;
  perform 1 from public.athletes where id=p_athlete_id and user_id is null for update;
  if not found then raise exception 'Cet athlète possède déjà un compte lié.'; end if;
  delete from public.athlete_invitations where athlete_id=p_athlete_id and coach_id=auth.uid() and accepted_at is null;
  insert into public.athlete_invitations(athlete_id,coach_id,token_hash,expires_at)
    values(p_athlete_id,auth.uid(),encode(sha256(convert_to(v_token,'UTF8')),'hex'),v_expires);
  return jsonb_build_object('token',v_token,'expires_at',v_expires);
end;
$$;

create function public.accept_invitation(p_token text)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_inv public.athlete_invitations%rowtype; v_target public.athletes%rowtype; v_old public.athletes%rowtype;
begin
  if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid() and account_type='athlete') then raise exception 'Connecte-toi avec un compte athlète.' using errcode='42501'; end if;
  if length(p_token)<>64 then raise exception 'Invitation invalide ou expirée.'; end if;
  select * into v_inv from public.athlete_invitations where token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex') for update;
  if not found or v_inv.accepted_at is not null or v_inv.expires_at<=now() then raise exception 'Invitation invalide ou expirée.'; end if;
  if not exists(select 1 from public.coach_athletes where athlete_id=v_inv.athlete_id and coach_id=v_inv.coach_id and status='accepted') then raise exception 'Invitation révoquée.'; end if;
  select * into v_target from public.athletes where id=v_inv.athlete_id for update;
  if v_target.user_id is not null and v_target.user_id<>auth.uid() then raise exception 'Ce profil est déjà lié à un autre compte.'; end if;
  select * into v_old from public.athletes where user_id=auth.uid() for update;
  if found and v_old.id<>v_target.id then
    if not v_old.onboarding_stub or exists(select 1 from public.coach_athletes where athlete_id=v_old.id)
      or exists(select 1 from public.training_sessions where athlete_id=v_old.id)
      or exists(select 1 from public.personal_events where athlete_id=v_old.id)
      or exists(select 1 from public.session_feedback where athlete_id=v_old.id)
    then raise exception 'Ton compte possède déjà un profil actif. Utilise le code coach pour connecter ce profil sans perdre ses données.'; end if;
    delete from public.athletes where id=v_old.id;
  end if;
  update public.athletes set user_id=auth.uid(),onboarding_stub=false where id=v_target.id;
  update public.athlete_invitations set accepted_at=now(),accepted_by=auth.uid() where id=v_inv.id;
  return v_target.id;
end;
$$;

create function public.request_coach(p_code text)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_coach uuid; v_athlete uuid;
begin
  if auth.uid() is null then raise exception 'Connexion requise.' using errcode='42501'; end if;
  select id into v_athlete from public.athletes where user_id=auth.uid();
  if not found then raise exception 'Compte athlète requis.' using errcode='42501'; end if;
  select user_id into v_coach from public.coach_profiles where join_code=lower(trim(p_code));
  if not found then raise exception 'Code coach introuvable.'; end if;
  if v_coach=auth.uid() then raise exception 'Impossible de te connecter à toi-même.'; end if;
  insert into public.coach_athletes(coach_id,athlete_id,status) values(v_coach,v_athlete,'pending')
    on conflict(coach_id,athlete_id) do update set status=case when coach_athletes.status='accepted' then 'accepted' else 'pending' end;
  update public.athletes set onboarding_stub=false where id=v_athlete;
  return v_coach;
end;
$$;

create function public.respond_coach_request(p_athlete_id uuid,p_accept boolean)
returns void language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'Connexion requise.' using errcode='42501'; end if;
  update public.coach_athletes set status=case when p_accept then 'accepted' else 'revoked' end
    where coach_id=auth.uid() and athlete_id=p_athlete_id and status='pending';
  if not found then raise exception 'Demande introuvable.'; end if;
end;
$$;

create function public.revoke_coach_relation(p_athlete_id uuid,p_coach_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null or (auth.uid()<>p_coach_id and not public.owns_athlete(p_athlete_id)) then raise exception 'Accès refusé.' using errcode='42501'; end if;
  update public.coach_athletes set status='revoked',selected=false where coach_id=p_coach_id and athlete_id=p_athlete_id;
  delete from public.athlete_invitations where coach_id=p_coach_id and athlete_id=p_athlete_id and accepted_at is null;
end;
$$;

create function public.set_coach_permissions(p_athlete_id uuid,p_coach_id uuid,p_can_view_calendar boolean,p_can_add_sessions boolean,p_can_edit_own_sessions boolean,p_can_view_feedback boolean)
returns void language plpgsql security definer set search_path='' as $$
begin
  if not public.owns_athlete(p_athlete_id) then raise exception 'Seul cet athlète peut choisir les permissions.' using errcode='42501'; end if;
  update public.coach_athletes set can_view_calendar=p_can_view_calendar,can_add_sessions=p_can_add_sessions,
    can_edit_own_sessions=p_can_edit_own_sessions,can_view_feedback=p_can_view_feedback
    where athlete_id=p_athlete_id and coach_id=p_coach_id and status='accepted';
  if not found then raise exception 'Relation acceptée introuvable.'; end if;
end;
$$;

create function public.athlete_coaches(p_athlete_id uuid)
returns table(coach_id uuid,display_name text,status text,can_view_calendar boolean,can_add_sessions boolean,can_edit_own_sessions boolean,can_view_feedback boolean)
language plpgsql stable security definer set search_path='' as $$
begin
  if not public.owns_athlete(p_athlete_id) and not public.coach_has_permission(p_athlete_id,'roster') then raise exception 'Accès refusé.' using errcode='42501'; end if;
  return query select ca.coach_id,cp.display_name,ca.status,ca.can_view_calendar,ca.can_add_sessions,ca.can_edit_own_sessions,ca.can_view_feedback
    from public.coach_athletes ca join public.coach_profiles cp on cp.user_id=ca.coach_id
    where ca.athlete_id=p_athlete_id and ca.status in ('pending','accepted') order by cp.display_name;
end;
$$;

create function public.save_session_feedback(p_session_id uuid,p_rpe integer,p_feeling integer,p_comment text default '')
returns void language plpgsql security definer set search_path='' as $$
declare v_athlete uuid;
begin
  select athlete_id into v_athlete from public.training_sessions where id=p_session_id;
  if not found or not public.owns_athlete(v_athlete) then raise exception 'Seul cet athlète peut donner son feedback.' using errcode='42501'; end if;
  insert into public.session_feedback(session_id,athlete_id,created_by,rpe,feeling,comment)
    values(p_session_id,v_athlete,auth.uid(),p_rpe,p_feeling,coalesce(p_comment,''))
    on conflict(session_id) do update set rpe=excluded.rpe,feeling=excluded.feeling,comment=excluded.comment;
end;
$$;

-- Harden inherited SECURITY DEFINER helpers and keep all RPC access explicit.
alter function public.is_admin() set search_path='';
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.profiles where id=auth.uid() and is_admin=true);
$$;
alter function public.set_updated_at() set search_path='';
do $$ declare t text; f record; begin
  foreach t in array array['coach_profiles','coach_athletes','training_sessions','personal_events','session_feedback','session_templates'] loop
    execute format('create trigger %I before update on public.%I for each row execute function public.set_updated_at()',t||'_set_updated_at',t);
  end loop;
  for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname=any(array['valid_training_blocks','owns_athlete','coach_has_permission','stamp_training_author','link_new_roster_athlete','mark_athlete_profile_used','sync_coach_display_name','handle_new_user','create_roster_athlete','update_roster_athlete','archive_roster_athlete','create_invitation','accept_invitation','request_coach','respond_coach_request','revoke_coach_relation','set_coach_permissions','athlete_coaches','save_session_feedback','is_admin','set_updated_at'])
  loop execute format('revoke all on function %s from public, anon, authenticated',f.signature); end loop;
end $$;
grant execute on function public.valid_training_blocks(jsonb,integer), public.owns_athlete(uuid), public.coach_has_permission(uuid,text), public.is_admin() to authenticated,service_role;
grant execute on function public.create_roster_athlete(jsonb),public.update_roster_athlete(uuid,jsonb),public.archive_roster_athlete(uuid),
  public.create_invitation(uuid),public.accept_invitation(text),public.request_coach(text),public.respond_coach_request(uuid,boolean),
  public.revoke_coach_relation(uuid,uuid),public.set_coach_permissions(uuid,uuid,boolean,boolean,boolean,boolean),public.athlete_coaches(uuid),public.save_session_feedback(uuid,integer,integer,text) to authenticated;

-- Existing tables remain RLS-protected and no unauthenticated table access is needed.
revoke all on public.gym_settings,public.coach_contacts from public,anon;
