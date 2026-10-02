import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const owner = '12000000-0000-4000-8000-000000000001', other = '12000000-0000-4000-8000-000000000002';
const modes = ['tiles-4', 'tiles-6', 'tiles-8', 'bag-sequence-visible', 'bag-sequence-hidden', 'bag-targets-visible', 'bag-targets-hidden'];
const migration = await readFile(new URL('../supabase/migrations/20261001230552_cognitive_personal_records.sql', import.meta.url), 'utf8');
async function fixture() {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema public,auth to anon,authenticated;
    grant execute on function auth.uid() to anon,authenticated;
    alter default privileges in schema public grant all on tables to public,anon,authenticated;
    alter default privileges in schema public grant execute on functions to public,anon,authenticated;
    insert into auth.users values ('${owner}'),('${other}');`);
  await db.exec(migration);
  let currentOwner = owner;
  const login = async id => { currentOwner = id; await db.exec(`reset role; set role authenticated; set request.jwt.claim.sub='${id}';`); };
  const save = async (mode, score, expectedOwner = currentOwner || null) => (await db.query('select * from public.save_cognitive_record($1,$2,$3)', [mode, score, expectedOwner])).rows;
  const records = async () => (await db.query('select mode,score from public.cognitive_records order by mode')).rows;
  return { db, login, save, records };
}

test('cognitive records migration enforces private ownership, exact variants and minimal table/function privileges', async () => {
  const { db, login, save, records } = await fixture();
  try {
    await login(owner);
    for (let index = 0; index < modes.length; index++) assert.deepEqual(await save(modes[index], index), [{ mode: modes[index], score: index }]);
    assert.equal((await records()).length, 7);
    await assert.rejects(db.query('insert into public.cognitive_records(owner_id,mode,score) values ($1,$2,$3)', [other, 'tiles-4', 100]), /row-level security/);
    await assert.rejects(db.query('update public.cognitive_records set owner_id=$1 where mode=$2', [other, 'tiles-4']), /permission denied/);
    await assert.rejects(db.query('update public.cognitive_records set mode=$1 where mode=$2', ['tiles-6', 'tiles-4']), /permission denied/);
    await assert.rejects(db.exec('truncate public.cognitive_records'), /permission denied/);
    await login(other);
    assert.deepEqual(await records(), []);
    assert.equal((await db.query('update public.cognitive_records set score=100 where owner_id=$1 returning mode', [owner])).rows.length, 0);
    assert.equal((await db.query('delete from public.cognitive_records where owner_id=$1 returning mode', [owner])).rows.length, 0);
    assert.deepEqual(await save('tiles-4', 50), [{ mode: 'tiles-4', score: 50 }]);
    assert.deepEqual(await records(), [{ mode: 'tiles-4', score: 50 }]);
    await assert.rejects(save('tiles-4', 900, owner), /account changed/);
    await assert.rejects(save('tiles-4', 900, null), /account changed/);
    assert.deepEqual(await records(), [{ mode: 'tiles-4', score: 50 }], 'a queued write from the old owner must not alter the new account');
    await login(owner); assert.equal((await records()).find(row => row.mode === 'tiles-4').score, 0);
    await db.exec('reset role; set role anon;');
    await assert.rejects(db.exec('select * from public.cognitive_records'), /permission denied/);
    await assert.rejects(save('tiles-4', 99), /permission denied/);
    await assert.rejects(db.exec("delete from public.cognitive_records where mode='tiles-4'"), /permission denied/);
    await login('');
    await assert.rejects(save('tiles-4', 99), /Authentication required/);
    assert.deepEqual(await records(), []);
    await db.exec('reset role;');
    const security = (await db.query("select p.prosecdef,p.proconfig,c.relrowsecurity from pg_proc p join pg_class c on c.oid='public.cognitive_records'::regclass where p.oid='public.save_cognitive_record(text,integer,uuid)'::regprocedure")).rows[0];
    assert.equal(security.prosecdef, false); assert.equal(security.relrowsecurity, true);
    assert.ok(security.proconfig.includes('search_path=""'));
    assert.equal((await db.query("select has_function_privilege('anon','public.save_cognitive_record(text,integer,uuid)','execute') allowed")).rows[0].allowed, false);
    assert.equal((await db.query("select has_function_privilege('authenticated','public.save_cognitive_record(text,integer,uuid)','execute') allowed")).rows[0].allowed, true);
  } finally { await db.close(); }
});

test('database save retains the greatest score in any submission order and reset only removes its chosen variant', async () => {
  const { db, login, save, records } = await fixture();
  try {
    await login(owner);
    assert.deepEqual(await save('tiles-4', 100), [{ mode: 'tiles-4', score: 100 }]);
    assert.deepEqual(await save('tiles-4', 3), [{ mode: 'tiles-4', score: 100 }]);
    assert.deepEqual(await save('tiles-4', 200), [{ mode: 'tiles-4', score: 200 }]);
    assert.deepEqual(await save('tiles-4', 0), [{ mode: 'tiles-4', score: 200 }]);
    // PGlite serializes its connection. Both possible arrival orders use the
    // same atomic ON CONFLICT update, instead of a client SELECT-then-UPDATE.
    await Promise.all([save('tiles-6', 90), save('tiles-6', 2), save('tiles-6', 180), save('tiles-6', 1)]);
    assert.equal((await records()).find(row => row.mode === 'tiles-6').score, 180);
    await save('bag-sequence-visible', 8); await save('bag-sequence-hidden', 5);
    assert.equal((await db.query('delete from public.cognitive_records where owner_id=$1 and mode=$2 returning mode', [owner, 'bag-sequence-visible'])).rows.length, 1);
    assert.ok((await records()).some(row => row.mode === 'bag-sequence-hidden' && row.score === 5));
    assert.deepEqual(await save('bag-sequence-visible', 1), [{ mode: 'bag-sequence-visible', score: 1 }]);
    await db.exec('reset role;');
    await db.query('delete from auth.users where id=$1', [owner]);
    assert.equal((await db.query('select count(*)::int count from public.cognitive_records where owner_id=$1', [owner])).rows[0].count, 0);
  } finally { await db.close(); }
});

test('database rejects invalid modes, nulls and out-of-range scores in RPC and direct writes', async () => {
  const { db, login, save } = await fixture();
  try {
    await login(owner);
    for (const mode of ['tiles-5', 'bag-targets', 'TILES-4', '', null]) await assert.rejects(save(mode, 3), /Invalid cognitive record/);
    for (const score of [-1, 10001, null]) await assert.rejects(save('tiles-4', score), /Invalid cognitive record/);
    await assert.rejects(save('tiles-4', '1.5'), /invalid input syntax/);
    await assert.rejects(db.exec("insert into public.cognitive_records(mode,score) values ('tiles-5',3)"), /check constraint/);
    await assert.rejects(db.exec("insert into public.cognitive_records(mode,score) values ('tiles-4',10001)"), /check constraint/);
    await assert.rejects(db.exec("insert into public.cognitive_records(mode,score) values ('tiles-4',null)"), /not-null constraint/);
    await assert.rejects(db.exec('insert into public.cognitive_records(mode,score) values (null,0)'), /not-null constraint/);
    assert.deepEqual(await save('tiles-4', 10000), [{ mode: 'tiles-4', score: 10000 }]);
    await assert.rejects(db.exec("update public.cognitive_records set score=-1 where mode='tiles-4'"), /check constraint/);
  } finally { await db.close(); }
});
