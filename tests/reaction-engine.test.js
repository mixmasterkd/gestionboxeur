import test from 'node:test';
import assert from 'node:assert/strict';
import { COLORS, ReactionGame } from '../js/reaction-engine.js';

function fixture(config = {}) {
  let time = 0;
  const game = new ReactionGame({ now: () => time, random: () => 0, ...config });
  return {
    game,
    set(value) { time = value; },
    advance(ms) { time += ms; return game.tick(); },
    reveal() { time += 4000; game.tick(); return game.reveal(); },
    hitAfter(ms, index = game.colors.indexOf(game.target), input = 'touch') { time += ms; return game.hit(index, input); },
  };
}

test('reaction modes, lengths and palette have a stable bounded contract', () => {
  assert.deepEqual(COLORS.map(color => color.name), ['Rouge', 'Bleu', 'Jaune', 'Vert']);
  assert.equal(new Set(COLORS.map(color => color.id)).size, 4);
  assert.equal(new Set(COLORS.map(color => color.hex)).size, 4);
  assert.ok(Object.isFrozen(COLORS) && COLORS.every(Object.isFrozen));
  for (const mode of ['simple', 'locate', 'choice']) for (const rounds of [1, 5, 10]) {
    const state = new ReactionGame({ mode, rounds }).snapshot();
    assert.equal(state.status, 'idle'); assert.equal(state.active, false); assert.equal(state.trial, 0);
    assert.equal(state.target, null); assert.equal(state.colors.length, mode === 'simple' ? 1 : 4);
    assert.equal(state.best, null); assert.equal(state.average, null); assert.equal(state.last, null);
  }
  for (const config of [{ mode: 'invalid' }, { rounds: 0 }, { rounds: 2 }, { rounds: '5' }, { now: null }, { random: 1 }]) {
    assert.throws(() => new ReactionGame(config));
  }
});

test('waiting announces the target but never reveals colors before explicit reveal', () => {
  const f = fixture({ mode: 'choice' }), g = f.game;
  const start = g.start();
  assert.equal(start.status, 'waiting'); assert.equal(start.target, 0); assert.equal(start.ready, false);
  assert.deepEqual(start.colors, [null, null, null, null]);
  assert.equal(g.reveal().status, 'waiting');
  assert.equal(f.advance(1499).ready, false);
  assert.equal(f.advance(1).ready, true);
  assert.deepEqual(g.snapshot().colors, [null, null, null, null]);
  assert.equal(f.advance(5000).status, 'waiting', 'late UI does not reveal a missed frame');
  assert.equal(g.reveal().status, 'active');
});

test('reaction time is measured from actual reveal, not from elapsed waiting deadline', () => {
  const f = fixture(), g = f.game;
  g.start(); f.advance(8000); g.reveal();
  const state = f.hitAfter(243.6);
  assert.equal(state.status, 'settling'); assert.equal(state.correct, true); assert.equal(state.last.ms, 244);
  assert.equal(state.last.input, 'touch'); assert.equal(state.best, null); assert.equal(state.results.length, 0);
  assert.equal(f.advance(99).status, 'settling');
  const committed = f.advance(1);
  assert.equal(committed.status, 'feedback'); assert.equal(committed.results.length, 1);
  assert.equal(committed.best, 244); assert.equal(committed.average, 244); assert.equal(committed.errors, 0);
});

test('scheduled waiting deadline without visible cue is still too early to hit', () => {
  const f = fixture(), g = f.game;
  g.start(); f.advance(5000);
  const state = g.hit(0, 'mouse');
  assert.equal(state.last.error, 'early'); assert.equal(state.last.ms, null);
  assert.equal(state.status, 'feedback'); assert.equal(state.errors, 1); assert.equal(state.best, null);
  assert.equal(g.reveal().status, 'feedback');
});

test('one button uses announced color; locate shows only that color in one random slot', () => {
  let f = fixture({ random: () => .99 });
  assert.equal(f.game.start().target, 3);
  assert.deepEqual(f.reveal().colors, [3]);
  f = fixture({ mode: 'locate', random: () => .6 });
  assert.equal(f.game.start().target, 2);
  assert.deepEqual(f.reveal().colors, [null, null, 2, null]);
  assert.equal(f.hitAfter(200, 0).last.error, 'wrong');
});

test('choice reveals all colors together in shuffled positions and accepts only announced one', () => {
  const f = fixture({ mode: 'choice' }), g = f.game;
  assert.deepEqual(g.start().colors, [null, null, null, null]);
  const state = f.reveal();
  assert.deepEqual(state.colors, [1, 2, 3, 0]);
  assert.deepEqual([...state.colors].sort(), [0, 1, 2, 3]);
  assert.equal(f.hitAfter(281, 3, 'keyboard').correct, true);
  assert.equal(f.advance(100).results[0].input, 'keyboard');
});

test('successive wait durations cannot repeat, including upper bound wrap', () => {
  for (const random of [() => 0, () => 1]) {
    const f = fixture({ random }), g = f.game;
    g.start(); const first = g.nextAt;
    g.hit(0, 'touch'); f.advance(1100);
    const second = g.nextAt - 1100;
    assert.notEqual(second, first);
    assert.ok(first >= 1500 && first <= 4000);
    assert.ok(second >= 1500 && second <= 4000);
  }
});

test('extra hit in settling invalidates fast multi-touch and never exposes a valid record', () => {
  const f = fixture({ mode: 'locate' }), g = f.game;
  g.start(); f.reveal(); f.hitAfter(151, 0);
  assert.equal(g.snapshot().best, null);
  const extra = f.hitAfter(30, 3);
  assert.equal(extra.accepted, true); assert.equal(extra.correct, false);
  assert.equal(extra.last.error, 'multiple'); assert.equal(extra.last.ms, null);
  const result = f.advance(70);
  assert.equal(result.results.length, 1); assert.equal(result.best, null); assert.equal(result.average, null);
  assert.equal(result.errors, 1); assert.equal(result.last.input, 'touch');
});

test('repeated same-button taps are also multiple, while invalid coordinates are ignored', () => {
  const f = fixture(), g = f.game;
  g.start(); f.reveal(); f.hitAfter(300);
  assert.equal(g.hit(-1, 'touch').accepted, false);
  assert.equal(g.hit(0, 'touch').last.error, 'multiple');
  assert.equal(f.advance(100).best, null);
});

test('early and wrong hits consume one trial with immediate feedback and ignore more hits', () => {
  const f = fixture({ mode: 'choice' }), g = f.game;
  g.start(); const early = g.hit(0, 'mouse');
  assert.equal(early.last.error, 'early'); assert.equal(early.results.length, 1);
  assert.equal(g.hit(2, 'touch').accepted, false);
  assert.equal(f.advance(1099).status, 'feedback');
  assert.equal(f.advance(1).trial, 2);
  f.reveal(); const wrong = f.hitAfter(100, 0);
  assert.equal(wrong.last.error, 'wrong'); assert.equal(wrong.results.length, 2); assert.equal(wrong.errors, 2);
  assert.equal(g.hit(3, 'mouse').accepted, false);
});

test('sub-millisecond reaction is an invalid early hit, while one millisecond is valid', () => {
  for (const elapsed of [0, .5, .999, 1]) {
    const f = fixture(), g = f.game;
    g.start(); f.reveal(); const state = f.hitAfter(elapsed);
    assert.equal(state.last.error, elapsed < 1 ? 'early' : null);
    assert.equal(state.last.ms, elapsed < 1 ? null : 1);
  }
});

test('ten-second timeout is enforced by tick and hit even with no prior frame', () => {
  for (const method of ['tick', 'hit']) {
    const f = fixture(), g = f.game;
    g.start(); f.reveal(); f.set(14000);
    const state = method === 'tick' ? g.tick() : g.hit(0, 'mouse');
    assert.equal(state.last.error, 'timeout'); assert.equal(state.last.input, null);
    assert.equal(state.best, null); assert.equal(state.status, 'feedback');
    if (method === 'hit') assert.equal(state.accepted, false);
  }
  const f = fixture(), g = f.game;
  g.start(); f.reveal();
  assert.equal(f.hitAfter(9999.8).last.ms, 10000, 'rounded upper limit stays valid before timeout');
});

test('completed 1/5/10-trial sessions finish after feedback and restart starts cleanly', () => {
  for (const rounds of [1, 5, 10]) {
    const f = fixture({ rounds }), g = f.game;
    g.start();
    for (let trial = 1; trial <= rounds; trial++) {
      assert.equal(g.snapshot().trial, trial); f.reveal();
      f.hitAfter(200 + trial); f.advance(100);
      assert.equal(g.results.length, trial);
      const state = f.advance(1100);
      assert.equal(state.status, trial === rounds ? 'done' : 'waiting');
    }
    assert.equal(g.active, false); assert.equal(g.snapshot().best, 201);
    assert.equal(g.hit(0, 'mouse').accepted, false); assert.equal(g.reveal().status, 'done');
    const reset = g.start();
    assert.equal(reset.status, 'waiting'); assert.equal(reset.trial, 1); assert.equal(reset.results.length, 0);
    assert.equal(reset.last, null); assert.equal(reset.best, null); assert.equal(reset.errors, 0);
  }
});

test('statistics include only valid finalized trials and round the average', () => {
  const f = fixture(), g = f.game;
  g.start(); f.reveal(); f.hitAfter(201); f.advance(100); f.advance(1100);
  g.hit(0, 'keyboard'); f.advance(1100);
  f.reveal(); f.hitAfter(304, 0, 'mouse'); f.advance(100);
  const state = g.snapshot();
  assert.equal(state.results.length, 3); assert.equal(state.best, 201); assert.equal(state.average, 253);
  assert.equal(state.errors, 1);
  assert.deepEqual(state.results.map(result => result.trial), [1, 2, 3]);
  assert.deepEqual(state.results.map(result => result.input), ['touch', 'keyboard', 'mouse']);
});

test('interrupt discards unsettled hits and preserves completed trials without producing done', () => {
  const f = fixture(), g = f.game;
  g.start(); f.reveal(); f.hitAfter(300); f.advance(100); f.advance(1100);
  f.reveal(); f.hitAfter(150);
  const state = g.interrupt();
  assert.equal(state.status, 'interrupted'); assert.equal(state.active, false); assert.equal(state.results.length, 1);
  assert.equal(state.best, 300); assert.equal(state.last.ms, 300); assert.deepEqual(state.colors, [null]);
  assert.equal(f.advance(30000).status, 'interrupted');
  assert.equal(g.hit(0, 'touch').accepted, false); assert.equal(g.reveal().status, 'interrupted');
});

test('interrupt is safe during every running phase and inert after idle/done', () => {
  for (const phase of ['waiting', 'active', 'settling', 'feedback']) {
    const f = fixture(), g = f.game; g.start();
    if (phase !== 'waiting') f.reveal();
    if (phase === 'settling' || phase === 'feedback') f.hitAfter(250);
    if (phase === 'feedback') f.advance(100);
    assert.equal(g.status, phase); assert.equal(g.interrupt().status, 'interrupted');
  }
  const f = fixture({ rounds: 1 }), g = f.game;
  assert.equal(g.interrupt().status, 'idle');
  g.start(); g.hit(0, 'touch'); f.advance(1100);
  assert.equal(g.interrupt().status, 'done');
});

test('invalid input kind/index is ignored without consuming a trial in all input phases', () => {
  const f = fixture({ mode: 'choice' }), g = f.game;
  const invalid = [[-1, 'touch'], [4, 'mouse'], [NaN, 'keyboard'], [1.1, 'touch'], ['1', 'mouse'], [null, 'touch'], [0, null], [0, 'pen']];
  g.start();
  for (const args of invalid) assert.equal(g.hit(...args).accepted, false);
  assert.equal(g.results.length, 0); f.reveal();
  for (const args of invalid) assert.equal(g.hit(...args).accepted, false);
  f.hitAfter(100, 3);
  for (const args of invalid) assert.equal(g.hit(...args).accepted, false);
  assert.equal(f.advance(100).best, 100);
});

test('snapshots are isolated copies and cannot rewrite current signals or valid results', () => {
  const f = fixture(), g = f.game; g.start(); f.reveal(); f.hitAfter(213);
  let state = g.snapshot(); state.last.ms = 1; state.colors[0] = 99;
  assert.equal(g.snapshot().last.ms, 213); assert.equal(g.snapshot().colors[0], 0);
  f.advance(100); state = g.snapshot(); state.results[0].ms = 1; state.last.ms = 2; state.results.push({ ms: 0 });
  assert.equal(g.snapshot().best, 213); assert.equal(g.snapshot().results.length, 1);
});

test('random boundary and non-finite inputs remain bounded without exposing invalid colors', () => {
  for (const value of [-1, 0, .5, 1, 2, NaN, Infinity]) {
    const f = fixture({ mode: 'choice', random: () => value }), g = f.game;
    const state = g.start(); assert.ok(state.target >= 0 && state.target < 4);
    assert.ok(g.nextAt >= 1500 && g.nextAt <= 4000);
    assert.deepEqual([...f.reveal().colors].sort(), [0, 1, 2, 3]);
  }
});

test('backward clocks cannot create a negative reaction time or premature deadline', () => {
  const f = fixture(), g = f.game; g.start(); f.reveal(); f.set(3990);
  assert.equal(g.hit(0, 'touch').last.error, 'early');
  f.set(5000); assert.equal(g.tick().status, 'feedback');
  f.set(5100); assert.equal(g.tick().status, 'waiting');
  assert.throws(() => new ReactionGame({ now: () => NaN }).start(), /Horloge/);
});
