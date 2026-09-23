-- Read-only deployment checks. Run using a trusted PostgreSQL connection.
-- No personal information, raw invitations, email addresses or secrets are returned.
begin read only;

select 'profiles' as entity, count(*) as rows from public.profiles
union all select 'athletes',count(*) from public.athletes
union all select 'coach_profiles',count(*) from public.coach_profiles
union all select 'coach_athletes',count(*) from public.coach_athletes;

select c.relname as table_name,c.relrowsecurity as rls_enabled
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname in ('profiles','gym_settings','athletes','coach_contacts',
  'coach_profiles','coach_athletes','training_sessions','personal_events','session_feedback','session_templates','athlete_invitations','gyms','admin_test_accounts')
order by c.relname;

select
  not has_column_privilege('authenticated','public.profiles','is_admin','UPDATE') as admin_is_protected,
  not has_column_privilege('authenticated','public.profiles','account_type','UPDATE') as role_is_protected,
  not has_column_privilege('authenticated','public.athletes','notes','SELECT') as legacy_notes_are_private,
  not has_column_privilege('authenticated','public.coach_athletes','can_add_sessions','UPDATE') as permissions_are_protected,
  not has_column_privilege('authenticated','public.training_sessions','created_by','UPDATE') as authors_are_immutable,
  has_column_privilege('authenticated','public.training_sessions','completed_at','SELECT') as completion_is_calendar_visible,
  not has_column_privilege('authenticated','public.training_sessions','completed_at','INSERT') as completion_insert_is_protected,
  not has_column_privilege('authenticated','public.training_sessions','completed_at','UPDATE') as completion_update_is_protected,
  has_function_privilege('authenticated','public.set_session_completed(uuid,boolean)','EXECUTE') as completion_rpc_is_available,
  not has_function_privilege('anon','public.set_session_completed(uuid,boolean)','EXECUTE') as completion_requires_login,
  has_function_privilege('authenticated','public.merge_roster_athlete(uuid,uuid,timestamptz,timestamptz,timestamptz,timestamptz,jsonb)','EXECUTE') as roster_attachment_rpc_is_available,
  not has_function_privilege('anon','public.merge_roster_athlete(uuid,uuid,timestamptz,timestamptz,timestamptz,timestamptz,jsonb)','EXECUTE') as roster_attachment_requires_login,
  not has_function_privilege('anon','public.accept_invitation(text)','EXECUTE') as invitation_requires_login,
  not has_table_privilege('authenticated','public.admin_test_accounts','INSERT') as test_mapping_is_server_owned,
  not has_function_privilege('anon','public.save_athlete_profile(jsonb)','EXECUTE') as profile_write_requires_login;

select tgname as safeguard,not tgisinternal as application_trigger
from pg_trigger where tgname in ('athlete_identity_guard','session_lock_guard','event_lock_guard','feedback_requires_completion');

select count(*)=1 as exactly_one_default_gym from public.gyms where is_default;

select count(*)=0 as all_legacy_athletes_backfilled
from public.athletes a
where a.coach_id is not null and not exists (
  select 1 from public.coach_athletes ca where ca.athlete_id=a.id and ca.coach_id=a.coach_id
);
rollback;
