import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { localQuery,personas,openLocalDatabase } from '../scripts/local-preview-server.mjs';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

test('publication migration timestamps preserve existing local trial data on reopening',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'gboxeur-migration-alias-'));
 let db;
 try{
  db=await openLocalDatabase({directory});
  await db.query("update public.profiles set full_name='Essai à conserver' where id=$1",[personas[0].id]);
  for(const [current,previous] of [['20261009053411','20261008231021'],['20261009053420','20261009011343'],['20261009053421','20261009030740']])await db.query("update auth.local_migrations set name=$1||substring(name from 15) where name like $2",[previous,current+'%']);
  await db.close();db=null;
  db=await openLocalDatabase({directory});
  assert.equal((await db.query('select full_name from public.profiles where id=$1',[personas[0].id])).rows[0].full_name,'Essai à conserver');
  assert.equal((await db.query('select count(*)::int n from auth.local_migrations')).rows[0].n,30);
  assert.equal((await db.query("select count(*)::int n from auth.local_migrations where name like '202610090534%'")).rows[0].n,3);
 }finally{await db?.close();await rm(directory,{recursive:true,force:true});}
});

test('local preview executes requests under the selected RLS identity with bound values and no SQL injection',async()=>{
 const db=new PGlite(),one=personas[0].id,two=personas[1].id;
 try{
  await db.exec(`create role authenticated;create schema auth;create function auth.uid() returns uuid language sql stable as $$select current_setting('request.jwt.claim.sub')::uuid$$;
   grant usage on schema auth to authenticated;
   create table public.local_probe(id uuid default gen_random_uuid(),owner_id uuid default auth.uid(),title text,day date,updated_at timestamptz default '2026-10-09 01:00:00.123456+00');
   alter table public.local_probe enable row level security;
   grant select,insert,update,delete on public.local_probe to authenticated;
   create policy own on public.local_probe to authenticated using(owner_id=auth.uid()) with check(owner_id=auth.uid());`);
  const title="<script>test</script>'); drop table public.local_probe; --";
  const inserted=await localQuery(db,one,{table:'local_probe',method:'insert',values:{title,day:'2026-10-08'},single:'one'});
  assert.equal(inserted.title,title);
  assert.equal(inserted.day,'2026-10-08','SQL dates retain the calendar date format');
  assert.match(inserted.updated_at,/00\.123456/,'versions retain all microseconds for optimistic updates');
  const updated=await localQuery(db,one,{table:'local_probe',method:'update',values:{title},filters:[{column:'id',op:'eq',value:inserted.id},{column:'updated_at',op:'eq',value:inserted.updated_at}],single:'one'});
  assert.equal(updated.id,inserted.id);
  assert.deepEqual(await localQuery(db,two,{table:'local_probe'}),[]);
  assert.equal((await localQuery(db,one,{table:'local_probe',filters:[{column:'id',op:'eq',value:inserted.id}]})).length,1);
  assert.equal((await localQuery(db,one,{table:'local_probe',filters:[{column:'title',op:'eq',value:title}]}))[0].title,title);
  assert.deepEqual(await localQuery(db,two,{table:'local_probe',method:'update',values:{title:'Forged'},filters:[{column:'id',op:'eq',value:inserted.id}]}),[]);
  await assert.rejects(()=>localQuery(db,one,{table:'local_probe;drop table local_probe'}),/Identifiant/);
  await assert.rejects(()=>localQuery(db,one,{rpc:'evil);reset role;--'}),/Identifiant/);
  await assert.rejects(()=>localQuery(db,'unknown',{table:'local_probe'}),/compte/);
  // Failed statements and other personas do not leak a previous role or identity.
  assert.equal((await localQuery(db,one,{table:'local_probe'})).length,1);
  assert.equal((await db.query('select current_user as role')).rows[0].role,'postgres');
 }finally{await db.close();}
});
