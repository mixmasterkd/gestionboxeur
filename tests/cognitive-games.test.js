import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { mountCognitiveGames } from '../js/cognitive-games.js';

const flush = () => new Promise(resolve => setTimeout(resolve, 0));
const defer = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const preferenceKey = owner => `gestionboxeur:cognitive:v1:${owner}`;

async function fixture({ rows = [], preferences, ownerId = 'coach-a', store: suppliedStore, list, save, reset, ready = true, loadBag, webgl = false, AudioContext, demo = false } = {}) {
  const window = new Window({ url: 'https://example.test/tools.html', settings: { disableJavaScriptEvaluation: true, disableJavaScriptFileLoading: true, disableCSSFileLoading: true } });
  const host = window.document.createElement('div'); window.document.body.append(host);
  if (webgl) window.WebGL2RenderingContext = function WebGL2RenderingContext() {};
  else window.WebGL2RenderingContext = undefined;
  if (AudioContext) window.AudioContext = AudioContext;
  const values = new Map(preferences ? [[preferenceKey(ownerId), JSON.stringify(preferences)]] : []);
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const persisted = new Map(rows.map(row => [row.mode, row.score]));
  const calls = { list: 0, save: [], reset: [], confirm: [], activity: [] };
  const store = suppliedStore === undefined ? {
    demo,
    async listRecords() { calls.list++; return list ? list() : [...persisted].map(([mode, score]) => ({ mode, score })); },
    async saveRecord(mode, score) {
      calls.save.push({ mode, score });
      const row = save ? await save(mode, score) : { mode, score: Math.max(persisted.get(mode) || 0, score) };
      persisted.set(mode, row.score); return row;
    },
    async resetRecord(mode) { calls.reset.push(mode); if (reset) await reset(mode); persisted.delete(mode); },
  } : suppliedStore;
  let time = 0;
  window.confirm = message => { calls.confirm.push(message); return true; };
  const ui = mountCognitiveGames(host, { store, ownerId, storage, now: () => time, random: () => 0, autoTick: false, loadBag: loadBag || (() => Promise.reject(new Error('No 3D'))), onActivity: value => calls.activity.push(value) });
  const app = {
    window, host, ui, calls, persisted, storage, $: id => host.querySelector(`#${id}`),
    query: selector => host.querySelector(selector), all: selector => [...host.querySelectorAll(selector)],
    status: () => host.querySelector('.cognitive')?.dataset.status,
    advance(ms) { time += ms; ui.tick(); },
    change(id, checked) { const input = host.querySelector(`#${id}`); input.checked = checked; input.dispatchEvent(new window.Event('change', { bubbles: true })); },
    async close() { ui.destroy(); await window.happyDOM.abort(); },
  };
  if (ready) await flush();
  return app;
}

function showSequence(app) {
  if (app.status() === 'success') app.advance(650);
  assert.equal(app.status(), 'showing');
  for (let frames = 0; app.status() === 'showing' && frames < 1000; frames++) app.advance(50);
  assert.equal(app.status(), 'input');
}
function target(app, index) { return app.query(`.${app.query('.cognitive').dataset.variant === 'bag' ? 'cognitive-fallback-zone' : 'cognitive-tile'}[data-index="${index}"]`); }
function sequenceScore(app, score) {
  app.$('cognitiveStart').click();
  for (let length = 1; length <= score; length++) {
    showSequence(app);
    for (let hit = 0; hit < length; hit++) target(app, 0).click();
    assert.equal(app.status(), 'success');
  }
  showSequence(app); target(app, 1).click();
  assert.equal(app.status(), 'finished');
  assert.equal(app.$('cognitiveScore').textContent, String(score));
}

test('cognitive UI starts with six empty accessible tiles and loads the matching private record', async () => {
  const app = await fixture({ rows: [{ mode: 'tiles-6', score: 7 }, { mode: 'tiles-4', score: 2 }] });
  try {
    assert.equal(app.status(), 'idle'); assert.equal(app.all('.cognitive-tile').length, 6);
    assert.deepEqual(app.all('.cognitive-tile').map(tile => tile.textContent), ['', '', '', '', '', '']);
    assert.deepEqual(app.all('.cognitive-tile').map(tile => tile.getAttribute('aria-label')), ['Tuile 1', 'Tuile 2', 'Tuile 3', 'Tuile 4', 'Tuile 5', 'Tuile 6']);
    assert.ok(app.all('.cognitive-tile').every(tile => tile.disabled));
    assert.equal(app.$('cognitiveRecord').textContent, '7'); assert.equal(app.$('cognitiveRecordStatus').hidden, true);
    assert.equal(app.$('cognitiveScore').textContent, '0'); assert.equal(app.$('cognitiveMetric').textContent, '—');
    assert.equal(app.$('cognitiveTileSettings').hidden, false); assert.equal(app.$('cognitiveBagSettings').hidden, true);
    assert.equal(app.$('cognitiveTabTiles').getAttribute('aria-selected'), 'true'); assert.equal(app.$('cognitiveTabBag').tabIndex, -1);
    assert.equal(app.$('cognitiveSound').checked, true); assert.equal(app.calls.list, 1); assert.equal(app.calls.save.length, 0);
  } finally { await app.close(); }
});

test('four/six/eight tile controls select separate records and keyboard tabs preserve preferences', async () => {
  const app = await fixture({ rows: [{ mode: 'tiles-4', score: 3 }, { mode: 'tiles-6', score: 5 }, { mode: 'tiles-8', score: 9 }] });
  try {
    for (const [count, record] of [[4, 3], [8, 9], [6, 5]]) {
      app.query(`button[data-count="${count}"]`).click();
      assert.equal(app.all('.cognitive-tile').length, count); assert.equal(app.$('cognitiveRecord').textContent, String(record));
      assert.equal(app.query(`button[data-count="${count}"]`).getAttribute('aria-pressed'), 'true');
      assert.equal(JSON.parse(app.storage.getItem(preferenceKey('coach-a'))).count, count);
    }
    app.$('cognitiveTabTiles').dispatchEvent(new app.window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
    assert.equal(app.query('.cognitive').dataset.variant, 'bag'); assert.equal(app.window.document.activeElement, app.$('cognitiveTabBag'));
    assert.equal(app.$('cognitivePanel').getAttribute('aria-labelledby'), 'cognitiveTabBag');
    app.$('cognitiveTabBag').dispatchEvent(new app.window.KeyboardEvent('keydown', { key: 'Home', bubbles: true, cancelable: true }));
    assert.equal(app.query('.cognitive').dataset.variant, 'tiles'); assert.equal(app.$('cognitiveRecord').textContent, '5');
    assert.equal(app.calls.save.length, 0);
  } finally { await app.close(); }
});

test('sequence demo flashes, ignores early input, grows and saves only a completed new best', async () => {
  const app = await fixture({ preferences: { sound: false } });
  try {
    app.$('cognitiveStart').click();
    assert.equal(app.status(), 'showing'); assert.equal(app.$('cognitiveStatus').textContent, 'Regarde');
    assert.equal(app.$('cognitiveStop').hidden, false); assert.equal(app.$('cognitiveStart').hidden, true);
    assert.ok(app.all('button[data-count],button[data-variant],button[data-mode]').every(button => button.disabled));
    target(app, 0).click(); assert.equal(app.$('cognitiveScore').textContent, '0');
    app.advance(550); assert.equal(target(app, 0).classList.contains('is-lit'), true);
    app.advance(620); assert.equal(target(app, 0).classList.contains('is-lit'), false);
    app.advance(280); assert.equal(app.status(), 'input'); assert.equal(app.$('cognitiveStatus').textContent, 'À toi');
    target(app, 0).click(); assert.equal(app.status(), 'success'); assert.equal(app.$('cognitiveScore').textContent, '1');
    assert.equal(app.calls.save.length, 0);
    app.advance(650); assert.equal(app.$('cognitiveMetric').textContent, '2'); showSequence(app);
    target(app, 0).click(); assert.equal(app.status(), 'input'); target(app, 0).click(); assert.equal(app.status(), 'success');
    showSequence(app); target(app, 1).click(); assert.equal(app.status(), 'finished');
    assert.equal(target(app, 1).classList.contains('is-wrong'), true); assert.equal(app.$('cognitiveStatus').textContent, 'Fin de la séquence');
    assert.equal(app.$('cognitiveStart').textContent, 'Recommencer'); await flush();
    assert.deepEqual(app.calls.save, [{ mode: 'tiles-6', score: 2 }]); assert.equal(app.$('cognitiveRecord').textContent, '2');
    assert.equal(app.$('cognitiveRecordStatus').hidden, true); app.ui.tick(); await flush(); assert.equal(app.calls.save.length, 1);
    assert.deepEqual(app.calls.activity, [true, false]);
    sequenceScore(app, 1); await flush(); assert.equal(app.calls.save.length, 1, 'a lower result never rewrites a known best');
  } finally { await app.close(); }
});

test('bag fallback has six numbered zones and hidden-number variants keep independent records', async () => {
  const app = await fixture({ preferences: { sound: false }, rows: [
    { mode: 'bag-sequence-visible', score: 4 }, { mode: 'bag-sequence-hidden', score: 8 }, { mode: 'bag-targets-hidden', score: 17 },
  ] });
  try {
    app.$('cognitiveTabBag').click();
    assert.equal(app.$('cognitiveBagViewport').dataset.render, 'fallback'); assert.match(app.$('cognitiveRenderStatus').textContent, /simplifiée/);
    assert.equal(app.$('cognitiveTileSettings').hidden, true); assert.equal(app.$('cognitiveBagSettings').hidden, false);
    assert.equal(app.all('.cognitive-fallback-zone').length, 6); assert.equal(app.$('cognitiveRecord').textContent, '4');
    assert.ok(app.all('.cognitive-fallback-zone span').every(span => !span.hidden));
    app.change('cognitiveNumbers', false); assert.ok(app.all('.cognitive-fallback-zone span').every(span => span.hidden));
    assert.equal(app.$('cognitiveRecord').textContent, '8'); assert.equal(JSON.parse(app.storage.getItem(preferenceKey('coach-a'))).numbers, false);
    app.$('cognitiveStart').click(); app.advance(550);
    assert.equal(app.$('cognitiveCue').textContent, '1', 'memorization cue remains visible even when bag labels are hidden');
    assert.equal(app.$('cognitiveNumbers').disabled, true);
    app.$('cognitiveStop').click(); assert.equal(app.status(), 'interrupted'); assert.equal(app.calls.save.length, 0);
    app.query('button[data-mode="targets"]').click(); assert.equal(app.$('cognitiveRecord').textContent, '17');
    assert.equal(app.$('cognitiveMetricLabel').textContent, 'Temps'); assert.equal(app.$('cognitiveMetric').textContent, '30 s');
  } finally { await app.close(); }
});

test('target game lasts exactly thirty seconds and applies +1/-1 without negative scores', async () => {
  const app = await fixture({ preferences: { variant: 'bag', mode: 'targets', sound: false, numbers: false } });
  try {
    app.$('cognitiveStart').click(); assert.equal(app.status(), 'input'); assert.equal(app.$('cognitiveMetric').textContent, '30 s');
    assert.equal(target(app, 0).classList.contains('is-target'), true);
    target(app, 2).click(); assert.equal(app.$('cognitiveScore').textContent, '0');
    target(app, 0).click(); assert.equal(app.$('cognitiveScore').textContent, '1'); assert.equal(target(app, 1).classList.contains('is-target'), true);
    target(app, 1).click(); assert.equal(app.$('cognitiveScore').textContent, '2');
    target(app, 4).click(); assert.equal(app.$('cognitiveScore').textContent, '1');
    app.advance(29999); assert.equal(app.status(), 'input'); assert.equal(app.$('cognitiveMetric').textContent, '1 s'); assert.equal(app.calls.save.length, 0);
    app.advance(1); assert.equal(app.status(), 'finished'); assert.equal(app.$('cognitiveMetric').textContent, '0 s');
    target(app, 0).click(); assert.equal(app.$('cognitiveScore').textContent, '1');
    await flush(); assert.deepEqual(app.calls.save, [{ mode: 'bag-targets-hidden', score: 1 }]);
    assert.equal(app.$('cognitiveRecord').textContent, '1'); assert.equal(app.all('.is-target').length, 0);
  } finally { await app.close(); }
});

test('record reset confirms its scope and blocks new games or mode changes until deletion finishes', async () => {
  const pending = defer();
  const app = await fixture({ rows: [{ mode: 'tiles-6', score: 8 }, { mode: 'tiles-4', score: 3 }], reset: () => pending.promise });
  try {
    app.window.confirm = message => { app.calls.confirm.push(message); return false; };
    app.$('cognitiveResetRecord').click(); assert.equal(app.calls.reset.length, 0); assert.equal(app.$('cognitiveRecord').textContent, '8');
    app.window.confirm = message => { app.calls.confirm.push(message); return true; };
    app.$('cognitiveResetRecord').click(); assert.deepEqual(app.calls.reset, ['tiles-6']);
    assert.match(app.calls.confirm[1], /ce mode uniquement/); assert.equal(app.$('cognitiveResetRecord').disabled, true);
    assert.equal(app.$('cognitiveStart').disabled, true);
    assert.equal(app.query('button[data-count="4"]').disabled, true);
    app.query('button[data-count="4"]').click(); assert.equal(app.$('cognitiveRecord').textContent, '8');
    app.$('cognitiveStart').click(); assert.equal(app.status(), 'idle'); assert.equal(app.calls.save.length, 0);
    pending.resolve(); await flush();
    assert.equal(app.$('cognitiveRecord').textContent, '0'); assert.equal(app.$('cognitiveResetRecord').disabled, true);
    assert.equal(app.$('cognitiveStart').disabled, false); assert.equal(app.query('button[data-count="4"]').disabled, false);
    app.query('button[data-count="4"]').click(); assert.equal(app.$('cognitiveRecord').textContent, '3'); assert.equal(app.persisted.get('tiles-4'), 3);
    app.query('button[data-count="6"]').click(); sequenceScore(app, 1); await flush();
    assert.equal(app.$('cognitiveRecord').textContent, '1'); assert.deepEqual(app.calls.save, [{ mode: 'tiles-6', score: 1 }]);
  } finally { await app.close(); }
});

test('failed record loading is visible and retry restores records without preventing gameplay', async () => {
  let unavailable = true;
  const app = await fixture({ list: () => { if (unavailable) throw new Error('Connexion interrompue.'); return [{ mode: 'tiles-6', score: 12 }]; } });
  try {
    assert.equal(app.$('cognitiveRecord').textContent, '—'); assert.equal(app.$('cognitiveRetry').hidden, false);
    assert.equal(app.$('cognitiveRecordStatus').classList.contains('is-error'), true); assert.match(app.$('cognitiveRecordStatus').textContent, /Connexion interrompue/);
    assert.equal(app.$('cognitiveStart').disabled, false); assert.equal(app.$('cognitiveResetRecord').disabled, true);
    unavailable = false; app.$('cognitiveRetry').click(); await flush();
    assert.equal(app.calls.list, 2); assert.equal(app.$('cognitiveRecord').textContent, '12'); assert.equal(app.$('cognitiveRetry').hidden, true);
    assert.equal(app.$('cognitiveRecordStatus').hidden, true);
  } finally { await app.close(); }
});

test('failed record saving preserves the score, guards departure and retries under its original mode', async () => {
  let unavailable = true;
  const app = await fixture({ preferences: { sound: false }, save: (mode, score) => { if (unavailable) throw new Error('Record non enregistré : hors ligne.'); return { mode, score }; } });
  try {
    sequenceScore(app, 1); await flush();
    assert.equal(app.$('cognitiveScore').textContent, '1'); assert.equal(app.$('cognitiveRecord').textContent, '0');
    assert.equal(app.$('cognitiveRetry').hidden, false); assert.match(app.$('cognitiveRecordStatus').textContent, /hors ligne/);
    assert.equal(app.$('cognitiveResetRecord').disabled, true);
    app.window.confirm = message => { app.calls.confirm.push(message); return false; };
    assert.equal(app.ui.canLeave(), false); assert.match(app.calls.confirm.at(-1), /record n’est pas encore enregistré/);
    const unload = new app.window.Event('beforeunload', { cancelable: true }); app.window.dispatchEvent(unload); assert.equal(unload.defaultPrevented, true);
    app.query('button[data-count="4"]').click(); unavailable = false; app.$('cognitiveRetry').click(); await flush();
    assert.deepEqual(app.calls.save, [{ mode: 'tiles-6', score: 1 }, { mode: 'tiles-6', score: 1 }]);
    assert.equal(app.$('cognitiveRecord').textContent, '0'); assert.equal(app.$('cognitiveRetry').hidden, true); assert.equal(app.ui.canLeave(), true);
    app.query('button[data-count="6"]').click(); assert.equal(app.$('cognitiveRecord').textContent, '1');
  } finally { await app.close(); }
});

test('visibility and pagehide interrupt instead of awarding a record or resuming a hidden run', async () => {
  const app = await fixture({ preferences: { sound: false } });
  try {
    app.$('cognitiveStart').click(); showSequence(app); target(app, 0).click(); assert.equal(app.$('cognitiveScore').textContent, '1');
    Object.defineProperty(app.window.document, 'visibilityState', { configurable: true, value: 'hidden' });
    app.window.document.dispatchEvent(new app.window.Event('visibilitychange'));
    assert.equal(app.status(), 'interrupted'); assert.match(app.$('cognitiveStatus').textContent, /quitté la page/);
    Object.defineProperty(app.window.document, 'visibilityState', { configurable: true, value: 'visible' });
    app.window.document.dispatchEvent(new app.window.Event('visibilitychange')); app.advance(60000);
    assert.equal(app.status(), 'interrupted'); assert.equal(app.calls.save.length, 0); assert.equal(app.ui.canLeave(), true);
    app.$('cognitiveTabBag').click(); app.query('button[data-mode="targets"]').click(); app.$('cognitiveStart').click(); target(app, 0).click();
    app.window.dispatchEvent(new app.window.Event('pagehide')); app.advance(30000);
    assert.equal(app.status(), 'interrupted'); assert.equal(app.calls.save.length, 0);
  } finally { await app.close(); }
});

test('manual stop and declined leave confirmation keep active scores out of records', async () => {
  const app = await fixture({ preferences: { sound: false } });
  try {
    app.$('cognitiveStart').click(); app.window.confirm = message => { app.calls.confirm.push(message); return false; };
    assert.equal(app.ui.canLeave(), false); assert.match(app.calls.confirm.at(-1), /arrêter la partie/); assert.equal(app.status(), 'showing');
    showSequence(app); target(app, 0).click(); app.$('cognitiveStop').click(); await flush();
    assert.equal(app.status(), 'interrupted'); assert.equal(app.$('cognitiveStatus').textContent, 'Partie arrêtée.');
    assert.equal(app.$('cognitiveScore').textContent, '1'); assert.equal(app.calls.save.length, 0); assert.equal(app.ui.canLeave(), true);
  } finally { await app.close(); }
});

test('records that finish while initial loading is pending wait for the account before writing', async () => {
  const pending = defer();
  const app = await fixture({ preferences: { sound: false }, list: () => pending.promise, ready: false });
  try {
    sequenceScore(app, 1); assert.equal(app.calls.save.length, 0); assert.equal(app.$('cognitiveRecord').textContent, '—');
    pending.resolve([]); await flush();
    assert.deepEqual(app.calls.save, [{ mode: 'tiles-6', score: 1 }]); assert.equal(app.$('cognitiveRecord').textContent, '1');
  } finally { await app.close(); }
});

test('destroy ignores a late records load, a late 3D load and a late failed save', async () => {
  const load = defer();
  const first = await fixture({ list: () => load.promise, ready: false });
  first.ui.destroy(); load.resolve([{ mode: 'tiles-6', score: 99 }]); await flush();
  assert.equal(first.host.childElementCount, 0); assert.equal(first.calls.save.length, 0); await first.close();

  const module = defer(); let created = 0;
  const second = await fixture({ webgl: true, preferences: { variant: 'bag', sound: false }, loadBag: () => module.promise });
  second.ui.destroy(); module.resolve({ createCognitiveBagScene: () => { created++; return { update() {}, destroy() {} }; } }); await flush();
  assert.equal(created, 0); assert.equal(second.host.childElementCount, 0); await second.close();

  const write = defer();
  const third = await fixture({ preferences: { sound: false }, save: () => write.promise });
  sequenceScore(third, 1); assert.equal(third.calls.save.length, 1); third.ui.destroy(); write.reject(new Error('late offline')); await flush();
  third.ui.tick(); assert.equal(third.host.childElementCount, 0); assert.equal(third.calls.save.length, 1); await third.close();
});

test('destroy never flushes a second queued record after an in-flight save resolves', async () => {
  const write = defer();
  const app = await fixture({ preferences: { sound: false }, save: () => write.promise });
  try {
    sequenceScore(app, 1); assert.equal(app.calls.save.length, 1);
    app.query('button[data-count="4"]').click(); sequenceScore(app, 2); assert.equal(app.calls.save.length, 1);
    app.ui.destroy(); write.resolve({ mode: 'tiles-6', score: 1 }); await flush();
    assert.deepEqual(app.calls.save, [{ mode: 'tiles-6', score: 1 }]); assert.equal(app.host.childElementCount, 0);
  } finally { await app.close(); }
});

test('a higher score earned during a pending save is serialized and unload protection clears only when saved', async () => {
  const writes = [];
  const app = await fixture({ preferences: { sound: false }, save: (mode, score) => { const pending = defer(); writes.push({ pending, mode, score }); return pending.promise; } });
  try {
    sequenceScore(app, 1); assert.equal(writes.length, 1);
    sequenceScore(app, 2); assert.equal(writes.length, 1, 'saves cannot race one another');
    writes[0].pending.resolve({ mode: writes[0].mode, score: writes[0].score }); await flush();
    assert.equal(writes.length, 2); assert.equal(writes[1].score, 2); app.ui.tick(); assert.equal(app.$('cognitiveRecord').textContent, '1');
    const pendingUnload = new app.window.Event('beforeunload', { cancelable: true }); app.window.dispatchEvent(pendingUnload); assert.equal(pendingUnload.defaultPrevented, true);
    writes[1].pending.resolve({ mode: writes[1].mode, score: writes[1].score }); await flush();
    assert.deepEqual(app.calls.save, [{ mode: 'tiles-6', score: 1 }, { mode: 'tiles-6', score: 2 }]);
    assert.equal(app.$('cognitiveRecord').textContent, '2'); assert.equal(app.ui.canLeave(), true);
    const savedUnload = new app.window.Event('beforeunload', { cancelable: true }); app.window.dispatchEvent(savedUnload); assert.equal(savedUnload.defaultPrevented, false);
  } finally { await app.close(); }
});

test('3D bag lifecycle updates, forwards hits and tears down when returning to tiles', async () => {
  const sceneCalls = { update: [], hits: [], destroy: 0 }; let handlers;
  const app = await fixture({ webgl: true, preferences: { variant: 'bag', mode: 'targets', sound: false }, loadBag: async () => ({
    createCognitiveBagScene(_host, options) {
      handlers = options;
      return { update: state => sceneCalls.update.push(structuredClone(state)), hit: index => sceneCalls.hits.push(index), destroy: () => { sceneCalls.destroy++; } };
    },
  }) });
  try {
    assert.equal(app.$('cognitiveBagViewport').dataset.render, 'ready'); assert.equal(app.$('cognitiveRenderStatus').textContent, '');
    assert.equal(sceneCalls.update.at(-1).enabled, false);
    app.$('cognitiveStart').click(); assert.equal(sceneCalls.update.at(-1).enabled, true); assert.equal(sceneCalls.update.at(-1).target, 0);
    handlers.onHit(0); assert.equal(app.$('cognitiveScore').textContent, '1'); assert.deepEqual(sceneCalls.hits, [0]);
    app.$('cognitiveStop').click(); app.$('cognitiveTabTiles').click(); assert.equal(sceneCalls.destroy, 1);
    assert.equal(app.all('.cognitive-tile').length, 6);
  } finally { await app.close(); }
});

test('3D loader rejection falls back, and a stale successful loader cannot replace newer tiles', async () => {
  const first = await fixture({ webgl: true, preferences: { variant: 'bag', sound: false }, loadBag: () => Promise.reject(new Error('WebGL failure')) });
  try { assert.equal(first.$('cognitiveBagViewport').dataset.render, 'fallback'); assert.equal(first.all('.cognitive-fallback-zone').length, 6); } finally { await first.close(); }
  const loading = defer(); let created = 0;
  const second = await fixture({ webgl: true, preferences: { variant: 'bag', sound: false }, loadBag: () => loading.promise });
  try {
    second.$('cognitiveTabTiles').click();
    loading.resolve({ createCognitiveBagScene: () => { created++; return { update() {}, destroy() {} }; } }); await flush();
    assert.equal(created, 0); assert.equal(second.all('.cognitive-tile').length, 6); assert.equal(second.$('cognitiveBagViewport'), null);
  } finally { await second.close(); }
});

test('audio is optional: unavailable sound does not block play and its switch persists per account', async () => {
  const app = await fixture();
  try {
    app.$('cognitiveStart').click(); await flush();
    assert.equal(app.$('cognitiveAudioError').hidden, false); assert.match(app.$('cognitiveAudioError').textContent, /sans son/);
    assert.equal(app.status(), 'showing'); app.change('cognitiveSound', false);
    assert.equal(JSON.parse(app.storage.getItem(preferenceKey('coach-a'))).sound, false);
    showSequence(app); target(app, 0).click(); assert.equal(app.status(), 'success');
    assert.equal(app.storage.getItem(preferenceKey('coach-b')), null);
  } finally { await app.close(); }
});

test('disabled sound never starts audio and late audio unlock after destroy cannot play a note', async () => {
  const resume = defer(); let created = 0, oscillators = 0, closed = 0;
  class AudioContext {
    constructor() { created++; this.state = 'suspended'; }
    async resume() { await resume.promise; if (this.state !== 'closed') this.state = 'running'; }
    close() { closed++; this.state = 'closed'; return Promise.resolve(); }
    createOscillator() { oscillators++; throw new Error('No oscillator should be created after destruction.'); }
  }
  const silent = await fixture({ preferences: { sound: false }, AudioContext });
  try { silent.$('cognitiveStart').click(); silent.advance(550); assert.equal(created, 0); assert.equal(silent.$('cognitiveAudioError').hidden, true); } finally { await silent.close(); }
  const delayed = await fixture({ AudioContext });
  delayed.$('cognitiveStart').click(); assert.equal(created, 1);
  delayed.advance(550); assert.equal(oscillators, 0); delayed.ui.destroy(); resume.resolve(); await flush();
  delayed.advance(620); assert.equal(closed, 1); assert.equal(oscillators, 0); assert.equal(delayed.host.childElementCount, 0); assert.equal(delayed.calls.save.length, 0);
  await delayed.close();
});

test('without an account store the game stays usable and demo records are explicitly scoped', async () => {
  const disconnected = await fixture({ store: null });
  try {
    assert.match(disconnected.$('cognitiveRecordStatus').textContent, /Connecte-toi/); assert.equal(disconnected.$('cognitiveStart').disabled, false);
    assert.equal(disconnected.$('cognitiveResetRecord').disabled, true); assert.equal(disconnected.query('.cognitive-demo').hidden, true);
  } finally { await disconnected.close(); }
  const demo = await fixture({ demo: true });
  try { assert.equal(demo.query('.cognitive-demo').hidden, false); assert.match(demo.query('.cognitive-demo').textContent, /rechargement/); } finally { await demo.close(); }
});
