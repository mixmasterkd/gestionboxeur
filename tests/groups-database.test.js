import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

test('group assignments are atomic, deduplicated and private; membership preserves history and feedback',async(t)=>{
 const db=new PGlite();
 const coach='61000000-0000-4000-8000-000000000001',first='61000000-0000-4000-8000-000000000002',second='61000000-0000-4000-8000-000000000003',outsider='61000000-0000-4000-8000-000000000004';
 const scalar=async(sql,args=[])=>Object.values((await db.query(sql,args)).rows[0]||{})[0];
 const admin=()=>db.exec('reset role');
 const login=async id=>{await admin();await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);await db.exec('set role authenticated');};
 const group=async(name,ids,existing)=>scalar('select public.save_training_group($1,$2,$3,$4)',[name,ids,existing?.id??null,existing?.updated_at??null]);
 const shared=async(payload,existing)=>scalar('select public.save_shared_training_session($1,$2,$3)',[JSON.stringify(payload),existing?.id??null,existing?.updated_at??null]);
 const remove=async existing=>scalar('select public.delete_training_group($1,$2)',[existing.id,existing.updated_at]);
 const count=async id=>scalar('select count(*)::int from public.training_sessions where shared_session_id=$1',[id]);
 const copy=async(id,athlete)=>scalar('select id from public.training_sessions where shared_session_id=$1 and athlete_id=$2',[id,athlete]);
 try{
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;create function auth.role() returns text language sql stable as $$select 'authenticated'::text$$;grant usage on schema public,auth to anon,authenticated,service_role;grant execute on function auth.uid(),auth.role() to anon,authenticated,service_role;alter default privileges in schema public grant all on tables to public,anon,authenticated,service_role;`);
  const dir=new URL('../supabase/migrations/',import.meta.url);for(const name of (await readdir(dir)).filter(f=>f.endsWith('.sql')).sort())await db.exec(await readFile(new URL(name,dir),'utf8'));
  for(const [id,role] of [[coach,'coach'],[first,'athlete'],[second,'athlete'],[outsider,'coach']])await db.query('insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)',[id,id+'@example.test',JSON.stringify({full_name:role,account_type:role,birth_date:'2000-01-01'})]);
  const own=await scalar('select id from public.athletes where user_id=$1',[coach]),a=await scalar('select id from public.athletes where user_id=$1',[first]),b=await scalar('select id from public.athletes where user_id=$1',[second]),foreign=await scalar('select id from public.athletes where user_id=$1',[outsider]);
  await db.query("insert into public.coach_athletes(athlete_id,coach_id,status) values($1,$3,'accepted'),($2,$3,'accepted')",[a,b,coach]);
  const future=await scalar("select (current_date+7)::text"),past=await scalar("select (current_date-7)::text");
  await login(coach);
  let g=await group('Boxe compétition',[own,a,a]);assert.deepEqual(new Set(g.athlete_ids),new Set([own,a]));
  await assert.rejects(()=>group('Intrusion',[foreign]),/associés/);
  await assert.rejects(()=>group(' ',[a]),/check constraint/);
  let master=await shared({title:'Round commun',date:future,group_ids:[g.id],athlete_ids:[a],blocks:[],notes:'Commun'});
  assert.equal(master.is_group_session,true);assert.equal(await count(master.id),2);
  const aCopy=await copy(master.id,a);
  await t.test('forged shared copies fail both column permissions and the restrictive insert policy',async()=>{
   const forged=()=>db.query("insert into public.training_sessions(athlete_id,title,date,shared_session_id) values($1,'Copie forgée',$2,$3)",[b,future,master.id]);
   await assert.rejects(forged,/permission denied/);
   await admin();await db.exec('grant insert(shared_session_id) on public.training_sessions to authenticated');
   try{await login(coach);await assert.rejects(forged,/row-level security/);}
   finally{await admin();await db.exec('revoke insert(shared_session_id) on public.training_sessions from authenticated');await login(coach);}
   assert.equal(await count(master.id),2);
  });
  const historical=await shared({title:'Historique',date:past,group_ids:[g.id],athlete_ids:[],blocks:[]});
  assert.equal(await count(historical.id),2);
  g=await group(g.name,[own,a,b],g);assert.equal(await count(master.id),3);assert.equal(await count(historical.id),2);
  await assert.rejects(()=>group('Concurrent',[a],{...g,updated_at:'2000-01-01'}),/changé/);
  // The recipient can complete and review their own copy, without seeing peers or editing common content.
  await login(first);
  assert.equal(await scalar('select count(*)::int from public.training_groups'),0);
  assert.equal(await scalar('select count(*)::int from public.shared_training_sessions'),0);
  assert.equal(await count(master.id),1);
  assert.equal((await db.query("update public.training_sessions set title='Divergence' where id=$1 returning id",[aCopy])).rows.length,0);
  await db.query('select public.set_session_completed($1,true)',[aCopy]);
  await db.query("select public.save_session_feedback($1,7,4,'Retour individuel')",[aCopy]);
  const completion=await scalar('select completed_at from public.training_sessions where id=$1',[aCopy]);
  await assert.rejects(()=>shared({title:'Intrusion'},master),/coach requis/);
  await login(coach);
  master=await shared({title:'Round corrigé',notes:'Correction commune'},master);
  assert.equal(await scalar('select title from public.training_sessions where id=$1',[aCopy]),'Round corrigé');
  assert.deepEqual(await scalar('select completed_at from public.training_sessions where id=$1',[aCopy]),completion);
  assert.equal(await scalar('select comment from public.session_feedback where session_id=$1',[aCopy]),'Retour individuel');
  assert.equal((await db.query('delete from public.training_sessions where id=$1 returning id',[aCopy])).rows.length,0);
  // Direct recipients and overlapping groups preserve the one copy when another source disappears.
  let other=await group('Autre groupe',[b]);
  master=await shared({group_ids:[g.id,other.id],athlete_ids:[a]},master);
  g=await group(g.name,[own],g);assert.equal(await count(master.id),3);
  await remove(other);assert.equal(await count(master.id),2);
  await remove(g);assert.equal(await count(master.id),1);
  assert.equal(await count(historical.id),2);
  assert.equal(await scalar('select comment from public.session_feedback where session_id=$1',[aCopy]),'Retour individuel');
  // Shared deletion retains completed and past copies while removing future empty ones.
  const hA=await copy(historical.id,a);
  await scalar('select public.delete_shared_training_session($1,$2)',[historical.id,historical.updated_at]);
  assert.equal(await scalar('select title from public.training_sessions where id=$1',[hA]),'Historique');
  assert.equal(await scalar('select shared_session_id from public.training_sessions where id=$1',[hA]),null);
  await scalar('select public.delete_shared_training_session($1,$2)',[master.id,master.updated_at]);
  assert.equal(await scalar('select comment from public.session_feedback where session_id=$1',[aCopy]),'Retour individuel');
  assert.equal(await scalar('select shared_session_id from public.training_sessions where id=$1',[aCopy]),null);
  await t.test('detaching a master preserves individual identity, completion rights and feedback guards',async()=>{
   await login(first);
   assert.equal(await scalar('select athlete_id from public.training_sessions where id=$1',[aCopy]),a);
   assert.equal(await scalar('select created_by from public.training_sessions where id=$1',[aCopy]),coach);
   assert.deepEqual(await scalar('select completed_at from public.training_sessions where id=$1',[aCopy]),completion);
   await db.query('select public.set_session_completed($1,false)',[aCopy]);
   assert.equal(await scalar('select comment from public.session_feedback where session_id=$1',[aCopy]),'Retour individuel');
   await assert.rejects(()=>db.query("select public.save_session_feedback($1,8,3,'Trop tôt')",[aCopy]),/terminée/);
   await db.query('select public.set_session_completed($1,true)',[aCopy]);
   await db.query("select public.save_session_feedback($1,6,4,'Retour après détachement')",[aCopy]);
   await login(coach);
   await assert.rejects(()=>db.query('select public.set_session_completed($1,false)',[aCopy]),/Seul cet athlète/);
   await assert.rejects(()=>db.query("select public.save_session_feedback($1,1,1,'Usurpation')",[aCopy]),/Seul cet athlète/);
   assert.equal(await scalar('select comment from public.session_feedback where session_id=$1',[aCopy]),'Retour après détachement');
  });
  await t.test('an open editor resolves current members and cannot resurrect a deleted group or overwrite newer common content',async()=>{
   let dynamic=await group('Membres dynamiques',[own,a]);
   const opened=await shared({title:'Ouverte avant changement',date:future,group_ids:[dynamic.id],athlete_ids:[]});
   dynamic=await group(dynamic.name,[own,b],dynamic);
   // The form carries group IDs, never a stale expansion of members.
   const updated=await shared({title:'Membres actuels',date:future,group_ids:opened.group_ids,athlete_ids:opened.athlete_ids},opened);
   assert.equal(await copy(updated.id,a),undefined);assert.ok(await copy(updated.id,b));
   assert.equal(await scalar('select title from public.training_sessions where shared_session_id=$1 and athlete_id=$2',[updated.id,b]),'Membres actuels');
   await assert.rejects(()=>shared({title:'Ancien contenu'},opened),/changé/);
   await remove(dynamic);
   await assert.rejects(()=>shared({title:'Groupe ressuscité',group_ids:updated.group_ids,athlete_ids:updated.athlete_ids},updated),/inaccessible/);
   assert.equal(await scalar('select title from public.shared_training_sessions where id=$1',[updated.id]),'Membres actuels');
   assert.equal(await count(updated.id),0);
  });
  // Group-only future sessions disappear when the group is removed.
  let empty=await group('Vide',[]);const pending=await shared({title:'Futur vide',date:future,group_ids:[empty.id],athlete_ids:[],blocks:[]});assert.equal(await count(pending.id),0);
  empty=await group('Rempli',[b],empty);assert.equal(await count(pending.id),1);
  await remove(empty);assert.equal(await count(pending.id),0);
  // The database rejects a forged recipient/group and rolls back all writes.
  const baseline=await scalar('select count(*)::int from public.shared_training_sessions');
  await assert.rejects(()=>shared({title:'Fuite',date:future,athlete_ids:[foreign],group_ids:[]}),/destinataire/);
  assert.equal(await scalar('select count(*)::int from public.shared_training_sessions'),baseline);
  const secured=await group('Sécurisé',[b]);
  await login(outsider);
  assert.equal(await scalar('select count(*)::int from public.training_groups'),0);
  assert.equal(await scalar('select count(*)::int from public.training_group_members'),0);
  await assert.rejects(()=>remove(secured),/inaccessible/);
  await assert.rejects(()=>shared({title:'Vol',date:future,group_ids:[secured.id],athlete_ids:[]}),/inaccessible/);
  await assert.rejects(()=>db.query("insert into public.training_groups(coach_id,name) values($1,'Bypass')",[outsider]),/permission denied/);
  await login(coach);
  const restricted=await shared({title:'Permission',date:future,group_ids:[secured.id],athlete_ids:[]});
  await admin();await db.query('update public.coach_athletes set can_add_sessions=false where coach_id=$1 and athlete_id=$2',[coach,b]);
  await login(coach);
  await assert.rejects(()=>shared({title:'Interdit'},restricted),/destinataire/);
  assert.equal(await scalar('select title from public.shared_training_sessions where id=$1',[restricted.id]),'Permission');
  // Removing a revoked member does not mutate the now-inaccessible personal calendar.
  await admin();await db.query('update public.coach_athletes set can_view_calendar=false where coach_id=$1 and athlete_id=$2',[coach,b]);
  await login(coach);await remove(secured);
  await login(second);assert.equal(await count(restricted.id),1);
  assert.equal(await scalar('select title from public.training_sessions where shared_session_id=$1',[restricted.id]),'Permission');
  // Anonymous users cannot invoke any group API or access private tables.
  await admin();await db.exec('set role anon');
  for(const table of ['training_groups','training_group_members','shared_training_sessions','shared_session_groups','shared_session_athletes'])await assert.rejects(()=>db.query(`select * from public.${table}`),/permission denied/);
  await assert.rejects(()=>group('Anonyme',[]),/permission denied/);
 }finally{await db.close();}
});
