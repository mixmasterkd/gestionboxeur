import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
const owner = '12000000-0000-4000-8000-000000000001', other = '12000000-0000-4000-8000-000000000002';
const base = await readFile(new URL('../supabase/migrations/20261001230552_cognitive_personal_records.sql', import.meta.url), 'utf8');
const upgrade = await readFile(new URL('../supabase/migrations/20261006024812_cognitive_memory_dual_task.sql', import.meta.url), 'utf8');
test('prepared upgrade preserves existing records and stores atomic best plus last with private account access', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create schema auth; create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      grant usage on schema public,auth to anon,authenticated; grant execute on function auth.uid() to anon,authenticated;
      insert into auth.users values('${owner}'),('${other}');`);
    await db.exec(base); await db.exec(`set role authenticated;set request.jwt.claim.sub='${owner}';select * from public.save_cognitive_record('tiles-6',7,'${owner}');reset role;`);
    await db.exec(upgrade); await db.exec(`set role authenticated;set request.jwt.claim.sub='${owner}';`);
    const save = async (mode, result, expected = owner) => (await db.query('select * from public.save_cognitive_result($1,$2,$3)', [mode, JSON.stringify(result), expected])).rows[0];
    const record = { levelReached: 5, maxLevel: 4, errors: 3 };
    await save('visual-memory', record); const row = await save('visual-memory', { ...record, maxLevel: 1 });
    assert.equal(row.best_result.maxLevel, 4); assert.equal(row.last_result.maxLevel, 1); assert.ok(Date.parse(row.last_result.date));
    assert.equal((await db.query("select score from public.cognitive_records where mode='tiles-6'")).rows[0].score, 7);
    await assert.rejects(save('visual-memory', record, other), /account changed/);
    await assert.rejects(save('visual-memory', { ...record, errors: 4 }), /Invalid/);
    await assert.rejects(save('visual-memory', { ...record, maxLevel: null }), /Invalid/);
    await assert.rejects(save('tiles-6', record), /Invalid/);
    const dual = { score: 240, targetsHit: 20, targetsMissed: 0, inhibitionErrors: 0, triangleCount: 10, triangleAnswer: 10, triangleError: 0, precision: 100, averageReactionTime: 650, bestReactionTime: 200 };
    assert.equal((await save('dual-task', dual)).best_result.score, 240);
    await assert.rejects(save('dual-task', { ...dual, triangleError: 1 }), /Invalid/);
    await assert.rejects(save('dual-task', { ...dual, bestReactionTime: null }), /Invalid/);
    await db.exec(`set request.jwt.claim.sub='${other}';`); assert.deepEqual((await db.query('select * from public.cognitive_records')).rows, []);
    await assert.rejects(save('dual-task', dual), /account changed/);
    await db.exec('reset role;set role anon;'); await assert.rejects(db.query('select * from public.cognitive_records'), /permission denied/);
    await assert.rejects(save('visual-memory', record), /permission denied/);
    await db.exec('reset role;');
    const security = (await db.query("select prosecdef,proconfig from pg_proc where oid='public.save_cognitive_result(text,jsonb,uuid)'::regprocedure")).rows[0];
    assert.equal(security.prosecdef, false); assert.ok(security.proconfig.includes('search_path=""'));
  } finally { await db.close(); }
});
