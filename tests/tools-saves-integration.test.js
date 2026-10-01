import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Window } from 'happy-dom';
import { mountTools } from '../js/tools.js';
import { createDemoToolStore } from '../js/tool-saves.js';

const html = await readFile(new URL('../tools.html', import.meta.url), 'utf8');
const settle = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const basePayload = { mode: 'base', config: { rounds: 2, series: 2, work: 90, rest: 15, seriesRest: 120, preparation: 5, warning: false }, units: { work: 'M', rest: 'S', seriesRest: 'M', preparation: 'S' } };
function fixture(options = {}) {
  const window = new Window({ url: 'https://example.test/tools.html', settings: { disableJavaScriptEvaluation: true, disableJavaScriptFileLoading: true, disableCSSFileLoading: true } });
  window.document.write(html);
  window.localStorage.setItem('gestionboxeur:tools:v1', JSON.stringify({ sound: false }));
  let time = 0, closed = false;
  const store = options.toolStore || createDemoToolStore();
  const root = window.document.getElementById('toolsApp');
  const ui = mountTools(root, { now: () => time, autoTick: false, toolStore: store, ...options });
  return {
    window, root, ui, store, $: id => window.document.getElementById(id),
    action: name => root.querySelector(`[data-preset-action="${name}"]`),
    advance(ms) { time += ms; ui.tick(); },
    async close() { if (!closed) { closed = true; ui.destroy(); await window.happyDOM.abort(); } },
  };
}
function configure(app, values) {
  const form = app.$('timerForm');
  for (const [name, value] of Object.entries(values)) form.elements[name].value = String(value);
  form.dispatchEvent(new app.window.Event('change', { bubbles: true }));
}
function custom(app, text) {
  app.$('timerModeAdvanced').click();
  app.$('timerProgramText').value = text;
  app.$('timerProgramText').dispatchEvent(new app.window.Event('input', { bubbles: true }));
}
async function save(app, title) {
  app.action('open-save').click();
  const form = app.$('timerPresets').querySelector('form');
  form.querySelector('input').value = title;
  form.dispatchEvent(new app.window.Event('submit', { bubbles: true, cancelable: true }));
  await settle();
}
async function load(app, title) {
  app.action('open-load').click(); await settle();
  const row = [...app.$('timerPresets').querySelectorAll('.timer-presets-item')].find(item => item.querySelector('strong').textContent === title);
  assert.ok(row, `saved timer ${title} is listed`);
  row.querySelector('[data-preset-action="load"]').click(); await settle();
}

test('real timer saves Base with M/S units and Advanced separately; loading each preserves the other draft and remains playable', async () => {
  const app = fixture();
  try {
    app.ui.select('intervals');
    const { warning, ...config } = basePayload.config;
    configure(app, config);
    for (const name of ['work', 'seriesRest']) app.root.querySelector(`[data-duration="${name}"][data-unit="M"]`).click();
    assert.equal(app.$('timerForm').elements.work.value, '1.5');
    await save(app, 'Base 90 secondes');
    const savedBase = (await app.store.listTimers())[0];
    assert.deepEqual(savedBase.payload, basePayload);
    const advancedText = '2x\n- 2s @ Z3\n- 1s @ Repos';
    custom(app, advancedText); await save(app, 'Avancé court');
    assert.deepEqual((await app.store.listTimers())[0].payload, { mode: 'advanced', text: advancedText });
    custom(app, '- 4s @ Z4');
    await load(app, 'Base 90 secondes');
    assert.equal(app.$('timerModeBase').getAttribute('aria-selected'), 'true');
    assert.equal(app.$('timerForm').elements.work.value, '1.5');
    assert.equal(app.root.querySelector('[data-duration="work"][data-unit="M"]').getAttribute('aria-pressed'), 'true');
    assert.equal(app.$('timerForm').elements.seriesRest.value, '2');
    app.$('timerModeAdvanced').click(); assert.equal(app.$('timerProgramText').value, '- 4s @ Z4');
    app.$('timerModeBase').click(); configure(app, { rounds: 3, work: 1 });
    await load(app, 'Avancé court');
    assert.equal(app.$('timerModeAdvanced').getAttribute('aria-selected'), 'true');
    assert.equal(app.$('timerProgramText').value, advancedText);
    app.$('timerModeBase').click();
    assert.equal(app.$('timerForm').elements.rounds.value, '3');
    assert.equal(app.$('timerForm').elements.work.value, '1');
    assert.equal(app.root.querySelector('[data-duration="work"][data-unit="M"]').getAttribute('aria-pressed'), 'true');
    app.$('timerModeAdvanced').click(); app.$('timerStart').click();
    assert.equal(app.$('timerBoard').dataset.status, 'running'); assert.equal(app.$('timerPhase').textContent, 'Z3');
    app.advance(2000); assert.equal(app.$('timerPhase').textContent, 'REPOS');
    app.advance(1000); assert.equal(app.$('timerPhase').textContent, 'Z3');
    app.advance(3000); assert.equal(app.$('timerPhase').textContent, 'TERMINÉ');
    assert.equal((await app.store.listTimers()).length, 2, 'loading and playing do not create extra saves');
  } finally { await app.close(); }
});

test('save and load controls, including already-open rows, remain locked during running and pause', async () => {
  const app = fixture();
  try {
    await app.store.saveTimer({ title: 'Base enregistrée', payload: basePayload });
    app.ui.select('intervals'); configure(app, { preparation: 0, work: 30 });
    app.action('open-load').click(); await settle();
    app.$('timerStart').click(); app.advance(5000);
    for (const action of ['open-save', 'open-load', 'load', 'delete']) assert.equal(app.action(action).disabled, true);
    app.action('load').dispatchEvent(new app.window.Event('click')); await settle();
    assert.equal(app.$('timerDigits').textContent, '00:25');
    app.$('timerStart').click();
    assert.equal(app.$('timerBoard').dataset.status, 'paused');
    assert.equal(app.action('open-save').disabled, true); assert.equal(app.action('load').disabled, true);
    app.action('load').dispatchEvent(new app.window.Event('click')); await settle();
    assert.equal(app.$('timerForm').elements.work.value, '30');
    app.$('timerReset').click(); assert.equal(app.action('load').disabled, false);
    app.action('load').click(); await settle(); assert.equal(app.$('timerForm').elements.work.value, '1.5');
    app.action('open-save').click();
    assert.equal(app.$('timerPresets').querySelector('input').maxLength, 100);
    app.$('timerStart').click();
    assert.equal(app.action('save').disabled, true);
    app.$('timerPresets').querySelector('form').dispatchEvent(new app.window.Event('submit', { bubbles: true, cancelable: true })); await settle();
    assert.equal((await app.store.listTimers()).length, 1);
  } finally { await app.close(); }
});

test('pending preset list and save completions cannot affect another tool after switching', async () => {
  const listGate = deferred(), saveGate = deferred(), demo = createDemoToolStore();
  const store = { ...demo, listTimers: () => listGate.promise, saveTimer: async row => { await saveGate.promise; return demo.saveTimer(row); } };
  const app = fixture({ toolStore: store });
  try {
    app.ui.select('intervals'); app.action('open-load').click();
    const oldOpen = app.action('open-save');
    app.ui.select('steps'); listGate.resolve([{ id: 'one', title: 'Tardif', payload: basePayload }]); await settle();
    assert.equal(app.$('toolTitle').textContent, 'Compteur de pas'); assert.equal(app.$('timerPresets'), null);
    oldOpen.dispatchEvent(new app.window.Event('click')); assert.equal(app.$('timerPresets'), null);
    app.ui.select('intervals');
    app.action('open-save').click(); const form = app.$('timerPresets').querySelector('form');
    form.querySelector('input').value = 'Enregistrement lancé';
    form.dispatchEvent(new app.window.Event('submit', { bubbles: true, cancelable: true }));
    app.ui.select('punches'); saveGate.resolve(); await settle();
    assert.equal(app.$('toolTitle').textContent, 'Compteur de coups'); assert.ok(app.$('blueAdd'));
    assert.equal(app.$('toolNotice').textContent, ''); assert.equal(app.$('timerPresets'), null);
    assert.equal((await demo.listTimers()).length, 1, 'an already-submitted save completes without remounting its old UI');
  } finally { await app.close(); }
});

test('lazy bulletin loading is cancelled on tool changes or teardown and only the current board is mounted', async () => {
  const pending = [], mounts = [], disposed = [];
  const app = fixture({ loadBulletin: () => new Promise(resolve => pending.push(resolve)) });
  const module = { mountBulletinBoard(host, { store }) {
    mounts.push({ host, store }); host.textContent = 'Babillard prêt';
    return { destroy() { disposed.push(host); } };
  } };
  try {
    app.ui.select('bulletin'); assert.match(app.$('toolStage').textContent, /Ouverture/);
    app.ui.select('steps'); pending[0](module); await settle();
    assert.equal(mounts.length, 0); assert.ok(app.$('stepTap'));
    app.ui.select('bulletin'); app.ui.select('bulletin');
    pending[1](module); await settle(); assert.equal(mounts.length, 0);
    pending[2](module); await settle(); assert.equal(mounts.length, 1);
    assert.equal(mounts[0].store, app.store); assert.equal(app.$('toolStage').textContent, 'Babillard prêt');
    app.ui.select('intervals'); assert.equal(disposed.length, 1);
    app.ui.select('bulletin'); await app.close(); pending[3](module); await settle();
    assert.equal(mounts.length, 1); assert.equal(disposed.length, 1);
  } finally { await app.close(); }
});

test('declining the unsaved-board warning preserves the current tool and its notes', async () => {
  let allowed = false, destroyed = 0;
  const app = fixture({ loadBulletin: async () => ({ mountBulletinBoard(host) {
    host.textContent = 'Mes notes non enregistrées';
    return { canLeave: () => allowed, destroy() { destroyed++; } };
  } }) });
  try {
    app.ui.select('bulletin'); await settle();
    app.ui.select(null);
    assert.equal(app.$('toolTitle').textContent, 'Babillard');
    assert.equal(app.$('toolStage').textContent, 'Mes notes non enregistrées');
    assert.equal(destroyed, 0);
    app.ui.select('intervals'); assert.equal(destroyed, 0);
    allowed = true; app.ui.select('intervals');
    assert.equal(destroyed, 1); assert.ok(app.$('timerStart'));
  } finally { await app.close(); }
});
