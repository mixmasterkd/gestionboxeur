import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Window } from 'happy-dom';
import { RoundTimer, StepCounter, makePhases, formatTime, timerCue } from '../js/tools-engine.js';
import { mountTools } from '../js/tools.js';

const html = await readFile(new URL('../tools.html', import.meta.url), 'utf8');
function fixture(saved) {
  const window = new Window({ url: 'https://example.test/tools.html', settings: { disableJavaScriptEvaluation: true, disableJavaScriptFileLoading: true, disableCSSFileLoading: true } });
  window.document.write(html);
  if (saved) window.localStorage.setItem('gestionboxeur:tools:v1', JSON.stringify(saved));
  let time = 0;
  const root = window.document.getElementById('toolsApp');
  const ui = mountTools(root, { now: () => time, autoTick: false });
  return { window, ui, $: id => window.document.getElementById(id), advance: ms => { time += ms; ui.tick(); }, async close() { ui.destroy(); await window.happyDOM.abort(); } };
}

test('rounds have preparation and between-round rest, with no extra rest after the last round', () => {
  const phases = makePhases({ rounds: 2, work: 120, rest: 30, preparation: 5, warning: true });
  assert.deepEqual(phases.map(p => [p.kind, p.round, p.seconds]), [['prepare', 1, 5], ['work', 1, 120], ['rest', 1, 30], ['work', 2, 120]]);
  assert.deepEqual(phases.map(p => p.warning), [false, true, false, true]);
  assert.equal(makePhases({ rounds: 1, work: 20, rest: 0, preparation: 0, warning: true })[0].warning, false);
  for (const setting of [{ rounds: 0 }, { rounds: 100 }, { work: -1 }, { rest: -1 }, { work: NaN }, { preparation: 61 }, { rounds: 2.5 }]) assert.throws(() => makePhases(setting), RangeError);
});

test('timer catches up across several phases after delayed browser callbacks', () => {
  let now = 0;
  const timer = new RoundTimer(makePhases({ rounds: 3, work: 120, rest: 30, preparation: 10 }), () => now);
  timer.start();
  now = 165000;
  const state = timer.snapshot();
  assert.equal(state.phase.kind, 'work'); assert.equal(state.phase.round, 2); assert.equal(state.remaining, 115000);
  now = 430000;
  assert.equal(timer.snapshot().status, 'done'); assert.equal(timer.snapshot().remaining, 0);
});

test('pause freezes the exact remaining time and resume does not count paused time', () => {
  let now = 1000;
  const timer = new RoundTimer(makePhases({ rounds: 1, work: 120, preparation: 0 }), () => now);
  timer.start(); now += 12500; timer.pause(); now += 600000;
  assert.equal(timer.snapshot().remaining, 107500); assert.equal(timer.snapshot().status, 'paused');
  timer.start(); now += 7500;
  assert.equal(timer.snapshot().remaining, 100000);
  timer.reset(); assert.equal(timer.snapshot().remaining, 120000); assert.equal(timer.snapshot().status, 'idle');
});

test('warnings occur once at 30 seconds in a work round and never during rest or when disabled', () => {
  let now = 0;
  const timer = new RoundTimer(makePhases({ rounds: 2, work: 120, rest: 60, preparation: 0, warning: true }), () => now);
  timer.start(); now = 89900; let before = timer.snapshot(); now = 90000; let after = timer.snapshot();
  assert.equal(timerCue(before, after), 'warning');
  before = after; now += 100; after = timer.snapshot(); assert.equal(timerCue(before, after), null);
  before = after; now = 120000; after = timer.snapshot(); assert.equal(timerCue(before, after), 'phase');
  before = after; now = 150000; after = timer.snapshot(); assert.equal(timerCue(before, after), null);
  const noWarning = new RoundTimer(makePhases({ rounds: 1, work: 120, preparation: 0, warning: false }), () => now);
  before = noWarning.start(); now += 90000; assert.equal(timerCue(before, noWarning.snapshot()), null);
});

test('late callbacks do not replay an obsolete 30-second warning or every missed phase cue', () => {
  let now = 0;
  const timer = new RoundTimer(makePhases({ rounds: 2, work: 120, rest: 30, preparation: 0, warning: true }), () => now);
  const start = timer.start(); now = 110000;
  assert.equal(timerCue(start, timer.snapshot()), null);
  now = 270000; const done = timer.snapshot();
  assert.equal(timerCue(start, done), 'finish'); assert.equal(timerCue(done, done), null);
});

test('manual cadence uses intervals between taps and resets for a fresh measurement', () => {
  let now = 1000;
  const counter = new StepCounter(() => now);
  assert.equal(counter.tap().cadence, null);
  for (let i = 0; i < 10; i++) { now += 500; counter.tap(); }
  assert.deepEqual(counter.snapshot(), { count: 11, elapsed: 5000, cadence: 120 });
  counter.reset(); assert.deepEqual(counter.snapshot(), { count: 0, elapsed: 0, cadence: null });
  assert.equal(formatTime(119001), '02:00'); assert.equal(formatTime(0), '00:00');
});

test('boxing settings, pause, reset and retained appearance operate from the real page', async () => {
  const app = fixture({ sound: false });
  try {
    app.$('toolsApp').querySelector('[data-tool="boxing"]').click();
    assert.equal(app.$('toolsMenu').hidden, true); assert.equal(app.$('toolTitle').textContent, 'Timer de boxe');
    assert.equal(app.window.document.activeElement, app.$('toolTitle'), 'opening a tool never focuses an input');
    const form = app.$('timerForm'); form.elements.preparation.value = '0'; form.elements.work.value = '120';
    form.dispatchEvent(new app.window.Event('change', { bubbles: true }));
    app.$('timerDesign').value = 'classic'; app.$('timerDesign').dispatchEvent(new app.window.Event('change'));
    app.$('timerStart').click(); app.advance(6000);
    assert.equal(app.$('timerDigits').textContent, '01:54'); assert.equal(app.$('timerFields').disabled, true);
    app.$('timerStart').click(); app.advance(300000); assert.equal(app.$('timerDigits').textContent, '01:54');
    app.$('timerStart').click(); app.advance(6000); assert.equal(app.$('timerDigits').textContent, '01:48');
    app.$('timerReset').click(); assert.equal(app.$('timerDigits').textContent, '02:00'); assert.equal(app.$('timerFields').disabled, false);
    assert.equal(JSON.parse(app.window.localStorage.getItem('gestionboxeur:tools:v1')).design, 'classic');
    app.$('toolsBack').click(); assert.equal(app.$('toolsMenu').hidden, false);
  } finally { await app.close(); }
});

test('leaving a timer pauses it and selecting another tool preserves its progress', async () => {
  const app = fixture({ sound: false });
  try {
    app.ui.select('boxing'); app.$('timerStart').click(); app.advance(2000);
    app.$('toolsBack').click(); app.advance(90000);
    app.ui.select('steps'); app.ui.select('boxing');
    assert.equal(app.$('timerDigits').textContent, '00:08'); assert.equal(app.$('timerStart').textContent, 'Reprendre');
    assert.equal(app.$('timerState').textContent, 'En pause');
  } finally { await app.close(); }
});

test('interval timer accepts custom effort, zero rest and repetition count', async () => {
  const app = fixture({ sound: false });
  try {
    app.ui.select('intervals');
    const form = app.$('timerForm');
    form.elements.rounds.value = '2'; form.elements.work.value = '3'; form.elements.rest.value = '0'; form.elements.preparation.value = '0';
    app.$('timerStart').click(); app.advance(3500);
    assert.equal(app.$('timerRound').textContent, 'Intervalle 2 / 2'); assert.equal(app.$('timerDigits').textContent, '00:03');
    app.advance(2500); assert.equal(app.$('timerPhase').textContent, 'TERMINÉ'); assert.equal(app.$('timerStart').textContent, 'Recommencer');
  } finally { await app.close(); }
});

test('both corners register simultaneous pointers once each, with separate undo and keyboard input', async () => {
  const app = fixture();
  try {
    app.ui.select('punches');
    const blue = app.$('blueAdd'), red = app.$('redAdd');
    blue.dispatchEvent(new app.window.PointerEvent('pointerdown', { pointerId: 1, pointerType: 'touch', isPrimary: true, bubbles: true }));
    red.dispatchEvent(new app.window.PointerEvent('pointerdown', { pointerId: 2, pointerType: 'touch', isPrimary: false, bubbles: true }));
    blue.dispatchEvent(new app.window.MouseEvent('click', { detail: 1 }));
    red.dispatchEvent(new app.window.MouseEvent('click', { detail: 1 }));
    assert.equal(app.$('blueCount').textContent, '1'); assert.equal(app.$('redCount').textContent, '1');
    app.$('blueUndo').click(); assert.equal(app.$('blueCount').textContent, '0'); assert.equal(app.$('redCount').textContent, '1');
    red.click(); assert.equal(app.$('redCount').textContent, '2');
    blue.dispatchEvent(new app.window.PointerEvent('pointercancel', { pointerId: 1 }));
    assert.equal(blue.classList.contains('is-pressed'), false);
    app.$('punchReset').click(); assert.equal(app.$('redCount').textContent, '0'); assert.equal(app.$('redUndo').disabled, true);
  } finally { await app.close(); }
});

test('step button reports cadence without duplicate generated clicks and starts a new measure', async () => {
  const app = fixture();
  try {
    app.ui.select('steps'); app.$('stepTap').click(); app.advance(500); app.$('stepTap').click();
    assert.equal(app.$('stepCount').textContent, '2'); assert.equal(app.$('stepCadence').textContent, '120');
    app.$('stepReset').click(); assert.equal(app.$('stepCount').textContent, '0'); assert.equal(app.$('stepCadence').textContent, '—');
  } finally { await app.close(); }
});

test('fullscreen has an in-page fallback and Escape restores the page', async () => {
  const app = fixture();
  try {
    app.ui.select('boxing'); app.$('toolDetail').requestFullscreen = undefined;
    app.$('toolFullscreen').click();
    assert.equal(app.$('toolDetail').classList.contains('is-expanded'), true);
    assert.equal(app.$('toolFullscreen').getAttribute('aria-pressed'), 'true');
    app.window.document.dispatchEvent(new app.window.KeyboardEvent('keydown', { key: 'Escape' }));
    assert.equal(app.$('toolDetail').classList.contains('is-expanded'), false);
    assert.equal(app.window.document.body.classList.contains('tools-expanded'), false);
  } finally { await app.close(); }
});

test('an invalid saved duration cannot break the timer', async () => {
  const app = fixture({ boxing: { rounds: -4, work: 120, rest: 30, preparation: 0 }, intervals: { rounds: 4, work: '<script>', rest: 10, preparation: 0 } });
  try { app.ui.select('boxing'); assert.equal(app.$('timerForm').elements.rounds.value, '3'); app.ui.select('intervals'); assert.equal(app.$('timerForm').elements.work.value, '45'); }
  finally { await app.close(); }
});
