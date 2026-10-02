import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Window } from 'happy-dom';
import { mountTools } from '../js/tools.js';
import { effortAppearance } from '../js/session-chart.js';
import { compileTimerText } from '../js/timer-program.js';
import { makePhases } from '../js/tools-engine.js';

const html = await readFile(new URL('../tools.html', import.meta.url), 'utf8');
const preferenceKey = 'gestionboxeur:tools:v1';
const draftKey = owner => `gestionboxeur:timer-program:v1:${owner}`;
const storageWith = (saved = {}) => {
  const entries = new Map([[preferenceKey, JSON.stringify({ sound: false, ...saved })]]);
  return { getItem: key => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, String(value)) };
};
function fixture({ storage = storageWith(), ownerId } = {}) {
  const window = new Window({ url: 'https://example.test/tools.html', settings: { disableJavaScriptEvaluation: true, disableJavaScriptFileLoading: true, disableCSSFileLoading: true } });
  window.document.write(html);
  let time = 0;
  const root = window.document.getElementById('toolsApp');
  const ui = mountTools(root, { now: () => time, autoTick: false, storage, ...(ownerId ? { ownerId } : {}) });
  return { window, ui, storage, $: id => window.document.getElementById(id), advance: ms => { time += ms; ui.tick(); }, async close() { ui.destroy(); await window.happyDOM.abort(); } };
}
const change = (app, element) => element.dispatchEvent(new app.window.Event('change', { bubbles: true }));
const input = (app, element) => element.dispatchEvent(new app.window.Event('input', { bubbles: true }));
function configure(app, values) {
  const form = app.$('timerForm');
  for (const [name, value] of Object.entries(values)) form.elements[name].value = String(value);
  change(app, form);
}
function custom(app, text) {
  app.$('timerModeAdvanced').click();
  app.$('timerProgramText').value = text;
  input(app, app.$('timerProgramText'));
}
const boardColor = app => app.$('timerBoard').style.getPropertyValue('--interval-color');
const unitButton = (app, name, unit) => app.window.document.querySelector(`[data-duration="${name}"][data-unit="${unit}"]`);
const schedule = phases => phases.map(({ kind, seconds }) => [kind, seconds]);
const assertGeneratedMatchesBase = app => assert.deepEqual(schedule(compileTimerText(app.$('timerProgramText').value).phases), schedule(makePhases(JSON.parse(app.storage.getItem(preferenceKey)).intervals)));

test('classic lamps appear green, warning, red from left to right and follow round transitions', async () => {
  const app = fixture({ storage: storageWith({ design: 'classic', boxing: { rounds: 2, work: 120, rest: 30, preparation: 0, warning: true } }) });
  try {
    app.ui.select('boxing');
    const board = app.$('timerBoard');
    assert.deepEqual([...board.querySelectorAll('.classic-fallback-lights .beacon')].map(lamp => [...lamp.classList].find(name => name !== 'beacon')), ['work', 'warning', 'rest']);
    assert.deepEqual([...board.querySelectorAll('.classic-legend [data-lamp]')].map(lamp => lamp.dataset.lamp), ['work', 'warning', 'rest']);
    app.$('timerStart').click();
    assert.equal(board.dataset.phase, 'work'); assert.equal(board.dataset.warning, 'false');
    app.advance(90000);
    assert.equal(board.dataset.phase, 'work'); assert.equal(board.dataset.warning, 'true');
    app.advance(30000);
    assert.equal(board.dataset.phase, 'rest'); assert.equal(board.dataset.warning, 'false');
    app.advance(30000);
    assert.equal(board.dataset.phase, 'work'); assert.equal(board.dataset.warning, 'false');
  } finally { await app.close(); }
});

test('infinite boxing persists in the unified round selector and progresses beyond the previous fixed count', async () => {
  const storage = storageWith({ boxing: { rounds: 1, work: 120, rest: 30, preparation: 0, warning: false } });
  const app = fixture({ storage });
  try {
    app.ui.select('boxing');
    configure(app, { rounds: 0 });
    assert.equal(app.$('timerForm').elements.rounds.disabled, false);
    assert.equal(app.$('timerForm').elements.rounds.value, '0');
    assert.equal(app.$('timerRound').textContent, 'Round 1 / ∞');
    assert.match(app.$('timerSummary').textContent, /Rounds infinis/);
    assert.equal(JSON.parse(storage.getItem(preferenceKey)).boxing.infinite, true);
    app.$('timerStart').click(); app.advance(150000);
    assert.equal(app.$('timerRound').textContent, 'Round 2 / ∞');
    assert.equal(app.$('timerState').textContent, 'En cours');
    assert.equal(app.$('timerDigits').textContent, '02:00');
  } finally { await app.close(); }
  const reopened = fixture({ storage });
  try {
    reopened.ui.select('boxing');
    assert.equal(reopened.$('timerForm').elements.rounds.value, '0');
    assert.equal(reopened.$('timerForm').elements.rounds.disabled, false);
    configure(reopened, { rounds: 1 });
    assert.equal(reopened.$('timerForm').elements.rounds.disabled, false);
    reopened.$('timerStart').click(); reopened.advance(120000);
    assert.equal(reopened.$('timerPhase').textContent, 'TERMINÉ');
  } finally { await reopened.close(); }
});

test('basic intervals default to one series and hide its unused recovery controls on first load and reload', async () => {
  const storage = storageWith();
  for (let visit = 0; visit < 2; visit++) {
    const app = fixture({ storage });
    try {
      app.ui.select('intervals');
      assert.equal(app.$('timerForm').elements.series.value, '1');
      assert.equal(app.$('interval-seriesRest-row').hidden, true);
      assert.equal(app.$('timerForm').elements.seriesRest.disabled, true);
      for (const unit of ['M', 'S']) assert.equal(unitButton(app, 'seriesRest', unit).disabled, true);
      assert.equal(app.$('timerStart').disabled, false);
      assert.equal(app.$('timerSeries').hidden, true);
      configure(app, { preparation: 0 });
      assert.equal(JSON.parse(storage.getItem(preferenceKey)).intervals.series, 1);
    } finally { await app.close(); }
  }
});

test('changing series immediately reveals or hides recovery while preserving its duration and M/S unit', async () => {
  const storage = storageWith(), app = fixture({ storage });
  try {
    app.ui.select('intervals');
    const form = app.$('timerForm');
    form.elements.series.value = '2'; input(app, form.elements.series);
    assert.equal(app.$('interval-seriesRest-row').hidden, false);
    assert.equal(form.elements.seriesRest.disabled, false);
    for (const unit of ['M', 'S']) assert.equal(unitButton(app, 'seriesRest', unit).disabled, false);
    configure(app, { seriesRest: 90 });
    unitButton(app, 'seriesRest', 'M').click();
    assert.equal(form.elements.seriesRest.value, '1.5');
    form.elements.series.value = '1'; input(app, form.elements.series);
    assert.equal(app.$('interval-seriesRest-row').hidden, true);
    assert.equal(form.elements.seriesRest.disabled, true);
    assert.equal(form.elements.seriesRest.value, '1.5');
    assert.equal(unitButton(app, 'seriesRest', 'M').getAttribute('aria-pressed'), 'true');
    assert.equal(JSON.parse(storage.getItem(preferenceKey)).intervals.seriesRest, 90);
  } finally { await app.close(); }
  const reopened = fixture({ storage });
  try {
    reopened.ui.select('intervals');
    const form = reopened.$('timerForm');
    assert.equal(form.elements.series.value, '1');
    assert.equal(reopened.$('interval-seriesRest-row').hidden, true);
    assert.equal(form.elements.seriesRest.value, '1.5');
    form.elements.series.value = '3'; input(reopened, form.elements.series);
    assert.equal(reopened.$('interval-seriesRest-row').hidden, false);
    assert.equal(form.elements.seriesRest.disabled, false);
    assert.equal(form.elements.seriesRest.value, '1.5');
    assert.equal(unitButton(reopened, 'seriesRest', 'M').getAttribute('aria-pressed'), 'true');
    assert.equal(JSON.parse(storage.getItem(preferenceKey)).intervals.seriesRest, 90);
  } finally { await reopened.close(); }
});

test('an invalid interseries recovery does not block a single-series timer but must be corrected when relevant again', async () => {
  const app = fixture();
  try {
    app.ui.select('intervals');
    configure(app, { rounds: 1, series: 2, work: 5, rest: 0, seriesRest: 30, preparation: 0 });
    configure(app, { seriesRest: '' });
    assert.equal(app.$('timerStart').disabled, true);
    const form = app.$('timerForm');
    form.elements.series.value = '1'; input(app, form.elements.series);
    assert.equal(app.$('interval-seriesRest-row').hidden, true);
    assert.equal(app.$('timerStart').disabled, false);
    assert.equal(JSON.parse(app.storage.getItem(preferenceKey)).intervals.seriesRest, 30);
    form.elements.series.value = '2'; input(app, form.elements.series);
    assert.equal(app.$('interval-seriesRest-row').hidden, false);
    assert.equal(form.elements.seriesRest.value, '');
    assert.equal(app.$('timerStart').disabled, true);
    form.elements.series.value = '1'; input(app, form.elements.series);
    app.$('timerStart').click(); app.advance(5000);
    assert.equal(app.$('timerPhase').textContent, 'TERMINÉ');
  } finally { await app.close(); }
});

test('basic intervals show series and gray recovery, replacing ordinary rest between series', async () => {
  const app = fixture();
  try {
    app.ui.select('intervals');
    assert.equal(app.$('timerAdvancedPanel').hidden, true);
    assert.equal(app.$('timerModeBase').getAttribute('aria-selected'), 'true');
    configure(app, { rounds: 2, series: 2, work: 3, rest: 1, seriesRest: 5, preparation: 0 });
    assert.equal(app.$('timerSeries').textContent, 'Série 1 / 2');
    assert.equal(app.$('timerSeries').hidden, false);
    assert.match(app.$('timerSummary').textContent, /Total 00:19/);
    app.$('timerStart').click();
    assert.equal(boardColor(app), '#25a567');
    app.advance(3000);
    assert.equal(app.$('timerPhase').textContent, 'REPOS');
    assert.equal(boardColor(app), '#a3a9b2');
    app.advance(1000);
    assert.equal(app.$('timerRound').textContent, 'Intervalle 2 / 2');
    assert.match(app.$('timerNext').textContent, /Repos entre séries · 00:05/);
    app.advance(3000);
    assert.equal(app.$('timerPhase').textContent, 'REPOS ENTRE SÉRIES');
    assert.equal(app.$('timerDigits').textContent, '00:05');
    assert.equal(boardColor(app), '#a3a9b2');
    app.advance(5000);
    assert.equal(app.$('timerSeries').textContent, 'Série 2 / 2');
    assert.equal(app.$('timerRound').textContent, 'Intervalle 1 / 2');
    assert.equal(app.$('timerPhase').textContent, 'TRAVAIL');
    app.advance(7000);
    assert.equal(app.$('timerPhase').textContent, 'TERMINÉ');
    assert.equal(app.$('timerNext').textContent, 'Séance terminée');
    const saved = JSON.parse(app.storage.getItem(preferenceKey)).intervals;
    assert.equal(saved.series, 2); assert.equal(saved.seriesRest, 5);
  } finally { await app.close(); }
});

test('custom programs block empty or untimed commands, recover after correction and preserve basic settings', async () => {
  const app = fixture();
  try {
    app.ui.select('intervals');
    configure(app, { rounds: 2, series: 3, work: 12, rest: 4, seriesRest: 8, preparation: 0 });
    custom(app, '');
    assert.equal(app.$('timerStart').disabled, true);
    assert.equal(app.$('timerDigits').textContent, '—');
    assert.equal(app.$('timerProgramError').hidden, false);
    assert.equal(app.$('timerBasePanel').hidden, true);
    custom(app, '- 500mtr @ Z3');
    assert.equal(app.$('timerStart').disabled, true);
    app.$('timerStart').click(); app.advance(9000);
    assert.equal(app.$('timerState').textContent, 'Prêt à démarrer');
    assert.match(app.$('timerProgramError').textContent, /durée|distance/);
    custom(app, '2x\n- 3s @ Z3\n- 1s @ Repos');
    assert.equal(app.$('timerStart').disabled, false);
    assert.equal(app.$('timerProgramError').hidden, true);
    assert.match(app.$('timerSummary').textContent, /4 étapes/);
    app.$('timerModeBase').click();
    assert.equal(app.$('timerBasePanel').hidden, false);
    assert.equal(app.$('timerForm').elements.work.value, '12');
    assert.equal(app.$('timerForm').elements.series.value, '3');
    assert.match(app.$('timerSummary').textContent, /2 répétitions × 3 séries/);
    assert.match(app.$('timerProgramText').value, /2x/);
  } finally { await app.close(); }
});

test('custom current and next intensities follow the existing palette and explicit rests turn gray', async () => {
  const app = fixture();
  try {
    app.ui.select('intervals'); configure(app, { preparation: 0 });
    custom(app, '2x\n- 3s @ Z3\n- 2s @ Z4\n- 1s @ Repos');
    app.$('timerStart').click();
    const zoneColor = zone => effortAppearance({ effort: { kind: 'zone', min: zone, max: zone } }).color;
    assert.equal(app.$('timerPhase').textContent, 'Z3');
    assert.equal(boardColor(app), zoneColor(3));
    assert.equal(app.$('timerNext').textContent, 'Ensuite : Z4 · 00:02');
    app.advance(3000);
    assert.equal(app.$('timerPhase').textContent, 'Z4');
    assert.equal(boardColor(app), zoneColor(4));
    assert.equal(app.$('timerNext').textContent, 'Ensuite : Repos · 00:01');
    app.advance(2000);
    assert.equal(app.$('timerPhase').textContent, 'REPOS');
    assert.equal(boardColor(app), '#a3a9b2');
    assert.equal(app.$('timerNext').textContent, 'Ensuite : Z3 · 00:03');
    app.advance(1000);
    assert.match(app.$('timerSeries').textContent, /Répétition 2 \/ 2/);
    assert.equal(app.$('timerRound').textContent, 'Étape 4 / 6');
    app.advance(6000);
    assert.equal(app.$('timerPhase').textContent, 'TERMINÉ');
  } finally { await app.close(); }
});

test('running and paused custom programs lock all editing until reset', async () => {
  const app = fixture({ ownerId: 'coach-a' });
  const original = '- 20s @ Z3\n- 10s @ Repos';
  try {
    app.ui.select('intervals'); configure(app, { preparation: 0 }); custom(app, original);
    app.$('timerStart').click(); app.advance(2000);
    assert.equal(app.$('timerProgramText').disabled, true);
    assert.equal(app.$('timerModeBase').disabled, true);
    assert.equal(app.$('timerModeAdvanced').disabled, true);
    assert.equal(app.$('timerFields').disabled, true);
    app.$('timerStart').click();
    assert.equal(app.$('timerState').textContent, 'En pause');
    assert.equal(app.$('timerProgramText').disabled, true);
    app.$('timerProgramText').value = '- 1s @ Z5'; input(app, app.$('timerProgramText'));
    assert.equal(JSON.parse(app.storage.getItem(draftKey('coach-a'))).text, original, 'even synthetic edits while locked cannot change the saved program');
    app.ui.select('steps'); app.ui.select('intervals');
    assert.equal(app.$('timerProgramText').value, original);
    assert.equal(app.$('timerDigits').textContent, '00:18');
    assert.equal(app.$('timerProgramText').disabled, true);
    app.$('timerReset').click();
    assert.equal(app.$('timerProgramText').disabled, false);
    assert.equal(app.$('timerFields').disabled, true, 'base fields are inactive while Advanced is selected');
    assert.equal(app.$('timerModeBase').disabled, false);
    custom(app, '- 5s @ Z4');
    assert.equal(app.$('timerDigits').textContent, '00:05');
  } finally { await app.close(); }
});

test('custom drafts survive reload only for their owner and keep private text out of common preferences', async () => {
  const storage = storageWith();
  const first = fixture({ storage, ownerId: 'coach-a' });
  try {
    first.ui.select('intervals'); configure(first, { preparation: 0 });
    custom(first, '2x\n- 5s @ Z3\n- 2s @ Repos');
  } finally { await first.close(); }
  const second = fixture({ storage, ownerId: 'coach-b' });
  try {
    second.ui.select('intervals');
    assert.equal(second.$('timerModeBase').getAttribute('aria-selected'), 'true');
    assertGeneratedMatchesBase(second);
    assert.doesNotMatch(second.$('timerProgramText').value, /@ Z3/);
    custom(second, '- 7s @ Z4');
  } finally { await second.close(); }
  const reopened = fixture({ storage, ownerId: 'coach-a' });
  try {
    reopened.ui.select('intervals');
    assert.equal(reopened.$('timerModeAdvanced').getAttribute('aria-selected'), 'true');
    assert.equal(reopened.$('timerProgramText').value, '2x\n- 5s @ Z3\n- 2s @ Repos');
    assert.equal(reopened.$('timerAdvancedPanel').hidden, false);
    assert.equal(reopened.$('timerStart').disabled, false);
    assert.equal(reopened.$('timerDigits').textContent, '00:05');
    assert.doesNotMatch(storage.getItem(preferenceKey), /@ Z3|@ Z4|2x/);
    assert.equal(JSON.parse(storage.getItem(draftKey('coach-b'))).text, '- 7s @ Z4');
  } finally { await reopened.close(); }
});

test('an invalid draft stays blocked after reload and cannot replay the last valid program', async () => {
  const storage = storageWith(), app = fixture({ storage, ownerId: 'coach-a' });
  try {
    app.ui.select('intervals'); configure(app, { preparation: 0 });
    custom(app, '- 10s @ Z3');
    assert.equal(app.$('timerStart').disabled, false);
    custom(app, '- 1km @ Z3');
    assert.equal(app.$('timerStart').disabled, true);
    assert.equal(app.$('timerNext').textContent, '');
  } finally { await app.close(); }
  const reopened = fixture({ storage, ownerId: 'coach-a' });
  try {
    reopened.ui.select('intervals');
    assert.equal(reopened.$('timerModeAdvanced').getAttribute('aria-selected'), 'true');
    assert.equal(reopened.$('timerProgramText').value, '- 1km @ Z3');
    assert.equal(reopened.$('timerStart').disabled, true);
    assert.equal(reopened.$('timerPhase').textContent, 'RÉGLAGES À CORRIGER');
    assert.equal(reopened.$('timerProgramError').hidden, false);
    // Even direct event dispatch bypassing a disabled button is revalidated.
    reopened.$('timerStart').dispatchEvent(new reopened.window.MouseEvent('click', { bubbles: true }));
    reopened.advance(60000);
    assert.equal(reopened.$('timerState').textContent, 'Prêt à démarrer');
    reopened.$('timerModeBase').click();
    assert.equal(reopened.$('timerStart').disabled, false);
    reopened.$('timerStart').click();
    assert.equal(reopened.$('timerState').textContent, 'En cours');
  } finally { await reopened.close(); }
});

test('advanced text starts as an exact base copy including preparation and follows until edited', async () => {
  const app = fixture();
  try {
    app.ui.select('intervals');
    assert.match(app.$('timerProgramText').value, /^- 5s @ Préparation/);
    assertGeneratedMatchesBase(app);
    for (let pass = 0; pass < 3; pass++) {
      app.$('timerModeAdvanced').click();
      assert.equal(app.$('timerAdvancedPanel').hidden, false);
      assert.equal(app.$('timerDigits').textContent, '00:05');
      assert.equal(JSON.parse(app.storage.getItem(draftKey('local'))).edited, false, 'visiting Advanced alone does not detach its draft');
      app.$('timerModeBase').click();
    }
    configure(app, { rounds: 3, series: 2, work: 12, rest: 4, seriesRest: 8, preparation: 7 });
    assertGeneratedMatchesBase(app);
    const generated = app.$('timerProgramText').value;
    app.$('timerModeAdvanced').click();
    assert.equal(app.$('timerProgramText').value, generated);
    assert.equal(app.$('timerDigits').textContent, '00:07');
    assert.equal(app.$('timerPhase').textContent, 'PRÉPARATION');
    app.$('timerStart').click(); app.advance(7000);
    assert.equal(app.$('timerDigits').textContent, '00:12');
    assert.equal(app.$('timerPhase').textContent, 'Travail');
  } finally { await app.close(); }
});

test('manual advanced edits become independent while base settings remain directly accessible', async () => {
  const app = fixture();
  const program = '- 9s @ Z4\n- 2s @ Repos';
  try {
    app.ui.select('intervals');
    configure(app, { rounds: 2, work: 20, rest: 3, series: 2, seriesRest: 7, preparation: 5 });
    custom(app, program);
    assert.equal(app.$('timerDigits').textContent, '00:09', 'advanced commands have no invisible inherited preparation');
    app.$('timerModeBase').click();
    assert.equal(app.$('timerFields').disabled, false);
    assert.equal(app.$('timerForm').elements.work.value, '20');
    assert.equal(app.$('timerDigits').textContent, '00:05');
    configure(app, { rounds: 4, work: 60, preparation: 10 });
    assert.equal(app.$('timerProgramText').value, program);
    app.$('timerModeAdvanced').click();
    assert.equal(app.$('timerDigits').textContent, '00:09');
    assert.equal(app.$('timerProgramText').value, program);
    app.$('timerModeBase').click();
    assert.equal(app.$('timerForm').elements.rounds.value, '4');
    assert.equal(app.$('timerForm').elements.work.value, '60');
    assert.equal(app.$('timerForm').elements.preparation.value, '10');
    assert.deepEqual(JSON.parse(app.storage.getItem(draftKey('local'))), { custom: false, text: program, edited: true });
    app.ui.select('steps'); app.ui.select('intervals');
    assert.equal(app.$('timerModeBase').getAttribute('aria-selected'), 'true');
    assert.equal(app.$('timerProgramText').value, program);
  } finally { await app.close(); }
});

test('invalid advanced text remains intact while Base can still start its saved session', async () => {
  const app = fixture();
  try {
    app.ui.select('intervals'); configure(app, { rounds: 1, work: 5, preparation: 0 });
    custom(app, '- 1km @ Z3');
    assert.equal(app.$('timerStart').disabled, true);
    app.$('timerModeBase').click();
    assert.equal(app.$('timerStart').disabled, false);
    assert.equal(app.$('timerDigits').textContent, '00:05');
    assert.equal(app.$('timerProgramText').value, '- 1km @ Z3');
    app.$('timerStart').click(); app.advance(5000);
    assert.equal(app.$('timerState').textContent, 'Bien joué !');
    app.$('timerModeAdvanced').click();
    assert.equal(app.$('timerProgramText').value, '- 1km @ Z3');
    assert.equal(app.$('timerStart').disabled, true);
  } finally { await app.close(); }
});

test('M/S controls are independent per duration and preserve exact seconds on repeated switches', async () => {
  const app = fixture();
  try {
    app.ui.select('intervals'); configure(app, { series: 2, work: 90, rest: 45, seriesRest: 120, preparation: 7 });
    const form = app.$('timerForm'), original = app.$('timerProgramText').value;
    unitButton(app, 'work', 'M').click();
    assert.equal(form.elements.work.value, '1.5');
    assert.equal(form.elements.rest.value, '45');
    assert.equal(unitButton(app, 'rest', 'S').getAttribute('aria-pressed'), 'true');
    unitButton(app, 'rest', 'M').click();
    assert.equal(form.elements.rest.value, '0.75');
    unitButton(app, 'seriesRest', 'M').click();
    assert.equal(form.elements.seriesRest.value, '2');
    for (let pass = 0; pass < 4; pass++) {
      unitButton(app, 'preparation', 'M').click();
      assert.equal(form.elements.preparation.value, '0.116666666667');
      unitButton(app, 'preparation', 'S').click();
      assert.equal(form.elements.preparation.value, '7');
    }
    assert.equal(app.$('timerProgramText').value, original);
    assert.equal(JSON.parse(app.storage.getItem(preferenceKey)).intervals.preparation, 7);
    configure(app, { work: 0.5, rest: 0.25, seriesRest: 1.5 });
    assert.deepEqual(JSON.parse(app.storage.getItem(preferenceKey)).intervalUnits, { work: 'M', rest: 'M', seriesRest: 'M', preparation: 'S' });
    const saved = JSON.parse(app.storage.getItem(preferenceKey)).intervals;
    assert.equal(saved.work, 30); assert.equal(saved.rest, 15); assert.equal(saved.seriesRest, 90);
    assertGeneratedMatchesBase(app);
    unitButton(app, 'work', 'S').click();
    assert.equal(form.elements.work.value, '30');
    assert.equal(form.elements.rest.value, '0.25');
  } finally { await app.close(); }
});

test('invalid base durations cannot be rounded, converted or started and correction recovers', async () => {
  const app = fixture();
  try {
    app.ui.select('intervals');
    const work = app.$('timerForm').elements.work;
    for (const invalid of ['', '-1', '1.5', '3601']) {
      configure(app, { work: invalid });
      assert.equal(app.$('timerStart').disabled, true, invalid);
      unitButton(app, 'work', 'M').click();
      assert.equal(unitButton(app, 'work', 'S').getAttribute('aria-pressed'), 'true');
      assert.equal(work.value, invalid);
      assert.ok(work.validationMessage);
    }
    configure(app, { work: 7 });
    assert.equal(app.$('timerStart').disabled, false);
    unitButton(app, 'work', 'M').click();
    configure(app, { work: '0.116' });
    assert.equal(app.$('timerStart').disabled, true);
    unitButton(app, 'work', 'S').click();
    assert.equal(unitButton(app, 'work', 'M').getAttribute('aria-pressed'), 'true');
    configure(app, { work: '0.116666666667', preparation: 61 });
    assert.equal(app.$('timerStart').disabled, true);
    configure(app, { preparation: 0 });
    assert.equal(app.$('timerStart').disabled, false);
    app.$('timerStart').click();
    assert.equal(app.$('timerDigits').textContent, '00:07');
  } finally { await app.close(); }
});

test('reload preserves units, independent drafts and selected mode without inherited advanced preparation', async () => {
  const storage = storageWith(), first = fixture({ storage, ownerId: 'coach-a' });
  const program = '- 1s @ Z4';
  try {
    first.ui.select('intervals'); configure(first, { series: 2, work: 90, rest: 45, seriesRest: 120, preparation: 7 });
    for (const name of ['work', 'rest', 'preparation']) unitButton(first, name, 'M').click();
    custom(first, program);
    first.$('timerModeBase').click();
  } finally { await first.close(); }
  const second = fixture({ storage, ownerId: 'coach-a' });
  try {
    second.ui.select('intervals');
    assert.equal(second.$('timerModeBase').getAttribute('aria-selected'), 'true');
    for (const [name, value] of [['work', '1.5'], ['rest', '0.75'], ['seriesRest', '120'], ['preparation', '0.116666666667']]) assert.equal(second.$('timerForm').elements[name].value, value);
    assert.equal(second.$('timerProgramText').value, program);
    second.$('timerModeAdvanced').click();
    assert.equal(second.$('timerDigits').textContent, '00:01');
  } finally { await second.close(); }
  const third = fixture({ storage, ownerId: 'coach-a' });
  try {
    third.ui.select('intervals');
    assert.equal(third.$('timerModeAdvanced').getAttribute('aria-selected'), 'true');
    assert.equal(third.$('timerDigits').textContent, '00:01');
    assert.equal(third.$('timerProgramText').value, program);
    assert.equal(unitButton(third, 'work', 'M').getAttribute('aria-pressed'), 'true');
  } finally { await third.close(); }
});

test('legacy custom drafts migrate their preparation visibly once and stay independent', async () => {
  const storage = storageWith({ intervals: { preparation: 5 } });
  storage.setItem(draftKey('coach-a'), JSON.stringify({ custom: true, text: '- 8s @ Z3' }));
  const first = fixture({ storage, ownerId: 'coach-a' });
  try {
    first.ui.select('intervals');
    assert.equal(first.$('timerProgramText').value, '- 5s @ Préparation\n\n- 8s @ Z3');
    assert.equal(first.$('timerDigits').textContent, '00:05');
    assert.equal(first.$('timerPhase').textContent, 'PRÉPARATION');
    assert.equal(JSON.parse(storage.getItem(draftKey('coach-a'))).edited, true);
    first.$('timerModeBase').click(); configure(first, { preparation: 10 });
    first.$('timerModeAdvanced').click();
    assert.equal(first.$('timerDigits').textContent, '00:05');
  } finally { await first.close(); }
  const reopened = fixture({ storage, ownerId: 'coach-a' });
  try {
    reopened.ui.select('intervals');
    assert.equal(reopened.$('timerProgramText').value, '- 5s @ Préparation\n\n- 8s @ Z3');
    assert.equal(compileTimerText(reopened.$('timerProgramText').value).totalSeconds, 13);
    reopened.$('timerStart').click(); reopened.advance(5000);
    assert.equal(reopened.$('timerDigits').textContent, '00:08');
  } finally { await reopened.close(); }
});

test('keyboard mode navigation is reversible without editing, and locks during running and pause', async () => {
  const app = fixture();
  try {
    app.ui.select('intervals');
    const key = (element, value) => element.dispatchEvent(new app.window.KeyboardEvent('keydown', { key: value, bubbles: true }));
    key(app.$('timerModeBase'), 'ArrowRight');
    assert.equal(app.$('timerModeAdvanced').getAttribute('aria-selected'), 'true');
    assert.equal(app.window.document.activeElement, app.$('timerModeAdvanced'));
    key(app.$('timerModeAdvanced'), 'Home');
    assert.equal(app.$('timerModeBase').getAttribute('aria-selected'), 'true');
    assert.equal(JSON.parse(app.storage.getItem(draftKey('local'))).edited, false);
    app.$('timerStart').click();
    key(app.$('timerModeBase'), 'End');
    assert.equal(app.$('timerModeBase').getAttribute('aria-selected'), 'true');
    assert.equal(app.$('timerFields').disabled, true);
    app.$('timerStart').click();
    assert.equal(app.$('timerModeAdvanced').disabled, true);
    key(app.$('timerModeBase'), 'ArrowRight');
    assert.equal(app.$('timerModeBase').getAttribute('aria-selected'), 'true');
    app.$('timerReset').click();
    key(app.$('timerModeBase'), 'End');
    assert.equal(app.$('timerModeAdvanced').getAttribute('aria-selected'), 'true');
  } finally { await app.close(); }
});

test('base sessions beyond advanced parser limits remain playable without silent truncation', async () => {
  const app = fixture();
  try {
    app.ui.select('intervals'); configure(app, { rounds: 99, series: 99, work: 1, rest: 1, seriesRest: 2, preparation: 0 });
    assert.equal(app.$('timerStart').disabled, false);
    assert.equal(app.$('timerProgramText').value, '');
    app.$('timerModeAdvanced').click();
    assert.equal(app.$('timerStart').disabled, true);
    assert.match(app.$('timerProgramError').textContent, /mode Base.*réglages/);
    app.$('timerModeBase').click();
    assert.equal(app.$('timerStart').disabled, false);
    app.$('timerStart').click(); app.advance(1000);
    assert.equal(app.$('timerState').textContent, 'En cours');
    assert.equal(app.$('timerPhase').textContent, 'REPOS');
  } finally { await app.close(); }
});
