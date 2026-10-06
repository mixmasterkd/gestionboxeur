import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Window } from 'happy-dom';
import { mountTools } from '../js/tools.js';

const html = await readFile(new URL('../tools.html', import.meta.url), 'utf8');
const preferenceKey = 'gestionboxeur:tools:v1';
const legacyBoxing = { rounds: 7, work: 120, rest: 30, preparation: 5, warning: false };
function storageWith(boxing) {
  const entries = new Map([[preferenceKey, JSON.stringify({ sound: false, boxing })]]);
  return { getItem: key => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, String(value)) };
}
function fixture(storage = storageWith(legacyBoxing)) {
  const window = new Window({ url: 'https://example.test/tools.html', settings: { disableJavaScriptEvaluation: true, disableJavaScriptFileLoading: true, disableCSSFileLoading: true } });
  window.document.write(html); window.confirm = () => true;
  let time = 0;
  const ui = mountTools(window.document.getElementById('toolsApp'), { now: () => time, autoTick: false, storage });
  ui.select('boxing');
  return {
    window, ui, storage, $: id => window.document.getElementById(id),
    advance: milliseconds => { time += milliseconds; ui.tick(); },
    async close() { ui.destroy(); await window.happyDOM.abort(); },
  };
}
function configure(app, values) {
  const form = app.$('timerForm');
  for (const [name, value] of Object.entries(values)) {
    if (name === 'warning') form.elements[name].checked = value;
    else form.elements[name].value = String(value);
  }
  form.dispatchEvent(new app.window.Event('change', { bubbles: true }));
}
const savedBoxing = app => JSON.parse(app.storage.getItem(preferenceKey)).boxing;

test('boxing settings use four menus with one round selector for infinity or 1–99 rounds', async () => {
  const app = fixture();
  try {
    const form = app.$('timerForm');
    assert.deepEqual([...form.querySelectorAll('select')].map(select => select.name), ['rounds', 'work', 'rest', 'preparation']);
    assert.equal(form.querySelector('[name="roundMode"]'), null);
    assert.equal(form.querySelector('input[type="number"]'), null);
    const rounds = form.elements.rounds;
    assert.equal(rounds.tagName, 'SELECT');
    assert.deepEqual([...rounds.options].map(option => option.value), Array.from({ length: 100 }, (_, value) => String(value)));
    assert.equal(rounds.options[0].textContent.trim(), 'Infini');
    assert.equal(rounds.value, '7');
    assert.equal(rounds.disabled, false);
    assert.equal(app.$('timerFields').disabled, false);
    assert.equal(form.elements.warning.type, 'checkbox');
    assert.match(form.elements.warning.closest('label').textContent, /30/);
  } finally { await app.close(); }
});

test('compact boxing duration menus keep their seconds values and display explicit min/sec units', async () => {
  const app = fixture();
  try {
    const form = app.$('timerForm');
    const expected = { work: ['120', '180'], rest: ['30', '60'], preparation: ['0', '5', '10', '15', '30', '60'] };
    for (const [name, values] of Object.entries(expected)) {
      assert.deepEqual([...form.elements[name].options].map(option => option.value), values);
      for (const option of form.elements[name].options) {
        if (option.value === '0') continue;
        assert.match(option.textContent.trim(), /^\d+\s+(?:min|sec)$/, `${name}: ${option.textContent}`);
      }
    }
    configure(app, { work: 180, rest: 60, preparation: 10 });
    assert.deepEqual({ work: savedBoxing(app).work, rest: savedBoxing(app).rest, preparation: savedBoxing(app).preparation }, { work: 180, rest: 60, preparation: 10 });
    app.$('timerStart').click();
    assert.equal(app.$('timerDigits').textContent, '00:10');
    app.advance(10000);
    assert.equal(app.$('timerDigits').textContent, '03:00');
    assert.equal(app.$('timerBoard').dataset.phase, 'work');
    app.advance(180000);
    assert.equal(app.$('timerDigits').textContent, '01:00');
    assert.equal(app.$('timerBoard').dataset.phase, 'rest');
  } finally { await app.close(); }
});

test('legacy finite settings without an infinite flag survive opening and persistence', async () => {
  const storage = storageWith(legacyBoxing);
  for (let visit = 0; visit < 2; visit++) {
    const app = fixture(storage);
    try {
      assert.equal(app.$('timerForm').elements.rounds.value, '7');
      assert.equal(app.$('timerRound').textContent, 'Round 1 / 7');
      assert.equal(app.$('timerForm').elements.work.value, '120');
      assert.equal(app.$('timerForm').elements.preparation.value, '5');
      configure(app, { warning: false });
      assert.deepEqual(savedBoxing(app), { ...legacyBoxing, infinite: false });
    } finally { await app.close(); }
  }
});

test('legacy infinity selects Infini without replacing the stored previous fixed count with zero', async () => {
  const storage = storageWith({ ...legacyBoxing, infinite: true });
  for (let visit = 0; visit < 2; visit++) {
    const app = fixture(storage);
    try {
      assert.equal(app.$('timerForm').elements.rounds.value, '0');
      assert.equal(app.$('timerForm').elements.rounds.disabled, false);
      assert.equal(app.$('timerRound').textContent, 'Round 1 / ∞');
      configure(app, { preparation: 0 });
      assert.equal(savedBoxing(app).rounds, 7);
      assert.equal(savedBoxing(app).infinite, true);
      app.$('timerStart').click(); app.advance(8 * 150000);
      assert.equal(app.$('timerRound').textContent, 'Round 9 / ∞');
      assert.equal(app.$('timerState').textContent, 'En cours');
    } finally { await app.close(); }
  }
});

test('switching fixed count to Infini and back persists the chosen finite count and completion', async () => {
  const storage = storageWith(legacyBoxing);
  const app = fixture(storage);
  try {
    configure(app, { rounds: 0 });
    assert.equal(savedBoxing(app).rounds, 7);
    assert.equal(savedBoxing(app).infinite, true);
    configure(app, { rounds: 2, preparation: 0 });
    assert.equal(savedBoxing(app).rounds, 2);
    assert.equal(savedBoxing(app).infinite, false);
    assert.equal(app.$('timerRound').textContent, 'Round 1 / 2');
    configure(app, { rounds: 0 });
    assert.equal(savedBoxing(app).rounds, 2);
    assert.equal(savedBoxing(app).infinite, true);
    configure(app, { rounds: 1 });
    app.$('timerStart').click(); app.advance(120000);
    assert.equal(app.$('timerPhase').textContent, 'TERMINÉ');
    assert.equal(app.$('timerRound').textContent, 'Round 1 / 1');
    assert.equal(app.$('timerFields').disabled, false);
  } finally { await app.close(); }
  const reopened = fixture(storage);
  try {
    assert.equal(reopened.$('timerForm').elements.rounds.value, '1');
    assert.equal(reopened.$('timerRound').textContent, 'Round 1 / 1');
    assert.equal(savedBoxing(reopened).infinite, false);
  } finally { await reopened.close(); }
});

test('infinite boxing locks the common fieldset while running or paused and reset makes all settings usable', async () => {
  const app = fixture(storageWith({ ...legacyBoxing, infinite: true, preparation: 0 }));
  try {
    const rounds = app.$('timerForm').elements.rounds;
    assert.equal(rounds.value, '0');
    assert.equal(rounds.disabled, false);
    app.$('timerStart').click(); app.advance(6000);
    assert.equal(app.$('timerFields').disabled, true);
    assert.equal(rounds.disabled, false, 'locking comes from the fieldset, not an infinity-specific disabled flag');
    assert.equal(app.$('timerDigits').textContent, '01:54');
    app.$('timerStart').click(); app.advance(300000);
    assert.equal(app.$('timerState').textContent, 'En pause');
    assert.equal(app.$('timerFields').disabled, true);
    assert.equal(app.$('timerDigits').textContent, '01:54');
    app.$('timerStart').click(); app.advance(4000);
    assert.equal(app.$('timerDigits').textContent, '01:50');
    app.$('timerReset').click();
    assert.equal(app.$('timerState').textContent, 'Prêt à démarrer');
    assert.equal(app.$('timerFields').disabled, false);
    assert.equal(rounds.disabled, false);
    assert.equal(rounds.value, '0');
    assert.equal(app.$('timerDigits').textContent, '02:00');
    configure(app, { rounds: 3 });
    assert.equal(app.$('timerRound').textContent, 'Round 1 / 3');
    assert.equal(savedBoxing(app).infinite, false);
  } finally { await app.close(); }
});

test('warning checkbox still controls the last thirty seconds after changing the unified round menu', async () => {
  const app = fixture();
  try {
    configure(app, { rounds: 0, preparation: 0, warning: true });
    app.$('timerStart').click(); app.advance(90000);
    assert.equal(app.$('timerBoard').dataset.warning, 'true');
    assert.equal(app.$('timerPhase').textContent, 'DERNIÈRES 30 SECONDES');
    app.advance(30000);
    assert.equal(app.$('timerBoard').dataset.phase, 'rest');
    assert.equal(app.$('timerBoard').dataset.warning, 'false');
    app.$('timerReset').click();
    configure(app, { rounds: 1, warning: false });
    app.$('timerStart').click(); app.advance(90000);
    assert.equal(app.$('timerDigits').textContent, '00:30');
    assert.equal(app.$('timerBoard').dataset.warning, 'false');
    assert.equal(app.$('timerPhase').textContent, 'BOXE');
  } finally { await app.close(); }
});
