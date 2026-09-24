-- Privacy is independent from the existing edit lock. Historical events remain
-- shared, and all calendar/relationship permissions still apply.
alter table public.personal_events add column is_private boolean not null default false;
grant insert(is_private),update(is_private) on public.personal_events to authenticated;
comment on column public.personal_events.is_private is 'When true, only its author may access this calendar note, subject to the existing calendar permissions. Independent from is_locked.';

-- Restrictive policies are ANDed with every existing permissive policy. This
-- covers SELECT, INSERT, UPDATE (both the old and new row), and DELETE without
-- broadening an author's calendar access after a coaching link is revoked.
create policy event_private_author on public.personal_events
 as restrictive for all to authenticated
 using (not is_private or created_by=(select auth.uid()))
 with check (not is_private or created_by=(select auth.uid()));

create function app_private.protect_event_privacy()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if new.is_private is distinct from old.is_private
   and auth.uid() is not null and old.created_by is distinct from auth.uid() then
  raise exception 'Seul l’auteur peut changer la confidentialité de cette note.' using errcode='42501';
 end if;
 return new;
end;
$$;
revoke all on function app_private.protect_event_privacy() from public,anon,authenticated;
create trigger event_privacy_guard before update on public.personal_events
 for each row execute function app_private.protect_event_privacy();
