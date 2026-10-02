import test from 'node:test';
import assert from 'node:assert/strict';
import { createCognitiveRecordStore, createDemoCognitiveRecordStore } from '../js/cognitive-records.js';

const modes = ['tiles-4', 'tiles-6', 'tiles-8', 'bag-sequence-visible', 'bag-sequence-hidden', 'bag-targets-visible', 'bag-targets-hidden'];
const settle = () => new Promise(resolve => setImmediate(resolve));
function mock(responses) {
  const calls = [];
  function query(call) {
    calls.push(call);
    const chain = { then(resolve, reject) { return Promise.resolve(responses.shift()).then(resolve, reject); } };
    for (const name of ['select', 'delete', 'eq', 'order', 'single']) chain[name] = (...args) => { call.methods.push([name, ...args]); return chain; };
    return chain;
  }
  return { calls, client: {
    from(table) { return query({ table, methods: [] }); },
    rpc(name, args) { return query({ rpc: name, args, methods: [] }); },
  } };
}

test('demo records are independent per exact variant, retain maxima, and only reset the chosen variant', async () => {
  const store = createDemoCognitiveRecordStore(), other = createDemoCognitiveRecordStore();
  assert.equal(store.demo, true);
  for (let index = 0; index < modes.length; index++) await store.saveRecord(modes[index], index + 1);
  assert.deepEqual(await store.saveRecord('tiles-4', 12), { mode: 'tiles-4', score: 12 });
  assert.deepEqual(await store.saveRecord('tiles-4', 2), { mode: 'tiles-4', score: 12 });
  const listed = await store.listRecords(); listed[0].score = 9000; listed.splice(1);
  assert.equal((await store.listRecords()).length, 7);
  assert.ok((await store.listRecords()).every(row => row.score < 9000));
  assert.deepEqual(await other.listRecords(), []);
  await store.resetRecord('bag-sequence-visible');
  assert.equal((await store.listRecords()).length, 6);
  assert.ok((await store.listRecords()).some(row => row.mode === 'bag-sequence-hidden'));
  await store.resetRecord('bag-sequence-visible');
  await store.resetRecord('tiles-4');
  assert.deepEqual(await store.saveRecord('tiles-4', 0), { mode: 'tiles-4', score: 0 });
});

test('both stores reject invalid modes and scores before sending requests', async () => {
  const api = mock([]);
  const stores = [createDemoCognitiveRecordStore(), createCognitiveRecordStore(api.client, 'owner')];
  for (const store of stores) {
    for (const mode of ['tiles-5', 'TILES-4', 'bag-sequence', 'tiles-4 ', '', null, {}]) {
      await assert.rejects(store.saveRecord(mode, 1), /mode/);
      await assert.rejects(store.resetRecord(mode), /mode/);
    }
    for (const score of [-1, 10001, 1.5, NaN, Infinity, '5', null, undefined]) await assert.rejects(store.saveRecord('tiles-4', score), /entier/);
  }
  assert.equal(api.calls.length, 0);
  for (const owner of ['', null, undefined, 42]) assert.throws(() => createCognitiveRecordStore(api.client, owner), /Connecte-toi/);
});

test('account reads and resets explicitly filter the owner; save uses the atomic owner-derived RPC and returns one object', async () => {
  const api = mock([{ data: [{ mode: 'tiles-4', score: 12, owner_id: 'private' }] }, { data: { mode: 'tiles-4', score: 12 } }, { data: null }]);
  const store = createCognitiveRecordStore(api.client, 'owner');
  assert.equal(store.demo, false);
  assert.deepEqual(await store.listRecords(), [{ mode: 'tiles-4', score: 12 }]);
  assert.deepEqual(await store.saveRecord('tiles-4', 4), { mode: 'tiles-4', score: 12 });
  assert.equal(await store.resetRecord('tiles-6'), undefined);
  assert.deepEqual(api.calls[0], { table: 'cognitive_records', methods: [['select', 'mode,score'], ['eq', 'owner_id', 'owner'], ['order', 'mode']] });
  assert.deepEqual(api.calls[1], { rpc: 'save_cognitive_record', args: { p_mode: 'tiles-4', p_score: 4, p_expected_owner: 'owner' }, methods: [['single']] });
  assert.deepEqual(api.calls[2], { table: 'cognitive_records', methods: [['delete'], ['eq', 'owner_id', 'owner'], ['eq', 'mode', 'tiles-6']] });
});

test('reads, reset and later writes wait behind an in-flight score so reset cannot resurrect an older queued record', async () => {
  let complete;
  const pending = new Promise(resolve => { complete = resolve; });
  const api = mock([
    pending,
    { data: { mode: 'tiles-4', score: 9 } },
    { data: [{ mode: 'tiles-4', score: 9 }] },
    { data: null }, { data: [] },
    { data: { mode: 'tiles-4', score: 1 } },
  ]);
  const store = createCognitiveRecordStore(api.client, 'owner');
  const first = store.saveRecord('tiles-4', 9), lower = store.saveRecord('tiles-4', 4);
  const before = store.listRecords(), reset = store.resetRecord('tiles-4'), after = store.listRecords(), fresh = store.saveRecord('tiles-4', 1);
  await settle(); assert.equal(api.calls.length, 1);
  complete({ data: { mode: 'tiles-4', score: 9 } });
  assert.deepEqual(await first, { mode: 'tiles-4', score: 9 });
  assert.deepEqual(await lower, { mode: 'tiles-4', score: 9 });
  assert.deepEqual(await before, [{ mode: 'tiles-4', score: 9 }]);
  await reset; assert.deepEqual(await after, []); assert.deepEqual(await fresh, { mode: 'tiles-4', score: 1 });
  assert.deepEqual(api.calls.map(call => call.rpc || call.methods[0][0]), ['save_cognitive_record', 'save_cognitive_record', 'select', 'delete', 'select', 'save_cognitive_record']);
});

test('a failed save or reset does not poison subsequent queued account operations', async () => {
  const api = mock([{ error: { code: '42501' } }, { data: [{ mode: 'tiles-4', score: 20 }] }, { error: { message: 'Connexion interrompue' } }, { data: { mode: 'tiles-4', score: 21 } }]);
  const store = createCognitiveRecordStore(api.client, 'owner');
  const failedSave = store.saveRecord('tiles-4', 2), read = store.listRecords();
  await assert.rejects(failedSave, /privés/); assert.deepEqual(await read, [{ mode: 'tiles-4', score: 20 }]);
  const failedReset = store.resetRecord('tiles-4'), next = store.saveRecord('tiles-4', 21);
  await assert.rejects(failedReset, /Connexion interrompue/); assert.equal((await next).score, 21);
});

test('queued writes keep the original expected owner when the shared client changes accounts', async () => {
  let complete;
  const pending = new Promise(resolve => { complete = resolve; });
  const api = mock([pending, { error: { code: '42501', message: 'The account changed before the record could be saved' } }]);
  const store = createCognitiveRecordStore(api.client, 'account-a');
  const read = store.listRecords(), write = store.saveRecord('tiles-4', 8);
  await settle(); assert.equal(api.calls.length, 1);
  complete({ data: [] }); await read;
  await assert.rejects(write, /Reconnecte-toi/);
  assert.equal(api.calls[1].args.p_expected_owner, 'account-a', 'the server can reject this write if auth.uid() has changed');
});

test('missing schema and network failures are reported explicitly instead of inventing local records', async () => {
  for (const code of ['42P01', '42703', '42883', 'PGRST202', 'PGRST205']) {
    const api = mock([{ error: { code } }, { error: { code } }, { error: { code } }]);
    const store = createCognitiveRecordStore(api.client, 'owner');
    for (const operation of [() => store.listRecords(), () => store.saveRecord('tiles-4', 7), () => store.resetRecord('tiles-4')]) await assert.rejects(operation(), /mise à jour de la base/);
    assert.equal(api.calls.length, 3);
  }
  const api = mock([Promise.resolve().then(() => { throw new Error('Network offline'); }), { data: [] }]);
  const store = createCognitiveRecordStore(api.client, 'owner');
  await assert.rejects(store.saveRecord('tiles-4', 7), /Network offline/);
  assert.deepEqual(await store.listRecords(), []);
});

test('malformed server responses cannot be mistaken for saved records', async () => {
  const api = mock([{ data: null }, { data: [{ mode: 'tiles-4', score: 2 }] }, { data: { mode: 'tiles-6', score: 2 } }, { data: [{ mode: 'unknown', score: 2 }] }]);
  const store = createCognitiveRecordStore(api.client, 'owner');
  await assert.rejects(store.listRecords(), /invalides/);
  await assert.rejects(store.saveRecord('tiles-4', 2), /mode/);
  await assert.rejects(store.saveRecord('tiles-4', 2), /correspond pas/);
  await assert.rejects(store.listRecords(), /mode/);
});
