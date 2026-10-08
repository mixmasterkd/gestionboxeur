import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('personal tools PostgreSQL isolation, privileges, payload constraints and revision conflicts', async () => {
  const db = new PGlite();
  const owner = '11000000-0000-4000-8000-000000000001', other = '11000000-0000-4000-8000-000000000002';
  try {
    await db.exec(`create role anon; create role authenticated; create schema auth;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      grant usage on schema public,auth to anon,authenticated;
      grant execute on function auth.uid() to anon,authenticated;
      alter default privileges in schema public grant all on tables to public,anon,authenticated;
      insert into auth.users values ('${owner}'),('${other}');`);
    await db.exec(await readFile(new URL('../supabase/migrations/20261001203531_personal_tool_saves.sql', import.meta.url), 'utf8'));
    const login = async id => db.exec(`reset role;set role authenticated;set request.jwt.claim.sub='${id}';`);
    await login(owner);
    const payload = JSON.stringify({ mode: 'advanced', text: '- 1m' });
    const saved = (await db.query('insert into public.timer_presets(title,payload) values ($1,$2) returning id', ['Test', payload])).rows[0].id;
    const revision = (await db.query("insert into public.bulletin_boards(notes) values ('[]') returning revision")).rows[0].revision;
    assert.equal((await db.query('select count(*)::int n from public.timer_presets')).rows[0].n, 1);
    await assert.rejects(db.query('insert into public.timer_presets(owner_id,title,payload) values ($1,$2,$3)', [other, 'Spoof', payload]), /row-level security/);
    await assert.rejects(db.query('insert into public.timer_presets(title,payload) values ($1,$2)', ['Mixed', JSON.stringify({ mode: 'advanced', text: '- 1m', config: {} })]), /check constraint/);
    await assert.rejects(db.query('insert into public.timer_presets(title,payload) values ($1,$2)', ['Invalid', JSON.stringify({ mode: 'advanced' })]), /check constraint/);
    await assert.rejects(db.exec("update public.timer_presets set title='altered'"), /permission denied/);
    await assert.rejects(db.query('update public.bulletin_boards set owner_id=$1', [other]), /permission denied/);
    await login(other);
    assert.equal((await db.query('select count(*)::int n from public.timer_presets')).rows[0].n, 0);
    assert.equal((await db.query('select count(*)::int n from public.bulletin_boards')).rows[0].n, 0);
    assert.equal((await db.query('delete from public.timer_presets where id=$1 returning id', [saved])).rows.length, 0);
    assert.equal((await db.query("update public.bulletin_boards set notes='[]' returning owner_id")).rows.length, 0);
    await login(owner);
    assert.equal((await db.query('update public.bulletin_boards set revision=gen_random_uuid() where revision=$1 returning revision', [revision])).rows.length, 1);
    assert.equal((await db.query("update public.bulletin_boards set notes='[]' where revision=$1 returning revision", [revision])).rows.length, 0);
    await db.exec('reset role;set role anon;');
    await assert.rejects(db.exec('select * from public.timer_presets'), /permission denied/);
    await assert.rejects(db.exec('select * from public.bulletin_boards'), /permission denied/);
    await login(owner);
    assert.equal((await db.query('delete from public.timer_presets where id=$1 returning id', [saved])).rows.length, 1);
  } finally { await db.close(); }
});
