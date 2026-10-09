-- Local review: scoped roster invitations and explicit, revocable group-only links.
-- The token is returned once and only its SHA-256 digest is retained.
create table public.group_join_links (
 id uuid primary key default gen_random_uuid(),
 group_id uuid not null references public.training_groups(id) on delete cascade,
 created_by uuid not null references public.profiles(id) on delete cascade,
 token_hash bytea not null unique check(octet_length(token_hash)=32),
 created_at timestamptz not null default now(),
 expires_at timestamptz not null,
 revoked_at timestamptz,
 check(expires_at>created_at and expires_at<=created_at+interval '30 days')
);
create index group_join_links_group_idx on public.group_join_links(group_id,expires_at) where revoked_at is null;
create index group_join_links_creator_idx on public.group_join_links(created_by);
alter table public.group_join_links enable row level security;
revoke all on public.group_join_links from public,anon,authenticated;
grant all on public.group_join_links to service_role;

-- An internal check for the original inviter, independent of the current caller.
create function app_private.community_can_invite(p_group uuid,p_user uuid,p_role text)
returns boolean language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.training_groups g where g.id=p_group and
  (g.coach_id=p_user or (p_role='member' and exists(select 1 from public.training_group_members m
   join public.athletes a on a.id=m.athlete_id where m.group_id=g.id and a.user_id=p_user and m.role='admin'))));
$$;
revoke all on function app_private.community_can_invite(uuid,uuid,text) from public,anon,authenticated;

-- Accent folding avoids an extension requirement in local and hosted databases.
create function app_private.community_search_text(p_text text)
returns text language sql immutable security invoker set search_path='' as $$
 select translate(replace(replace(lower(coalesce(p_text,'')),'œ','oe'),'æ','ae'),'àáâãäåçèéêëìíîïñòóôõöùúûüýÿ','aaaaaaceeeeiiiinooooouuuuyy');
$$;
revoke all on function app_private.community_search_text(text) from public,anon,authenticated;

-- Keep the previous calendar/content implementation private and route new actions
-- through the same authenticated entry point and membership transaction lock.
alter function app_private.community_command(text,jsonb) rename to community_calendar_command;
revoke all on function app_private.community_calendar_command(text,jsonb) from public,anon,authenticated;
create function app_private.community_command(p_action text,p_data jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 v_uid uuid:=auth.uid(); v_gid uuid; v_role text; v_new_role text; v_query text; v_offset integer;
 v_result jsonb; v_items jsonb:='[]'; v_ids uuid[]; v_user uuid; v_aid uuid;
 v_inv public.group_invitations%rowtype; v_link public.group_join_links%rowtype;
 v_group public.training_groups%rowtype; v_id uuid; v_token text; v_expires timestamptz;
 v_total integer; v_invited integer:=0; v_pending integer:=0; v_members integer:=0;
begin
 if v_uid is null or not exists(select 1 from public.profiles where id=v_uid) then raise exception 'Connecte-toi.' using errcode='42501'; end if;
 if jsonb_typeof(p_data) is distinct from 'object' then raise exception 'Données invalides.'; end if;
 if p_action='group_detail' then
  v_result:=app_private.community_calendar_command(p_action,p_data);
  v_gid:=(v_result->'group'->>'id')::uuid;
  return v_result||jsonb_build_object('join_links',case when app_private.community_manages(v_gid) then
   coalesce((select jsonb_agg(jsonb_build_object('id',l.id,'created_at',l.created_at,'expires_at',l.expires_at,'created_by',l.created_by,'inviter_name',p.full_name) order by l.created_at desc)
    from public.group_join_links l join public.profiles p on p.id=l.created_by where l.group_id=v_gid and l.revoked_at is null and l.expires_at>now() and app_private.community_can_invite(l.group_id,l.created_by,'member')),'[]'::jsonb)
   else '[]'::jsonb end);
 end if;
 if p_action not in ('invite_candidates','invite_members','create_join_link','inspect_join_link','accept_join_link','revoke_join_link') then
  return app_private.community_calendar_command(p_action,p_data);
 end if;

 if p_action in ('inspect_join_link','accept_join_link') then
  -- Invalid, expired, revoked, and departed-inviter links have one opaque failure.
  v_token:=p_data->>'token';
  if v_token is null or v_token !~ '^[0-9a-f]{64}$' then raise exception 'Lien d’invitation invalide ou expiré.' using errcode='42501'; end if;
  if p_action='accept_join_link' then perform pg_advisory_xact_lock(61030,1); end if;
  select * into v_link from public.group_join_links where token_hash=sha256(convert_to(v_token,'UTF8'));
  if not found or v_link.revoked_at is not null or v_link.expires_at<=now() or not app_private.community_can_invite(v_link.group_id,v_link.created_by,'member') then
   raise exception 'Lien d’invitation invalide ou expiré.' using errcode='42501';
  end if;
  v_gid:=v_link.group_id; v_role:=app_private.community_role(v_gid);
  select * into v_group from public.training_groups where id=v_gid;
  if p_action='inspect_join_link' then
   return jsonb_build_object('id',v_link.id,'group',jsonb_build_object('id',v_gid,'name',v_group.name,'description',v_group.description),
    'inviter_name',(select full_name from public.profiles where id=v_link.created_by),'expires_at',v_link.expires_at,'already_member',v_role is not null,'role','member');
  end if;
  if v_role is not null then return jsonb_build_object('group_id',v_gid,'accepted',true,'already_member',true,'role',v_role); end if;
  if (select count(*) from public.training_group_members where group_id=v_gid)>=500 then raise exception 'Le groupe est complet.'; end if;
  select id into v_aid from public.athletes where user_id=v_uid;
  if v_aid is null then raise exception 'Complète ton profil avant de rejoindre un groupe.'; end if;
  -- Only the account's existing profile is used. Email matches never attach a roster sheet.
  insert into public.training_group_members(group_id,athlete_id,role,accepted_group_access) values(v_gid,v_aid,'member',true);
  update public.group_invitations set status='accepted',responded_at=now() where group_id=v_gid and user_id=v_uid and status='pending';
  perform app_private.community_refresh_group(v_gid);
  update public.training_groups set updated_at=now() where id=v_gid;
  return jsonb_build_object('group_id',v_gid,'accepted',true,'already_member',false,'role','member');
 end if;

 v_gid:=nullif(p_data->>'group_id','')::uuid;
 if p_action<>'invite_candidates' then perform pg_advisory_xact_lock(61030,1); end if;
 v_role:=app_private.community_role(v_gid);
 if v_role is null or v_role not in ('owner','admin') then raise exception 'Administration du groupe requise.' using errcode='42501'; end if;
 select * into v_group from public.training_groups where id=v_gid;
 if p_action='invite_candidates' then
  v_query:=trim(coalesce(p_data->>'query','')); v_offset:=coalesce(nullif(p_data->>'offset','')::integer,0);
  if char_length(v_query)>200 or v_offset<0 or v_offset>10000 then raise exception 'Recherche invalide.'; end if;
  with candidates as (
   select a.id athlete_id,a.user_id,a.first_name,a.last_name,trim(coalesce(a.first_name,'')||' '||coalesce(a.last_name,'')) name,a.email,
    case when a.user_id=v_group.coach_id or m.athlete_id is not null then 'member'
     when a.user_id is null then 'sans_compte'
     when i.status='pending' and i.expires_at>now() and app_private.community_can_invite(v_gid,i.invited_by,i.role) then 'pending' else 'available' end status,
    case when a.user_id=v_group.coach_id then 'owner' else m.role end role
   from public.coach_athletes c join public.athletes a on a.id=c.athlete_id
   left join public.training_group_members m on m.group_id=v_gid and m.athlete_id=a.id
   left join public.group_invitations i on i.group_id=v_gid and i.user_id=a.user_id
   where c.coach_id=v_uid and c.status='accepted' and not exists(
    select 1 from regexp_split_to_table(app_private.community_search_text(v_query),'\s+') term where position(term in app_private.community_search_text(concat_ws(' ',a.first_name,a.last_name,a.email)))=0)
  ), page as (select * from candidates order by app_private.community_search_text(last_name),app_private.community_search_text(first_name),athlete_id limit 30 offset v_offset)
  select (select count(*)::integer from candidates),coalesce((select jsonb_agg(to_jsonb(page) order by app_private.community_search_text(last_name),app_private.community_search_text(first_name),athlete_id) from page),'[]'::jsonb) into v_total,v_items;
  return jsonb_build_object('items',v_items,'offset',v_offset,'next_offset',case when v_offset+30<v_total then v_offset+30 else null end,'total',v_total);
 end if;
 if p_action='invite_members' then
  v_new_role:=coalesce(p_data->>'role','member');
  if v_new_role not in ('member','admin') or (v_new_role='admin' and v_role<>'owner') then raise exception 'Seul le créateur peut nommer un admin.' using errcode='42501'; end if;
  if jsonb_typeof(p_data->'user_ids') is distinct from 'array' then raise exception 'Sélection invalide.'; end if;
  if jsonb_array_length(p_data->'user_ids') not between 1 and 50 then raise exception 'Choisis de 1 à 50 personnes.'; end if;
  select array_agg(distinct value::uuid order by value::uuid) into v_ids from jsonb_array_elements_text(p_data->'user_ids');
  -- Lock only accepted relations owned by this account. Group visibility is never a roster source.
  perform c.athlete_id from public.coach_athletes c join public.athletes a on a.id=c.athlete_id
   where c.coach_id=v_uid and c.status='accepted' and a.user_id=any(v_ids) order by c.athlete_id for share of c;
  if exists(select 1 from unnest(v_ids) u where u is null or not exists(select 1 from public.coach_athletes c join public.athletes a on a.id=c.athlete_id where c.coach_id=v_uid and c.status='accepted' and a.user_id=u)) then
   raise exception 'Certaines personnes ne sont plus dans ta liste d’athlètes liés. Actualise la liste.' using errcode='42501';
  end if;
  foreach v_user in array v_ids loop
   if v_user=v_group.coach_id or exists(select 1 from public.training_group_members m join public.athletes a on a.id=m.athlete_id where m.group_id=v_gid and a.user_id=v_user) then
    v_members:=v_members+1; v_items:=v_items||jsonb_build_array(jsonb_build_object('user_id',v_user,'status','member')); continue;
   end if;
   select * into v_inv from public.group_invitations where group_id=v_gid and user_id=v_user;
   if found and v_inv.status='pending' and v_inv.expires_at>now() and app_private.community_can_invite(v_gid,v_inv.invited_by,v_inv.role) then
    v_pending:=v_pending+1; v_items:=v_items||jsonb_build_array(jsonb_build_object('user_id',v_user,'id',v_inv.id,'status','pending')); continue;
   end if;
   if v_inv.responded_at>now()-interval '1 day' then raise exception 'Attends avant de renvoyer cette invitation.'; end if;
   if (select count(*) from public.group_invitations where invited_by=v_uid and created_at>now()-interval '1 day')>=50 then raise exception 'Limite quotidienne d’invitations atteinte.'; end if;
   insert into public.group_invitations(group_id,user_id,invited_by,role) values(v_gid,v_user,v_uid,v_new_role)
    on conflict(group_id,user_id) do update set invited_by=v_uid,role=v_new_role,status='pending',created_at=now(),expires_at=now()+interval '30 days',responded_at=null returning id into v_id;
   v_invited:=v_invited+1; v_items:=v_items||jsonb_build_array(jsonb_build_object('user_id',v_user,'id',v_id,'status','invited'));
  end loop;
  return jsonb_build_object('invited_count',v_invited,'pending_count',v_pending,'member_count',v_members,'items',v_items);
 end if;
 if p_action='create_join_link' then
  if p_data ? 'role' and p_data->>'role' is distinct from 'member' then raise exception 'Un lien de groupe invite uniquement des membres.'; end if;
  v_expires:=coalesce(nullif(p_data->>'expires_at','')::timestamptz,now()+interval '7 days');
  if v_expires<=now() or v_expires>now()+interval '30 days' then raise exception 'Expiration invalide (30 jours maximum).'; end if;
  -- Each UUID supplies 122 random bits; concatenate two, independent of pgcrypto installation.
  v_token:=replace(gen_random_uuid()::text||gen_random_uuid()::text,'-','');
  update public.group_join_links set revoked_at=now() where group_id=v_gid and revoked_at is null;
  insert into public.group_join_links(group_id,created_by,token_hash,expires_at) values(v_gid,v_uid,sha256(convert_to(v_token,'UTF8')),v_expires) returning id into v_id;
  return jsonb_build_object('id',v_id,'group_id',v_gid,'token',v_token,'expires_at',v_expires);
 end if;
 if p_action='revoke_join_link' then
  v_id:=nullif(p_data->>'id','')::uuid;
  if v_id is not null and not exists(select 1 from public.group_join_links where id=v_id and group_id=v_gid) then raise exception 'Lien inaccessible.' using errcode='42501'; end if;
  update public.group_join_links set revoked_at=coalesce(revoked_at,now()) where group_id=v_gid and (v_id is null or id=v_id);
  return jsonb_build_object('revoked',true);
 end if;
 raise exception 'Action inconnue.';
end;
$$;
revoke all on function app_private.community_command(text,jsonb) from public,anon,authenticated;
grant execute on function app_private.community_command(text,jsonb) to authenticated;
create or replace function public.community_command(p_action text,p_data jsonb default '{}')
returns jsonb language sql security invoker set search_path='' as $$select app_private.community_command(p_action,p_data);$$;
revoke all on function public.community_command(text,jsonb) from public,anon,authenticated;
grant execute on function public.community_command(text,jsonb) to authenticated;
