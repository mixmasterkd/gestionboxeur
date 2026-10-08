-- Store contact details independently of the sign-in address.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_role text:=case when new.raw_user_meta_data->>'account_type'='coach' then 'coach' else 'athlete' end;
  v_gym uuid:=nullif(new.raw_user_meta_data->>'gym_id','')::uuid; v_birth date;
  v_name text:=coalesce(nullif(trim(left(new.raw_user_meta_data->>'full_name',200)),''),'Athlète');
  v_gym_name text:=regexp_replace(trim(left(new.raw_user_meta_data->>'gym_name',200)),'\s+',' ','g');
  v_address text:=regexp_replace(trim(left(new.raw_user_meta_data->>'gym_address',500)),'\s+',' ','g');
  v_contact_email text:=coalesce(nullif(trim(new.raw_user_meta_data->>'contact_email'),''),new.email);
begin
  if length(v_contact_email)>320 or v_contact_email !~ '^[^[:space:]@]+@[^[:space:]@]+$' then raise exception 'Courriel de contact invalide.'; end if;
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
        nullif(new.raw_user_meta_data->>'losses','')::integer,left(new.raw_user_meta_data->>'phone',100),v_contact_email,v_gym,true);
  return new;
end;
$$;
