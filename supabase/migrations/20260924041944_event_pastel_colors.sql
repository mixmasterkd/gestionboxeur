-- Presentation only; existing calendar ownership and lock policies remain authoritative.
alter table public.personal_events
  add column color text not null default 'sand'
  check (color in ('sand', 'coral', 'blue', 'lavender', 'mint'));
grant insert(color), update(color) on public.personal_events to authenticated;
