import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {TRAINING_COLORS} from '../js/workout-rich-text.js';

test('PostgreSQL accepts every editor color and still rejects untrusted formatting',async()=>{
 const db=new PGlite();
 try{
  await db.exec('create schema app_private;create role anon;create role authenticated;create role service_role;');
  const directory=new URL('../supabase/migrations/',import.meta.url);
  const filename=(await readdir(directory)).find(name=>name.endsWith('_workout_text_base_colors.sql'));
  await db.exec(await readFile(new URL(filename,directory),'utf8'));
  const valid=async color=>(await db.query('select app_private.valid_workout_document($1::jsonb) as valid',[JSON.stringify({version:1,text:'Texte',marks:[{start:0,end:5,color}]})])).rows[0].valid;
  for(const color of TRAINING_COLORS)assert.equal(await valid(color),true,color);
  for(const color of ['red;position:absolute','#f00','normal',42,null])assert.equal(await valid(color),false,String(color));
  assert.equal((await db.query("select prosecdef from pg_proc where oid='app_private.valid_workout_document(jsonb)'::regprocedure")).rows[0].prosecdef,false);
 }finally{await db.close();}
});
