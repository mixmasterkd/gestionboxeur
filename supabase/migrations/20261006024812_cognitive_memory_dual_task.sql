-- Applied to production after release approval as remote version 20261006033329.
alter table public.cognitive_records drop constraint cognitive_records_mode_check;
alter table public.cognitive_records add constraint cognitive_records_mode_check check (mode in (
  'tiles-4','tiles-6','tiles-8','bag-sequence-visible','bag-sequence-hidden','bag-targets-visible','bag-targets-hidden',
  'visual-memory','dual-task'
));
alter table public.cognitive_records add column best_result jsonb, add column last_result jsonb;
alter table public.cognitive_records add constraint cognitive_records_results_check check (
  (best_result is null or (jsonb_typeof(best_result) = 'object' and octet_length(best_result::text) <= 4096)) and
  (last_result is null or (jsonb_typeof(last_result) = 'object' and octet_length(last_result::text) <= 4096))
);
grant insert (best_result,last_result), update (best_result,last_result) on public.cognitive_records to authenticated;

create function public.save_cognitive_result(p_mode text, p_result jsonb, p_expected_owner uuid)
returns table(mode text,best_result jsonb,last_result jsonb)
language plpgsql security invoker set search_path = '' as $$
declare
  owner uuid := auth.uid();
  fields text[];
  field text;
  value integer;
  submitted_score integer;
  normalized jsonb := '{}'::jsonb;
begin
  if owner is null or owner is distinct from p_expected_owner then
    raise exception 'Authentication required or account changed' using errcode='42501';
  end if;
  if p_mode is null or p_mode not in ('visual-memory','dual-task') or p_result is null
     or jsonb_typeof(p_result) <> 'object' or octet_length(p_result::text)>4096 then
    raise exception 'Invalid cognitive result' using errcode='22023';
  end if;
  fields := case when p_mode='visual-memory' then array['levelReached','maxLevel','errors']
    else array['score','targetsHit','targetsMissed','inhibitionErrors','triangleCount','triangleAnswer','triangleError','precision'] end;
  foreach field in array fields loop
    if not (p_result ? field) or jsonb_typeof(p_result->field)<>'number' or (p_result->>field) !~ '^[0-9]{1,5}$' then
      raise exception 'Invalid result field' using errcode='22023';
    end if;
    value := (p_result->>field)::integer;
    if value>10000 then raise exception 'Invalid result field' using errcode='22023'; end if;
    normalized := normalized || jsonb_build_object(field,value);
  end loop;
  if p_mode='visual-memory' then
    if (p_result->>'levelReached')::integer not between 1 and 30 or (p_result->>'maxLevel')::integer > (p_result->>'levelReached')::integer
       or (p_result->>'errors')::integer>3 then raise exception 'Invalid memory result' using errcode='22023'; end if;
    submitted_score := (p_result->>'maxLevel')::integer;
  else
    if (p_result->>'targetsHit')::integer+(p_result->>'targetsMissed')::integer+(p_result->>'triangleCount')::integer<>30
       or (p_result->>'triangleCount')::integer not between 8 and 12 or (p_result->>'triangleAnswer')::integer>30
       or (p_result->>'inhibitionErrors')::integer>(p_result->>'triangleCount')::integer
       or (p_result->>'triangleError')::integer<>abs((p_result->>'triangleCount')::integer-(p_result->>'triangleAnswer')::integer)
       or (p_result->>'precision')::integer>100 or (p_result->>'score')::integer>600 then
      raise exception 'Invalid dual task result' using errcode='22023';
    end if;
    foreach field in array array['averageReactionTime','bestReactionTime'] loop
      if not (p_result ? field) then raise exception 'Invalid reaction time' using errcode='22023'; end if;
      if (p_result->>'targetsHit')::integer=0 then
        if p_result->field <> 'null'::jsonb then raise exception 'Invalid reaction time' using errcode='22023'; end if;
      else
        if jsonb_typeof(p_result->field)<>'number' or (p_result->>field) !~ '^[0-9]{1,4}$' then raise exception 'Invalid reaction time' using errcode='22023'; end if;
        if (p_result->>field)::integer not between 1 and 1150 then raise exception 'Invalid reaction time' using errcode='22023'; end if;
      end if;
      normalized := normalized || jsonb_build_object(field,p_result->field);
    end loop;
    submitted_score := (p_result->>'score')::integer;
  end if;
  normalized := normalized || jsonb_build_object('date',to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
  return query insert into public.cognitive_records as saved(owner_id,mode,score,best_result,last_result)
    values(owner,p_mode,submitted_score,normalized,normalized)
    on conflict on constraint cognitive_records_pkey do update set
      score=greatest(saved.score,excluded.score),
      best_result=case when excluded.score>saved.score or saved.best_result is null then excluded.best_result else saved.best_result end,
      last_result=excluded.last_result
    returning saved.mode,saved.best_result,saved.last_result;
end;
$$;
revoke all on function public.save_cognitive_result(text,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.save_cognitive_result(text,jsonb,uuid) to authenticated;
