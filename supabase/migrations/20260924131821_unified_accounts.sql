-- account_type now denotes optional coaching tools, not a separate identity.
-- Existing athlete IDs, coach relationships and admin test accounts are preserved.
create or replace function public.protect_athlete_identity()
returns trigger language plpgsql set search_path='' as $$
begin
  if new.user_id is not null and (tg_op='INSERT' or old.user_id is distinct from new.user_id or old.birth_date is distinct from new.birth_date) then
    if (new.birth_date is null and not (tg_op='INSERT' and exists(select 1 from public.profiles where id=new.user_id and account_type='coach'))) or new.birth_date>current_date then raise exception 'Une date de naissance valide est obligatoire pour un athlète inscrit.'; end if;
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

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_role text:=case when new.raw_user_meta_data->>'account_type'='coach' then 'coach' else 'athlete' end;
  v_gym uuid:=nullif(new.raw_user_meta_data->>'gym_id','')::uuid; v_birth date;
  v_name text:=coalesce(nullif(trim(left(new.raw_user_meta_data->>'full_name',200)),''),'Athlète');
  v_gym_name text:=regexp_replace(trim(left(new.raw_user_meta_data->>'gym_name',200)),'\s+',' ','g');
  v_address text:=regexp_replace(trim(left(new.raw_user_meta_data->>'gym_address',500)),'\s+',' ','g');
begin
  if not (new.raw_user_meta_data?'gym_id') then select id into v_gym from public.gyms where is_default; end if;
  v_birth:=nullif(new.raw_user_meta_data->>'birth_date','')::date;
  if v_role='athlete' then
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
  end if;
    insert into public.athletes(user_id,first_name,last_name,birth_date,sex,weight_kg,weight_unit,fights,wins,losses,phone,email,gym_id,onboarding_stub)
      values(new.id,coalesce(nullif(trim(left(new.raw_user_meta_data->>'first_name',200)),''),v_name),
        coalesce(trim(left(new.raw_user_meta_data->>'last_name',200)),''),v_birth,nullif(new.raw_user_meta_data->>'sex',''),
        nullif(new.raw_user_meta_data->>'weight_kg','')::numeric,coalesce(nullif(new.raw_user_meta_data->>'weight_unit',''),'kg'),
        coalesce(nullif(new.raw_user_meta_data->>'fights','')::integer,0),nullif(new.raw_user_meta_data->>'wins','')::integer,
        nullif(new.raw_user_meta_data->>'losses','')::integer,left(new.raw_user_meta_data->>'phone',100),new.email,v_gym,true);
  return new;
end;
$$;

-- Add only missing personal profiles; no guessed birthday or link to a roster.
insert into public.athletes(user_id,first_name,last_name,phone,email,gym_id,onboarding_stub)
select p.id,coalesce(nullif(trim(p.full_name),''),'Profil'),'',p.phone,u.email,p.gym_id,false
from public.profiles p join auth.users u on u.id=p.id
where p.account_type='coach' and not exists(select 1 from public.athletes a where a.user_id=p.id)
on conflict(user_id) do nothing;

create function public.enable_coaching()
returns void language plpgsql security definer set search_path='' as $$
declare v_profile public.profiles%rowtype;
begin
  if auth.uid() is null then raise exception 'Connexion requise.' using errcode='42501'; end if;
  select * into v_profile from public.profiles where id=auth.uid() for update;
  if not found then raise exception 'Compte introuvable.' using errcode='42501'; end if;
  if exists(select 1 from public.admin_test_accounts where test_user_id=auth.uid()) then
    raise exception 'Le compte de test conserve ses fonctions athlète.' using errcode='42501';
  end if;
  insert into public.coach_profiles(user_id,display_name) values(v_profile.id,coalesce(v_profile.full_name,'')) on conflict(user_id) do nothing;
  insert into public.gym_settings(coach_id,gym_name,address)
    select v_profile.id,coalesce(g.name,'Mon gym'),g.address from (select 1) singleton left join public.gyms g on g.id=v_profile.gym_id
    on conflict(coach_id) do nothing;
  update public.profiles set account_type='coach' where id=v_profile.id and account_type<>'coach';
end;
$$;
revoke all on function public.enable_coaching() from public,anon;
grant execute on function public.enable_coaching() to authenticated,service_role;
comment on column public.profiles.account_type is 'Compatibilité : coach active les outils d’encadrement; chaque compte possède son profil et son calendrier.';

create or replace function public.accept_invitation(p_token text)
returns uuid language plpgsql security definer set search_path='' as $$
declare
  v_inv public.athlete_invitations%rowtype;
  v_target public.athletes%rowtype;
  v_old public.athletes%rowtype;
  v_relation public.coach_athletes%rowtype;
begin
  if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid()) then raise exception 'Connecte-toi à ton compte.' using errcode='42501'; end if;
  if length(p_token)<>64 then raise exception 'Invitation invalide ou expirée.'; end if;
  select * into v_inv from public.athlete_invitations where token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex') for update;
  if not found or v_inv.accepted_at is not null or v_inv.expires_at<=now() then raise exception 'Invitation invalide ou expirée.'; end if;
  if v_inv.coach_id=auth.uid() then raise exception 'Impossible de te connecter à toi-même.' using errcode='42501'; end if;
  -- Same athlete-before-relation ordering as merge_roster_athlete, including the
  -- signup stub which acceptance may remove. Merge never locks invitations.
  perform 1 from public.athletes where id=v_inv.athlete_id or user_id=auth.uid() order by id for update;
  select * into v_target from public.athletes where id=v_inv.athlete_id;
  if not found then raise exception 'Invitation invalide ou expirée.'; end if;
  select * into v_relation from public.coach_athletes
    where athlete_id=v_inv.athlete_id and coach_id=v_inv.coach_id for update;
  if not found or v_relation.status is distinct from 'accepted' then raise exception 'Invitation révoquée.'; end if;
  if v_target.user_id is not null and v_target.user_id<>auth.uid() then raise exception 'Ce profil est déjà lié à un autre compte.'; end if;
  select * into v_old from public.athletes where user_id=auth.uid();
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
