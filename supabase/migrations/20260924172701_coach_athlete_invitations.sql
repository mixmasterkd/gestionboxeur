create schema if not exists coaching_private;
revoke all on schema coaching_private from public,anon,authenticated;
grant usage on schema coaching_private to authenticated;

-- A coach proposes a relationship; only its athlete can activate it.
-- This is separate from signup links and never replaces an athlete profile.
create table public.coaching_invitations (
 id uuid primary key default gen_random_uuid(),
 coach_id uuid not null references public.coach_profiles(user_id) on delete cascade,
 athlete_id uuid not null references public.athletes(id) on delete cascade,
 status text not null default 'pending' check(status in ('pending','accepted','declined','cancelled')),
 created_at timestamptz not null default now(),
 expires_at timestamptz not null default now()+interval '30 days',
 responded_at timestamptz,
 unique(coach_id,athlete_id)
);
create index coaching_invitations_athlete_idx on public.coaching_invitations(athlete_id,status);
alter table public.coaching_invitations enable row level security;
revoke all on public.coaching_invitations from public,anon,authenticated;
grant select on public.coaching_invitations to authenticated;
grant all on public.coaching_invitations to service_role;
create policy coaching_invitations_participants on public.coaching_invitations for select to authenticated
 using(coach_id=(select auth.uid()) or public.owns_athlete(athlete_id));

-- Exact email lookup exposes only a name and connection status, never a directory
-- of birthdays, contact addresses, calendars or private roster data.
create function coaching_private.find_athlete_by_email(p_email text)
returns table(athlete_id uuid,display_name text,connection_status text)
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not exists(select 1 from public.coach_profiles where user_id=auth.uid()) then raise exception 'Compte coach requis.' using errcode='42501'; end if;
 if p_email is null or length(trim(p_email)) not between 3 and 320 or position('@' in p_email)=0 then raise exception 'Courriel invalide.'; end if;
 return query select a.id,trim(a.first_name||' '||coalesce(a.last_name,'')),
  case when r.status='accepted' then 'accepted' when i.status='pending' and i.expires_at>now() then 'pending' else 'available' end
 from auth.users u join public.athletes a on a.user_id=u.id
 left join public.coach_athletes r on r.athlete_id=a.id and r.coach_id=auth.uid()
 left join public.coaching_invitations i on i.athlete_id=a.id and i.coach_id=auth.uid()
 where lower(u.email)=lower(trim(p_email)) and u.id<>auth.uid() limit 1;
end;
$$;

create function coaching_private.invite_existing_athlete(p_email text)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_athlete uuid; v_id uuid; v_previous public.coaching_invitations%rowtype;
begin
 if auth.uid() is null then raise exception 'Connecte-toi.' using errcode='42501'; end if;
 -- Serialize invitations from this coach to avoid duplicate sends and rate races.
 perform 1 from public.coach_profiles where user_id=auth.uid() for update;
 if not found then raise exception 'Compte coach requis.' using errcode='42501'; end if;
 select f.athlete_id into v_athlete from coaching_private.find_athlete_by_email(p_email) f;
 if v_athlete is null then raise exception 'Aucun compte trouvé pour ce courriel.'; end if;
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

create function coaching_private.my_coaching_invitations()
returns table(id uuid,coach_id uuid,athlete_id uuid,coach_name text,athlete_name text,direction text,created_at timestamptz)
language sql stable security definer set search_path='' as $$
 select i.id,i.coach_id,i.athlete_id,c.display_name,trim(a.first_name||' '||coalesce(a.last_name,'')),
 case when a.user_id=auth.uid() then 'incoming' else 'outgoing' end,i.created_at
 from public.coaching_invitations i join public.athletes a on a.id=i.athlete_id join public.coach_profiles c on c.user_id=i.coach_id
 where auth.uid() is not null and (i.coach_id=auth.uid() or a.user_id=auth.uid()) and i.status='pending' and i.expires_at>now()
 order by i.created_at desc;
$$;

create function coaching_private.respond_coaching_invitation(p_invitation_id uuid,p_accept boolean)
returns void language plpgsql security definer set search_path='' as $$
declare v_inv public.coaching_invitations%rowtype;
begin
 if p_accept is null then raise exception 'Réponse invalide.'; end if;
 select * into v_inv from public.coaching_invitations where id=p_invitation_id for update;
 if not found or not public.owns_athlete(v_inv.athlete_id) then raise exception 'Seul l’athlète invité peut répondre.' using errcode='42501'; end if;
 if v_inv.status<>'pending' or v_inv.expires_at<=now() then raise exception 'Invitation déjà traitée ou expirée.'; end if;
 if p_accept then
  insert into public.coach_athletes(coach_id,athlete_id,status) values(v_inv.coach_id,v_inv.athlete_id,'accepted')
  on conflict(coach_id,athlete_id) do update set status='accepted',can_view_calendar=true,can_add_sessions=true,can_edit_own_sessions=true,can_view_feedback=true
  where public.coach_athletes.status<>'accepted';
 end if;
 update public.coaching_invitations set status=case when p_accept then 'accepted' else 'declined' end,responded_at=now() where id=v_inv.id;
end;
$$;

create function coaching_private.cancel_coaching_invitation(p_invitation_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
 update public.coaching_invitations set status='cancelled',responded_at=now()
 where id=p_invitation_id and coach_id=auth.uid() and status='pending';
 if not found then raise exception 'Invitation inaccessible.' using errcode='42501'; end if;
end;
$$;

revoke all on function coaching_private.find_athlete_by_email(text),coaching_private.invite_existing_athlete(text),coaching_private.my_coaching_invitations(),coaching_private.respond_coaching_invitation(uuid,boolean),coaching_private.cancel_coaching_invitation(uuid) from public,anon,authenticated;
grant execute on function coaching_private.find_athlete_by_email(text),coaching_private.invite_existing_athlete(text),coaching_private.my_coaching_invitations(),coaching_private.respond_coaching_invitation(uuid,boolean),coaching_private.cancel_coaching_invitation(uuid) to authenticated;

-- Public API entry points run as the caller; privileged implementation is private.
create function public.find_athlete_by_email(p_email text)
returns table(athlete_id uuid,display_name text,connection_status text)
language sql security invoker set search_path='' as $$select * from coaching_private.find_athlete_by_email(p_email)$$;
create function public.invite_existing_athlete(p_email text) returns uuid
language sql security invoker set search_path='' as $$select coaching_private.invite_existing_athlete(p_email)$$;
create function public.my_coaching_invitations()
returns table(id uuid,coach_id uuid,athlete_id uuid,coach_name text,athlete_name text,direction text,created_at timestamptz)
language sql stable security invoker set search_path='' as $$select * from coaching_private.my_coaching_invitations()$$;
create function public.respond_coaching_invitation(p_invitation_id uuid,p_accept boolean) returns void
language sql security invoker set search_path='' as $$select coaching_private.respond_coaching_invitation(p_invitation_id,p_accept)$$;
create function public.cancel_coaching_invitation(p_invitation_id uuid) returns void
language sql security invoker set search_path='' as $$select coaching_private.cancel_coaching_invitation(p_invitation_id)$$;
revoke all on function public.find_athlete_by_email(text),public.invite_existing_athlete(text),public.my_coaching_invitations(),public.respond_coaching_invitation(uuid,boolean),public.cancel_coaching_invitation(uuid) from public,anon,authenticated;
grant execute on function public.find_athlete_by_email(text),public.invite_existing_athlete(text),public.my_coaching_invitations(),public.respond_coaching_invitation(uuid,boolean),public.cancel_coaching_invitation(uuid) to authenticated;
