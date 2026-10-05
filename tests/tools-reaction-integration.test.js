import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Window } from 'happy-dom';
import { mountTools } from '../js/tools.js';

const html = await readFile(new URL('../tools.html', import.meta.url), 'utf8');
const settle = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };

function fixture({ setupWindow = () => {}, ...options } = {}) {
  const window = new Window({ url: 'https://example.test/tools.html', settings: { disableJavaScriptEvaluation: true, disableJavaScriptFileLoading: true, disableCSSFileLoading: true } });
  window.document.write(html);
  window.localStorage.setItem('gestionboxeur:tools:v1', JSON.stringify({ sound: false }));
  setupWindow(window);
  let time = 0;
  const root = window.document.getElementById('toolsApp');
  const ui = mountTools(root, { now: () => time, autoTick: false, ownerId: 'owner-a', ...options });
  return { window, root, ui, $: id => window.document.getElementById(id), advance(ms) { time += ms; ui.tick(); }, async close() { if (root.childElementCount) ui.destroy(); await window.happyDOM.abort(); } };
}

test('reaction opens lazily from actual tools and receives its private store, clock and activity callback', async () => {
  const store = { scope: 'owner-a' };
  let loads = 0, mounted, ticks = 0, destroyed = 0;
  const app = fixture({ reactionStore: store, loadReaction: async () => {
    loads++;
    return { mountReactionGame(host, options) {
      mounted = { host, options }; host.innerHTML = '<div id="reactionStub"></div>';
      return { tick() { ticks++; }, canLeave() { return true; }, destroy() { destroyed++; host.replaceChildren(); } };
    } };
  } });
  try {
    assert.equal(loads, 0);
    app.root.querySelector('button[data-tool="reaction"]').click(); await settle();
    assert.equal(loads, 1); assert.equal(app.$('toolTitle').textContent, 'Test de réactivité');
    assert.equal(mounted.options.store, store); assert.equal(mounted.options.ownerId, 'owner-a');
    assert.equal(mounted.options.autoTick, false); assert.equal(typeof mounted.options.onActivity, 'function');
    assert.equal(mounted.options.now(), 0); app.advance(321); assert.equal(mounted.options.now(), 321); assert.equal(ticks, 1);
    app.$('toolsBack').click(); assert.equal(destroyed, 1); assert.equal(app.$('toolsMenu').hidden, false);
    app.ui.select('boxing'); app.$('timerStart').click(); app.advance(500);
    assert.equal(app.$('timerBoard').dataset.status, 'running'); app.$('timerReset').click();
  } finally { await app.close(); }
});

test('reaction respects leave cancellation and releases its screen lock after leaving', async () => {
  let options, allowLeave = false, destroyed = 0, requests = 0, releases = 0;
  const app = fixture({ loadReaction: async () => ({ mountReactionGame(host, received) {
    options = received; host.innerHTML = '<div id="reactionStub"></div>';
    return { tick() {}, canLeave() { return allowLeave; }, destroy() { destroyed++; received.onActivity(false); host.replaceChildren(); } };
  } }) });
  try {
    Object.defineProperty(app.window.navigator, 'wakeLock', { value: { async request() { requests++; return { addEventListener() {}, async release() { releases++; } }; } } });
    app.ui.select('reaction'); await settle(); options.onActivity(true); await settle();
    assert.equal(requests, 1);
    app.$('toolsBack').click(); assert.equal(destroyed, 0); assert.ok(app.$('reactionStub')); assert.equal(releases, 0);
    allowLeave = true; app.$('toolsBack').click(); await settle();
    assert.equal(destroyed, 1); assert.equal(releases, 1); assert.equal(app.$('reactionStub'), null);
  } finally { await app.close(); }
});

test('a late reaction module cannot replace a different tool', async () => {
  const loading = deferred(); let mounts = 0;
  const app = fixture({ loadReaction: () => loading.promise });
  try {
    app.ui.select('reaction'); app.ui.select('steps');
    loading.resolve({ mountReactionGame() { mounts++; } }); await settle();
    assert.equal(mounts, 0); assert.ok(app.$('stepTap')); assert.equal(app.$('toolTitle').textContent, 'Compteur de pas');
  } finally { await app.close(); }
});

test('a reaction module resolving after teardown cannot mount or reacquire the screen lock', async () => {
  const loading = deferred(); let mounts = 0;
  const app = fixture({ loadReaction: () => loading.promise });
  app.ui.select('reaction'); app.ui.destroy();
  loading.resolve({ mountReactionGame() { mounts++; } }); await settle();
  assert.equal(mounts, 0); assert.equal(app.root.childElementCount, 0);
  await app.close();
});

test('a late wake-lock acquisition is released when reaction has already been left', async () => {
  const requested = deferred(); let options, releases = 0;
  const app = fixture({ loadReaction: async () => ({ mountReactionGame(host, received) {
    options = received; host.innerHTML = '<div id="reactionStub"></div>';
    return { tick() {}, canLeave() { return true; }, destroy() { received.onActivity(false); host.replaceChildren(); } };
  } }) });
  try {
    Object.defineProperty(app.window.navigator, 'wakeLock', { value: { request: () => requested.promise } });
    app.ui.select('reaction'); await settle(); options.onActivity(true);
    app.$('toolsBack').click(); requested.resolve({ addEventListener() {}, async release() { releases++; } }); await settle();
    assert.equal(releases, 1); assert.equal(app.$('toolsMenu').hidden, false);
  } finally { await app.close(); }
});

test('a real reaction session saves and reloads its personal best through the tools page', async () => {
  const { mountReactionGame } = await import('../js/reaction-game.js');
  const rows = [];
  const store = {
    async listRecords() { return rows.map(row => ({ ...row })); },
    async saveRecord(mode, input, best_ms) { const row = { mode, input, best_ms }; rows.push(row); return row; },
    async resetRecord() { throw new Error('This workflow does not delete records.'); },
  };
  const app = fixture({ reactionStore: store, loadReaction: async () => ({ mountReactionGame: (host, options) => mountReactionGame(host, { ...options, random: () => 0 }) }) });
  try {
    app.window.localStorage.setItem('gestionboxeur:reaction:v1:owner-a', JSON.stringify({ mode: 'simple', rounds: 1 }));
    app.root.querySelector('button[data-tool="reaction"]').click(); await settle();
    assert.equal(app.$('reactionRounds').value, '1');
    app.$('reactionStart').click(); app.advance(5000); app.advance(225);
    const target = app.root.querySelector('.reaction-pad[data-index="0"]');
    for (const type of ['pointerdown', 'pointerup']) target.dispatchEvent(new app.window.PointerEvent(type, { bubbles: true, pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0 }));
    app.advance(100); app.advance(1100); await settle();
    assert.deepEqual(rows, [{ mode: 'simple', input: 'mouse', best_ms: 225 }]);
    assert.match(app.$('reactionRecord').textContent, /225/);
    app.$('toolsBack').click(); app.ui.select('reaction'); await settle();
    assert.match(app.$('reactionRecord').textContent, /225/); assert.equal(app.$('reactionRounds').value, '1');
    app.$('toolsBack').click(); app.ui.select('boxing'); assert.ok(app.$('timerStart'));
    app.$('timerStart').click(); assert.equal(app.$('timerBoard').dataset.status, 'running');
  } finally { await app.close(); }
});

test('production reaction timing uses its own animation frame and never the parent 100 ms timer', async () => {
  const { mountReactionGame } = await import('../js/reaction-game.js');
  const frames = new Map(), rows = [];
  let frameId = 0, parentTick, parentPeriod, receivedAutoTick;
  const app = fixture({
    autoTick: true,
    setupWindow(window) {
      window.setInterval = (callback, period) => { parentTick = callback; parentPeriod = period; return 1; };
      window.clearInterval = () => {};
      window.requestAnimationFrame = callback => { frames.set(++frameId, callback); return frameId; };
      window.cancelAnimationFrame = id => frames.delete(id);
    },
    reactionStore: { async listRecords() { return []; }, async saveRecord(mode, input, best_ms) { const row = { mode, input, best_ms }; rows.push(row); return row; } },
    loadReaction: async () => ({ mountReactionGame(host, options) { receivedAutoTick = options.autoTick; return mountReactionGame(host, { ...options, random: () => 0 }); } }),
  });
  const status = () => app.root.querySelector('.reaction')?.dataset.status;
  const runFrame = () => { assert.equal(frames.size, 1); const [id, callback] = frames.entries().next().value; frames.delete(id); callback(0); };
  try {
    app.window.localStorage.setItem('gestionboxeur:reaction:v1:owner-a', JSON.stringify({ mode: 'simple', rounds: 1 }));
    app.ui.select('reaction'); await settle(); assert.equal(parentPeriod, 100); assert.equal(receivedAutoTick, true);
    app.$('reactionStart').click(); assert.equal(frames.size, 1);
    app.advance(5000); parentTick();
    assert.equal(status(), 'waiting', 'a late parent interval must not reveal the signal');
    assert.equal(app.root.querySelector('.reaction-pad').dataset.color, '');
    runFrame(); assert.equal(status(), 'active');
    app.advance(240); parentTick();
    const target = app.root.querySelector('.reaction-pad');
    for (const type of ['pointerdown', 'pointerup']) target.dispatchEvent(new app.window.PointerEvent(type, { bubbles: true, pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0 }));
    assert.equal(status(), 'settling'); app.advance(100); parentTick();
    assert.equal(status(), 'settling', 'the parent interval does not advance the reaction engine');
    runFrame(); await settle(); assert.equal(status(), 'feedback');
    assert.deepEqual(rows, [{ mode: 'simple', input: 'mouse', best_ms: 240 }], 'elapsed time begins at actual reveal, not the overdue random deadline');
    app.advance(1100); parentTick(); assert.equal(status(), 'feedback');
    runFrame(); assert.equal(status(), 'done'); assert.equal(frames.size, 0);
    app.$('reactionStart').click(); assert.equal(frames.size, 1); app.window.confirm = () => true;
    app.ui.select('steps'); assert.equal(frames.size, 0); assert.ok(app.$('stepTap'));
  } finally { await app.close(); }
});
