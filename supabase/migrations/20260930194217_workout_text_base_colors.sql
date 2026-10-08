-- Add base colors alongside the existing pastel keys, preserving all document validation and privileges.
create or replace function app_private.valid_workout_document(p_document jsonb)
returns boolean language plpgsql immutable security invoker set search_path='' as $$
declare
 v_mark jsonb;
 v_length integer;
 v_start numeric;
 v_end numeric;
begin
 if p_document is null then return true; end if;
 if jsonb_typeof(p_document) is distinct from 'object'
   or p_document->'version' is distinct from '1'::jsonb
   or jsonb_typeof(p_document->'text') is distinct from 'string'
   or jsonb_typeof(p_document->'marks') is distinct from 'array'
   or octet_length(p_document::text)>500000 then return false; end if;
 -- Browser ranges use UTF-16 offsets: an emoji outside the BMP counts twice.
 v_length:=length(regexp_replace(p_document->>'text',U&'[\+010000-\+10FFFF]','xx','g'));
 if v_length>20000 or jsonb_array_length(p_document->'marks')>2000 then return false; end if;
 for v_mark in select value from jsonb_array_elements(p_document->'marks') loop
  if jsonb_typeof(v_mark) is distinct from 'object'
    or jsonb_typeof(v_mark->'start') is distinct from 'number'
    or jsonb_typeof(v_mark->'end') is distinct from 'number' then return false; end if;
  v_start:=(v_mark->>'start')::numeric; v_end:=(v_mark->>'end')::numeric;
  if v_start<>trunc(v_start) or v_end<>trunc(v_end) or v_start<0 or v_end<=v_start or v_end>v_length then return false; end if;
  if v_mark ? 'bold' and v_mark->'bold' is distinct from 'true'::jsonb then return false; end if;
  if v_mark ? 'underline' and v_mark->'underline' is distinct from 'true'::jsonb then return false; end if;
  if v_mark ? 'color' and (jsonb_typeof(v_mark->'color') is distinct from 'string' or v_mark->>'color' not in ('coral','blue','mint','lavender','red','royal','green','yellow','orange','purple')) then return false; end if;
 end loop;
 return true;
end;
$$;
revoke all on function app_private.valid_workout_document(jsonb) from public,anon,authenticated;
grant execute on function app_private.valid_workout_document(jsonb) to authenticated,service_role;
