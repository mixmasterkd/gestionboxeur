import test from 'node:test';
import assert from 'node:assert/strict';
import { createReactionRecordStore, createDemoReactionRecordStore } from '../js/reaction-records.js';

const modes = ['simple', 'locate', 'choice'], inputs = ['touch', 'mouse', 'keyboard'];
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

test('demo reaction records keep independent minima per exact mode/input and reset only one pair', async () => {
  const store = createDemoReactionRecordStore(), other = createDemoReactionRecordStore();
  assert.equal(store.demo, true);
  for (const mode of modes) for (const input of inputs) await store.saveRecord(mode, input, 350);
  assert.deepEqual(await store.saveRecord('simple', 'touch', 210), { mode: 'simple', input: 'touch', best_ms: 210 });
  const saved = await store.saveRecord('simple', 'touch', 500);
  assert.equal(saved.best_ms, 210); saved.best_ms = 1;
  const listed = await store.listRecords(); listed[0].best_ms = 1; listed.splice(1);
  assert.equal((await store.listRecords()).length, 9);
  assert.ok((await store.listRecords()).every(row => row.best_ms > 1));
  assert.deepEqual(await other.listRecords(), []);
  await store.resetRecord('simple', 'touch');
  assert.equal((await store.listRecords()).length, 8);
  assert.ok((await store.listRecords()).some(row => row.mode === 'simple' && row.input === 'mouse' && row.best_ms === 350));
  assert.ok((await store.listRecords()).some(row => row.mode === 'locate' && row.input === 'touch' && row.best_ms === 350));
  await store.resetRecord('simple', 'touch');
  assert.equal((await store.saveRecord('simple', 'touch', 900)).best_ms, 900);
  assert.equal((await store.saveRecord('simple', 'touch', 1)).best_ms, 1);
});

test('both reaction stores reject invalid modes, inputs and nonpositive/noninteger times before any request', async () => {
  const api = mock([]);
  for (const store of [createDemoReactionRecordStore(), createReactionRecordStore(api.client, 'owner')]) {
    for (const mode of ['Simple', 'tiles-4', 'simple ', '', null, {}]) {
      await assert.rejects(store.saveRecord(mode, 'touch', 200), /mode/);
      await assert.rejects(store.resetRecord(mode, 'touch'), /mode/);
    }
    for (const input of ['Touch', 'pen', 'touch ', '', null, {}]) {
      await assert.rejects(store.saveRecord('simple', input, 200), /commande/);
      await assert.rejects(store.resetRecord('simple', input), /commande/);
    }
    for (const value of [-1, 0, 10001, 1.5, NaN, Infinity, '200', null, undefined]) await assert.rejects(store.saveRecord('simple', 'touch', value), /entier/);
  }
  assert.equal(api.calls.length, 0);
  for (const owner of ['', ' ', null, undefined, 42]) assert.throws(() => createReactionRecordStore(api.client, owner), /Connecte-toi/);
});

test('reads and resets filter ownership; RPC sends the original owner guard and returns a single validated row', async () => {
  const api = mock([{ data: [{ mode: 'simple', input: 'keyboard', best_ms: 250, owner_id: 'private' }] }, { data: { mode: 'simple', input: 'keyboard', best_ms: 250 } }, { data: null }]);
  const store = createReactionRecordStore(api.client, 'owner');
  assert.equal(store.demo, false);
  assert.deepEqual(await store.listRecords(), [{ mode: 'simple', input: 'keyboard', best_ms: 250 }]);
  assert.deepEqual(await store.saveRecord('simple', 'keyboard', 300), { mode: 'simple', input: 'keyboard', best_ms: 250 });
  assert.equal(await store.resetRecord('simple', 'keyboard'), undefined);
  assert.deepEqual(api.calls[0], { table: 'reaction_records', methods: [['select', 'mode,input,best_ms'], ['eq', 'owner_id', 'owner'], ['order', 'mode'], ['order', 'input']] });
  assert.deepEqual(api.calls[1], { rpc: 'save_reaction_record', args: { p_mode: 'simple', p_input: 'keyboard', p_best_ms: 300, p_expected_owner: 'owner' }, methods: [['single']] });
  assert.deepEqual(api.calls[2], { table: 'reaction_records', methods: [['delete'], ['eq', 'owner_id', 'owner'], ['eq', 'mode', 'simple'], ['eq', 'input', 'keyboard']] });
});

test('reads, reset and later writes wait behind an in-flight save so old queued minima cannot reappear after reset', async () => {
  let complete;
  const pending = new Promise(resolve => { complete = resolve; });
  const api = mock([pending, { data: { mode: 'simple', input: 'mouse', best_ms: 180 } }, { data: [{ mode: 'simple', input: 'mouse', best_ms: 180 }] }, { data: null }, { data: [] }, { data: { mode: 'simple', input: 'mouse', best_ms: 400 } }]);
  const store = createReactionRecordStore(api.client, 'owner');
  const first = store.saveRecord('simple', 'mouse', 180), slower = store.saveRecord('simple', 'mouse', 400);
  const before = store.listRecords(), reset = store.resetRecord('simple', 'mouse'), after = store.listRecords(), fresh = store.saveRecord('simple', 'mouse', 400);
  await settle(); assert.equal(api.calls.length, 1);
  complete({ data: { mode: 'simple', input: 'mouse', best_ms: 180 } });
  assert.equal((await first).best_ms, 180); assert.equal((await slower).best_ms, 180);
  assert.deepEqual(await before, [{ mode: 'simple', input: 'mouse', best_ms: 180 }]);
  await reset; assert.deepEqual(await after, []); assert.equal((await fresh).best_ms, 400);
  assert.deepEqual(api.calls.map(call => call.rpc || call.methods[0][0]), ['save_reaction_record', 'save_reaction_record', 'select', 'delete', 'select', 'save_reaction_record']);
});

test('failed save/reset operations do not poison the queue and queued writes retain their initial account', async () => {
  let complete;
  const pending = new Promise(resolve => { complete = resolve; });
  const api = mock([pending, { error: { code: '42501', message: 'The account changed before the record could be saved' } }, { error: { message: 'Connexion interrompue' } }, { data: [] }]);
  const store = createReactionRecordStore(api.client, 'account-a');
  const read = store.listRecords(), write = store.saveRecord('choice', 'touch', 300);
  await settle(); assert.equal(api.calls.length, 1);
  complete({ data: [] }); await read;
  await assert.rejects(write, /Reconnecte-toi/);
  assert.equal(api.calls[1].args.p_expected_owner, 'account-a');
  const reset = store.resetRecord('choice', 'touch'), after = store.listRecords();
  await assert.rejects(reset, /Connexion interrompue/); assert.deepEqual(await after, []);
});

test('missing schema and network errors stay explicit without inventing a successful local save', async () => {
  for (const code of ['42P01', '42703', '42883', 'PGRST202', 'PGRST205']) {
    const api = mock([{ error: { code } }, { error: { code } }, { error: { code } }]);
    const store = createReactionRecordStore(api.client, 'owner');
    for (const operation of [() => store.listRecords(), () => store.saveRecord('locate', 'mouse', 200), () => store.resetRecord('locate', 'mouse')]) {
      await assert.rejects(operation(), error => error.code === code && /mise à jour de la base/.test(error.message));
    }
    assert.equal(api.calls.length, 3);
  }
  const api = mock([Promise.resolve().then(() => { throw new Error('Network offline'); }), { data: [] }]);
  const store = createReactionRecordStore(api.client, 'owner');
  await assert.rejects(store.saveRecord('simple', 'touch', 200), /Network offline/);
  assert.deepEqual(await store.listRecords(), []);
});

test('malformed server rows or mismatched input/mode cannot be mistaken for saved reaction records', async () => {
  const api = mock([
    { data: null }, { data: [{ mode: 'simple', input: 'pen', best_ms: 200 }] },
    { data: [{ mode: 'simple', input: 'mouse', best_ms: 200 }] },
    { data: { mode: 'choice', input: 'mouse', best_ms: 200 } },
    { data: { mode: 'simple', input: 'touch', best_ms: 200 } },
    { data: { mode: 'simple', input: 'mouse', best_ms: 0 } },
  ]);
  const store = createReactionRecordStore(api.client, 'owner');
  await assert.rejects(store.listRecords(), /invalides/);
  await assert.rejects(store.listRecords(), /commande/);
  await assert.rejects(store.saveRecord('simple', 'mouse', 200), /mode/);
  await assert.rejects(store.saveRecord('simple', 'mouse', 200), /correspond pas/);
  await assert.rejects(store.saveRecord('simple', 'mouse', 200), /correspond pas/);
  await assert.rejects(store.saveRecord('simple', 'mouse', 200), /entier/);
});
