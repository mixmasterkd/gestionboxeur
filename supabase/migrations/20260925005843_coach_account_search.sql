-- Search returns only a name, identifier and the caller's relationship status.
create function coaching_private.search_coaches(p_query text)
returns table(coach_id uuid,display_name text,connection_status text)
language plpgsql stable security definer set search_path='' as $$
declare v_query text:=lower(trim(p_query)); v_athlete uuid;
begin
 if auth.uid() is null then raise exception 'Connexion requise.' using errcode='42501'; end if;
 select id into v_athlete from public.athletes where user_id=auth.uid();
 if v_athlete is null then raise exception 'Profil personnel requis.' using errcode='42501'; end if;
 if v_query is null or length(v_query) not between 2 and 320 then raise exception 'Indique au moins deux caractères.'; end if;
 return query select c.user_id,c.display_name,
  case when r.status='accepted' then 'accepted' when r.status='pending' then 'pending'
   when i.status='pending' and i.expires_at>now() then 'invited' else 'available' end
 from public.coach_profiles c join auth.users u on u.id=c.user_id
 left join public.coach_athletes r on r.coach_id=c.user_id and r.athlete_id=v_athlete
 left join public.coaching_invitations i on i.coach_id=c.user_id and i.athlete_id=v_athlete
 where c.user_id<>auth.uid() and case when position('@' in v_query)>0 then lower(u.email)=v_query
 else strpos(lower(c.display_name),v_query)>0 end
 order by lower(c.display_name),c.user_id limit 20;
end;
$$;

-- Choosing a coach authorizes a request for the caller's own profile only.
-- Reuse the established code flow; no relationship activates before acceptance.
create function coaching_private.request_coach_account(p_coach_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_code text; v_athlete uuid; v_status text;
begin
 if auth.uid() is null then raise exception 'Connexion requise.' using errcode='42501'; end if;
 select id into v_athlete from public.athletes where user_id=auth.uid() for update;
 if v_athlete is null then raise exception 'Profil personnel requis.' using errcode='42501'; end if;
 if p_coach_id=auth.uid() then raise exception 'Impossible de te connecter à toi-même.'; end if;
 select join_code into v_code from public.coach_profiles where user_id=p_coach_id;
 if v_code is null then raise exception 'Compte coach introuvable.'; end if;
 select status into v_status from public.coach_athletes where athlete_id=v_athlete and coach_id=p_coach_id;
 if v_status in ('accepted','pending') then return p_coach_id; end if;
 if (select count(*) from public.coach_athletes where athlete_id=v_athlete and status='pending')>=50 then raise exception 'Trop de demandes en attente.'; end if;
 return public.request_coach(v_code);
end;
$$;

create function public.search_coaches(p_query text)
returns table(coach_id uuid,display_name text,connection_status text)
language sql stable security invoker set search_path='' as $$select * from coaching_private.search_coaches(p_query)$$;
create function public.request_coach_account(p_coach_id uuid) returns uuid
language sql security invoker set search_path='' as $$select coaching_private.request_coach_account(p_coach_id)$$;
revoke all on function coaching_private.search_coaches(text),coaching_private.request_coach_account(uuid),public.search_coaches(text),public.request_coach_account(uuid) from public,anon,authenticated;
grant execute on function coaching_private.search_coaches(text),coaching_private.request_coach_account(uuid),public.search_coaches(text),public.request_coach_account(uuid) to authenticated;
