import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { mountTimerPresets } from '../js/timer-presets.js';

const settle = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const base = () => ({ mode: 'base', config: { rounds: 5, series: 2, work: 60, rest: 15, seriesRest: 90, preparation: 5, warning: false }, units: { work: 'M', rest: 'S', seriesRest: 'S', preparation: 'S' } });
const advanced = () => ({ mode: 'advanced', text: '3x\n- 2m Z3\n- 30s Z1' });
function fixture(options = {}) {
  const window = new Window({ url: 'https://example.test/tools.html', settings: { disableJavaScriptEvaluation: true, disableCSSFileLoading: true } });
  const host = window.document.createElement('div'); window.document.body.append(host);
  const calls = { saves: [], loads: [], deletes: [], lists: 0 };
  let locked = false;
  const store = {
    async listTimers() { calls.lists++; return []; },
    async saveTimer(row) { calls.saves.push(row); return { ...row, id: 'new' }; },
    async deleteTimer(id) { calls.deletes.push(id); },
    ...options.store,
  };
  const ui = mountTimerPresets(host, {
    store: options.store === null ? null : store, getPreset: options.getPreset || base,
    applyPreset: options.applyPreset || (payload => { calls.loads.push(payload); }), isLocked: () => locked,
  });
  const find = action => host.querySelector(`[data-preset-action="${action}"]`);
  const submit = (name = 'Ma séance') => {
    const input = host.querySelector('input'); input.value = name;
    host.querySelector('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  };
  return { window, host, ui, calls, find, submit, setLocked(value) { locked = value; ui.sync(); }, async close() { ui.destroy(); await window.happyDOM.abort(); } };
}

test('save captures only the foreground mode, trims its title and prevents duplicate in-flight submissions', async () => {
  const gate = deferred(), payload = base(), saved = [];
  const app = fixture({ getPreset: () => payload, store: { saveTimer(row) { saved.push(row); return gate.promise; } } });
  try {
    app.find('open-save').click(); app.submit('  Fractionné du mardi  '); app.submit('Doublon');
    assert.equal(saved.length, 1); assert.equal(saved[0].title, 'Fractionné du mardi');
    assert.deepEqual(saved[0].payload, payload);
    assert.equal(app.host.querySelector('.timer-presets').getAttribute('aria-busy'), 'true');
    assert.equal(app.find('save').disabled, true);
    payload.config.work = 120;
    assert.equal(saved[0].payload.config.work, 60, 'the pending save keeps its own settings snapshot');
    gate.resolve({ id: 'saved' }); await settle();
    assert.equal(app.host.querySelector('form').hidden, true);
    assert.match(app.host.querySelector('[role="status"]').textContent, /Fractionné du mardi.*enregistré.*Base/);
    assert.equal(app.find('open-save').disabled, false);
  } finally { await app.close(); }
});

test('advanced save contains its text only, and invalid names or timer configurations never reach storage', async () => {
  let valid = false;
  const app = fixture({ getPreset() { if (!valid) throw new Error('Ligne 2 : durée invalide.'); return advanced(); } });
  try {
    app.find('open-save').click(); app.submit('   ');
    assert.match(app.host.querySelector('[role="alert"]').textContent, /titre/);
    assert.equal(app.calls.saves.length, 0);
    app.submit('Intervalles avancés'); await settle();
    assert.match(app.host.querySelector('[role="alert"]').textContent, /Ligne 2/);
    assert.equal(app.calls.saves.length, 0);
    valid = true; app.submit('Intervalles avancés'); await settle();
    assert.deepEqual(app.calls.saves[0], { title: 'Intervalles avancés', payload: advanced() });
  } finally { await app.close(); }
});

test('load lists safe titles and modes, then applies an isolated payload', async () => {
  const maliciousTitle = '<img src=x onerror="alert(1)">';
  const rows = [{ id: 'one', title: maliciousTitle, payload: base() }, { id: 'two', title: 'Sacs', payload: advanced() }];
  const app = fixture({ store: { async listTimers() { return rows; } } });
  try {
    app.find('open-load').click(); await settle();
    assert.equal(app.host.querySelector('img'), null);
    assert.equal(app.host.querySelector('strong').textContent, maliciousTitle);
    assert.deepEqual([...app.host.querySelectorAll('.timer-presets-mode')].map(node => node.textContent), ['Base', 'Avancé']);
    app.find('load').click(); await settle();
    assert.equal(app.calls.loads.length, 1); assert.deepEqual(app.calls.loads[0], base());
    app.calls.loads[0].config.work = 300;
    assert.equal(rows[0].payload.config.work, 60);
    assert.equal(app.host.querySelector('[aria-label="Liste des timers enregistrés"]').hidden, true);
  } finally { await app.close(); }
});

test('deletion requires confirmation, is cancellable and prevents duplicate requests', async () => {
  const gate = deferred(), deleted = [];
  const app = fixture({ store: {
    async listTimers() { return [{ id: 'one', title: 'Sacs', payload: advanced() }]; },
    deleteTimer(id) { deleted.push(id); return gate.promise; },
  } });
  try {
    app.find('open-load').click(); await settle(); app.find('delete').click();
    assert.equal(deleted.length, 0); assert.equal(app.window.document.activeElement, app.find('confirm-delete'));
    app.find('cancel-delete').click(); assert.equal(deleted.length, 0); assert.equal(app.find('confirm-delete'), null);
    app.find('delete').click(); app.find('confirm-delete').click();
    app.find('confirm-delete').dispatchEvent(new app.window.Event('click'));
    assert.deepEqual(deleted, ['one']);
    gate.resolve(); await settle();
    assert.equal(app.host.querySelectorAll('.timer-presets-item').length, 0);
    assert.match(app.host.textContent, /Aucun timer enregistré/);
    assert.match(app.host.querySelector('[role="status"]').textContent, /supprimé/);
  } finally { await app.close(); }
});

test('running or paused state blocks actions even when a pending list finishes after locking', async () => {
  const gate = deferred();
  const app = fixture({ store: { listTimers: () => gate.promise } });
  try {
    app.setLocked(true);
    assert.equal(app.find('open-save').disabled, true); assert.equal(app.find('open-load').disabled, true);
    app.find('open-save').dispatchEvent(new app.window.Event('click'));
    assert.equal(app.host.querySelector('form').hidden, true);
    app.setLocked(false); app.find('open-load').click(); app.setLocked(true);
    gate.resolve([{ id: 'one', title: 'Rounds', payload: base() }]); await settle();
    assert.equal(app.find('load').disabled, true); assert.equal(app.find('delete').disabled, true);
    app.find('load').dispatchEvent(new app.window.Event('click')); await settle();
    assert.equal(app.calls.loads.length, 0);
    app.setLocked(false); app.find('load').click(); await settle(); assert.equal(app.calls.loads.length, 1);
    app.find('open-save').click(); app.setLocked(true); app.submit(); await settle();
    assert.equal(app.calls.saves.length, 0);
  } finally { await app.close(); }
});

test('list, save and delete errors remain visible and support retry without losing the form or row', async () => {
  let failList = true, failSave = true, failDelete = true;
  const app = fixture({ store: {
    async listTimers() { if (failList) throw new Error('Connexion interrompue.'); return [{ id: 'one', title: 'Rounds', payload: base() }]; },
    async saveTimer() { if (failSave) throw new Error('Enregistrement impossible.'); },
    async deleteTimer() { if (failDelete) throw new Error('Suppression impossible.'); },
  } });
  try {
    app.find('open-load').click(); await settle();
    assert.equal(app.find('retry').hidden, false); assert.match(app.host.querySelector('[role="alert"]').textContent, /Connexion/);
    failList = false; app.find('retry').click(); await settle(); assert.equal(app.host.querySelectorAll('.timer-presets-item').length, 1);
    app.find('delete').click(); app.find('confirm-delete').click(); await settle();
    assert.match(app.host.querySelector('[role="alert"]').textContent, /Suppression/); assert.equal(app.host.querySelectorAll('.timer-presets-item').length, 1);
    failDelete = false; app.find('confirm-delete').click(); await settle(); assert.equal(app.host.querySelectorAll('.timer-presets-item').length, 0);
    app.find('open-save').click(); app.submit('Conserver ce titre'); await settle();
    assert.match(app.host.querySelector('[role="alert"]').textContent, /Enregistrement/);
    assert.equal(app.host.querySelector('input').value, 'Conserver ce titre'); assert.equal(app.find('save').disabled, false);
    failSave = false; app.submit('Conserver ce titre'); await settle(); assert.equal(app.host.querySelector('form').hidden, true);
  } finally { await app.close(); }
});

test('invalid saved payloads report apply errors without closing the list', async () => {
  const app = fixture({ applyPreset() { throw new Error('Durée invalide dans ce timer.'); }, store: { async listTimers() { return [{ id: 'one', title: 'Ancien timer', payload: { mode: 'base' } }]; } } });
  try {
    app.find('open-load').click(); await settle(); app.find('load').click(); await settle();
    assert.match(app.host.querySelector('[role="alert"]').textContent, /Durée invalide/);
    assert.equal(app.host.querySelector('[aria-label="Liste des timers enregistrés"]').hidden, false);
    assert.equal(app.find('load').disabled, false);
  } finally { await app.close(); }
});

test('destroy cancels late UI updates and apply may safely remount its parent timer', async () => {
  const gate = deferred();
  const app = fixture({ store: { listTimers: () => gate.promise } });
  app.find('open-load').click(); app.ui.destroy(); gate.resolve([{ id: 'one', title: 'Tardif', payload: base() }]); await settle();
  assert.equal(app.host.children.length, 0); await app.close();
  const saving = deferred();
  const saveApp = fixture({ store: { saveTimer: () => saving.promise } });
  saveApp.find('open-save').click(); saveApp.submit(); saveApp.ui.destroy(); saving.reject(new Error('Trop tard')); await settle();
  assert.equal(saveApp.host.children.length, 0); await saveApp.close();
  let loads = 0;
  const remounted = fixture({ store: { async listTimers() { return [{ id: 'one', title: 'Rounds', payload: base() }]; } }, applyPreset() { loads++; remounted.ui.destroy(); } });
  remounted.find('open-load').click(); await settle(); remounted.find('load').click(); await settle();
  assert.equal(loads, 1); assert.equal(remounted.host.children.length, 0); await remounted.close();
});

test('null stores disable the library and demo stores identify their session-only lifetime', async () => {
  const unavailable = fixture({ store: null });
  try {
    assert.equal(unavailable.find('open-save').disabled, true); assert.equal(unavailable.find('open-load').disabled, true);
    assert.match(unavailable.host.textContent, /bibliothèque de timers est indisponible/);
  } finally { await unavailable.close(); }
  const app = fixture({ store: { demo: true } });
  try {
    const hint = [...app.host.querySelectorAll('.timer-presets-hint')].find(node => node.textContent.startsWith('Mode démo'));
    assert.equal(hint.hidden, false); assert.match(hint.textContent, /session uniquement/);
  } finally { await app.close(); }
});
