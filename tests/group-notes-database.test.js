import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

test('common notes enforce author rights, private recipients, atomic membership and preserved history',async(t)=>{
 const db=new PGlite();
 const coach='71000000-0000-4000-8000-000000000001',first='71000000-0000-4000-8000-000000000002',second='71000000-0000-4000-8000-000000000003',outsider='71000000-0000-4000-8000-000000000004';
 const scalar=async(sql,args=[])=>Object.values((await db.query(sql,args)).rows[0]||{})[0];
 const admin=()=>db.exec('reset role');
 const login=async id=>{await admin();await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);await db.exec('set role authenticated');};
 const group=async(name,ids,existing)=>scalar('select public.save_training_group($1,$2,$3,$4)',[name,ids,existing?.id??null,existing?.updated_at??null]);
 const note=async(payload,existing)=>scalar('select public.save_shared_calendar_event($1,$2,$3)',[JSON.stringify(payload),existing?.id??null,existing?.updated_at??null]);
 const removeGroup=async existing=>scalar('select public.delete_training_group($1,$2)',[existing.id,existing.updated_at]);
 const removeNote=async existing=>scalar('select public.delete_shared_calendar_event($1,$2)',[existing.id,existing.updated_at]);
 const count=async id=>scalar('select count(*)::int from public.personal_events where shared_event_id=$1',[id]);
 const copy=async(id,athlete)=>scalar('select id from public.personal_events where shared_event_id=$1 and athlete_id=$2',[id,athlete]);
 try{
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;create function auth.role() returns text language sql stable as $$select 'authenticated'::text$$;grant usage on schema public,auth to anon,authenticated,service_role;grant execute on function auth.uid(),auth.role() to anon,authenticated,service_role;alter default privileges in schema public grant all on tables to public,anon,authenticated,service_role;`);
  const dir=new URL('../supabase/migrations/',import.meta.url);for(const name of (await readdir(dir)).filter(f=>f.endsWith('.sql')).sort())await db.exec(await readFile(new URL(name,dir),'utf8'));
  for(const [id,role] of [[coach,'coach'],[first,'athlete'],[second,'athlete'],[outsider,'coach']])await db.query('insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)',[id,id+'@example.test',JSON.stringify({full_name:role,account_type:role,birth_date:'2000-01-01'})]);
  const own=await scalar('select id from public.athletes where user_id=$1',[coach]),a=await scalar('select id from public.athletes where user_id=$1',[first]),b=await scalar('select id from public.athletes where user_id=$1',[second]),foreign=await scalar('select id from public.athletes where user_id=$1',[outsider]);
  await db.query("insert into public.coach_athletes(athlete_id,coach_id,status) values($1,$3,'accepted'),($2,$3,'accepted')",[a,b,coach]);
  const future=await scalar("select (current_date+7)::text"),past=await scalar("select (current_date-7)::text");
  await login(coach);
  let g=await group('Notes communes',[own,a]);
  let master=await note({title:'À apporter',date:future,group_ids:[g.id,g.id],athlete_ids:[a,a],notes:'Gants et serviette',color:'mint',is_private:true,is_locked:false});
  assert.equal(master.is_group_event,true);assert.equal(master.is_private,false);assert.equal(master.is_locked,true);assert.equal(await count(master.id),2);
  const aCopy=await copy(master.id,a);
  assert.equal(await scalar('select is_private from public.personal_events where id=$1',[aCopy]),false);
  await t.test('only the author can edit shared content; recipients cannot discover or forge another recipient',async()=>{
   await assert.rejects(()=>db.query("insert into public.personal_events(athlete_id,title,date,shared_event_id) values($1,'Forgée',$2,$3)",[b,future,master.id]),/permission denied/);
   await admin();await db.exec('grant insert(shared_event_id) on public.personal_events to authenticated');
   try{await login(coach);await assert.rejects(()=>db.query("insert into public.personal_events(athlete_id,title,date,shared_event_id) values($1,'Forgée',$2,$3)",[b,future,master.id]),/row-level security/);}
   finally{await admin();await db.exec('revoke insert(shared_event_id) on public.personal_events from authenticated');}
   await login(first);
   assert.equal(await scalar('select count(*)::int from public.shared_calendar_events'),0);assert.equal(await scalar('select count(*)::int from public.shared_event_groups'),0);assert.equal(await scalar('select count(*)::int from public.shared_event_athletes'),0);
   assert.equal(await count(master.id),1);
   assert.equal((await db.query("update public.personal_events set title='Divergence' where id=$1 returning id",[aCopy])).rows.length,0);
   assert.equal((await db.query('delete from public.personal_events where id=$1 returning id',[aCopy])).rows.length,0);
   await assert.rejects(()=>note({title:'Intrusion'},master),/coach requis/);
   await login(outsider);await assert.rejects(()=>note({title:'Autre coach'},master),/inaccessible/);await assert.rejects(()=>removeNote(master),/inaccessible/);
   await login(coach);
  });
  const original=master;
  master=await note({title:'Correction',notes:'Gants, serviette, eau',color:'blue'},master);
  assert.equal(await scalar('select title from public.personal_events where id=$1',[aCopy]),'Correction');
  await assert.rejects(()=>note({title:'Édition périmée'},original),/changé/);
  await assert.rejects(()=>removeNote(original),/changé/);
  const historical=await note({title:'Passé',date:past,group_ids:[g.id],athlete_ids:[]});
  let ongoing=await note({title:'Stage',date:past,end_date:future,group_ids:[g.id],athlete_ids:[]});
  g=await group(g.name,[own,a,b],g);
  assert.equal(await count(master.id),3);assert.equal(await count(historical.id),2);assert.equal(await count(ongoing.id),3);
  // Explicit clearing of an end date is preserved instead of falling back to the old range.
  ongoing=await note({end_date:null},ongoing);assert.equal(ongoing.end_date,null);
  assert.equal(await scalar('select end_date from public.personal_events where shared_event_id=$1 and athlete_id=$2',[ongoing.id,b]),null);
  let other=await group('Autre source',[b]);
  master=await note({group_ids:[g.id,other.id],athlete_ids:[a]},master);
  g=await group(g.name,[own],g);assert.equal(await count(master.id),3);assert.equal(await count(ongoing.id),3);
  await removeGroup(other);assert.equal(await count(master.id),2);
  await removeGroup(g);assert.equal(await count(master.id),1);assert.equal(await count(historical.id),2);
  const historicalCopy=await copy(historical.id,a);
  await removeNote(historical);assert.equal(await scalar('select title from public.personal_events where id=$1',[historicalCopy]),'Passé');assert.equal(await scalar('select shared_event_id from public.personal_events where id=$1',[historicalCopy]),null);
  await removeNote(master);assert.equal(await scalar('select count(*)::int from public.personal_events where id=$1',[aCopy]),0);
  await t.test('invalid or revoked recipients roll back writes and membership cannot mutate revoked calendars',async()=>{
   const baseline=await scalar('select count(*)::int from public.shared_calendar_events');
   await assert.rejects(()=>note({title:'Interdit',date:future,athlete_ids:[foreign],group_ids:[]}),/destinataire/);
   assert.equal(await scalar('select count(*)::int from public.shared_calendar_events'),baseline);
   let secured=await group('Permissions',[b]);let protectedNote=await note({title:'Droits',date:future,athlete_ids:[],group_ids:[secured.id]});
   const protectedCopy=await copy(protectedNote.id,b);
   await admin();await db.query('update public.coach_athletes set can_add_sessions=false,can_edit_own_sessions=false where athlete_id=$1 and coach_id=$2',[b,coach]);await login(coach);
   await assert.rejects(()=>note({title:'Non autorisé'},protectedNote),/destinataire/);
   assert.equal(await scalar('select title from public.shared_calendar_events where id=$1',[protectedNote.id]),'Droits');
   await removeGroup(secured);
   await login(second);assert.equal(await scalar('select title from public.personal_events where id=$1',[protectedCopy]),'Droits');
   await login(coach);await removeNote(protectedNote);
   await login(second);assert.equal(await scalar('select title from public.personal_events where id=$1',[protectedCopy]),'Droits');
   await login(coach);
  });
  await t.test('direct personal note privacy remains independent and anonymous callers cannot access the new API',async()=>{
   await db.query("insert into public.personal_events(athlete_id,title,date,is_private) values($1,'Privée',$2,true)",[own,future]);
   assert.equal(await scalar("select is_private from public.personal_events where title='Privée'"),true);
   await admin();await db.exec('set role anon');
   await assert.rejects(()=>db.query('select * from public.shared_calendar_events'),/permission denied/);
   await assert.rejects(()=>note({title:'Anonyme',date:future,athlete_ids:[own]}),/permission denied/);
  });
 }finally{await db.close();}
});
