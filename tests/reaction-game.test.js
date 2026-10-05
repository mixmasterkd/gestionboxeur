import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { mountReactionGame } from '../js/reaction-game.js';

const flush = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const preferenceKey = owner => `gestionboxeur:reaction:v1:${owner}`;
const recordKey = (mode, input) => `${mode}:${input}`;
function memoryStorage() {
  const entries = new Map();
  return { getItem: key => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, String(value)) };
}

async function fixture({ rows = [], preferences = { mode: 'simple', rounds: 1 }, ownerId = 'owner-a', storage = memoryStorage(), store: suppliedStore, list, save, reset, ready = true, touch = false } = {}) {
  const window = new Window({ url: 'https://example.test/tools.html', settings: { disableJavaScriptEvaluation: true, disableJavaScriptFileLoading: true, disableCSSFileLoading: true } });
  const host = window.document.createElement('div'); window.document.body.append(host);
  if (touch) Object.defineProperty(window.navigator, 'maxTouchPoints', { configurable: true, value: 2 });
  if (preferences) storage.setItem(preferenceKey(ownerId), JSON.stringify(preferences));
  const persisted = new Map(rows.map(row => [recordKey(row.mode, row.input), row.best_ms]));
  const calls = { list: 0, save: [], reset: [], confirm: [], activity: [] };
  const store = suppliedStore === undefined ? {
    async listRecords() {
      calls.list++;
      return list ? list() : [...persisted].map(([key, best_ms]) => { const [mode, input] = key.split(':'); return { mode, input, best_ms }; });
    },
    async saveRecord(mode, input, best_ms) {
      calls.save.push({ mode, input, best_ms });
      const row = save ? await save(mode, input, best_ms) : { mode, input, best_ms: Math.min(persisted.get(recordKey(mode, input)) ?? Infinity, best_ms) };
      persisted.set(recordKey(row.mode, row.input), row.best_ms); return row;
    },
    async resetRecord(mode, input) { calls.reset.push({ mode, input }); if (reset) await reset(mode, input); persisted.delete(recordKey(mode, input)); },
  } : suppliedStore;
  let time = 0;
  window.confirm = message => { calls.confirm.push(message); return true; };
  const ui = mountReactionGame(host, { store, ownerId, storage, now: () => time, random: () => 0, autoTick: false, onActivity: active => calls.activity.push(active) });
  const app = {
    window, host, ui, calls, persisted, storage,
    $: id => host.querySelector(`#${id}`), query: selector => host.querySelector(selector), all: selector => [...host.querySelectorAll(selector)],
    status: () => host.querySelector('.reaction')?.dataset.status,
    advance(ms) { time += ms; ui.tick(); },
    select(id, value) { const control = host.querySelector(`#${id}`); control.value = String(value); control.dispatchEvent(new window.Event('change', { bubbles: true })); },
    async close() { ui.destroy(); await window.happyDOM.abort(); },
  };
  if (ready) await flush();
  return app;
}
const pad = (app, index = 0) => app.query(`.reaction-pad[data-index="${index}"]`);
function pointer(app, type, { index = 0, input = 'mouse', id = 1, primary = true } = {}) {
  pad(app, index).dispatchEvent(new app.window.PointerEvent(type, { bubbles: true, cancelable: true, pointerId: id, pointerType: input, isPrimary: primary, button: 0 }));
}
function press(app, options = {}) { pointer(app, 'pointerdown', options); pointer(app, 'pointerup', options); }
function key(app, type, key = ' ', options = {}) {
  app.window.document.dispatchEvent(new app.window.KeyboardEvent(type, { key, code: key === ' ' ? 'Space' : `Key${key.toUpperCase()}`, bubbles: true, cancelable: true, ...options }));
}
function showSignal(app) { app.advance(5000); assert.equal(app.status(), 'active'); }
function completeTrial(app, milliseconds = 250, { input = 'mouse', index = 0 } = {}) {
  showSignal(app); app.advance(milliseconds);
  if (input === 'keyboard') { key(app, 'keydown'); key(app, 'keyup'); } else press(app, { input, index });
  app.advance(100); app.advance(1100);
}
async function completeGame(app, milliseconds = 250, options) {
  app.$('reactionStart').click(); completeTrial(app, milliseconds, options); await flush();
}

test('reaction defaults to five trials and exposes independently selected mode and input records', async () => {
  const app = await fixture({ preferences: null, rows: [
    { mode: 'simple', input: 'mouse', best_ms: 230 }, { mode: 'simple', input: 'touch', best_ms: 280 }, { mode: 'locate', input: 'touch', best_ms: 310 },
  ] });
  try {
    assert.equal(app.status(), 'idle'); assert.equal(app.$('reactionMode').value, 'simple'); assert.equal(app.$('reactionRounds').value, '5');
    assert.equal(app.$('reactionInput').value, 'mouse'); assert.match(app.$('reactionRecord').textContent, /230/);
    assert.equal(app.calls.list, 1); assert.equal(app.calls.save.length, 0);
    assert.deepEqual([...app.$('reactionRounds').options].map(option => option.value), ['1', '5', '10']);
    assert.deepEqual([...app.$('reactionMode').options].map(option => option.value), ['simple', 'locate', 'choice']);
    app.select('reactionInput', 'touch'); assert.match(app.$('reactionRecord').textContent, /280/);
    app.select('reactionMode', 'locate'); assert.match(app.$('reactionRecord').textContent, /310/);
    app.select('reactionInput', 'keyboard'); assert.match(app.$('reactionRecord').textContent, /—/);
    assert.equal(app.$('reactionResetRecord').disabled, true);
  } finally { await app.close(); }
});

test('one valid reaction saves only after settling and ignores its generated mouse click', async () => {
  const app = await fixture();
  try {
    app.$('reactionStart').click(); assert.equal(app.status(), 'waiting');
    assert.equal(app.$('reactionMode').disabled, true); assert.equal(app.$('reactionRounds').disabled, true);
    showSignal(app); app.advance(237); press(app);
    assert.equal(app.calls.save.length, 0, 'the multi-input guard must settle before recording');
    pad(app).dispatchEvent(new app.window.MouseEvent('click', { detail: 1, bubbles: true }));
    app.advance(99); assert.equal(app.calls.save.length, 0);
    app.advance(1); await flush();
    assert.deepEqual(app.calls.save, [{ mode: 'simple', input: 'mouse', best_ms: 237 }]);
    assert.match(app.$('reactionResult').textContent, /237/); assert.match(app.$('reactionAverage').textContent, /237/);
    assert.match(app.$('reactionRecord').textContent, /237/); assert.equal(app.$('reactionErrors').textContent.trim(), '0');
    app.advance(1100); assert.equal(app.status(), 'done'); assert.equal(app.$('reactionMode').disabled, false);
    assert.deepEqual(app.calls.activity, [true, false]);
    app.ui.tick(); await flush(); assert.equal(app.calls.save.length, 1);
    await completeGame(app, 340); assert.equal(app.calls.save.length, 1, 'a slower result cannot overwrite the known record');
    await completeGame(app, 195); assert.equal(app.calls.save.at(-1).best_ms, 195);
  } finally { await app.close(); }
});

test('touch and keyboard reactions never overwrite the mouse record and ignore repeated held keys', async () => {
  const app = await fixture({ rows: [{ mode: 'simple', input: 'mouse', best_ms: 180 }], touch: true });
  try {
    assert.equal(app.$('reactionInput').value, 'touch');
    await completeGame(app, 220, { input: 'touch' });
    assert.deepEqual(app.calls.save, [{ mode: 'simple', input: 'touch', best_ms: 220 }]);
    assert.equal(app.$('reactionInput').value, 'touch'); assert.equal(app.persisted.get('simple:mouse'), 180);
    app.$('reactionStart').click(); showSignal(app); app.advance(275);
    key(app, 'keydown'); key(app, 'keydown', ' ', { repeat: true }); key(app, 'keyup');
    app.advance(100); app.advance(1100); await flush();
    assert.equal(app.$('reactionInput').value, 'keyboard');
    assert.deepEqual(app.calls.save.at(-1), { mode: 'simple', input: 'keyboard', best_ms: 275 });
    assert.equal(app.$('reactionErrors').textContent.trim(), '0');
    assert.equal(app.persisted.get('simple:touch'), 220); assert.equal(app.persisted.get('simple:mouse'), 180);
  } finally { await app.close(); }
});

test('false starts and overlapping touches are errors rather than reaction records', async () => {
  const app = await fixture();
  try {
    app.$('reactionStart').click(); press(app, { input: 'touch' }); app.advance(1100); await flush();
    assert.equal(app.status(), 'done'); assert.equal(app.$('reactionErrors').textContent.trim(), '1'); assert.equal(app.calls.save.length, 0);
    app.$('reactionStart').click(); showSignal(app); app.advance(200);
    pointer(app, 'pointerdown', { input: 'touch', id: 1 });
    pointer(app, 'pointerdown', { input: 'touch', id: 2, primary: false });
    pointer(app, 'pointerup', { input: 'touch', id: 1 }); pointer(app, 'pointerup', { input: 'touch', id: 2, primary: false });
    app.advance(100); app.advance(1100); await flush();
    assert.equal(app.$('reactionErrors').textContent.trim(), '1'); assert.equal(app.calls.save.length, 0);
    assert.match(app.$('reactionAverage').textContent, /—/);
    assert.match(app.$('reactionRecord').textContent, /—/);
  } finally { await app.close(); }
});

test('locate and choice use four positions and retain distinct records while rejecting incorrect targets', async () => {
  const app = await fixture();
  try {
    app.select('reactionMode', 'locate'); assert.equal(app.all('.reaction-pad').length, 4);
    app.$('reactionStart').click(); assert.match(app.$('reactionTargetName').textContent, /rouge/i);
    showSignal(app); app.advance(250); press(app, { index: 1 }); app.advance(1100); await flush();
    assert.equal(app.$('reactionErrors').textContent.trim(), '1'); assert.equal(app.calls.save.length, 0);
    await completeGame(app, 310, { index: 0 });
    assert.deepEqual(app.calls.save.at(-1), { mode: 'locate', input: 'mouse', best_ms: 310 });
    app.select('reactionMode', 'choice'); assert.equal(app.all('.reaction-pad').length, 4);
    app.$('reactionStart').click(); showSignal(app); app.advance(260); press(app, { index: 0 }); app.advance(1100); await flush();
    assert.equal(app.$('reactionErrors').textContent.trim(), '1'); assert.equal(app.calls.save.length, 1);
    // A deterministic zero shuffle moves the announced red target to position 4.
    await completeGame(app, 350, { index: 3 });
    assert.deepEqual(app.calls.save.at(-1), { mode: 'choice', input: 'mouse', best_ms: 350 });
    assert.equal(app.persisted.get('locate:mouse'), 310);
  } finally { await app.close(); }
});

test('a second held keyboard control invalidates a correct response instead of creating an artificial best', async () => {
  const app = await fixture({ preferences: { mode: 'locate', rounds: 1 } });
  try {
    app.$('reactionStart').click(); showSignal(app); app.advance(210);
    key(app, 'keydown', 'a'); key(app, 'keydown', 'k'); key(app, 'keyup', 'a'); key(app, 'keyup', 'k');
    app.advance(100); app.advance(1100); await flush();
    assert.equal(app.$('reactionErrors').textContent.trim(), '1'); assert.equal(app.calls.save.length, 0);
    assert.match(app.$('reactionAverage').textContent, /—/);
  } finally { await app.close(); }
});

test('a held pointer blocks the next signal until release and cancelled pointers cannot poison later trials', async () => {
  const app = await fixture({ preferences: { mode: 'simple', rounds: 5 } });
  try {
    app.$('reactionStart').click(); pointer(app, 'pointerdown', { input: 'touch', id: 7 });
    app.advance(1100); app.advance(5000);
    assert.equal(app.status(), 'waiting'); assert.equal(pad(app).dataset.color, ''); assert.equal(app.calls.save.length, 0);
    pointer(app, 'pointercancel', { input: 'touch', id: 7 }); app.advance(1);
    assert.equal(app.status(), 'active'); app.advance(260); press(app, { input: 'touch', id: 8 }); app.advance(100); await flush();
    assert.deepEqual(app.calls.save, [{ mode: 'simple', input: 'touch', best_ms: 260 }]);
    assert.equal(app.$('reactionErrors').textContent.trim(), '1');
  } finally { await app.close(); }
});

test('assistive button activation uses the keyboard record without a duplicate pointer event', async () => {
  const app = await fixture();
  try {
    app.$('reactionStart').click(); showSignal(app); app.advance(290); pad(app).click();
    app.advance(100); app.advance(1100); await flush();
    assert.deepEqual(app.calls.save, [{ mode: 'simple', input: 'keyboard', best_ms: 290 }]);
    assert.equal(app.$('reactionInput').value, 'keyboard'); assert.equal(app.$('reactionErrors').textContent.trim(), '0');
  } finally { await app.close(); }
});

test('five trials report valid-only average, retain failures and stop after the configured count', async () => {
  const app = await fixture({ preferences: { mode: 'simple', rounds: 5 } });
  try {
    app.$('reactionStart').click(); press(app); app.advance(1100);
    completeTrial(app, 300); await flush(); completeTrial(app, 200); await flush();
    showSignal(app); app.advance(10000); app.advance(1100);
    completeTrial(app, 250); await flush();
    assert.equal(app.status(), 'done'); assert.equal(app.$('reactionErrors').textContent.trim(), '2');
    assert.match(app.$('reactionAverage').textContent, /250/); assert.match(app.$('reactionRecord').textContent, /200/);
    assert.deepEqual(app.calls.save.map(row => row.best_ms), [300, 200]);
    assert.match(app.$('reactionResults').textContent, /300/); assert.match(app.$('reactionResults').textContent, /200/); assert.match(app.$('reactionResults').textContent, /250/);
    app.advance(60000); assert.equal(app.status(), 'done'); assert.equal(app.calls.save.length, 2);
  } finally { await app.close(); }
});

test('visibility loss and stopping discard a settling trial without writing a record', async () => {
  const app = await fixture();
  try {
    app.$('reactionStart').click(); showSignal(app); app.advance(230); press(app);
    Object.defineProperty(app.window.document, 'visibilityState', { configurable: true, value: 'hidden' });
    app.window.document.dispatchEvent(new app.window.Event('visibilitychange')); app.advance(10000); await flush();
    assert.equal(app.status(), 'interrupted'); assert.equal(app.calls.save.length, 0); assert.equal(app.ui.canLeave(), true);
    Object.defineProperty(app.window.document, 'visibilityState', { configurable: true, value: 'visible' });
    app.window.document.dispatchEvent(new app.window.Event('visibilitychange'));
    app.$('reactionStart').click(); showSignal(app); app.advance(245); press(app);
    app.$('reactionStop').click(); app.advance(10000); await flush();
    assert.equal(app.status(), 'interrupted'); assert.equal(app.calls.save.length, 0);
    app.$('reactionStart').click(); app.window.dispatchEvent(new app.window.Event('pagehide')); app.advance(10000);
    assert.equal(app.status(), 'interrupted'); assert.equal(app.calls.save.length, 0);
  } finally { await app.close(); }
});

test('active reactions respect cancelled leave confirmation and manual stop permits leaving', async () => {
  const app = await fixture();
  try {
    app.$('reactionStart').click(); app.window.confirm = () => false;
    assert.equal(app.ui.canLeave(), false); assert.equal(app.status(), 'waiting');
    app.$('reactionStop').click(); assert.equal(app.ui.canLeave(), true); assert.equal(app.calls.save.length, 0);
  } finally { await app.close(); }
});

test('record reset is confirmed and scoped to the displayed mode/input while pending deletion locks play', async () => {
  const pending = deferred();
  const app = await fixture({ rows: [{ mode: 'simple', input: 'mouse', best_ms: 230 }, { mode: 'simple', input: 'touch', best_ms: 250 }], reset: () => pending.promise });
  try {
    app.window.confirm = () => false; app.$('reactionResetRecord').click(); assert.equal(app.calls.reset.length, 0);
    app.window.confirm = () => true; app.$('reactionResetRecord').click();
    assert.deepEqual(app.calls.reset, [{ mode: 'simple', input: 'mouse' }]);
    assert.equal(app.$('reactionStart').disabled, true); assert.equal(app.$('reactionMode').disabled, true);
    assert.equal(app.$('reactionRounds').disabled, true); assert.equal(app.$('reactionInput').disabled, true);
    assert.equal(app.$('reactionResetRecord').disabled, true);
    pending.resolve(); await flush();
    assert.match(app.$('reactionRecord').textContent, /—/); assert.equal(app.$('reactionStart').disabled, false);
    app.select('reactionInput', 'touch'); assert.match(app.$('reactionRecord').textContent, /250/);
    assert.equal(app.persisted.get('simple:touch'), 250);
  } finally { await app.close(); }
});

test('record-loading errors show a retry without blocking play, and retry restores the private record', async () => {
  let offline = true;
  const app = await fixture({ list: () => { if (offline) throw new Error('Connexion interrompue.'); return [{ mode: 'simple', input: 'mouse', best_ms: 225 }]; } });
  try {
    assert.equal(app.$('reactionStart').disabled, false); assert.equal(app.$('reactionRetry').hidden, false);
    assert.match(app.$('reactionRecordStatus').textContent, /Connexion interrompue/); assert.equal(app.$('reactionResetRecord').disabled, true);
    offline = false; app.$('reactionRetry').click(); await flush();
    assert.equal(app.calls.list, 2); assert.match(app.$('reactionRecord').textContent, /225/);
    assert.equal(app.$('reactionRetry').hidden, true);
  } finally { await app.close(); }
});

test('failed saves preserve the result, guard leaving and retry using the original mode/input', async () => {
  let offline = true;
  const app = await fixture({ save: (mode, input, best_ms) => { if (offline) throw new Error('Hors ligne.'); return { mode, input, best_ms }; } });
  try {
    await completeGame(app, 260);
    assert.match(app.$('reactionResults').textContent, /260/); assert.equal(app.$('reactionRetry').hidden, false);
    assert.match(app.$('reactionRecordStatus').textContent, /Hors ligne/);
    app.window.confirm = () => false; assert.equal(app.ui.canLeave(), false);
    const unload = new app.window.Event('beforeunload', { cancelable: true }); app.window.dispatchEvent(unload); assert.equal(unload.defaultPrevented, true);
    app.select('reactionMode', 'choice'); app.select('reactionInput', 'touch'); offline = false;
    app.$('reactionRetry').click(); await flush();
    assert.deepEqual(app.calls.save, [{ mode: 'simple', input: 'mouse', best_ms: 260 }, { mode: 'simple', input: 'mouse', best_ms: 260 }]);
    assert.equal(app.$('reactionRetry').hidden, true); assert.equal(app.ui.canLeave(), true);
    app.select('reactionMode', 'simple'); app.select('reactionInput', 'mouse'); assert.match(app.$('reactionRecord').textContent, /260/);
  } finally { await app.close(); }
});

test('results earned before records finish loading wait and do not replace a faster existing result', async () => {
  const pending = deferred();
  const app = await fixture({ list: () => pending.promise, ready: false });
  try {
    await completeGame(app, 260); assert.equal(app.calls.save.length, 0);
    pending.resolve([{ mode: 'simple', input: 'mouse', best_ms: 190 }]); await flush();
    assert.equal(app.calls.save.length, 0); assert.match(app.$('reactionRecord').textContent, /190/);
  } finally { await app.close(); }
});

test('record saves serialize faster pending reactions and clear unload protection after the final write', async () => {
  const writes = [];
  const app = await fixture({ save: (mode, input, best_ms) => { const pending = deferred(); writes.push({ mode, input, best_ms, pending }); return pending.promise; } });
  try {
    await completeGame(app, 280); assert.equal(writes.length, 1);
    await completeGame(app, 220); assert.equal(writes.length, 1);
    writes[0].pending.resolve({ mode: 'simple', input: 'mouse', best_ms: 280 }); await flush();
    assert.equal(writes.length, 2); assert.equal(writes[1].best_ms, 220);
    const unload = new app.window.Event('beforeunload', { cancelable: true }); app.window.dispatchEvent(unload); assert.equal(unload.defaultPrevented, true);
    writes[1].pending.resolve({ mode: 'simple', input: 'mouse', best_ms: 220 }); await flush();
    assert.match(app.$('reactionRecord').textContent, /220/); assert.equal(app.ui.canLeave(), true);
    const completeUnload = new app.window.Event('beforeunload', { cancelable: true }); app.window.dispatchEvent(completeUnload); assert.equal(completeUnload.defaultPrevented, false);
  } finally { await app.close(); }
});

test('destroy ignores late record loads and failures and never flushes a queued second save', async () => {
  const loading = deferred();
  const first = await fixture({ list: () => loading.promise, ready: false });
  first.ui.destroy(); loading.resolve([{ mode: 'simple', input: 'mouse', best_ms: 120 }]); await flush();
  assert.equal(first.host.childElementCount, 0); assert.equal(first.calls.save.length, 0); await first.close();
  const pending = deferred();
  const second = await fixture({ save: () => pending.promise });
  await completeGame(second, 280); await completeGame(second, 230); assert.equal(second.calls.save.length, 1);
  second.ui.destroy(); pending.resolve({ mode: 'simple', input: 'mouse', best_ms: 280 }); await flush();
  assert.equal(second.calls.save.length, 1); assert.equal(second.host.childElementCount, 0); await second.close();
  const failed = deferred();
  const third = await fixture({ save: () => failed.promise });
  await completeGame(third, 260); third.ui.destroy(); failed.reject(new Error('late offline')); await flush();
  third.ui.tick(); assert.equal(third.host.childElementCount, 0); assert.equal(third.calls.save.length, 1); await third.close();
});

test('preferences remain account-scoped and disconnected play does not require a record store', async () => {
  const storage = memoryStorage();
  const first = await fixture({ storage });
  first.select('reactionMode', 'choice'); first.select('reactionRounds', 10);
  assert.deepEqual(JSON.parse(storage.getItem(preferenceKey('owner-a'))), { mode: 'choice', rounds: 10 });
  assert.equal(storage.getItem(preferenceKey('owner-b')), null); await first.close();
  const reopened = await fixture({ storage, preferences: null });
  try { assert.equal(reopened.$('reactionMode').value, 'choice'); assert.equal(reopened.$('reactionRounds').value, '10'); } finally { await reopened.close(); }
  const other = await fixture({ storage, preferences: null, ownerId: 'owner-b', store: null });
  try {
    assert.equal(other.$('reactionMode').value, 'simple'); assert.equal(other.$('reactionRounds').value, '5');
    assert.equal(other.$('reactionStart').disabled, false); assert.equal(other.$('reactionResetRecord').disabled, true);
    assert.match(other.$('reactionRecordStatus').textContent, /Connecte-toi/i);
    other.select('reactionRounds', 1); await completeGame(other, 240); assert.equal(other.status(), 'done');
  } finally { await other.close(); }
});
