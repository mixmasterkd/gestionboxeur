import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Window } from 'happy-dom';
import { RoundTimer, StepCounter, makePhases, formatTime, timerCue } from '../js/tools-engine.js';
import { mountTools } from '../js/tools.js';

const html = await readFile(new URL('../tools.html', import.meta.url), 'utf8');
function fixture(saved, { setupWindow = () => {}, ...options } = {}) {
  const window = new Window({ url: 'https://example.test/tools.html', settings: { disableJavaScriptEvaluation: true, disableJavaScriptFileLoading: true, disableCSSFileLoading: true } });
  window.document.write(html); window.confirm = () => true;
  setupWindow(window);
  if (saved) window.localStorage.setItem('gestionboxeur:tools:v1', JSON.stringify(saved));
  let time = 0;
  const root = window.document.getElementById('toolsApp');
  const ui = mountTools(root, { now: () => time, autoTick: false, ...options });
  return { window, ui, $: id => window.document.getElementById(id), advance: ms => { time += ms; ui.tick(); }, async close() { ui.destroy(); await window.happyDOM.abort(); } };
}
const settle = () => new Promise(resolve => setImmediate(resolve));
const change = (app, element) => element.dispatchEvent(new app.window.Event('change', { bubbles: true }));
const selectDesign = (app, design) => { app.$('timerDesign').value = design; change(app, app.$('timerDesign')); };
const boxingConfig = { rounds: 2, work: 120, rest: 30, preparation: 10, warning: true };

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
    app.ui.navigate({ tool: 'boxing' });
    assert.equal(app.$('toolDetail').hidden, false); assert.equal(app.$('toolTitle').textContent, 'Timer de boxe');
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
    app.ui.navigate({ tool: 'steps' }); assert.ok(app.$('stepTap'));
  } finally { await app.close(); }
});

test('leaving a timer pauses it and selecting another tool preserves its progress', async () => {
  const app = fixture({ sound: false });
  try {
    app.ui.select('boxing'); app.$('timerStart').click(); app.advance(2000);
    app.ui.navigate({ tool: 'steps' }); app.advance(90000);
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

test('modern timer exposes preparation, round, optional warning, rest and completion without stale warning state', async () => {
  const app = fixture({ sound: false, boxing: boxingConfig });
  try {
    app.ui.select('boxing');
    const board = app.$('timerBoard');
    assert.equal(board.dataset.design, 'boxing');
    assert.equal(board.dataset.phase, 'prepare'); assert.equal(board.dataset.warning, 'false');
    app.$('timerStart').click(); app.advance(10000);
    assert.equal(board.dataset.phase, 'work'); assert.equal(board.dataset.warning, 'false');
    app.advance(90000);
    assert.equal(board.dataset.warning, 'true'); assert.equal(app.$('timerPhase').textContent, 'DERNIÈRES 30 SECONDES');
    app.advance(30000);
    assert.equal(board.dataset.phase, 'rest'); assert.equal(board.dataset.warning, 'false');
    app.advance(30000);
    assert.equal(board.dataset.phase, 'work'); assert.equal(board.dataset.warning, 'false');
    app.advance(120000);
    assert.equal(board.dataset.phase, 'done'); assert.equal(board.dataset.warning, 'false');
    app.$('timerReset').click();
    assert.equal(board.dataset.phase, 'prepare'); assert.equal(board.dataset.status, 'idle');
    app.$('timerForm').elements.warning.checked = false;
    change(app, app.$('timerForm'));
    app.$('timerStart').click(); app.advance(100000);
    assert.equal(board.dataset.phase, 'work'); assert.equal(app.$('timerDigits').textContent, '00:30');
    assert.equal(board.dataset.warning, 'false'); assert.equal(app.$('timerPhase').textContent, 'BOXE');
  } finally { await app.close(); }
});

test('classic duration buttons synchronize the form, honor their bounds and persist across reopening', async () => {
  const app = fixture({ sound: false, design: 'classic' });
  let saved;
  try {
    app.ui.select('boxing');
    const button = (name, direction) => app.$('toolsApp').querySelector(`[data-adjust="${name}"][data-direction="${direction}"]`);
    assert.equal(button('work', 1).disabled, true);
    button('work', -1).click(); button('rest', -1).click();
    assert.equal(app.$('timerForm').elements.work.value, '120'); assert.equal(app.$('classicworkValue').textContent, '2 min');
    assert.equal(app.$('timerForm').elements.rest.value, '30'); assert.equal(app.$('classicrestValue').textContent, '30 sec');
    assert.equal(button('work', -1).disabled, true); assert.equal(button('rest', -1).disabled, true);
    assert.equal(button('work', 1).disabled, false);
    button('work', -1).click(); assert.equal(app.$('timerForm').elements.work.value, '120');
    button('rest', 1).click(); assert.equal(app.$('timerForm').elements.rest.value, '60');
    app.$('timerForm').elements.rest.value = '30'; change(app, app.$('timerForm'));
    assert.equal(app.$('classicrestValue').textContent, '30 sec');
    saved = JSON.parse(app.window.localStorage.getItem('gestionboxeur:tools:v1'));
    assert.equal(saved.boxing.work, 120); assert.equal(saved.boxing.rest, 30);
  } finally { await app.close(); }
  const reopened = fixture(saved);
  try {
    reopened.ui.select('boxing');
    assert.equal(reopened.$('timerBoard').dataset.design, 'classic');
    assert.equal(reopened.$('classicworkValue').textContent, '2 min');
    assert.equal(reopened.$('classicrestValue').textContent, '30 sec');
  } finally { await reopened.close(); }
});

test('classic settings are locked while running and paused, including direct 3D callbacks', async () => {
  let controls;
  const states = [];
  const app = fixture({ sound: false, design: 'classic', boxing: { ...boxingConfig, preparation: 0 } }, {
    setupWindow: window => { window.WebGL2RenderingContext = class {}; },
    loadClassicScene: async () => ({ createClassicTimerScene: (host, callbacks) => {
      controls = callbacks; return { update: state => states.push(state), destroy() {} };
    } }),
  });
  try {
    app.ui.select('boxing'); await settle();
    controls.onAdjust('work', 1);
    assert.equal(app.$('timerForm').elements.work.value, '180');
    app.$('timerStart').click(); app.advance(6000);
    assert.ok([...app.$('toolsApp').querySelectorAll('[data-adjust]')].every(button => button.disabled));
    controls.onAdjust('work', -1); controls.onAdjust('rest', 1);
    assert.equal(app.$('timerForm').elements.work.value, '180'); assert.equal(app.$('timerForm').elements.rest.value, '30');
    app.$('timerStart').click(); controls.onAdjust('work', -1);
    assert.equal(app.$('timerForm').elements.work.value, '180');
    assert.equal(states.at(-1).status, 'paused');
    app.$('timerReset').click(); controls.onAdjust('work', -1);
    assert.equal(app.$('timerForm').elements.work.value, '120');
  } finally { await app.close(); }
});

test('changing timer appearance during a round preserves elapsed time and disposes the scene', async () => {
  let disposed = 0;
  const states = [];
  const app = fixture({ sound: false, boxing: { ...boxingConfig, preparation: 0 } }, {
    setupWindow: window => { window.WebGL2RenderingContext = class {}; },
    loadClassicScene: async () => ({ createClassicTimerScene: () => ({ update: state => states.push(state), destroy() { disposed++; } }) }),
  });
  try {
    app.ui.select('boxing'); app.$('timerStart').click(); app.advance(6000);
    selectDesign(app, 'classic'); await settle();
    assert.equal(app.$('timerDigits').textContent, '01:54'); assert.equal(app.$('timerBoard').dataset.status, 'running');
    assert.equal(states.at(-1).status, 'running');
    app.advance(4000); selectDesign(app, 'boxing');
    assert.equal(app.$('timerDigits').textContent, '01:50'); assert.equal(disposed, 1);
    assert.equal(app.$('timerStart').textContent, 'Pause');
  } finally { await app.close(); }
});

test('classic remains usable when WebGL is unavailable or its scene cannot load', async () => {
  for (const webgl of [false, true]) {
    let loads = 0;
    const app = fixture({ sound: false, design: 'classic' }, {
      setupWindow: window => { window.WebGL2RenderingContext = webgl ? class {} : undefined; },
      loadClassicScene: async () => { loads++; throw new Error('WebGL unavailable'); },
    });
    try {
      app.ui.select('boxing'); await settle();
      assert.equal(loads, webgl ? 1 : 0);
      assert.equal(app.$('classicViewport').dataset.render, 'fallback');
      assert.match(app.$('classicRenderStatus').textContent, /3D est indisponible/);
      app.$('toolsApp').querySelector('[data-adjust="work"][data-direction="-1"]').click();
      app.$('timerStart').click(); app.advance(11000);
      assert.equal(app.$('timerDigits').textContent, '01:59');
      assert.equal(app.$('timerBoard').dataset.phase, 'work');
    } finally { await app.close(); }
  }
});

test('late scene loads cannot mount after a design change, tool exit or destruction', async () => {
  const pending = [];
  let mounted = 0, disposed = 0;
  const module = { createClassicTimerScene: () => { mounted++; return { update() {}, destroy() { disposed++; } }; } };
  const app = fixture({ sound: false, design: 'classic' }, {
    setupWindow: window => { window.WebGL2RenderingContext = class {}; },
    loadClassicScene: () => new Promise(resolve => pending.push(resolve)),
  });
  let closed = false;
  try {
    app.ui.select('boxing'); assert.equal(pending.length, 1);
    selectDesign(app, 'boxing'); pending[0](module); await settle(); assert.equal(mounted, 0);
    selectDesign(app, 'classic'); assert.equal(pending.length, 2);
    app.ui.select('steps'); pending[1](module); await settle(); assert.equal(mounted, 0);
    app.ui.select('boxing'); pending[2](module); await settle();
    assert.equal(mounted, 1); assert.equal(app.$('classicViewport').dataset.render, 'ready');
    selectDesign(app, 'boxing'); assert.equal(disposed, 1);
    selectDesign(app, 'classic'); assert.equal(pending.length, 4);
    await app.close(); closed = true;
    pending[3](module); await settle(); assert.equal(mounted, 1); assert.equal(disposed, 1);
  } finally { if (!closed) await app.close(); }
});

test('a delayed audio unlock cannot ring for a cancelled start after the timer restarts', async () => {
  const pending = [], strikes = [];
  const parameter = () => ({ value: 1, setValueAtTime() {}, exponentialRampToValueAtTime() {} });
  const node = type => ({ frequency: parameter(), gain: parameter(), connect() {}, disconnect() {}, stop() {}, start(at) { if (type === 'impact') strikes.push(at); } });
  class DelayedAudio {
    constructor() { this.state = 'suspended'; this.sampleRate = 48000; this.currentTime = 0; this.destination = {}; }
    createGain() { return node('gain'); }
    createOscillator() { return node('oscillator'); }
    createBufferSource() { return node('impact'); }
    createBuffer(channels, length, rate) { return { duration: length / rate, getChannelData: () => new Float32Array(length) }; }
    resume() { return new Promise(resolve => pending.push(() => { this.state = 'running'; resolve(); })); }
    async close() { this.state = 'closed'; }
  }
  const app = fixture({ boxing: { ...boxingConfig, preparation: 0 } }, { setupWindow: window => { window.AudioContext = DelayedAudio; } });
  try {
    app.ui.select('boxing'); app.$('timerStart').click();
    app.$('timerReset').click(); app.$('timerStart').click();
    assert.equal(pending.length, 2);
    pending[0](); await settle();
    assert.equal(strikes.length, 0, 'the old start must stay cancelled, even though the new timer is running');
    pending[1](); await settle();
    assert.equal(strikes.length, 3, 'only the current start should ring');
  } finally { await app.close(); }
});
