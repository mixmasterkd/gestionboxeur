-- Contact email lives in the existing athlete identity; Auth email is never updated.
create function coaching_private.save_athlete_profile(p_data jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid; v_birth date; v_name text; v_gym uuid;
begin
  select id into v_id from public.athletes where user_id=auth.uid() for update;
  if v_id is null then raise exception 'Compte athlète requis.' using errcode='42501'; end if;
  if p_data is null or jsonb_typeof(p_data)<>'object' then raise exception 'Profil invalide.'; end if;
  select case when p_data?'birth_date' then nullif(p_data->>'birth_date','')::date else birth_date end into v_birth from public.athletes where id=v_id;
  if (v_birth is null and not exists(select 1 from public.coach_profiles where user_id=auth.uid())) or v_birth>current_date then raise exception 'Une date de naissance valide est obligatoire.'; end if;
  if (p_data?'first_name' and coalesce(char_length(trim(p_data->>'first_name')),0) not between 1 and 200)
    or char_length(coalesce(p_data->>'last_name',''))>200 then raise exception 'Nom invalide.'; end if;
  if p_data?'email' and nullif(trim(p_data->>'email'),'') is not null and (length(p_data->>'email')>320 or trim(p_data->>'email') !~ '^[^[:space:]@]+@[^[:space:]@]+$') then raise exception 'Courriel de contact invalide.'; end if;
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
    email=case when p_data?'email' then nullif(trim(p_data->>'email'),'') else email end,
    gym_id=case when p_data?'gym_id' then nullif(p_data->>'gym_id','')::uuid else gym_id end,
    onboarding_stub=false where id=v_id;
  update public.profiles p set full_name=trim(a.first_name||' '||a.last_name),phone=a.phone,gym_id=a.gym_id
    from public.athletes a where a.id=v_id and p.id=auth.uid();
  return v_id;
end;
$$;
create or replace function public.protect_athlete_identity()
returns trigger language plpgsql set search_path='' as $$
begin
  if new.user_id is not null and (tg_op='INSERT' or old.user_id is distinct from new.user_id or old.birth_date is distinct from new.birth_date) then
    if (new.birth_date is null and not exists(select 1 from public.profiles where id=new.user_id and account_type='coach')) or new.birth_date>current_date then raise exception 'Une date de naissance valide est obligatoire pour un athlète inscrit.'; end if;
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


create or replace function public.save_athlete_profile(p_data jsonb) returns uuid
language sql security invoker set search_path='' as $$select coaching_private.save_athlete_profile(p_data)$$;
revoke all on function coaching_private.save_athlete_profile(jsonb),public.save_athlete_profile(jsonb) from public,anon,authenticated;
grant execute on function coaching_private.save_athlete_profile(jsonb),public.save_athlete_profile(jsonb) to authenticated;
