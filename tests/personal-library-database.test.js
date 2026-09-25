import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {getStarterTemplates} from '../js/starter-templates.js';

test('private bases initialize once and folder deletion checks the full confirmed snapshot atomically',async()=>{
 const db=new PGlite(),owner='12000000-0000-4000-8000-000000000001',other='12000000-0000-4000-8000-000000000002';
 const scalar=async(sql,args=[])=>Object.values((await db.query(sql,args)).rows[0]||{})[0];
 const login=async id=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);await db.exec('set role authenticated');};
 const seed=getStarterTemplates().map(({title,sport,description,notes,blocks,workout_document})=>({title,sport,description,notes,blocks,workout_document}));
 const init=items=>scalar('select public.initialize_training_library($1)',[JSON.stringify(items)]);
 const contents=async id=>(await db.query('select id,updated_at::text from public.session_templates where folder_id=$1 order by id',[id])).rows;
 const remove=(folder,rows)=>scalar('select public.delete_training_library_folder($1,$2,$3)',[folder.id,folder.name,JSON.stringify(rows)]);
 try{
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;create function auth.role() returns text language sql stable as $$select 'authenticated'::text$$;grant usage on schema public,auth to anon,authenticated,service_role;grant execute on function auth.uid(),auth.role() to anon,authenticated,service_role;alter default privileges in schema public grant all on tables to public,anon,authenticated,service_role;`);
  const dir=new URL('../supabase/migrations/',import.meta.url);for(const name of (await readdir(dir)).filter(f=>f.endsWith('.sql')).sort())await db.exec(await readFile(new URL(name,dir),'utf8'));
  for(const id of [owner,other])await db.query('insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)',[id,id+'@example.test',JSON.stringify({full_name:'Test',birth_date:'2000-01-01'})]);
  await login(owner);
  assert.equal(await init(seed),true);assert.equal(await init(seed),false);
  assert.equal(await scalar('select count(*) from public.session_templates'),13);assert.equal(await scalar('select count(*) from public.library_folders'),2);
  const folder=(await db.query("select id,name from public.library_folders where name='Boxe - Base'")).rows[0];
  const snapshot=await contents(folder.id);assert.equal(snapshot.length,2);
  // Already scheduled copies are separate rows and survive library deletion.
  const athlete=await scalar('select id from public.athletes where user_id=$1',[owner]);
  const scheduled=await scalar("insert into public.training_sessions(athlete_id,created_by,date,title,sport,blocks) select $1,$2,current_date,title,sport,blocks from public.session_templates where id=$3 returning id",[athlete,owner,snapshot[0].id]);
  await assert.rejects(()=>remove(folder,snapshot.slice(0,1)),/contenu.*changé/);
  assert.equal((await contents(folder.id)).length,2);
  await db.query("update public.session_templates set title='Modifié ailleurs' where id=$1",[snapshot[0].id]);
  await assert.rejects(()=>remove(folder,snapshot),/contenu.*changé/);
  const current=await contents(folder.id);
  await assert.rejects(()=>remove({...folder,name:'Ancien nom'},current),/dossier a changé/);
  await login(other);assert.equal(await scalar('select count(*) from public.session_templates'),0);
  await assert.rejects(()=>remove(folder,current),/accessible/);
  await assert.rejects(()=>db.query('insert into public.library_initialization(owner_id) values($1)',[owner]),/row-level security/);
  // A bad last item rolls back the marker, folders and earlier valid inserts.
  await assert.rejects(()=>init([seed[0],{...seed[1],title:null}]));
  assert.equal(await scalar('select count(*) from public.library_initialization'),0);assert.equal(await scalar('select count(*) from public.library_folders'),0);assert.equal(await scalar('select count(*) from public.session_templates'),0);
  assert.equal(await init(seed),true);
  await login(owner);assert.equal(await remove(folder,current),2);
  assert.equal(await scalar('select count(*) from public.training_sessions where id=$1',[scheduled]),1);
  assert.equal(await init(seed),false);assert.equal(await scalar('select count(*) from public.session_templates'),11);assert.equal(await scalar("select count(*) from public.library_folders where name='Boxe - Base'"),0);
  const one=await scalar('select id from public.session_templates limit 1');await db.query('delete from public.session_templates where id=$1',[one]);assert.equal(await init(seed),false);assert.equal(await scalar('select count(*) from public.session_templates'),10);
  const empty=(await db.query("insert into public.library_folders(name) values('Vide') returning id,name")).rows[0];assert.equal(await remove(empty,[]),0);
  await assert.rejects(()=>db.query('delete from public.library_initialization'),/permission denied/);
  await login(other);assert.equal(await scalar('select count(*) from public.session_templates'),13);
  await db.exec('reset role;set role anon');await assert.rejects(()=>init(seed),/permission denied/);await assert.rejects(()=>remove(folder,[]),/permission denied/);await assert.rejects(()=>db.query('select * from public.library_initialization'),/permission denied/);
 }finally{await db.close();}
});
