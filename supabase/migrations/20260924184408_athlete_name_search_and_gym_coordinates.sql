-- Search reveals only account names and the requesting coach's connection status.
create function coaching_private.search_athletes(p_query text)
returns table(athlete_id uuid,display_name text,connection_status text)
language plpgsql stable security definer set search_path='' as $$
declare v_query text:=lower(trim(p_query));
begin
 if auth.uid() is null or not exists(select 1 from public.coach_profiles where user_id=auth.uid()) then raise exception 'Compte coach requis.' using errcode='42501'; end if;
 if v_query is null or length(v_query) not between 2 and 320 then raise exception 'Indique au moins deux caractères.'; end if;
 return query select a.id,trim(a.first_name||' '||coalesce(a.last_name,'')),
  case when r.status='accepted' then 'accepted' when i.status='pending' and i.expires_at>now() then 'pending' else 'available' end
 from public.athletes a join auth.users u on u.id=a.user_id
 left join public.coach_athletes r on r.athlete_id=a.id and r.coach_id=auth.uid()
 left join public.coaching_invitations i on i.athlete_id=a.id and i.coach_id=auth.uid()
 where u.id<>auth.uid() and case when position('@' in v_query)>0 then lower(u.email)=v_query
 else strpos(lower(trim(a.first_name||' '||coalesce(a.last_name,''))),v_query)>0 end
 order by lower(a.first_name),lower(a.last_name),a.id limit 20;
end;
$$;

create function coaching_private.invite_athlete(p_athlete_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_athlete uuid; v_id uuid; v_previous public.coaching_invitations%rowtype;
begin
 if auth.uid() is null then raise exception 'Connecte-toi.' using errcode='42501'; end if;
 -- Serialize invitations from this coach to avoid duplicate sends and rate races.
 perform 1 from public.coach_profiles where user_id=auth.uid() for update;
 if not found then raise exception 'Compte coach requis.' using errcode='42501'; end if;
 select a.id into v_athlete from public.athletes a where a.id=p_athlete_id and a.user_id is not null and a.user_id<>auth.uid();
 if v_athlete is null then raise exception 'Compte athlète introuvable.'; end if;
 if exists(select 1 from public.coach_athletes where athlete_id=v_athlete and coach_id=auth.uid() and status='accepted') then raise exception 'Cet athlète est déjà dans ton effectif.'; end if;
 select * into v_previous from public.coaching_invitations where athlete_id=v_athlete and coach_id=auth.uid() for update;
 if found and v_previous.status='pending' and v_previous.expires_at>now() then return v_previous.id; end if;
 if v_previous.responded_at>now()-interval '1 day' then raise exception 'Attends avant de renvoyer une invitation à cette personne.'; end if;
 if (select count(*) from public.coaching_invitations where coach_id=auth.uid() and created_at>now()-interval '1 day')>=50 then raise exception 'Limite quotidienne d’invitations atteinte.'; end if;
 insert into public.coaching_invitations(coach_id,athlete_id) values(auth.uid(),v_athlete)
 on conflict(coach_id,athlete_id) do update set status='pending',created_at=now(),expires_at=now()+interval '30 days',responded_at=null
 returning id into v_id;
 return v_id;
end;
$$;

-- Preserve exact-email clients while sharing the same invitation rules.
create or replace function coaching_private.invite_existing_athlete(p_email text)
returns uuid language plpgsql security invoker set search_path='' as $$
declare v_athlete uuid;
begin
 select f.athlete_id into v_athlete from coaching_private.find_athlete_by_email(p_email) f;
 if v_athlete is null then raise exception 'Aucun compte trouvé pour ce courriel.'; end if;
 return coaching_private.invite_athlete(v_athlete);
end;
$$;

-- Gym coordinates belong to this coach; saving never publishes or edits a directory.
create function coaching_private.save_gym(p_name text,p_address text)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_name text:=regexp_replace(trim(p_name),'\s+',' ','g');
 v_address text:=regexp_replace(trim(p_address),'\s+',' ','g'); v_id uuid;
begin
 if auth.uid() is null or not exists(select 1 from public.coach_profiles where user_id=auth.uid()) then raise exception 'Compte coach requis.' using errcode='42501'; end if;
 if v_name is null or length(v_name) not between 1 and 200 then raise exception 'Nom du gym invalide.'; end if;
 if v_address is null or length(v_address) not between 1 and 500 then raise exception 'Adresse du gym invalide.'; end if;
 insert into public.gym_settings(coach_id,gym_name,address) values(auth.uid(),v_name,v_address)
 on conflict(coach_id) do update set gym_name=excluded.gym_name,address=excluded.address
 returning id into v_id;
 return v_id;
end;
$$;

create function public.search_athletes(p_query text)
returns table(athlete_id uuid,display_name text,connection_status text)
language sql stable security invoker set search_path='' as $$select * from coaching_private.search_athletes(p_query)$$;
create function public.invite_athlete(p_athlete_id uuid) returns uuid
language sql security invoker set search_path='' as $$select coaching_private.invite_athlete(p_athlete_id)$$;
create or replace function public.save_gym(p_name text,p_address text) returns uuid
language sql security invoker set search_path='' as $$select coaching_private.save_gym(p_name,p_address)$$;
revoke all on function coaching_private.search_athletes(text),coaching_private.invite_athlete(uuid),coaching_private.save_gym(text,text),public.search_athletes(text),public.invite_athlete(uuid),public.save_gym(text,text) from public,anon,authenticated;
grant execute on function coaching_private.search_athletes(text),coaching_private.invite_athlete(uuid),coaching_private.save_gym(text,text),public.search_athletes(text),public.invite_athlete(uuid),public.save_gym(text,text) to authenticated;
