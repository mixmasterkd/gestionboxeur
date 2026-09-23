-- Compatible security patch: the existing roster application may remain online.
-- RLS alone does not prevent changing sensitive columns on one's own profile.
revoke update on public.profiles from public,anon,authenticated;
revoke update(id,full_name,phone,is_admin,created_at,updated_at) on public.profiles from public,anon,authenticated;
grant update(full_name,phone) on public.profiles to authenticated;
alter function public.set_updated_at() set search_path='';
revoke all on function public.handle_new_user(),public.set_updated_at() from public,anon,authenticated;
