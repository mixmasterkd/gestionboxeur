import test from 'node:test';
import assert from 'node:assert/strict';
import { makePhases, RoundTimer, timerCue, formatTime } from '../js/tools-engine.js';

function clock(phases) {
  let now = 0;
  const timer = new RoundTimer(phases, () => now);
  return { timer, at(milliseconds) { now = milliseconds; return timer.snapshot(); } };
}

test('series restart repetition numbering and replace the last repetition rest with series rest', () => {
  const phases = makePhases({ rounds: 2, series: 3, work: 45, rest: 15, seriesRest: 120, preparation: 5 });
  assert.deepEqual(phases.map(p => [p.kind, p.series, p.round, p.seconds, !!p.seriesRest]), [
    ['prepare', 1, 1, 5, false],
    ['work', 1, 1, 45, false], ['rest', 1, 1, 15, false], ['work', 1, 2, 45, false], ['rest', 1, 2, 120, true],
    ['work', 2, 1, 45, false], ['rest', 2, 1, 15, false], ['work', 2, 2, 45, false], ['rest', 2, 2, 120, true],
    ['work', 3, 1, 45, false], ['rest', 3, 1, 15, false], ['work', 3, 2, 45, false],
  ]);
  const { timer, at } = clock(phases);
  assert.equal(timer.total, 560000);
  timer.start();
  const breakState = at(110000);
  assert.equal(breakState.phase.seriesRest, true);
  assert.equal(breakState.remaining, 120000);
  assert.equal(breakState.nextPhase.series, 2);
  assert.equal(breakState.nextPhase.round, 1);
  assert.equal(at(230000).phase.kind, 'work');
  assert.equal(at(560000).status, 'done');
  assert.equal(timer.snapshot().nextPhase, null);
});

test('zero rests and one-repetition series do not add empty phases or trailing recovery', () => {
  const phases = makePhases({ rounds: 1, series: 2, work: 10, rest: 30, seriesRest: 0, preparation: 0 });
  assert.deepEqual(phases.map(p => [p.kind, p.series, p.seconds]), [['work', 1, 10], ['work', 2, 10]]);
  assert.equal(new RoundTimer(phases).total, 20000);
  const noRepRest = makePhases({ rounds: 2, series: 2, work: 10, rest: 0, seriesRest: 5, preparation: 0 });
  assert.deepEqual(noRepRest.map(p => p.seconds), [10, 10, 5, 10, 10]);
  assert.equal(noRepRest.at(-1).kind, 'work');
});

test('infinite boxing prepares once, increments rounds and exposes every cycle transition', () => {
  const phases = makePhases({ infinite: true, rounds: 99, work: 120, rest: 30, preparation: 10 });
  const { timer, at } = clock(phases);
  assert.equal(phases.length, 3);
  assert.equal(timer.total, Infinity);
  assert.equal(formatTime(timer.total), '∞');
  assert.equal(timer.snapshot().nextPhase.kind, 'work');
  timer.start();
  const firstWork = at(10000);
  assert.equal(firstWork.phase.round, 1);
  assert.equal(firstWork.index, 1);
  const firstRest = at(130000);
  assert.equal(firstRest.phase.kind, 'rest');
  assert.equal(firstRest.nextPhase.kind, 'work');
  assert.equal(firstRest.nextPhase.round, 2);
  assert.equal(firstRest.nextPhase.start, 160000);
  const secondWork = at(160000);
  assert.equal(secondWork.phase.kind, 'work');
  assert.equal(secondWork.phase.round, 2);
  assert.equal(secondWork.remaining, 120000);
  assert.equal(secondWork.index, 3);
  assert.equal(timerCue(firstRest, secondWork), 'phase');
  const dayLater = at(86400000);
  assert.equal(dayLater.phase.kind, 'rest');
  assert.equal(dayLater.phase.round, 576);
  assert.equal(dayLater.index, 1152);
  assert.equal(dayLater.remaining, 10000);
  assert.equal(dayLater.nextPhase.round, 577);
  assert.equal(dayLater.status, 'running');
  assert.equal(timerCue(secondWork, dayLater), 'phase');
  assert.equal(timer.phases.length, 3, 'long runs never expand the stored cycle');
});

test('infinite rounds without rest still have distinct indices and accurate time after a day', () => {
  const { timer, at } = clock(makePhases({ infinite: true, work: 3, rest: 0, preparation: 0 }));
  const before = timer.start();
  const next = at(3000);
  assert.equal(next.phase.kind, 'work');
  assert.equal(next.phase.round, 2);
  assert.equal(next.index, 1);
  assert.equal(timerCue(before, next), 'phase');
  const longRun = at(86400500);
  assert.equal(longRun.phase.round, 28801);
  assert.equal(longRun.index, 28800);
  assert.equal(longRun.remaining, 2500);
  assert.equal(longRun.nextPhase.round, 28802);
  assert.equal(timer.phases.length, 1);
});

test('infinite projection matches an independently unfolded timeline on either side of every boundary', () => {
  for (const preparation of [0, 2]) for (const work of [1, 7]) for (const rest of [0, 3]) {
    let end = 0;
    const unfolded = [];
    const append = (kind, seconds, round) => { const start = end; end += seconds * 1000; unfolded.push({ kind, round, start, end }); };
    if (preparation) append('prepare', preparation, 1);
    for (let round = 1; round <= 7; round++) {
      append('work', work, round);
      if (rest) append('rest', rest, round);
    }
    const { timer, at } = clock(makePhases({ infinite: true, preparation, work, rest }));
    timer.start();
    // Keep the last unfolded cycle as a look-ahead for nextPhase.
    for (const edge of unfolded.slice(0, -2).map(p => p.end)) for (const offset of [-0.5, 0, 0.5]) {
      const elapsed = edge + offset;
      const expectedIndex = unfolded.findIndex(p => p.end > elapsed);
      const expected = unfolded[expectedIndex];
      const state = at(elapsed);
      const context = JSON.stringify({ preparation, work, rest, elapsed });
      assert.equal(state.phase.kind, expected.kind, context);
      assert.equal(state.phase.round, expected.round, context);
      assert.equal(state.index, expectedIndex, context);
      assert.equal(state.phase.start, expected.start, context);
      assert.equal(state.remaining, expected.end - elapsed, context);
      assert.equal(state.nextPhase.kind, unfolded[expectedIndex + 1].kind, context);
      assert.equal(state.nextPhase.round, unfolded[expectedIndex + 1].round, context);
    }
  }
});

test('pause at preparation, work and rest boundaries freezes through a year and resumes without drift', () => {
  const year = 365 * 24 * 60 * 60 * 1000;
  for (const pauseAt of [0, 1999.5, 2000, 8999.5, 9000, 11999.5, 12000, year + 1234.5]) {
    const { timer, at } = clock(makePhases({ infinite: true, preparation: 2, work: 7, rest: 3 }));
    timer.start();
    const beforePause = at(pauseAt);
    const paused = timer.pause();
    assert.equal(paused.elapsed, pauseAt);
    const stillPaused = at(pauseAt + year);
    assert.equal(stillPaused.remaining, beforePause.remaining);
    assert.equal(stillPaused.index, beforePause.index);
    assert.equal(stillPaused.nextPhase.round, beforePause.nextPhase.round);
    timer.start(); timer.start(); // Repeated start cannot reset a running timer.
    const resumed = at(pauseAt + year + 500.25);
    const uninterrupted = clock(makePhases({ infinite: true, preparation: 2, work: 7, rest: 3 }));
    uninterrupted.timer.start();
    assert.deepEqual(resumed, uninterrupted.at(pauseAt + 500.25));
  }
});

test('infinite warning is per round, while pause/resume and reset retain exact timing', () => {
  const { timer, at } = clock(makePhases({ infinite: true, work: 120, rest: 30, preparation: 10, warning: true }));
  timer.start();
  const before = at(249900), warning = at(250000);
  assert.equal(warning.phase.round, 2);
  assert.equal(timerCue(before, warning), 'warning');
  assert.equal(timerCue(warning, at(250100)), null);
  timer.pause();
  assert.equal(at(800000).remaining, 29900);
  timer.start();
  assert.equal(at(805000).remaining, 24900);
  const reset = timer.reset();
  assert.equal(reset.status, 'idle');
  assert.equal(reset.phase.kind, 'prepare');
  assert.equal(reset.phase.round, 1);
  assert.equal(reset.remaining, 10000);
});

test('custom finite phases retain intensity and source metadata including next phase', () => {
  const phases = [
    { kind: 'work', seconds: 60, round: 1, series: 2, effort: { zone: 'Z3', color: '#42ab63' }, command: '1m @ Z3' },
    { kind: 'rest', seconds: 30, round: 1, series: 2, effort: { label: 'Repos' }, command: '30s @ Repos' },
  ];
  const { timer, at } = clock(phases);
  const state = timer.start();
  assert.deepEqual(state.phase.effort, phases[0].effort);
  assert.equal(state.phase.command, phases[0].command);
  assert.deepEqual(state.nextPhase.effort, phases[1].effort);
  assert.equal(state.nextPhase.series, 2);
  assert.equal(at(60000).nextPhase, null);
  const done = at(86400000);
  assert.equal(done.status, 'done');
  assert.equal(done.elapsed, 90000);
  assert.equal(done.progress, 1);
  assert.equal(done.nextPhase, null);
  assert.equal(phases[0].start, undefined, 'configuration does not mutate source commands');
});

test('switching back to a finite timer clears the infinite cycle and starts fresh', () => {
  const { timer, at } = clock(makePhases({ infinite: true, work: 3, rest: 0, preparation: 0 }));
  timer.start();
  assert.equal(at(60000).phase.round, 21);
  timer.configure(makePhases({ rounds: 1, work: 10, preparation: 0 }));
  assert.equal(timer.snapshot().status, 'idle');
  assert.equal(timer.snapshot().phase.round, 1);
  assert.equal(timer.snapshot().total, 10000);
  timer.start();
  assert.equal(at(70000).status, 'done');
  assert.equal(timer.snapshot().nextPhase, null);
});

test('finite series finish at the exact independent duration for all zero-rest combinations', () => {
  for (const rounds of [1, 3]) for (const series of [1, 3]) for (const rest of [0, 2]) for (const seriesRest of [0, 5]) {
    const preparation = 2, work = 7;
    const duration = (preparation + series * (rounds * work + (rounds - 1) * rest) + (series - 1) * seriesRest) * 1000;
    const { timer, at } = clock(makePhases({ rounds, series, rest, seriesRest, preparation, work }));
    assert.equal(timer.total, duration);
    timer.start();
    const lastMoment = at(duration - 0.5);
    assert.equal(lastMoment.phase.kind, 'work');
    assert.equal(lastMoment.phase.series, series);
    assert.equal(lastMoment.phase.round, rounds);
    assert.equal(lastMoment.nextPhase, null);
    assert.equal(lastMoment.remaining, 0.5);
    assert.equal(at(duration).status, 'done');
    assert.equal(timer.pause().status, 'done', 'pause after completion must not revive the timer');
  }
});

test('series bounds and oversized or malformed timelines fail before timer configuration changes', () => {
  for (const config of [{ series: 0 }, { series: 100 }, { series: 1.5 }, { seriesRest: -1 }, { seriesRest: 3601 }, { infinite: 'true' }, { infinite: true, series: 2 }]) {
    assert.throws(() => makePhases(config), RangeError);
  }
  const largest = makePhases({ rounds: 99, series: 99 });
  assert.ok(largest.length < 20000);
  const timer = new RoundTimer(largest);
  assert.equal(timer.snapshot().phase.kind, 'prepare');
  const originalTotal = timer.total;
  for (const phases of [[], [{ seconds: 0 }], [{ seconds: Infinity }], [null], new Array(2), Array.from({ length: 20001 }, () => ({ seconds: 1 })), [{ seconds: Number.MAX_VALUE }]]) {
    assert.throws(() => timer.configure(phases), RangeError);
    assert.equal(timer.total, originalTotal);
  }
});
