import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { VisualMemoryGame, DualTaskGame, memoryDifficulty, countingPrecision } from '../js/mental-engine.js';
import { createLocalMentalRecordStore, validateMentalResult } from '../js/mental-records.js';
import { mountMentalGame } from '../js/mental-games.js';
const settle = () => new Promise(resolve => setImmediate(resolve));
test('memory presents unique simultaneous cells, accepts any order, ignores duplicates and consumes three lives', () => {
  let time = 0; const game = new VisualMemoryGame({ now: () => time, random: () => .5 });
  const first = game.start(); assert.equal(new Set(first.pattern).size, 3); assert.equal(game.hit(first.pattern[0]).accepted, false);
  time = 2800; game.tick(); const misses = Array.from({ length: 36 }, (_, i) => i).filter(i => !game.pattern.includes(i));
  game.hit(misses[0]); game.hit(misses[0]); assert.equal(game.lives, 2);
  for (const cell of [...first.pattern].reverse()) game.hit(cell);
  assert.equal(game.status, 'success'); assert.equal(game.maxLevel, 1); time += 700; game.tick(); assert.equal(game.level, 2); assert.equal(game.lives, 2);
  time += memoryDifficulty(2).exposure; game.tick();
  for (const cell of misses.slice(1, 3)) game.hit(cell);
  assert.equal(game.status, 'done'); assert.equal(game.maxLevel, 1); assert.equal(game.errors, 3);
  assert.ok(memoryDifficulty(30).count <= 16); assert.equal(memoryDifficulty(30).exposure, 800);
});
test('dual task measures time from actual reveal, counts each error once, rejects late targets and scores counting', () => {
  let time = 0; const game = new DualTaskGame({ now: () => time, random: () => .5 }); game.start();
  while (game.status !== 'answer') {
    time = game.nextAt; game.tick(); if (game.status === 'waiting') game.reveal();
    if (game.status === 'stimulus') {
      time += 200;
      if (game.stimulus.type === 'circle') { game.hit(); assert.equal(game.hit().accepted, false); }
      time = game.nextAt; game.tick();
    }
  }
  assert.equal(game.triangleCount, 10); assert.equal(game.answer(10.5), false); assert.equal(game.answer(8), true);
  const result = game.result(); assert.equal(result.targetsHit, 20); assert.equal(result.averageReactionTime, 200); assert.equal(result.triangleError, 2); assert.equal(result.score, 340); assert.equal(result.precision, 80);
  assert.equal(countingPrecision(8, 30), 0); assert.ok(validateMentalResult('dual-task', result));
});
test('dual task treats ignored circles and touched triangles separately, with null timing for no hits', () => {
  let time = 0; const game = new DualTaskGame({ now: () => time, random: () => 0 }); game.start();
  while (game.status !== 'answer') {
    time = game.nextAt; game.tick(); if (game.status === 'waiting') game.reveal();
    if (game.status === 'stimulus') { if (game.stimulus.type === 'triangle') { game.hit(); game.hit(); } time = game.nextAt; game.tick(); assert.equal(game.hit().accepted, false); }
  }
  game.answer(game.triangleCount); const result = game.result(); assert.equal(result.targetsMissed, 22); assert.equal(result.inhibitionErrors, 8); assert.equal(result.score, 0); assert.equal(result.bestReactionTime, null); assert.ok(validateMentalResult('dual-task', result));
});
test('both engines interrupt hidden or stale rounds instead of crediting unfinished results', () => {
  let time = 0; const memory = new VisualMemoryGame({ now: () => time }); memory.start(); time = 10000; assert.equal(memory.tick().status, 'interrupted');
  const dual = new DualTaskGame({ now: () => time }); dual.start(); time += 4000; assert.equal(dual.tick().status, 'interrupted'); assert.equal(dual.answer(0), false);
});
test('local stores persist best and last separately, isolate accounts and surface write failure', async () => {
  const window = new Window(), store = createLocalMentalRecordStore(window.localStorage, 'a');
  const result = { levelReached: 4, maxLevel: 3, errors: 3, date: new Date().toISOString() };
  try {
    await store.saveResult('visual-memory', result); await store.saveResult('visual-memory', { ...result, maxLevel: 1 });
    const reload = createLocalMentalRecordStore(window.localStorage, 'a'); assert.equal((await reload.getRecord('visual-memory')).best.maxLevel, 3); assert.equal((await reload.getRecord('visual-memory')).last.maxLevel, 1);
    assert.equal(await createLocalMentalRecordStore(window.localStorage, 'b').getRecord('visual-memory'), null);
    await assert.rejects(createLocalMentalRecordStore({ getItem() { return null; }, setItem() { throw new Error(); } }, 'a').saveResult('visual-memory', result), /enregistré/);
  } finally { await window.happyDOM.abort(); }
});
test('memory UI shows the full grid, saves only a completed game and interrupts on page hide', async () => {
  const window = new Window({ settings: { disableJavaScriptEvaluation: true } }); let time = 0;
  const host = window.document.createElement('div'); window.document.body.append(host); const store = createLocalMentalRecordStore(window.localStorage, 'a');
  const ui = mountMentalGame(host, { mode: 'visual-memory', store, autoTick: false, now: () => time, random: () => 0 });
  try {
    host.querySelector('#mentalStart').click(); assert.equal(host.querySelectorAll('.is-lit').length, 3); assert.equal(host.querySelectorAll('[data-cell]').length, 36);
    time = 2800; ui.tick();
    for (const index of [0, 4, 5]) host.querySelector(`[data-cell="${index}"]`).click();
    await settle(); assert.equal(host.querySelector('.mental').dataset.status, 'done'); assert.equal((await store.getRecord('visual-memory')).last.errors, 3);
    host.querySelector('#mentalStart').click(); window.dispatchEvent(new window.Event('pagehide')); assert.equal(host.querySelector('.mental').dataset.status, 'interrupted');
  } finally { ui.destroy(); await window.happyDOM.abort(); }
});
