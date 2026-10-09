import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Window } from 'happy-dom';
import { mountTools } from '../js/tools.js';

const html = await readFile(new URL('../tools.html', import.meta.url), 'utf8');
const source = await readFile(new URL('../js/tools-page.js', import.meta.url), 'utf8');
const settle = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
async function fixture({ url = 'http://192.168.50.123:4173/tools.html?demo=1', ...overrides } = {}) {
  const window = new Window({ url, settings: { disableJavaScriptFileLoading: true, disableCSSFileLoading: true } });
  window.document.write(html); window.confirm = () => true;
  Object.defineProperty(window.crypto, 'randomUUID', { value: undefined });
  window.localStorage.setItem('gestionboxeur:tools:v1', JSON.stringify({ sound: false }));
  const selections = [], mounts = [], destroyed = []; let ui, allow = true, prompts = 0;
  const child = (target, name) => {
    mounts.push(name); target.textContent = name;
    return { tick() {}, canLeave() { prompts++; return allow; }, destroy() { destroyed.push(name); target.replaceChildren(); } };
  };
  window.__client = { auth: { getSession: async () => ({ data: { session: { user: { id: 'owner', email: 'qa@example.test' } } } }), onAuthStateChange() {}, signOut: async () => ({ data: null }) } };
  window.__loadAccount = async () => ({ profile: { full_name: 'QA', account_type: 'athlete' }, gym: null });
  window.__mount = (root, options) => ui = mountTools(root, { ...options, autoTick: false,
    loadCognitive: async () => ({ mountCognitiveGames: (target, options) => child(target, options.initialVariant) }),
    loadReaction: async () => ({ mountReactionGame: target => child(target, 'reaction') }),
    loadMental: async () => ({ mountMentalGame: (target, options) => child(target, options.mode) }),
    loadBulletin: async () => ({ mountBulletinBoard: target => child(target, 'bulletin') }),
    ...overrides,
  });
  window.addEventListener('tools:selection', event => selections.push({ ...event.detail }));
  window.eval(source.replace(/^import .*;\s*$/gm, '').replace('const $ =', 'const client=window.__client,loadAccount=window.__loadAccount,result=async p=>(await p).data,isDemo=false,createToolStore=()=>null,createDemoToolStore=()=>null,createCognitiveRecordStore=()=>null,createDemoCognitiveRecordStore=()=>null,createReactionRecordStore=()=>null,createDemoReactionRecordStore=()=>null,createMentalStore=()=>null,mountNavigation=()=>{},mountTools=window.__mount;const $ ='));
  await settle();
  return { window, ui, selections, mounts, destroyed, $: id => window.document.getElementById(id),
    get prompts() { return prompts; }, set allow(value) { allow = value; },
    navigate(detail) { window.dispatchEvent(new window.CustomEvent('tools:navigate', { detail })); },
    async close() { ui?.destroy(); await window.happyDOM.abort(); },
  };
}

test('LAN deep links open each cognitive child directly and preserve demo and hash without an intermediate selection', async () => {
  for (const game of ['tiles', 'bag', 'visual-memory', 'reaction', 'dual-task']) {
    const f = await fixture({ url: `http://192.168.50.123:4173/tools.html?demo=1&tool=cognitive&game=${game}#outil` });
    try {
      assert.equal(f.$('toolsError').hidden, true); assert.equal(f.$('toolsApp').hidden, false);
      assert.deepEqual(f.ui.getSelection(), { tool: 'cognitive', game }); assert.deepEqual(f.mounts, [game]);
      assert.deepEqual(f.selections, [{ tool: 'cognitive', game }]); assert.equal(f.window.location.hash, '#outil');
      assert.equal(new URLSearchParams(f.window.location.search).get('demo'), '1');
      assert.equal(f.window.document.querySelector('.cognitive-menu'), null);
    } finally { await f.close(); }
  }
});

test('same-page navigation preserves measurements and never reinitializes a reselected tool', async () => {
  const f = await fixture(); try {
    f.navigate({ tool: 'steps' }); f.$('stepTap').click(); assert.equal(f.$('stepCount').textContent, '1');
    const stage = f.$('stepTap'), length = f.window.history.length, count = f.selections.length;
    f.navigate({ tool: 'steps' }); assert.equal(f.$('stepTap'), stage); assert.equal(f.$('stepCount').textContent, '1');
    assert.equal(f.selections.length, count); assert.equal(f.window.history.length, length);
    f.navigate({ tool: 'boxing' }); f.$('timerStart').click();
    const board = f.$('timerBoard'); f.navigate({ tool: 'boxing' }); assert.equal(f.$('timerBoard'), board);
    assert.equal(board.dataset.status, 'running'); assert.equal(f.window.location.search, '?demo=1&tool=boxing');
  } finally { await f.close(); }
});

test('invalid tool and game routes cannot change the current screen or URL', async () => {
  const f = await fixture({ url: 'https://example.test/tools.html?tool=steps&demo=1' }); try {
    const url = f.window.location.href, count = f.selections.length;
    for (const route of [{ tool: 'unknown' }, { tool: 'cognitive', game: 'unknown' }, { tool: 'boxing', game: 'tiles' }, { game: 'reaction' }, null]) f.navigate(route);
    assert.equal(f.window.location.href, url); assert.deepEqual(f.ui.getSelection(), { tool: 'steps' });
    assert.equal(f.selections.length, count); assert.ok(f.$('stepTap'));
  } finally { await f.close(); }
  const invalid = await fixture({ url: 'https://example.test/tools.html?tool=cognitive&game=invalid&demo=1' }); try {
    assert.deepEqual(invalid.ui.getSelection(), { tool: 'boxing' }); assert.equal(invalid.mounts.length, 0);
    assert.equal(invalid.window.location.search, '?tool=boxing&demo=1');
  } finally { await invalid.close(); }
});

test('refusing a cognitive child change keeps its game, URL and state, including the legacy reaction shortcut', async () => {
  const f = await fixture({ url: 'https://example.test/tools.html?tool=cognitive&game=tiles' }); try {
    f.allow = false; const url = f.window.location.href, count = f.selections.length;
    f.navigate({ tool: 'cognitive', game: 'reaction' }); await settle();
    assert.equal(f.prompts, 1); assert.equal(await f.ui.select('reaction'), false); assert.equal(f.prompts, 2);
    assert.deepEqual(f.mounts, ['tiles']); assert.deepEqual(f.destroyed, []);
    assert.deepEqual(f.ui.getSelection(), { tool: 'cognitive', game: 'tiles' }); assert.equal(f.window.location.href, url); assert.equal(f.selections.length, count);
    f.navigate({ tool: 'cognitive', game: 'tiles' }); assert.equal(f.prompts, 2, 'reselect does not ask or reset');
    f.allow = true; f.navigate({ tool: 'cognitive', game: 'reaction' }); await settle();
    assert.equal(f.prompts, 3, 'one guard per accepted child change'); assert.deepEqual(f.destroyed, ['tiles']);
    assert.equal(f.window.location.search, '?tool=cognitive&game=reaction');
    f.navigate({ tool: 'cognitive', game: 'bag' }); await settle();
    assert.deepEqual(f.ui.getSelection(), { tool: 'cognitive', game: 'bag' }); assert.equal(f.window.location.search, '?tool=cognitive&game=bag');
    f.navigate({ tool: 'boxing' }); assert.deepEqual(f.ui.getSelection(), { tool: 'boxing' }); assert.equal(f.window.location.search, '?tool=boxing');
  } finally { await f.close(); }
});

test('bulletin edits and the locked timer both block a direct child navigation before it can load', async () => {
  const f = await fixture({ url: 'https://example.test/tools.html?tool=bulletin' }); try {
    f.allow = false; f.navigate({ tool: 'cognitive', game: 'reaction' }); await settle();
    assert.deepEqual(f.mounts, ['bulletin']); assert.equal(f.window.location.search, '?tool=bulletin'); assert.deepEqual(f.destroyed, []);
    f.allow = true; f.navigate({ tool: 'boxing' }); f.$('timerStart').click(); f.$('timerFocusOpen').click();
    assert.equal(f.$('timerBoard').dataset.sessionLocked, 'true'); const count = f.selections.length;
    f.navigate({ tool: 'cognitive', game: 'reaction' }); await settle();
    assert.equal(f.window.location.search, '?tool=boxing'); assert.equal(f.$('timerBoard').dataset.status, 'running');
    assert.deepEqual(f.mounts, ['bulletin']); assert.equal(f.selections.length, count);
  } finally { await f.close(); }
});

test('late game imports cannot overwrite a newer direct selection or issue a stale selection event', async () => {
  const pending = deferred(); let staleMounts = 0;
  const f = await fixture({ loadCognitive: () => pending.promise }); try {
    f.navigate({ tool: 'cognitive', game: 'tiles' }); f.navigate({ tool: 'cognitive', game: 'reaction' }); await settle();
    pending.resolve({ mountCognitiveGames() { staleMounts++; } }); await settle();
    assert.equal(staleMounts, 0); assert.deepEqual(f.ui.getSelection(), { tool: 'cognitive', game: 'reaction' });
    assert.equal(f.window.location.search, '?demo=1&tool=cognitive&game=reaction');
    assert.deepEqual(f.selections.slice(1), [{ tool: 'cognitive', game: 'tiles' }, { tool: 'cognitive', game: 'reaction' }]);
  } finally { await f.close(); }
});

test('accepted browser history applies the destination; a refused move restores its entry without changing the child', async () => {
  const f = await fixture(); try {
    f.navigate({ tool: 'steps' }); const previous = { state: f.window.history.state, url: f.window.location.href };
    f.navigate({ tool: 'cognitive', game: 'reaction' }); await settle();
    const current = { state: f.window.history.state, url: f.window.location.href }, moves = [];
    f.window.history.go = distance => moves.push(distance); f.allow = false;
    f.window.history.replaceState(previous.state, '', previous.url); f.window.dispatchEvent(new f.window.PopStateEvent('popstate', { state: previous.state }));
    assert.deepEqual(moves, [1]); assert.deepEqual(f.ui.getSelection(), { tool: 'cognitive', game: 'reaction' }); assert.deepEqual(f.destroyed, []);
    f.window.history.replaceState(current.state, '', current.url); f.window.dispatchEvent(new f.window.PopStateEvent('popstate', { state: current.state }));
    assert.equal(f.window.location.href, current.url);
    f.allow = true; f.window.history.replaceState(previous.state, '', previous.url); f.window.dispatchEvent(new f.window.PopStateEvent('popstate', { state: previous.state }));
    assert.deepEqual(f.ui.getSelection(), { tool: 'steps' }); assert.ok(f.$('stepTap')); assert.deepEqual(f.destroyed, ['reaction']);
    assert.equal(f.window.location.href, previous.url);
  } finally { await f.close(); }
});


test('missing and invalid initial destinations replace the URL with boxing and never expose a choice page', async () => {
  for (const query of ['', '?demo=1', '?demo=1&tool=unknown', '?demo=1&tool=boxing&game=tiles', '?tool=boxing&tool=steps', '?game=reaction']) {
    const f = await fixture({ url: `http://192.168.50.123:4173/tools.html${query}#outil` }); try {
      assert.deepEqual(f.ui.getSelection(), { tool: 'boxing' }); assert.ok(f.$('timerStart'));
      assert.equal(f.$('toolsMenu'), null); assert.equal(f.$('toolsBack'), null);
      const params = new URLSearchParams(f.window.location.search);
      assert.deepEqual(params.getAll('tool'), ['boxing']); assert.equal(params.has('game'), false);
      assert.equal(f.window.location.hash, '#outil'); assert.equal(f.window.history.length, 1, 'canonicalization replaces the initial entry');
      if (query.includes('demo=1')) assert.equal(params.get('demo'), '1');
    } finally { await f.close(); }
  }
});

test('legacy cognitive destinations open Tiles directly without an intermediate game chooser', async () => {
  const f = await fixture({ url: 'https://example.test/tools.html?demo=1&tool=cognitive' }); try {
    assert.deepEqual(f.ui.getSelection(), { tool: 'cognitive', game: 'tiles' }); assert.deepEqual(f.mounts, ['tiles']);
    assert.equal(f.window.location.search, '?demo=1&tool=cognitive&game=tiles');
    assert.deepEqual(f.selections, [{ tool: 'cognitive', game: 'tiles' }]);
    assert.equal(f.window.document.querySelector('[data-game],.cognitive-game-back'), null);
    f.navigate({ tool: 'steps' }); await f.ui.select('cognitive');
    assert.deepEqual(f.ui.getSelection(), { tool: 'cognitive', game: 'tiles' });
  } finally { await f.close(); }
});

test('browser history entries without a tool still respect the active-game guard before canonicalizing to boxing', async () => {
  const f = await fixture(); try {
    const previous = { state: f.window.history.state, url: 'http://192.168.50.123:4173/tools.html?demo=1' };
    f.navigate({ tool: 'cognitive', game: 'reaction' }); await settle();
    const current = { state: f.window.history.state, url: f.window.location.href }, moves = [];
    f.window.history.go = distance => moves.push(distance); f.allow = false;
    f.window.history.replaceState(previous.state, '', previous.url); f.window.dispatchEvent(new f.window.PopStateEvent('popstate', { state: previous.state }));
    assert.deepEqual(moves, [1]); assert.deepEqual(f.ui.getSelection(), { tool: 'cognitive', game: 'reaction' });
    f.window.history.replaceState(current.state, '', current.url); f.window.dispatchEvent(new f.window.PopStateEvent('popstate', { state: current.state }));
    f.allow = true; f.window.history.replaceState(previous.state, '', previous.url); f.window.dispatchEvent(new f.window.PopStateEvent('popstate', { state: previous.state }));
    assert.deepEqual(f.ui.getSelection(), { tool: 'boxing' }); assert.equal(f.window.location.search, '?demo=1&tool=boxing');
    assert.ok(f.$('timerStart')); assert.deepEqual(f.destroyed, ['reaction']);
  } finally { await f.close(); }
});
