-- Shared athlete planning, protected identity, and a selectable gym directory.
-- Additive upgrade: retain legacy roster UUIDs, profiles and authored history.

create table public.gyms (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 1 and 200),
  address text not null default '' check (char_length(address) <= 500),
  is_default boolean not null default false,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index gyms_normalized_identity on public.gyms (
  lower(regexp_replace(trim(name),'\s+',' ','g')),
  lower(regexp_replace(trim(address),'\s+',' ','g'))
);
create unique index gyms_single_default on public.gyms(is_default) where is_default;
alter table public.profiles add column gym_id uuid references public.gyms(id) on delete set null;
alter table public.athletes add column gym_id uuid references public.gyms(id) on delete set null;
alter table public.athletes add column weight_unit text not null default 'kg' check (weight_unit in ('kg','lb'));

-- Reuse real local gym records; do not invent an address for Le Crew.
insert into public.gyms(name,address,created_by)
select distinct on (lower(regexp_replace(trim(gym_name),'\s+',' ','g')),lower(regexp_replace(trim(coalesce(address,'')),'\s+',' ','g')))
  regexp_replace(trim(gym_name),'\s+',' ','g'),regexp_replace(trim(coalesce(address,'')),'\s+',' ','g'),coach_id
from public.gym_settings where trim(gym_name) not in ('','Mon gym')
order by lower(regexp_replace(trim(gym_name),'\s+',' ','g')),lower(regexp_replace(trim(coalesce(address,'')),'\s+',' ','g')),created_at;
do $$ declare v_default uuid; begin
  select id into v_default from public.gyms where lower(name) in ('le crew','crew') order by (address <> '') desc,created_at limit 1;
  if v_default is null then insert into public.gyms(name) values('Le Crew') returning id into v_default; end if;
  update public.gyms set is_default=true where id=v_default;
end $$;
update public.profiles p set gym_id=g.id from public.gym_settings s join public.gyms g
  on lower(regexp_replace(trim(s.gym_name),'\s+',' ','g'))=lower(regexp_replace(trim(g.name),'\s+',' ','g'))
  and lower(regexp_replace(trim(coalesce(s.address,'')),'\s+',' ','g'))=lower(regexp_replace(trim(g.address),'\s+',' ','g'))
where p.id=s.coach_id;

alter table public.gyms enable row level security;
revoke all on public.gyms from public,anon,authenticated;
grant select(id,name,address,is_default,created_at) on public.gyms to anon,authenticated;
grant all on public.gyms to service_role;
create policy gyms_directory_read on public.gyms for select to anon,authenticated using(true);
grant select(gym_id,weight_unit) on public.athletes to authenticated;
grant update(gym_id,weight_unit) on public.athletes to authenticated;

create function public.save_gym(p_name text,p_address text)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid; v_name text:=regexp_replace(trim(p_name),'\s+',' ','g'); v_address text:=regexp_replace(trim(p_address),'\s+',' ','g');
begin
  if auth.uid() is null or not (public.is_admin() or exists(select 1 from public.coach_profiles where user_id=auth.uid())) then
    raise exception 'Compte coach ou administrateur requis.' using errcode='42501';
  end if;
  if coalesce(char_length(v_name),0) not between 1 and 200 or coalesce(char_length(v_address),0) not between 1 and 500 then
    raise exception 'Nom et adresse du gym requis (200 et 500 caractères maximum).';
  end if;
  -- A transaction lock also protects the initial Le Crew placeholder from races.
  perform pg_advisory_xact_lock(hashtext(lower(v_name)));
  select id into v_id from public.gyms where lower(name)=lower(v_name) and lower(address)=lower(v_address) limit 1;
  if v_id is null and public.is_admin() then
    update public.gyms set name=v_name,address=v_address where is_default and address='' and lower(name)=lower(v_name) returning id into v_id;
  end if;
  if v_id is null then
    insert into public.gyms(name,address,created_by) values(v_name,v_address,auth.uid())
      on conflict do nothing returning id into v_id;
    if v_id is null then select id into v_id from public.gyms where lower(name)=lower(v_name) and lower(address)=lower(v_address); end if;
  end if;
  if exists(select 1 from public.coach_profiles where user_id=auth.uid()) then
    update public.profiles set gym_id=v_id where id=auth.uid();
    insert into public.gym_settings(coach_id,gym_name,address) values(auth.uid(),v_name,v_address)
      on conflict(coach_id) do update set gym_name=excluded.gym_name,address=excluded.address;
  end if;
  return v_id;
end;
$$;

create function public.admin_save_gym(p_name text,p_address text,p_gym_id uuid default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid; v_name text:=regexp_replace(trim(p_name),'\s+',' ','g'); v_address text:=regexp_replace(trim(p_address),'\s+',' ','g');
begin
  if not public.is_admin() then raise exception 'Accès administrateur requis.' using errcode='42501'; end if;
  if coalesce(char_length(v_name),0) not between 1 and 200 or coalesce(char_length(v_address),0) not between 1 and 500 then
    raise exception 'Nom et adresse du gym requis (200 et 500 caractères maximum).';
  end if;
  perform pg_advisory_xact_lock(hashtext(lower(v_name)));
  if p_gym_id is not null then
    update public.gyms set name=v_name,address=v_address where id=p_gym_id returning id into v_id;
    if v_id is null then raise exception 'Gym introuvable.'; end if;
  else
    insert into public.gyms(name,address,created_by) values(v_name,v_address,auth.uid()) on conflict do nothing returning id into v_id;
    if v_id is null then select id into v_id from public.gyms where lower(name)=lower(v_name) and lower(address)=lower(v_address); end if;
  end if;
  return v_id;
end;
$$;

-- Protect identity even when a client bypasses the roster RPC with direct SQL.
create function public.protect_athlete_identity()
returns trigger language plpgsql set search_path='' as $$
begin
  if new.user_id is not null and (tg_op='INSERT' or old.user_id is distinct from new.user_id or old.birth_date is distinct from new.birth_date) then
    if new.birth_date is null or new.birth_date>current_date then raise exception 'Une date de naissance valide est obligatoire pour un athlète inscrit.'; end if;
  end if;
  if new.weight_kg is not null and new.weight_kg<=0 and (tg_op='INSERT' or new.weight_kg is distinct from old.weight_kg) then raise exception 'Poids invalide.'; end if;
  if tg_op='UPDATE' and auth.uid() is not null and auth.role()='authenticated' and old.user_id is not null and old.user_id<>auth.uid() then
    if row(new.first_name,new.last_name,new.birth_date,new.sex,new.phone,new.email,new.status,new.weight_class,new.gym_id,new.weight_unit,new.is_active)
      is distinct from row(old.first_name,old.last_name,old.birth_date,old.sex,old.phone,old.email,old.status,old.weight_class,old.gym_id,old.weight_unit,old.is_active)
    then raise exception 'Seul cet athlète peut modifier ses informations personnelles.' using errcode='42501'; end if;
  end if;
  return new;
end;
$$;
create trigger athlete_identity_guard before insert or update on public.athletes for each row execute function public.protect_athlete_identity();

create or replace function public.mark_athlete_profile_used()
returns trigger language plpgsql set search_path='' as $$
begin
  if row(new.first_name,new.last_name,new.birth_date,new.phone,new.email,new.weight_class,new.weight_kg,new.sex,new.status,new.fights,new.wins,new.losses,new.gym_id,new.weight_unit)
    is distinct from row(old.first_name,old.last_name,old.birth_date,old.phone,old.email,old.weight_class,old.weight_kg,old.sex,old.status,old.fights,old.wins,old.losses,old.gym_id,old.weight_unit)
  then new.onboarding_stub=false; end if;
  return new;
end;
$$;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_role text:=case when new.raw_user_meta_data->>'account_type'='coach' then 'coach' else 'athlete' end;
  v_gym uuid:=nullif(new.raw_user_meta_data->>'gym_id','')::uuid; v_birth date;
  v_name text:=coalesce(nullif(trim(left(new.raw_user_meta_data->>'full_name',200)),''),'Athlète');
  v_gym_name text:=regexp_replace(trim(left(new.raw_user_meta_data->>'gym_name',200)),'\s+',' ','g');
  v_address text:=regexp_replace(trim(left(new.raw_user_meta_data->>'gym_address',500)),'\s+',' ','g');
begin
  if not (new.raw_user_meta_data?'gym_id') then select id into v_gym from public.gyms where is_default; end if;
  if v_role='athlete' then
    v_birth:=nullif(new.raw_user_meta_data->>'birth_date','')::date;
    if v_birth is null or v_birth>current_date then raise exception 'Une date de naissance valide est obligatoire pour un athlète inscrit.'; end if;
  end if;
  insert into public.profiles(id,full_name,phone,account_type,is_admin,gym_id)
    values(new.id,v_name,left(new.raw_user_meta_data->>'phone',100),v_role,false,v_gym);
  if v_role='coach' then
    insert into public.coach_profiles(user_id,display_name) values(new.id,v_name);
    if coalesce(v_gym_name,'')<>'' and coalesce(v_address,'')<>'' then
      insert into public.gyms(name,address,created_by) values(v_gym_name,v_address,new.id) on conflict do nothing;
      select id into v_gym from public.gyms
        where lower(regexp_replace(trim(name),'\s+',' ','g'))=lower(regexp_replace(v_gym_name,'\s+',' ','g'))
        and lower(regexp_replace(trim(address),'\s+',' ','g'))=lower(regexp_replace(v_address,'\s+',' ','g'));
      update public.profiles set gym_id=v_gym where id=new.id;
    end if;
    insert into public.gym_settings(coach_id,gym_name,address)
      select new.id,coalesce(nullif(v_gym_name,''),g.name,'Mon gym'),coalesce(nullif(v_address,''),g.address)
      from (select 1) singleton left join public.gyms g on g.id=v_gym;
  else
    insert into public.athletes(user_id,first_name,last_name,birth_date,sex,weight_kg,weight_unit,fights,wins,losses,phone,email,gym_id,onboarding_stub)
      values(new.id,coalesce(nullif(trim(left(new.raw_user_meta_data->>'first_name',200)),''),v_name),
        coalesce(trim(left(new.raw_user_meta_data->>'last_name',200)),''),v_birth,nullif(new.raw_user_meta_data->>'sex',''),
        nullif(new.raw_user_meta_data->>'weight_kg','')::numeric,coalesce(nullif(new.raw_user_meta_data->>'weight_unit',''),'kg'),
        coalesce(nullif(new.raw_user_meta_data->>'fights','')::integer,0),nullif(new.raw_user_meta_data->>'wins','')::integer,
        nullif(new.raw_user_meta_data->>'losses','')::integer,left(new.raw_user_meta_data->>'phone',100),new.email,v_gym,true);
  end if;
  return new;
end;
$$;

-- This one-time trusted assignment uses the existing Auth identity, never signup metadata.
update public.profiles p set is_admin=true from auth.users u where p.id=u.id and lower(u.email)='mixmasterkd@gmail.com';

create function public.save_athlete_profile(p_data jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid; v_birth date; v_name text; v_gym uuid;
begin
  select id into v_id from public.athletes where user_id=auth.uid() for update;
  if v_id is null then raise exception 'Compte athlète requis.' using errcode='42501'; end if;
  if p_data is null or jsonb_typeof(p_data)<>'object' then raise exception 'Profil invalide.'; end if;
  select case when p_data?'birth_date' then nullif(p_data->>'birth_date','')::date else birth_date end into v_birth from public.athletes where id=v_id;
  if v_birth is null or v_birth>current_date then raise exception 'Une date de naissance valide est obligatoire.'; end if;
  if (p_data?'first_name' and coalesce(char_length(trim(p_data->>'first_name')),0) not between 1 and 200)
    or char_length(coalesce(p_data->>'last_name',''))>200 then raise exception 'Nom invalide.'; end if;
  update public.athletes set
    first_name=case when p_data?'first_name' then trim(p_data->>'first_name') else first_name end,
    last_name=case when p_data?'last_name' then trim(coalesce(p_data->>'last_name','')) else last_name end,
    birth_date=v_birth,sex=case when p_data?'sex' then nullif(p_data->>'sex','') else sex end,
    weight_kg=case when p_data?'weight_kg' then nullif(p_data->>'weight_kg','')::numeric else weight_kg end,
    weight_unit=case when p_data?'weight_unit' then p_data->>'weight_unit' else weight_unit end,
    fights=case when p_data?'fights' then coalesce(nullif(p_data->>'fights','')::integer,0) else fights end,
    wins=case when p_data?'wins' then nullif(p_data->>'wins','')::integer else wins end,
    losses=case when p_data?'losses' then nullif(p_data->>'losses','')::integer else losses end,
    status=case when p_data?'status' then p_data->>'status' else status end,
    phone=case when p_data?'phone' then left(p_data->>'phone',100) else phone end,
    email=case when p_data?'email' then left(p_data->>'email',320) else email end,
    gym_id=case when p_data?'gym_id' then nullif(p_data->>'gym_id','')::uuid else gym_id end,
    onboarding_stub=false where id=v_id;
  update public.profiles p set full_name=trim(a.first_name||' '||a.last_name),phone=a.phone,gym_id=a.gym_id
    from public.athletes a where a.id=v_id and p.id=auth.uid();
  return v_id;
end;
$$;

-- Existing roster RPC stays compatible; the trigger enforces the restricted columns.
-- JSON fields that actually change identity are rejected atomically for linked profiles.
create or replace function public.update_roster_athlete(p_athlete_id uuid,p_data jsonb)
returns void language plpgsql security definer set search_path='' as $$
begin
  if not public.coach_has_permission(p_athlete_id,'roster') then raise exception 'Accès au roster refusé.' using errcode='42501'; end if;
  if p_data is null or jsonb_typeof(p_data)<>'object' or (p_data?'first_name' and coalesce(length(trim(p_data->>'first_name')),0) not between 1 and 200) or length(coalesce(p_data->>'last_name',''))>200 then raise exception 'Nom invalide.'; end if;
  update public.athletes set
    first_name=case when p_data?'first_name' then trim(p_data->>'first_name') else first_name end,
    last_name=case when p_data?'last_name' then trim(coalesce(p_data->>'last_name','')) else last_name end,
    birth_date=case when p_data?'birth_date' then nullif(p_data->>'birth_date','')::date else birth_date end,
    sex=case when p_data?'sex' then nullif(p_data->>'sex','') else sex end,
    weight_kg=case when p_data?'weight_kg' then nullif(p_data->>'weight_kg','')::numeric else weight_kg end,
    weight_unit=case when p_data?'weight_unit' then p_data->>'weight_unit' else weight_unit end,
    fights=case when p_data?'fights' then coalesce(nullif(p_data->>'fights','')::integer,0) else fights end,
    wins=case when p_data?'wins' then nullif(p_data->>'wins','')::integer else wins end,
    losses=case when p_data?'losses' then nullif(p_data->>'losses','')::integer else losses end,
    status=case when p_data?'status' then p_data->>'status' else status end,
    phone=case when p_data?'phone' then p_data->>'phone' else phone end,
    email=case when p_data?'email' then p_data->>'email' else email end,
    gym_id=case when p_data?'gym_id' then nullif(p_data->>'gym_id','')::uuid else gym_id end
  where id=p_athlete_id;
  update public.coach_athletes set
    private_notes=case when p_data?'private_notes' then left(coalesce(p_data->>'private_notes',''),20000) else private_notes end,
    selected=case when p_data?'selected' then coalesce((p_data->>'selected')::boolean,false) else selected end
  where athlete_id=p_athlete_id and coach_id=auth.uid();
end;
$$;

create or replace function public.coach_has_permission(p_athlete_id uuid,p_permission text default 'roster')
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.coach_athletes ca join public.athletes a on a.id=ca.athlete_id
    where ca.athlete_id=p_athlete_id and ca.coach_id=auth.uid() and ca.status='accepted'
    and case p_permission when 'roster' then true
      when 'calendar' then a.user_id is not null and ca.can_view_calendar
      when 'add' then a.user_id is not null and ca.can_view_calendar and ca.can_add_sessions
      when 'edit' then a.user_id is not null and ca.can_view_calendar and ca.can_edit_own_sessions
      when 'feedback' then a.user_id is not null and ca.can_view_calendar and ca.can_view_feedback
      else false end);
$$;
comment on column public.coach_athletes.can_edit_own_sessions is 'Permission historique: modifie désormais les séances déverrouillées partagées et ses propres séances verrouillées.';

alter table public.training_sessions add column is_locked boolean not null default false;
alter table public.personal_events add column is_locked boolean not null default false;
alter table public.personal_events add column author_name text not null default '';
update public.personal_events e set author_name=coalesce(p.full_name,'Athlète') from public.profiles p where p.id=e.created_by;
create trigger personal_event_author before insert on public.personal_events for each row execute function public.stamp_training_author();
grant insert(is_locked),update(is_locked) on public.training_sessions,public.personal_events to authenticated;

create function public.protect_calendar_lock()
returns trigger language plpgsql set search_path='' as $$
begin
  if auth.uid() is not null and auth.role()='authenticated' then
    if new.created_by is distinct from old.created_by or new.athlete_id is distinct from old.athlete_id or new.author_name is distinct from old.author_name then
      raise exception 'Identité de la séance immuable.' using errcode='42501';
    end if;
    if new.is_locked is distinct from old.is_locked and old.created_by is distinct from auth.uid() then
      raise exception 'Seul le créateur peut verrouiller ou déverrouiller cette séance.' using errcode='42501';
    end if;
  end if;
  return new;
end;
$$;
create trigger session_lock_guard before update on public.training_sessions for each row execute function public.protect_calendar_lock();
create trigger event_lock_guard before update on public.personal_events for each row execute function public.protect_calendar_lock();

drop policy session_insert on public.training_sessions;
drop policy session_update on public.training_sessions;
drop policy session_delete on public.training_sessions;
create policy session_insert on public.training_sessions for insert to authenticated
  with check(created_by=auth.uid() and (public.owns_athlete(athlete_id) or public.coach_has_permission(athlete_id,'add')));
create policy session_update on public.training_sessions for update to authenticated
  using((public.owns_athlete(athlete_id) or public.coach_has_permission(athlete_id,'edit')) and (not is_locked or created_by=auth.uid()))
  with check((public.owns_athlete(athlete_id) or public.coach_has_permission(athlete_id,'edit')) and (not is_locked or created_by=auth.uid()));
create policy session_delete on public.training_sessions for delete to authenticated
  using(created_by=auth.uid() and (public.owns_athlete(athlete_id) or public.coach_has_permission(athlete_id,'edit')));
drop policy event_insert on public.personal_events;
drop policy event_update on public.personal_events;
drop policy event_delete on public.personal_events;
create policy event_insert on public.personal_events for insert to authenticated
  with check(created_by=auth.uid() and (public.owns_athlete(athlete_id) or public.coach_has_permission(athlete_id,'add')));
create policy event_update on public.personal_events for update to authenticated
  using((public.owns_athlete(athlete_id) or public.coach_has_permission(athlete_id,'edit')) and (not is_locked or created_by=auth.uid()))
  with check((public.owns_athlete(athlete_id) or public.coach_has_permission(athlete_id,'edit')) and (not is_locked or created_by=auth.uid()));
create policy event_delete on public.personal_events for delete to authenticated
  using(created_by=auth.uid() and (public.owns_athlete(athlete_id) or public.coach_has_permission(athlete_id,'edit')));

-- Both account types can retain their own reusable structured workouts.
alter table public.session_templates drop constraint session_templates_coach_id_fkey;
alter table public.session_templates add constraint session_templates_owner_fkey foreign key(coach_id) references public.profiles(id) on delete cascade;
drop policy template_own on public.session_templates;
create policy template_own on public.session_templates for all to authenticated using(coach_id=auth.uid()) with check(coach_id=auth.uid());

create or replace function public.accept_invitation(p_token text)
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
    if v_old.birth_date is null then raise exception 'Complète ta date de naissance avant de rejoindre ton coach.'; end if;
    delete from public.athletes where id=v_old.id;
    update public.athletes set user_id=auth.uid(),onboarding_stub=false,
      first_name=v_old.first_name,last_name=v_old.last_name,birth_date=v_old.birth_date,sex=coalesce(v_old.sex,sex),
      phone=coalesce(v_old.phone,phone),email=coalesce(v_old.email,email),gym_id=v_old.gym_id,weight_unit=v_old.weight_unit,
      weight_kg=coalesce(v_old.weight_kg,weight_kg),fights=case when v_old.fights>0 then v_old.fights else fights end,
      wins=coalesce(v_old.wins,wins),losses=coalesce(v_old.losses,losses)
    where id=v_target.id;
  else
    update public.athletes set user_id=auth.uid(),onboarding_stub=false where id=v_target.id;
  end if;
  update public.athlete_invitations set accepted_at=now(),accepted_by=auth.uid() where id=v_inv.id;
  return v_target.id;
end;
$$;

create table public.admin_test_accounts (
  admin_id uuid primary key references public.profiles(id) on delete cascade,
  test_user_id uuid not null unique references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  check(admin_id<>test_user_id)
);
alter table public.admin_test_accounts enable row level security;
revoke all on public.admin_test_accounts from public,anon,authenticated;
grant select on public.admin_test_accounts to authenticated;
grant all on public.admin_test_accounts to service_role;
create policy admin_test_account_owner on public.admin_test_accounts for select to authenticated using(admin_id=auth.uid() and public.is_admin());

revoke all on function public.save_gym(text,text),public.admin_save_gym(text,text,uuid),public.save_athlete_profile(jsonb),public.protect_athlete_identity(),public.protect_calendar_lock() from public,anon,authenticated;
grant execute on function public.save_gym(text,text),public.admin_save_gym(text,text,uuid),public.save_athlete_profile(jsonb) to authenticated;
