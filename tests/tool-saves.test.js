import test from 'node:test';
import assert from 'node:assert/strict';
import { createToolStore, createDemoToolStore, validateTimerPreset } from '../js/tool-saves.js';

const base = { mode: 'base', config: { rounds: 3, series: 2, work: 60, rest: 30, seriesRest: 90, preparation: 5 }, units: { work: 'M' } };
const note = { id: 'one', title: 'Boxe', body: 'Note', color: 'cream', links: [{ label: 'FQBO', url: 'https://fqbo.qc.ca/' }] };
function mock(responses) {
  const calls = [];
  const db = { from(table) {
    const call = { table, methods: [] }; calls.push(call);
    const query = { then: (resolve, reject) => Promise.resolve(responses.shift()).then(resolve, reject) };
    for (const method of ['select', 'insert', 'update', 'delete', 'eq', 'order', 'range', 'single', 'maybeSingle']) query[method] = (...args) => { call.methods.push([method, ...args]); return query; };
    return query;
  } };
  return { db, calls };
}
test('saved payload contains exactly the active mode and never elapsed time or the other draft', () => {
  assert.deepEqual(validateTimerPreset({ mode: 'advanced', text: '3x\n- 1m @ Z3\n- 30s @ repos', config: base.config, elapsed: 400 }), { mode: 'advanced', text: '3x\n- 1m @ Z3\n- 30s @ repos' });
  const clean = validateTimerPreset({ ...base, text: 'other', elapsed: 200 });
  assert.deepEqual(Object.keys(clean), ['mode', 'config', 'units']);
  assert.equal(clean.config.warning, false); assert.equal(clean.units.work, 'M'); assert.equal(clean.units.rest, 'S');
  assert.throws(() => validateTimerPreset({ mode: 'advanced', text: '- bananas' }));
  assert.throws(() => validateTimerPreset({ ...base, config: { ...base.config, rounds: 0 } }));
  assert.throws(() => validateTimerPreset({ ...base, config: { ...base.config, work: '60' } }));
});
test('demo saves are cloned, independently scoped and explicitly temporary', async () => {
  const store = createDemoToolStore(), other = createDemoToolStore();
  const saved = await store.saveTimer({ title: '  Sprint  ', payload: base }); saved.title = 'mutated';
  assert.equal((await store.listTimers())[0].title, 'Sprint');
  assert.deepEqual(await other.listTimers(), []); assert.equal(store.demo, true);
  await store.saveBoard({ notes: [note] });
  const board = await store.loadBoard(); board.notes[0].title = 'mutated';
  assert.equal((await store.loadBoard()).notes[0].title, 'Boxe');
  await store.saveBoard({ notes: [] }); assert.deepEqual(await store.loadBoard(), { notes: [] });
  await store.deleteTimer(saved.id); assert.deepEqual(await store.listTimers(), []);
  await assert.rejects(store.saveBoard({ notes: [{ ...note, links: [{ label: 'X', url: 'javascript:alert(1)' }] }] }));
  await assert.rejects(store.saveBoard({ notes: [note, note] }));
});
test('database timer CRUD uses explicit owner filters and sanitized active-mode payload', async () => {
  const { db, calls } = mock([{ data: [] }, { data: { id: 'saved' } }, { data: { id: 'saved' } }]);
  const store = createToolStore(db, 'owner');
  await store.listTimers(); await store.saveTimer({ title: 'Sprint', payload: base }); await store.deleteTimer('saved');
  assert.ok(calls[0].methods.some(m => m[0] === 'eq' && m[1] === 'owner_id' && m[2] === 'owner'));
  const insert = calls[1].methods.find(m => m[0] === 'insert')[1];
  assert.equal(insert.owner_id, 'owner'); assert.deepEqual(insert.payload, validateTimerPreset(base));
  assert.ok(calls[2].methods.some(m => m[0] === 'eq' && m[1] === 'owner_id' && m[2] === 'owner'));
});
test('board optimistic revision prevents overwrites from another device, without falling back locally', async () => {
  const { db, calls } = mock([{ data: { notes: [note], revision: 'rev1' } }, { error: { code: 'PGRST116' } }, { data: { notes: [], revision: 'rev2' } }]);
  const store = createToolStore(db, 'owner');
  await assert.rejects(store.saveBoard({ notes: [] }), /d’abord/);
  await store.loadBoard();
  await assert.rejects(store.saveBoard({ notes: [] }), /changé ailleurs/);
  assert.ok(calls[1].methods.some(m => m[0] === 'eq' && m[1] === 'revision' && m[2] === 'rev1'));
  await store.saveBoard({ notes: [] });
  assert.ok(calls[2].methods.some(m => m[0] === 'eq' && m[1] === 'revision' && m[2] === 'rev1'));
});
test('first board write is an insert, so a concurrent first write cannot be overwritten', async () => {
  const { db, calls } = mock([{ data: null }, { error: { code: '23505' } }]);
  const store = createToolStore(db, 'owner');
  assert.equal(await store.loadBoard(), null);
  await assert.rejects(store.saveBoard({ notes: [] }), /changé ailleurs/);
  assert.equal(calls[1].methods[0][0], 'insert');
});

test('reopening a board during a pending save waits for matching content and revision before another edit', async () => {
  let completeWrite;
  const pendingWrite = new Promise(resolve => { completeWrite = resolve; });
  const savedNote = { ...note, title: 'Modification déjà enregistrée' };
  const nextNote = { ...savedNote, body: 'Nouvelle modification après réouverture' };
  const { db, calls } = mock([
    { data: { notes: [note], revision: 'rev1' } },
    pendingWrite,
    { data: { notes: [savedNote], revision: 'rev2' } },
    { data: { notes: [nextNote], revision: 'rev3' } },
  ]);
  const store = createToolStore(db, 'owner');
  await store.loadBoard();
  const write = store.saveBoard({ notes: [savedNote] });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.length, 2, 'the previous view has sent its save');
  let reopened = false;
  const reopen = store.loadBoard().then(board => { reopened = true; return board; });
  await new Promise(resolve => setImmediate(resolve));
  try {
    assert.equal(reopened, false, 'new view must not receive stale content while the write is pending');
    assert.equal(calls.length, 2, 'do not even issue the reopened SELECT before the pending write completes');
  } finally {
    completeWrite({ data: { notes: [savedNote], revision: 'rev2' } });
  }
  await write;
  const board = await reopen;
  assert.deepEqual(board, { notes: [savedNote] });
  assert.equal(calls.length, 3);
  board.notes = [{ ...board.notes[0], body: nextNote.body }];
  await store.saveBoard(board);
  const nextWrite = calls[3].methods;
  assert.deepEqual(nextWrite.find(method => method[0] === 'update')[1].notes, [nextNote]);
  assert.ok(nextWrite.some(method => method[0] === 'eq' && method[1] === 'revision' && method[2] === 'rev2'), 'next write uses the revision belonging to the reopened content');
});

test('a failed board save does not poison the queue for a reopened read and later write', async () => {
  const remoteNote = { ...note, title: 'Modification depuis un autre appareil' };
  const { db, calls } = mock([
    { data: { notes: [note], revision: 'rev1' } },
    { error: { code: 'PGRST116' } },
    { data: { notes: [remoteNote], revision: 'rev2' } },
    { data: { notes: [], revision: 'rev3' } },
  ]);
  const store = createToolStore(db, 'owner');
  await store.loadBoard();
  const failed = store.saveBoard({ notes: [] });
  const reopened = store.loadBoard();
  await assert.rejects(failed, /changé ailleurs/);
  assert.deepEqual(await reopened, { notes: [remoteNote] });
  await store.saveBoard({ notes: [] });
  assert.ok(calls[3].methods.some(method => method[0] === 'eq' && method[1] === 'revision' && method[2] === 'rev2'));
});
