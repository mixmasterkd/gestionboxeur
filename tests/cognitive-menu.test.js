import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { mountCognitiveMenu } from '../js/cognitive-menu.js';
import { mountCognitiveGames } from '../js/cognitive-games.js';
import { createDemoCognitiveRecordStore } from '../js/cognitive-records.js';
test('menu exposes five distinct games, routes original variants and keeps the reaction clock independent', async () => {
  const window = new Window(), host = window.document.createElement('div'); window.document.body.append(host);
  let received, ticks = 0, released = 0, allow = true;
  const child = () => ({ tick() { ticks++; }, canLeave() { return allow; }, destroy() { released++; } });
  const menu = mountCognitiveMenu(host, { autoTick: true,
    loadCognitive: async () => ({ mountCognitiveGames(_, options) { received = options; return child(); } }),
    loadReaction: async () => ({ mountReactionGame(_, options) { received = options; return child(); } }),
  });
  try {
    assert.equal(host.querySelectorAll('[data-game]').length, 5);
    await menu.select('bag'); assert.equal(received.initialVariant, 'bag'); menu.tick(); assert.equal(ticks, 1);
    allow = false; host.querySelector('.cognitive-game-back').click(); assert.equal(released, 0);
    allow = true; host.querySelector('.cognitive-game-back').click(); assert.equal(released, 1); assert.equal(host.querySelectorAll('[data-game]').length, 5);
    await menu.select('reaction'); assert.equal(received.autoTick, true); menu.tick(); assert.equal(ticks, 1, 'parent loop does not measure reaction');
  } finally { menu.destroy(); await window.happyDOM.abort(); }
});
test('a late game import cannot replace a different game or mount after teardown', async () => {
  const window = new Window(), host = window.document.createElement('div'); let resolve, mounts = 0;
  const loading = new Promise(done => { resolve = done; });
  const menu = mountCognitiveMenu(host, { loadCognitive: () => loading, loadReaction: async () => ({ mountReactionGame(target) { target.textContent = 'Reaction'; return { destroy() {} }; } }) });
  try {
    const pending = menu.select('tiles'); await menu.select('reaction'); resolve({ mountCognitiveGames() { mounts++; } }); await pending;
    assert.equal(mounts, 0); assert.match(host.textContent, /Reaction/); menu.destroy(); assert.equal(host.childElementCount, 0);
  } finally { await window.happyDOM.abort(); }
});
test('Tuiles and Sac open as separate games and can only switch through the menu', async () => {
  const window = new Window(), host = window.document.createElement('div'); window.document.body.append(host);
  window.WebGL2RenderingContext = undefined;
  window.localStorage.setItem('gestionboxeur:cognitive:v1:owner', JSON.stringify({ variant: 'bag', count: 8, mode: 'targets', sound: false }));
  const menu = mountCognitiveMenu(host, { ownerId: 'owner', storage: window.localStorage, now: () => 0, autoTick: false, cognitiveStore: createDemoCognitiveRecordStore(), loadCognitive: async () => ({ mountCognitiveGames }) });
  try {
    await menu.select('tiles');
    assert.equal(host.querySelector('#cognitiveGameTitle').textContent, 'Tuiles'); assert.equal(host.querySelectorAll('.cognitive-tile').length, 8);
    assert.equal(host.querySelector('[data-variant] button[data-variant]'), null); assert.equal(host.querySelector('[role=tablist]'), null);
    assert.equal(host.querySelector('#cognitiveBagSettings').hidden, true);
    host.querySelector('.cognitive-game-back').click(); assert.equal(host.querySelectorAll('[data-game]').length, 5);
    await menu.select('bag'); assert.equal(host.querySelector('#cognitiveGameTitle').textContent, 'Sac');
    assert.equal(host.querySelectorAll('.cognitive-fallback-zone').length, 6); assert.equal(host.querySelector('#cognitiveTileSettings').hidden, true);
    assert.equal(host.querySelector('button[data-mode=targets]').getAttribute('aria-pressed'), 'true'); assert.equal(host.querySelector('[role=tablist]'), null);
    host.querySelector('.cognitive-game-back').click(); assert.equal(host.querySelectorAll('[data-game]').length, 5);
  } finally { menu.destroy(); await window.happyDOM.abort(); }
});
