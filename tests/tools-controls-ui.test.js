import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Window } from 'happy-dom';
import { mountTools } from '../js/tools.js';

const html = await readFile(new URL('../tools.html', import.meta.url), 'utf8');
const settle = () => new Promise(resolve => setImmediate(resolve));
function fixture({ audio = false } = {}) {
  const window = new Window({ url: 'https://example.test/tools.html', settings: { disableJavaScriptEvaluation: true, disableJavaScriptFileLoading: true, disableCSSFileLoading: true } });
  window.document.write(html); window.confirm = () => true;
  const nodes = [];
  const parameter = () => ({ value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} });
  const node = kind => { const value = { kind, frequency: parameter(), gain: parameter(), connect() {}, disconnect() {}, start() {}, stop() {} }; nodes.push(value); return value; };
  window.AudioContext = class {
    constructor() { this.state = 'running'; this.currentTime = 0; this.sampleRate = 48000; this.destination = {}; }
    createGain() { return node('gain'); }
    createOscillator() { return node('tone'); }
    createBufferSource() { return node('impact'); }
    createBuffer(channels, length, rate) { return { duration: length / rate, getChannelData: () => new Float32Array(length) }; }
    async resume() { this.state = 'running'; }
    async close() { this.state = 'closed'; }
  };
  window.localStorage.setItem('gestionboxeur:tools:v1', JSON.stringify({ sound: audio }));
  let time = 0;
  const ui = mountTools(window.document.getElementById('toolsApp'), { autoTick: false, now: () => time });
  const $ = id => window.document.getElementById(id);
  return { window, ui, $, nodes, advance(ms) { time += ms; ui.tick(); }, change(element) { element.dispatchEvent(new window.Event('change', { bubbles: true })); }, async close() { ui.destroy(); await window.happyDOM.abort(); } };
}

test('interval controls expose two direct modes without help, calendar, enable checkbox or recognized commands', async () => {
  const app = fixture();
  try {
    app.ui.select('intervals');
    const panel = app.$('timerSettings');
    assert.equal(panel.querySelectorAll('[role="tab"]').length, 2);
    assert.equal(panel.querySelector('details'), null);
    assert.equal(panel.querySelector('input[type="checkbox"]'), null);
    for (const id of ['timerProgramPreview', 'timerCustomEnabled', 'timerCalendarLoad', 'timerImportConfirm']) assert.equal(app.$(id), null);
    assert.doesNotMatch(panel.textContent, /Aide|reconnues|calendrier/);
    app.$('timerModeAdvanced').click();
    assert.equal(app.$('timerAdvancedPanel').hidden, false);
    assert.equal(app.$('timerProgramText').hidden, false);
    assert.ok(app.$('timerProgramText').value.length > 0);
    const page = await readFile(new URL('../js/tools-page.js', import.meta.url), 'utf8');
    assert.doesNotMatch(page, /loadCalendar|createTimerCalendarSource/);
  } finally { await app.close(); }
});

test('mode tabs support the keyboard, preserve focus and cannot switch a running or paused timer', async () => {
  const app = fixture();
  try {
    app.ui.select('intervals');
    app.$('timerModeBase').focus();
    app.$('timerModeBase').dispatchEvent(new app.window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    assert.equal(app.window.document.activeElement, app.$('timerModeAdvanced'));
    assert.equal(app.$('timerModeAdvanced').getAttribute('aria-selected'), 'true');
    const text = app.$('timerProgramText').value;
    app.$('timerStart').click();
    app.$('timerModeBase').click();
    assert.equal(app.$('timerAdvancedPanel').hidden, false);
    app.$('timerStart').click(); app.$('timerModeBase').click();
    assert.equal(app.$('timerAdvancedPanel').hidden, false);
    app.$('timerReset').click(); app.$('timerModeBase').click();
    assert.equal(app.$('timerBasePanel').hidden, false);
    assert.equal(app.$('timerFields').disabled, false);
    assert.equal(app.$('timerProgramText').value, text);
  } finally { await app.close(); }
});

test('the actual interval UI routes test, preparation, transition and completion to beeps, while boxing keeps bells', async () => {
  const app = fixture({ audio: true });
  try {
    app.ui.select('intervals');
    assert.match(app.$('timerSound').parentElement.textContent, /Signaux sonores/);
    assert.doesNotMatch(app.$('toolStage').textContent, /Cloche/);
    app.$('testSound').click(); await settle();
    assert.equal(app.nodes.filter(node => node.kind === 'tone').length, 3);
    assert.equal(app.nodes.filter(node => node.kind === 'impact').length, 0);
    const form = app.$('timerForm');
    for (const [name, value] of Object.entries({ rounds: 1, work: 2, rest: 0, series: 1, preparation: 1 })) form.elements[name].value = String(value);
    app.change(form); app.$('timerStart').click(); await settle();
    assert.equal(app.nodes.filter(node => node.kind === 'tone').length, 4, 'one preparation beep');
    app.advance(1000);
    assert.equal(app.nodes.filter(node => node.kind === 'tone').length, 7, 'three work beeps');
    app.advance(2000);
    assert.equal(app.nodes.filter(node => node.kind === 'tone').length, 10, 'three completion beeps');
    assert.equal(app.nodes.filter(node => node.kind === 'impact').length, 0);
    app.ui.select('boxing');
    assert.match(app.$('timerSound').parentElement.textContent, /Cloche de ring/);
    app.$('testSound').click(); await settle();
    assert.equal(app.nodes.filter(node => node.kind === 'impact').length, 3);
  } finally { await app.close(); }
});

test('punch rounds archive both corners, survive switching tools and reset the complete session', async () => {
  const app = fixture();
  try {
    app.ui.select('punches');
    for (let index = 0; index < 23; index++) app.$('blueAdd').click();
    for (let index = 0; index < 38; index++) app.$('redAdd').click();
    app.$('punchNextRound').click();
    assert.equal(app.$('punchRound').textContent, 'Round 2');
    assert.equal(app.$('blueCount').textContent, '0'); assert.equal(app.$('redCount').textContent, '0');
    const first = app.$('punchRoundHistory').firstElementChild;
    assert.equal(first.querySelector('.punch-history-blue').textContent, '23');
    assert.equal(first.querySelector('.punch-history-red').textContent, '38');
    app.$('redAdd').click(); app.$('punchNextRound').click(); app.$('blueAdd').click();
    app.ui.select('steps'); app.ui.select('punches');
    assert.equal(app.$('punchRound').textContent, 'Round 3');
    assert.equal(app.$('punchRoundHistory').children.length, 2);
    assert.equal(app.$('blueCount').textContent, '1');
    app.$('punchReset').click();
    assert.equal(app.$('punchRound').textContent, 'Round 1');
    assert.equal(app.$('punchRoundHistory').children.length, 0);
    assert.equal(app.$('punchRoundHistoryPanel').hidden, true);
    assert.equal(app.$('blueCount').textContent, '0'); assert.equal(app.$('redCount').textContent, '0');
  } finally { await app.close(); }
});
