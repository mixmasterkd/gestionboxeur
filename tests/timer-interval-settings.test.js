import test from 'node:test';
import assert from 'node:assert/strict';
import { basicTimerText, readDuration, displayDuration } from '../js/timer-interval-settings.js';
import { compileTimerText } from '../js/timer-program.js';
import { makePhases } from '../js/tools-engine.js';

const schedule = phases => phases.map(({ kind, seconds }) => [kind, seconds]);
const matchesBase = config => {
  const text = basicTimerText(config), compiled = compileTimerText(text);
  assert.deepEqual(schedule(compiled.phases), schedule(makePhases(config)), text);
  assert.equal(compiled.commands.includes('@ Préparation'), (config.preparation ?? 10) > 0);
  return { text, compiled };
};

test('small independent M/S controls preserve familiar and repeating decimal durations', () => {
  for (const [seconds, minutes] of [[0, '0'], [90, '1.5'], [45, '0.75'], [7, '0.116666666667'], [60, '1'], [3600, '60']]) {
    assert.equal(displayDuration(seconds, 'M'), minutes);
    assert.equal(displayDuration(seconds, 'S'), String(seconds));
    assert.equal(readDuration(minutes, 'M'), seconds);
    assert.equal(readDuration(String(seconds), 'S'), seconds);
  }
  assert.equal(readDuration('1,5', 'm'), 90);
  assert.equal(readDuration('.75', 'M'), 45);
  assert.equal(readDuration(' 45 ', 's'), 45);
  assert.equal(readDuration(1.5, 'M'), 90);
});

test('every supported integer second survives repeated display unit changes exactly', () => {
  for (let seconds = 0; seconds <= 3600; seconds++) {
    let value = seconds;
    for (let pass = 0; pass < 3; pass++) value = readDuration(displayDuration(readDuration(displayDuration(value, 'M'), 'M'), 'S'), 'S');
    assert.equal(value, seconds);
  }
});

test('duration validation rejects blanks, fractions of seconds, unsafe values and bounds', () => {
  for (const value of ['', ' ', null, undefined, false, NaN, Infinity, '-1', -1, '1e2', '1 2', '1:30', '3sec', '0x10', '1.5', 1.5, '7.00000000001']) assert.throws(() => readDuration(value, 'S'), RangeError, String(value));
  for (const value of ['0.001', '0.10000001', '0.116', '-1', '60.1']) assert.throws(() => readDuration(value, 'M'), RangeError, value);
  assert.throws(() => readDuration('1', 'min'), RangeError);
  assert.throws(() => readDuration('0', 'S', { min: 1 }), RangeError);
  assert.throws(() => readDuration('61', 'S', { max: 60 }), RangeError);
  assert.throws(() => readDuration('1', 'S', { min: 2, max: 1 }), RangeError);
  assert.throws(() => displayDuration(1.5, 'S'), RangeError);
  assert.throws(() => displayDuration(-1, 'M'), RangeError);
  assert.throws(() => displayDuration(1, 'minute'), RangeError);
  assert.equal(readDuration('0.11666666666666667', 'M'), 7);
  assert.equal(readDuration('1', 'M', { max: 60 }), 60);
});

test('default generated commands include preparation and exactly match base phases', () => {
  const { text, compiled } = matchesBase({});
  assert.match(text, /^- 10s @ Préparation/);
  assert.match(text, /2x\n- 3m\n- 1m @ Repos/);
  assert.equal(compiled.steps, 5);
  assert.equal(compiled.phases.at(-1).kind, 'work');
});

test('series conversion substitutes interseries rest and omits final rests in all combinations', () => {
  for (const rounds of [1, 2, 3, 12, 60, 99]) {
    for (const series of [1, 2, 3, 12]) {
      for (const rest of [0, 15, 60]) {
        for (const seriesRest of [0, 15, 60]) {
          for (const preparation of [0, 7]) matchesBase({ rounds, work: 45, rest, series, seriesRest, preparation });
        }
      }
    }
  }
});

test('large regular schedules stay compact and retain every timed boundary', () => {
  const { text, compiled } = matchesBase({ rounds: 99, series: 50, work: 1, rest: 1, seriesRest: 1, preparation: 5 });
  assert.ok(text.length < 2000);
  assert.equal(compiled.steps, 9899);
  assert.equal(compiled.totalSeconds, 9904);
});

test('oversized advanced conversion reports an error while base remains independently usable', () => {
  const config = { rounds: 99, series: 99, work: 1, rest: 1, seriesRest: 2, preparation: 0 };
  assert.throws(() => basicTimerText(config), /mode Base.*réglages/);
  assert.equal(makePhases(config).length, 19601);
  assert.throws(() => basicTimerText({ rounds: 0 }), RangeError);
  assert.throws(() => basicTimerText({ work: 1.5 }), RangeError);
});
