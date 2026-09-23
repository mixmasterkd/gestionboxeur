-- Completion is a separate athlete-owned status, not inferred from RPE feedback.
-- Existing post-session feedback implies completion during this one-time upgrade.
alter table public.training_sessions add column completed_at timestamptz;
comment on column public.training_sessions.completed_at is 'Séance marquée terminée par son athlète; indépendant du feedback et du verrou de contenu.';

update public.training_sessions s set completed_at=coalesce(f.updated_at,f.created_at)
from public.session_feedback f where f.session_id=s.id;

-- Calendar SELECT already includes all columns, including this new status.
-- Clients must use the ownership-checked RPC, even on their own unlocked sessions.
revoke insert(completed_at),update(completed_at) on public.training_sessions from public,anon,authenticated;

create function public.set_session_completed(p_session_id uuid,p_completed boolean)
returns timestamptz language plpgsql security definer set search_path='' as $$
declare v_athlete uuid; v_completed_at timestamptz;
begin
  if p_completed is null then raise exception 'Statut de séance invalide.'; end if;
  select athlete_id,completed_at into v_athlete,v_completed_at
    from public.training_sessions where id=p_session_id for update;
  if not found or not public.owns_athlete(v_athlete) then
    raise exception 'Seul cet athlète peut marquer sa séance terminée ou annuler ce statut.' using errcode='42501';
  end if;
  if p_completed and v_completed_at is null then
    update public.training_sessions set completed_at=now() where id=p_session_id returning completed_at into v_completed_at;
  elsif not p_completed and v_completed_at is not null then
    update public.training_sessions set completed_at=null where id=p_session_id;
    v_completed_at:=null;
  end if;
  return v_completed_at;
end;
$$;

-- This guard covers both the RPC and direct permitted INSERT/UPDATE statements.
-- Locking the session row serializes feedback writes with completion/undo requests.
create function public.require_completed_session_feedback()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_completed_at timestamptz;
begin
  if auth.role()='authenticated' and not public.owns_athlete(new.athlete_id) then
    raise exception 'Seul cet athlète peut donner son feedback.' using errcode='42501';
  end if;
  select completed_at into v_completed_at from public.training_sessions
    where id=new.session_id and athlete_id=new.athlete_id for share;
  if not found then raise exception 'Seul cet athlète peut donner son feedback sur sa séance.' using errcode='42501'; end if;
  if v_completed_at is null then
    raise exception 'Marque cette séance terminée avant de donner ton retour.' using errcode='23514';
  end if;
  return new;
end;
$$;
-- FK maintenance may clear created_by when an account is deleted; it is not a
-- new feedback edit and must preserve historical feedback even after undo.
create trigger feedback_requires_completion before insert or update of rpe,feeling,comment on public.session_feedback
  for each row execute function public.require_completed_session_feedback();

create or replace function public.save_session_feedback(p_session_id uuid,p_rpe integer,p_feeling integer,p_comment text default '')
returns void language plpgsql security definer set search_path='' as $$
declare v_athlete uuid; v_completed_at timestamptz;
begin
  select athlete_id,completed_at into v_athlete,v_completed_at from public.training_sessions where id=p_session_id for share;
  if not found or not public.owns_athlete(v_athlete) then raise exception 'Seul cet athlète peut donner son feedback.' using errcode='42501'; end if;
  if v_completed_at is null then raise exception 'Marque cette séance terminée avant de donner ton retour.' using errcode='23514'; end if;
  insert into public.session_feedback(session_id,athlete_id,created_by,rpe,feeling,comment)
    values(p_session_id,v_athlete,auth.uid(),p_rpe,p_feeling,coalesce(p_comment,''))
    on conflict(session_id) do update set rpe=excluded.rpe,feeling=excluded.feeling,comment=excluded.comment;
end;
$$;

revoke all on function public.set_session_completed(uuid,boolean),public.require_completed_session_feedback() from public,anon,authenticated;
grant execute on function public.set_session_completed(uuid,boolean) to authenticated;
