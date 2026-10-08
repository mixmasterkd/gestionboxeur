-- Additive endpoints: existing clients remain compatible. New clients bind
-- writes to the account/form that was loaded, even after a cross-tab sign-in.
create function public.save_athlete_profile_checked(p_expected_user_id uuid,p_data jsonb)
returns uuid language plpgsql security invoker set search_path='' as $$
begin
  if auth.uid() is null or auth.uid() is distinct from p_expected_user_id then
    raise exception 'La session a changé. Recharge ton profil.' using errcode='42501';
  end if;
  return public.save_athlete_profile(p_data);
end;
$$;
create function public.save_gym_checked(p_expected_user_id uuid,p_name text,p_address text)
returns uuid language plpgsql security invoker set search_path='' as $$
begin
  if auth.uid() is null or auth.uid() is distinct from p_expected_user_id then
    raise exception 'La session a changé. Recharge ton profil.' using errcode='42501';
  end if;
  return public.save_gym(p_name,p_address);
end;
$$;
create function public.enable_coaching_checked(p_expected_user_id uuid)
returns void language plpgsql security invoker set search_path='' as $$
begin
  if auth.uid() is null or auth.uid() is distinct from p_expected_user_id then
    raise exception 'La session a changé. Recharge ton profil.' using errcode='42501';
  end if;
  perform public.enable_coaching();
end;
$$;

-- Same lock order as attachment: athlete first, then the caller's relation.
-- Keep privileged access internal; permission and both versions are checked
-- under these locks before delegating to the existing validated update.
create function coaching_private.update_roster_athlete_checked(
  p_athlete_id uuid,p_data jsonb,p_expected_user_id uuid,
  p_updated_at timestamptz,p_relation_updated_at timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_version timestamptz; v_relation_version timestamptz;
begin
  if auth.uid() is null or auth.uid() is distinct from p_expected_user_id
    or not public.coach_has_permission(p_athlete_id,'roster') then
    raise exception 'Accès au roster refusé ou session modifiée.' using errcode='42501';
  end if;
  select updated_at into v_version from public.athletes where id=p_athlete_id for update;
  select updated_at into v_relation_version from public.coach_athletes
    where athlete_id=p_athlete_id and coach_id=auth.uid() and status='accepted' for update;
  if not found then raise exception 'Accès au roster refusé.' using errcode='42501'; end if;
  if p_updated_at is null or p_relation_updated_at is null
    or v_version is distinct from p_updated_at or v_relation_version is distinct from p_relation_updated_at then
    raise exception 'Cette fiche a changé. Ferme-la puis rouvre-la avant de réessayer. Tes modifications n’ont pas été enregistrées.' using errcode='40001';
  end if;
  perform public.update_roster_athlete(p_athlete_id,p_data);
  return (select jsonb_build_object('updated_at',a.updated_at,'relation_updated_at',c.updated_at)
    from public.athletes a join public.coach_athletes c on c.athlete_id=a.id
    where a.id=p_athlete_id and c.coach_id=auth.uid());
end;
$$;
create function public.update_roster_athlete_checked(
  p_athlete_id uuid,p_data jsonb,p_expected_user_id uuid,
  p_updated_at timestamptz,p_relation_updated_at timestamptz)
returns jsonb language sql security invoker set search_path='' as $$
  select coaching_private.update_roster_athlete_checked(p_athlete_id,p_data,p_expected_user_id,p_updated_at,p_relation_updated_at);
$$;
revoke all on function public.save_athlete_profile_checked(uuid,jsonb),public.save_gym_checked(uuid,text,text),public.enable_coaching_checked(uuid),
  public.update_roster_athlete_checked(uuid,jsonb,uuid,timestamptz,timestamptz),
  coaching_private.update_roster_athlete_checked(uuid,jsonb,uuid,timestamptz,timestamptz) from public,anon,authenticated;
grant execute on function public.save_athlete_profile_checked(uuid,jsonb),public.save_gym_checked(uuid,text,text),public.enable_coaching_checked(uuid),
  public.update_roster_athlete_checked(uuid,jsonb,uuid,timestamptz,timestamptz),
  coaching_private.update_roster_athlete_checked(uuid,jsonb,uuid,timestamptz,timestamptz) to authenticated;
