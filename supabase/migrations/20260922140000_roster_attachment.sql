-- Attach a coach's duplicate free roster sheet to an already linked athlete.
-- No Auth transfer, global deletion, calendar transfer or permission expansion.
create function public.merge_roster_athlete(
  p_source_id uuid,
  p_target_id uuid,
  p_source_updated_at timestamptz,
  p_target_updated_at timestamptz,
  p_source_relation_updated_at timestamptz,
  p_target_relation_updated_at timestamptz,
  p_choices jsonb
)
returns uuid language plpgsql security definer set search_path='' as $$
declare
  v_coach uuid:=auth.uid();
  v_source public.athletes%rowtype;
  v_target public.athletes%rowtype;
  v_source_relation public.coach_athletes%rowtype;
  v_target_relation public.coach_athletes%rowtype;
  v_notes text;
begin
  if v_coach is null or not exists(
    select 1 from public.coach_profiles c join public.profiles p on p.id=c.user_id
    where c.user_id=v_coach and p.account_type='coach'
  ) then raise exception 'Compte coach requis pour rattacher une fiche.' using errcode='42501'; end if;
  if p_source_id is null or p_target_id is null or p_source_id=p_target_id then
    raise exception 'Choisis deux fiches distinctes.' using errcode='22023';
  end if;
  if p_source_updated_at is null or p_target_updated_at is null
    or p_source_relation_updated_at is null or p_target_relation_updated_at is null then
    raise exception 'Versions des fiches et des relations obligatoires. Recharge les listes.' using errcode='22023';
  end if;
  if p_choices is null or jsonb_typeof(p_choices)<>'object'
    or coalesce(p_choices->>'weight','') not in ('source','target')
    or coalesce(p_choices->>'record','') not in ('source','target')
    or (p_choices-'weight'-'record')<>'{}'::jsonb then
    raise exception 'Choisis explicitement le poids et le bilan à conserver.' using errcode='22023';
  end if;

  -- Every invocation locks the two athletes, then the two calling-coach links,
  -- in a stable UUID order. Versions are checked only after these locks are held.
  perform 1 from public.athletes where id in (p_source_id,p_target_id) order by id for update;
  perform 1 from public.coach_athletes where coach_id=v_coach and athlete_id in (p_source_id,p_target_id)
    order by athlete_id for update;
  select * into v_source_relation from public.coach_athletes where coach_id=v_coach and athlete_id=p_source_id;
  select * into v_target_relation from public.coach_athletes where coach_id=v_coach and athlete_id=p_target_id;
  if v_source_relation.status is distinct from 'accepted' or v_target_relation.status is distinct from 'accepted' then
    raise exception 'Accès refusé : les deux fiches doivent être liées et acceptées par ton compte coach.' using errcode='42501';
  end if;
  select * into v_source from public.athletes where id=p_source_id;
  select * into v_target from public.athletes where id=p_target_id;
  if v_source.id is null or v_target.id is null then raise exception 'Fiche introuvable. Recharge les listes.' using errcode='42501'; end if;
  if v_source.user_id is not null then raise exception 'La fiche à rattacher possède déjà un compte athlète.' using errcode='22023'; end if;
  if v_target.user_id is null then raise exception 'La cible doit être un athlète inscrit déjà lié à ton compte coach.' using errcode='22023'; end if;
  if v_source.updated_at is distinct from p_source_updated_at
    or v_target.updated_at is distinct from p_target_updated_at
    or v_source_relation.updated_at is distinct from p_source_relation_updated_at
    or v_target_relation.updated_at is distinct from p_target_relation_updated_at then
    raise exception 'Une fiche ou une relation a changé. Recharge les listes et vérifie tes choix avant de rattacher.' using errcode='40001';
  end if;
  if exists(select 1 from public.training_sessions where athlete_id=p_source_id)
    or exists(select 1 from public.personal_events where athlete_id=p_source_id)
    or exists(select 1 from public.session_feedback where athlete_id=p_source_id) then
    raise exception 'Cette fiche possède des données de calendrier. Le rattachement ne peut pas les abandonner.' using errcode='22023';
  end if;

  -- Weight and whole fight record are explicit alternatives, never added together.
  -- The athlete's identity, gym, preferred unit, status and Auth link are untouched.
  if p_choices->>'weight'='source' or p_choices->>'record'='source' then
    update public.athletes set
      weight_kg=case when p_choices->>'weight'='source' then v_source.weight_kg else weight_kg end,
      fights=case when p_choices->>'record'='source' then v_source.fights else fights end,
      wins=case when p_choices->>'record'='source' then v_source.wins else wins end,
      losses=case when p_choices->>'record'='source' then v_source.losses else losses end
    where id=p_target_id;
  end if;
  v_notes:=case
    when v_source_relation.private_notes='' then v_target_relation.private_notes
    when v_target_relation.private_notes='' then v_source_relation.private_notes
    else v_target_relation.private_notes||E'\n\n— Notes de la fiche rattachée —\n'||v_source_relation.private_notes
  end;
  update public.coach_athletes set private_notes=v_notes,
    selected=(v_source_relation.selected or v_target_relation.selected) and v_target.status='available'
  where coach_id=v_coach and athlete_id=p_target_id;
  update public.coach_athletes set status='revoked',selected=false
  where coach_id=v_coach and athlete_id=p_source_id;
  -- Keep the source sheet and ALL its notes, other coach links and invitations.
  -- Existing invitation validation refuses this coach's now-revoked source link.
  return p_target_id;
end;
$$;

revoke all on function public.merge_roster_athlete(uuid,uuid,timestamptz,timestamptz,timestamptz,timestamptz,jsonb) from public,anon,authenticated;
grant execute on function public.merge_roster_athlete(uuid,uuid,timestamptz,timestamptz,timestamptz,timestamptz,jsonb) to authenticated;

-- Merged notes may exceed the old 20,000-character form limit. Never silently
-- truncate them during an unrelated roster update or a subsequent explicit edit.
create or replace function public.update_roster_athlete(p_athlete_id uuid,p_data jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare v_existing_notes text;
begin
  if not public.coach_has_permission(p_athlete_id,'roster') then raise exception 'Accès au roster refusé.' using errcode='42501'; end if;
  if p_data is null or jsonb_typeof(p_data)<>'object' or (p_data?'first_name' and coalesce(length(trim(p_data->>'first_name')),0) not between 1 and 200) or length(coalesce(p_data->>'last_name',''))>200 then raise exception 'Nom invalide.'; end if;
  perform 1 from public.athletes where id=p_athlete_id for update;
  select private_notes into v_existing_notes from public.coach_athletes
    where athlete_id=p_athlete_id and coach_id=auth.uid() and status='accepted' for update;
  if not found then raise exception 'Accès au roster refusé.' using errcode='42501'; end if;
  if p_data?'private_notes' and char_length(coalesce(p_data->>'private_notes',''))>greatest(20000,char_length(v_existing_notes)) then
    raise exception 'Les notes dépassent la longueur autorisée (% caractères). Aucun texte n’a été tronqué.',greatest(20000,char_length(v_existing_notes)) using errcode='22023';
  end if;
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
    private_notes=case when p_data?'private_notes' then coalesce(p_data->>'private_notes','') else private_notes end,
    selected=case when p_data?'selected' then coalesce((p_data->>'selected')::boolean,false) else selected end
  where athlete_id=p_athlete_id and coach_id=auth.uid();
end;
$$;

-- Serialize invitation acceptance with manual roster attachment. Checking a link
-- before waiting on its athlete lock would allow a concurrent merge to revoke
-- that link while acceptance continued with a stale accepted-status decision.
create or replace function public.accept_invitation(p_token text)
returns uuid language plpgsql security definer set search_path='' as $$
declare
  v_inv public.athlete_invitations%rowtype;
  v_target public.athletes%rowtype;
  v_old public.athletes%rowtype;
  v_relation public.coach_athletes%rowtype;
begin
  if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid() and account_type='athlete') then raise exception 'Connecte-toi avec un compte athlète.' using errcode='42501'; end if;
  if length(p_token)<>64 then raise exception 'Invitation invalide ou expirée.'; end if;
  select * into v_inv from public.athlete_invitations where token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex') for update;
  if not found or v_inv.accepted_at is not null or v_inv.expires_at<=now() then raise exception 'Invitation invalide ou expirée.'; end if;
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
