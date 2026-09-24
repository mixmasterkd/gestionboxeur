-- Private library folders; existing templates remain unfiled.
create table public.library_folders (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
 name text not null check(length(trim(name)) between 1 and 80),
 created_at timestamptz not null default now(),
 unique(owner_id,name), unique(owner_id,id)
);
alter table public.library_folders enable row level security;
revoke all on public.library_folders from public,anon,authenticated;
grant select,delete on public.library_folders to authenticated;
grant insert(name),update(name) on public.library_folders to authenticated;
grant all on public.library_folders to service_role;
create policy folder_owner on public.library_folders for all to authenticated
 using(owner_id=(select auth.uid())) with check(owner_id=(select auth.uid()));
alter table public.session_templates add column folder_id uuid;
alter table public.session_templates add constraint template_folder_owner foreign key(coach_id,folder_id)
 references public.library_folders(owner_id,id) on delete set null (folder_id);
create index session_templates_folder_idx on public.session_templates(coach_id,folder_id);
grant insert(folder_id),update(folder_id) on public.session_templates to authenticated;

-- Journal access follows the direct athlete/coach calendar relationship.
-- Reading requires calendar access; contributing requires the add permission.
create table public.journal_entries (
 id uuid primary key default gen_random_uuid(),
 athlete_id uuid not null references public.athletes(id) on delete cascade,
 created_by uuid not null default auth.uid() references public.profiles(id) on delete cascade,
 author_name text not null default '',
 title text not null check(length(trim(title)) between 1 and 160),
 body text not null default '' check(length(body)<=20000),
 status text not null default 'explore' check(status in ('explore','work','maintain')),
 archived boolean not null default false,
 created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp()
);
create index journal_entries_athlete_idx on public.journal_entries(athlete_id,archived,updated_at desc);
create index journal_entries_author_idx on public.journal_entries(created_by);
create table public.journal_updates (
 id uuid primary key default gen_random_uuid(),
 entry_id uuid not null references public.journal_entries(id) on delete cascade,
 created_by uuid not null default auth.uid() references public.profiles(id) on delete cascade,
 author_name text not null default '',
 kind text not null default 'comment' check(kind in ('created','comment','status','archived','restored','edited')),
 content text not null default '' check(length(content)<=20000),
 created_at timestamptz not null default clock_timestamp()
);
create index journal_updates_entry_idx on public.journal_updates(entry_id,created_at desc);
create index journal_updates_author_idx on public.journal_updates(created_by);
alter table public.journal_entries enable row level security;
alter table public.journal_updates enable row level security;
revoke all on public.journal_entries,public.journal_updates from public,anon,authenticated;
grant select on public.journal_entries,public.journal_updates to authenticated;
grant insert(athlete_id,title,body,status),update(title,body,status,archived) on public.journal_entries to authenticated;
grant insert(entry_id,content) on public.journal_updates to authenticated;
grant all on public.journal_entries,public.journal_updates to service_role;
create policy journal_read on public.journal_entries for select to authenticated
 using(public.owns_athlete(athlete_id) or public.coach_has_permission(athlete_id,'calendar'));
create policy journal_create on public.journal_entries for insert to authenticated
 with check(created_by=(select auth.uid()) and (public.owns_athlete(athlete_id) or public.coach_has_permission(athlete_id,'add')));
create policy journal_change on public.journal_entries for update to authenticated
 using(public.owns_athlete(athlete_id) or public.coach_has_permission(athlete_id,'add'))
 with check(public.owns_athlete(athlete_id) or public.coach_has_permission(athlete_id,'add'));
create policy journal_history_read on public.journal_updates for select to authenticated
 using(exists(select 1 from public.journal_entries e where e.id=entry_id));
create policy journal_comment on public.journal_updates for insert to authenticated
 with check(created_by=(select auth.uid()) and kind='comment' and length(trim(content))>0 and exists(
 select 1 from public.journal_entries e where e.id=entry_id and not e.archived
 and (public.owns_athlete(e.athlete_id) or public.coach_has_permission(e.athlete_id,'add'))));

create schema if not exists app_private;
revoke all on schema app_private from public,anon,authenticated;
create function app_private.journal_stamp() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Connecte-toi pour écrire dans le journal.'; end if;
 if tg_op='INSERT' then
  new.created_by:=auth.uid();
  new.author_name:=coalesce((select full_name from public.profiles where id=auth.uid()),'');
  new.created_at:=clock_timestamp();
 else
  if (new.title is distinct from old.title or new.body is distinct from old.body) and old.created_by<>auth.uid()
   then raise exception 'Seul l’auteur peut modifier son texte. Ajoute un commentaire.'; end if;
 end if;
 if tg_table_name='journal_entries' then new.updated_at:=clock_timestamp(); end if;
 return new;
end $$;
create trigger journal_entry_stamp before insert or update on public.journal_entries for each row execute function app_private.journal_stamp();
create trigger journal_comment_stamp before insert on public.journal_updates for each row execute function app_private.journal_stamp();
create function app_private.journal_history() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Connecte-toi pour écrire dans le journal.'; end if;
 if tg_op='INSERT' then
  -- An invitation must never replace a signup profile that now owns a journal.
  update public.athletes set onboarding_stub=false where id=new.athlete_id and onboarding_stub;
  insert into public.journal_updates(entry_id,kind,content) values(new.id,'created',new.body);
 else
  if new.status is distinct from old.status then insert into public.journal_updates(entry_id,kind,content) values(new.id,'status',new.status); end if;
  if new.archived is distinct from old.archived then insert into public.journal_updates(entry_id,kind) values(new.id,case when new.archived then 'archived' else 'restored' end); end if;
  if new.title is distinct from old.title or new.body is distinct from old.body then insert into public.journal_updates(entry_id,kind,content) values(new.id,'edited',new.body); end if;
 end if;
 return new;
end $$;
create trigger journal_entry_history after insert or update on public.journal_entries for each row execute function app_private.journal_history();
revoke all on function app_private.journal_stamp(),app_private.journal_history() from public,anon,authenticated;
