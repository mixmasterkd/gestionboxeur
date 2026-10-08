import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const owner = '13000000-0000-4000-8000-000000000001', other = '13000000-0000-4000-8000-000000000002';
const modes = ['simple', 'locate', 'choice'], inputs = ['touch', 'mouse', 'keyboard'];
const migration = await readFile(new URL('../supabase/migrations/20261005132435_reaction_personal_records.sql', import.meta.url), 'utf8');
async function fixture() {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role outsider; create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema public,auth to anon,authenticated,outsider;
    grant execute on function auth.uid() to anon,authenticated;
    alter default privileges in schema public grant all on tables to public,anon,authenticated;
    alter default privileges in schema public grant execute on functions to public,anon,authenticated;
    insert into auth.users values ('${owner}'),('${other}');`);
  await db.exec(migration);
  let currentOwner = owner;
  const login = async id => { currentOwner = id; await db.exec(`reset role; set role authenticated; set request.jwt.claim.sub='${id}';`); };
  const save = async (mode, input, ms, expectedOwner = currentOwner || null) => (await db.query('select * from public.save_reaction_record($1,$2,$3,$4)', [mode, input, ms, expectedOwner])).rows;
  const records = async () => (await db.query('select mode,input,best_ms from public.reaction_records order by mode,input')).rows;
  return { db, login, save, records };
}

test('reaction migration enforces private RLS, minimal column grants, anonymous denial and stale-account rejection', async () => {
  const { db, login, save, records } = await fixture();
  try {
    await login(owner);
    for (const mode of modes) for (const input of inputs) assert.deepEqual(await save(mode, input, 250), [{ mode, input, best_ms: 250 }]);
    assert.equal((await records()).length, 9);
    await assert.rejects(db.query('insert into public.reaction_records(owner_id,mode,input,best_ms) values ($1,$2,$3,$4)', [other, 'simple', 'touch', 100]), /row-level security/);
    for (const [column, value] of [['owner_id', other], ['mode', 'choice'], ['input', 'keyboard']]) await assert.rejects(db.query(`update public.reaction_records set ${column}=$1 where mode='simple' and input='touch'`, [value]), /permission denied/);
    await assert.rejects(db.exec('truncate public.reaction_records'), /permission denied/);
    await login(other); assert.deepEqual(await records(), []);
    assert.equal((await db.query('update public.reaction_records set best_ms=1 where owner_id=$1 returning mode', [owner])).rows.length, 0);
    assert.equal((await db.query('delete from public.reaction_records where owner_id=$1 returning mode', [owner])).rows.length, 0);
    assert.deepEqual(await save('simple', 'touch', 300), [{ mode: 'simple', input: 'touch', best_ms: 300 }]);
    await assert.rejects(save('simple', 'touch', 1, owner), /account changed/);
    await assert.rejects(save('simple', 'touch', 1, null), /account changed/);
    assert.deepEqual(await records(), [{ mode: 'simple', input: 'touch', best_ms: 300 }]);
    await login(owner); assert.ok((await records()).every(row => row.best_ms === 250));
    for (const role of ['anon', 'outsider']) {
      await db.exec(`reset role; set role ${role};`);
      await assert.rejects(db.exec('select * from public.reaction_records'), /permission denied/);
      await assert.rejects(save('simple', 'touch', 99), /permission denied/);
      await assert.rejects(db.exec("delete from public.reaction_records where mode='simple'"), /permission denied/);
      await assert.rejects(db.exec("insert into public.reaction_records(mode,input,best_ms) values ('simple','touch',100)"), /permission denied/);
    }
    await login('');
    await assert.rejects(save('simple', 'touch', 99), /Authentication required/);
    assert.deepEqual(await records(), []);
    await db.exec('reset role;');
    const security = (await db.query("select p.prosecdef,p.proconfig,c.relrowsecurity from pg_proc p join pg_class c on c.oid='public.reaction_records'::regclass where p.oid='public.save_reaction_record(text,text,integer,uuid)'::regprocedure")).rows[0];
    assert.equal(security.prosecdef, false); assert.equal(security.relrowsecurity, true); assert.ok(security.proconfig.includes('search_path=""'));
    for (const role of ['anon', 'outsider', 'authenticated']) assert.equal((await db.query("select has_function_privilege($1,'public.save_reaction_record(text,text,integer,uuid)','execute') allowed", [role])).rows[0].allowed, role === 'authenticated');
    const policies = (await db.query("select cmd,roles,qual,with_check from pg_policies where schemaname='public' and tablename='reaction_records' order by cmd")).rows;
    assert.deepEqual(policies.map(policy => policy.cmd), ['DELETE', 'INSERT', 'SELECT', 'UPDATE']);
    for (const policy of policies) { assert.deepEqual(policy.roles, ['authenticated']); assert.match(policy.qual || policy.with_check, /SELECT auth.uid/); }
    assert.match(policies.find(policy => policy.cmd === 'UPDATE').with_check, /owner_id/);
  } finally { await db.close(); }
});

test('reaction upsert atomically retains the minimum for each mode/input, reset isolates one pair and account deletion cascades', async () => {
  const { db, login, save, records } = await fixture();
  try {
    await login(owner);
    assert.deepEqual(await save('simple', 'touch', 300), [{ mode: 'simple', input: 'touch', best_ms: 300 }]);
    assert.equal((await save('simple', 'touch', 700))[0].best_ms, 300);
    assert.equal((await save('simple', 'touch', 210))[0].best_ms, 210);
    assert.equal((await save('simple', 'touch', 10000))[0].best_ms, 210);
    // PGlite serializes its connection. The SQL itself is one ON CONFLICT
    // statement using LEAST, with no client SELECT-then-UPDATE race.
    await Promise.all([save('locate', 'mouse', 400), save('locate', 'mouse', 280), save('locate', 'mouse', 500), save('locate', 'mouse', 170)]);
    await Promise.all([save('choice', 'keyboard', 170), save('choice', 'keyboard', 500), save('choice', 'keyboard', 280), save('choice', 'keyboard', 400)]);
    assert.equal((await records()).find(row => row.mode === 'locate').best_ms, 170);
    assert.equal((await records()).find(row => row.mode === 'choice').best_ms, 170);
    await save('simple', 'mouse', 310); await save('choice', 'touch', 510);
    assert.equal((await db.query('delete from public.reaction_records where owner_id=$1 and mode=$2 and input=$3 returning mode', [owner, 'simple', 'touch'])).rows.length, 1);
    assert.ok((await records()).some(row => row.mode === 'simple' && row.input === 'mouse' && row.best_ms === 310));
    assert.ok((await records()).some(row => row.mode === 'choice' && row.input === 'touch' && row.best_ms === 510));
    assert.deepEqual(await save('simple', 'touch', 900), [{ mode: 'simple', input: 'touch', best_ms: 900 }]);
    await db.exec('reset role;');
    await db.query('delete from auth.users where id=$1', [owner]);
    assert.equal((await db.query('select count(*)::int count from public.reaction_records where owner_id=$1', [owner])).rows[0].count, 0);
  } finally { await db.close(); }
});

test('database rejects malformed variants and invalid millisecond values in both RPC and direct writes', async () => {
  const { db, login, save } = await fixture();
  try {
    await login(owner);
    for (const mode of ['Simple', 'simple ', 'tiles-4', '', null]) await assert.rejects(save(mode, 'touch', 200), /Invalid reaction record/);
    for (const input of ['Touch', 'touch ', 'pen', '', null]) await assert.rejects(save('simple', input, 200), /Invalid reaction record/);
    for (const value of [-1, 0, 10001, null]) await assert.rejects(save('simple', 'touch', value), /Invalid reaction record/);
    await assert.rejects(save('simple', 'touch', '1.5'), /invalid input syntax/);
    await assert.rejects(db.exec("insert into public.reaction_records(mode,input,best_ms) values ('invalid','touch',200)"), /check constraint/);
    await assert.rejects(db.exec("insert into public.reaction_records(mode,input,best_ms) values ('simple','pen',200)"), /check constraint/);
    await assert.rejects(db.exec("insert into public.reaction_records(mode,input,best_ms) values ('simple','touch',0)"), /check constraint/);
    await assert.rejects(db.exec("insert into public.reaction_records(mode,input,best_ms) values ('simple','touch',10001)"), /check constraint/);
    for (const values of ["null,'touch',200", "'simple',null,200", "'simple','touch',null"]) await assert.rejects(db.exec(`insert into public.reaction_records(mode,input,best_ms) values (${values})`), /not-null constraint/);
    assert.deepEqual(await save('simple', 'touch', 10000), [{ mode: 'simple', input: 'touch', best_ms: 10000 }]);
    assert.deepEqual(await save('simple', 'touch', 1), [{ mode: 'simple', input: 'touch', best_ms: 1 }]);
    await assert.rejects(db.exec("update public.reaction_records set best_ms=-1 where mode='simple'"), /check constraint/);
  } finally { await db.close(); }
});
