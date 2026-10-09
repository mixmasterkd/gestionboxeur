import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile,readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('personal rosters and guarded journal deletion retain account isolation and existing coaching permissions',async t=>{
 const db=new PGlite();
 const athlete='81000000-0000-4000-8000-000000000001',coach='81000000-0000-4000-8000-000000000002',other='81000000-0000-4000-8000-000000000003';
 const scalar=async(sql,args=[])=>Object.values((await db.query(sql,args)).rows[0]||{})[0];
 const admin=()=>db.exec('reset role');
 const login=async id=>{await admin();await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);await db.exec('set role authenticated');};
 const snapshot=async id=>(await db.query("select e.id,e.updated_at::text,coalesce(array_agg(u.id order by u.id) filter(where u.id is not null),'{}'::uuid[]) updates from public.journal_entries e left join public.journal_updates u on u.entry_id=e.id where e.id=$1 group by e.id",[id])).rows[0];
 const remove=entry=>scalar('select public.delete_journal_entry($1,$2,$3)',[entry.id,entry.updated_at,entry.updates]);
 try{
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;create function auth.role() returns text language sql stable as $$select 'authenticated'::text$$;grant usage on schema public,auth to anon,authenticated,service_role;grant execute on function auth.uid(),auth.role() to anon,authenticated,service_role;alter default privileges in schema public grant all on tables to public,anon,authenticated,service_role;`);
  const directory=new URL('../supabase/migrations/',import.meta.url);
  for(const file of (await readdir(directory)).filter(file=>file.endsWith('.sql')).sort())await db.exec(await readFile(new URL(file,directory),'utf8'));
  for(const [id,role] of [[athlete,'athlete'],[coach,'coach'],[other,'athlete']])await db.query('insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)',[id,id+'@example.test',JSON.stringify({full_name:role,account_type:role,birth_date:'2000-01-01'})]);
  const athleteId=await scalar('select id from public.athletes where user_id=$1',[athlete]);
  let sheet;
  await t.test('a noncoach can create and edit a private sheet without activating coaching',async()=>{
   await login(athlete);
   sheet=await scalar('select public.create_roster_athlete($1)',[JSON.stringify({first_name:'Fiche privée',private_notes:'Confidentiel',selected:true,user_id:other,coach_id:coach})]);
   const row=(await db.query('select id,user_id,coach_id,first_name,updated_at::text from public.athletes where id=$1',[sheet])).rows[0];
   const relation=(await db.query('select * from public.coach_athletes where athlete_id=$1',[sheet])).rows[0];
   assert.equal(row.user_id,null);assert.equal(row.coach_id,athlete);assert.equal(relation.coach_id,athlete);assert.equal(relation.private_notes,'Confidentiel');
   const version=await scalar('select updated_at::text from public.coach_athletes where athlete_id=$1',[sheet]);
   await scalar('select public.update_roster_athlete_checked($1,$2,$3,$4,$5)',[sheet,JSON.stringify({first_name:'Fiche ajustée'}),athlete,row.updated_at,version]);
   assert.equal(await scalar('select first_name from public.athletes where id=$1',[sheet]),'Fiche ajustée');
   assert.equal(await scalar('select account_type from public.profiles where id=$1',[athlete]),'athlete');
   assert.equal(await scalar('select count(*) from public.coach_profiles where user_id=$1',[athlete]),0);
   assert.equal(await scalar("select public.coach_has_permission($1,'calendar')",[sheet]),false);
   await assert.rejects(()=>db.query('select public.create_roster_athlete(null)'),/Prénom/);
  });
  await t.test('contacts and list sheets never appear in another account or become coaching invitations',async()=>{
   await login(athlete);
   const contact=await scalar("insert into public.coach_contacts(coach_id,first_name) values($1,'Contact de liste') returning id",[athlete]);
   await login(other);assert.equal(await scalar('select count(*) from public.athletes where id=$1',[sheet]),0);
   assert.equal(await scalar('select count(*) from public.coach_athletes where athlete_id=$1',[sheet]),0);
   assert.equal(await scalar('select count(*) from public.coach_contacts where id=$1',[contact]),0);
   await assert.rejects(()=>db.query('select public.archive_roster_athlete($1)',[sheet]),/refusé/);
   await assert.rejects(()=>db.query("insert into public.coach_contacts(coach_id,first_name) values($1,'Intrusion')",[athlete]),/row-level security/);
   await assert.rejects(()=>db.query('insert into public.coach_athletes(coach_id,athlete_id) values($1,$2)',[other,athleteId]),/permission denied/);
   await login(athlete);await scalar('select public.archive_roster_athlete($1)',[sheet]);
   assert.equal(await scalar('select status from public.coach_athletes where athlete_id=$1',[sheet]),'revoked');
  });
  await admin();await db.query("insert into public.coach_athletes(athlete_id,coach_id,status,can_view_calendar,can_add_sessions) values($1,$2,'accepted',true,true)",[athleteId,coach]);
  await login(athlete);
  const id=await scalar("insert into public.journal_entries(athlete_id,title,body) values($1,'Mon sujet','Observation') returning id",[athleteId]);
  let initial=await snapshot(id);
  await t.test('direct and unauthorized deletion remain forbidden, including another contributing coach',async()=>{
   await assert.rejects(()=>db.query('delete from public.journal_entries where id=$1',[id]),/permission denied/);
   await login(other);await assert.rejects(()=>remove(initial),/supprimer/);
   await login(coach);await assert.rejects(()=>remove(initial),/supprimer/);
   await db.query("insert into public.journal_updates(entry_id,content) values($1,'Conseil à conserver')",[id]);
   await login(athlete);await assert.rejects(()=>remove(initial),/changé/);
   assert.equal(await scalar('select count(*) from public.journal_updates where entry_id=$1',[id]),2);
  });
  await t.test('changed entry, missing or duplicated history snapshots cannot delete new work',async()=>{
   initial=await snapshot(id);await db.query("update public.journal_entries set status='work' where id=$1",[id]);
   await assert.rejects(()=>remove(initial),/changé/);
   const latest=await snapshot(id);
   await assert.rejects(()=>remove({...latest,updates:null}),/changé/);
   await assert.rejects(()=>remove({...latest,updates:[...latest.updates,latest.updates[0]]}),/changé/);
   await db.query('update public.journal_entries set archived=true where id=$1',[id]);
   const archived=await snapshot(id);assert.equal(await remove(archived),id);
   assert.equal(await scalar('select count(*) from public.journal_entries where id=$1',[id]),0);
   assert.equal(await scalar('select count(*) from public.journal_updates where entry_id=$1',[id]),0);
  });
  await t.test('a contributing author can delete their topic only while current permission permits it',async()=>{
   await login(coach);const owned=await scalar("insert into public.journal_entries(athlete_id,title) values($1,'Conseil coach') returning id",[athleteId]);
   const entry=await snapshot(owned);
   await admin();await db.query('update public.coach_athletes set can_add_sessions=false where athlete_id=$1 and coach_id=$2',[athleteId,coach]);
   await login(coach);await assert.rejects(()=>remove(entry),/supprimer/);
   await admin();await db.query('update public.coach_athletes set can_add_sessions=true where athlete_id=$1 and coach_id=$2',[athleteId,coach]);
   await login(coach);assert.equal(await remove(entry),owned);
   const another=await scalar("insert into public.journal_entries(athlete_id,title) values($1,'Sujet conservé') returning id",[athleteId]);
   const last=await snapshot(another);
   await admin();await db.query("update public.coach_athletes set status='revoked' where athlete_id=$1 and coach_id=$2",[athleteId,coach]);
   await login(coach);await assert.rejects(()=>remove(last),/supprimer/);
   await login(athlete);assert.equal(await remove(last),another);
  });
  await t.test('public wrappers are invokers, anonymous execution is denied and no delete table grants are added',async()=>{
   await admin();assert.equal(await scalar("select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('create_roster_athlete','delete_journal_entry') and p.prosecdef"),0);
   assert.equal(await scalar("select has_table_privilege('authenticated','public.journal_entries','delete')"),false);
   await db.exec('set role anon');
   await assert.rejects(()=>db.query("select public.create_roster_athlete('{\"first_name\":\"Anon\"}')"),/permission denied/);
   await assert.rejects(()=>db.query("select public.delete_journal_entry($1,now(),'{}')",[id]),/permission denied/);
  });
 }finally{await db.close();}
});
