import { RoundTimer, StepCounter, makePhases, formatTime, timerCue } from './tools-engine.js';
import { createTimerSignals } from './timer-audio.js';
import { compileTimerText, timerEffortAppearance } from './timer-program.js';
import { intervalControlsMarkup, mountIntervalControls } from './timer-interval-controls.js';
import { basicTimerText } from './timer-interval-settings.js';
import { mountPunchCounter } from './punch-counter.js';
import { mountTimerPresets } from './timer-presets.js';
import { validateTimerPreset } from './tool-saves.js';

const preferenceKey = 'gestionboxeur:tools:v1';
const defaults = {
  boxing: { rounds: 3, work: 180, rest: 60, preparation: 10, warning: true, infinite: false },
  intervals: { rounds: 8, work: 45, rest: 15, preparation: 5, warning: false, series: 1, seriesRest: 60 },
};
const titles = { boxing: 'Timer de boxe', intervals: 'Timer à intervalles', punches: 'Compteur de coups', steps: 'Compteur de pas', bulletin: 'Babillard' };
const options = (values, selected) => values.map(([value, label]) => `<option value="${value}"${value === selected ? ' selected' : ''}>${label}</option>`).join('');

function preferences(storage) {
  const settings = { design: 'boxing', sound: true, boxing: { ...defaults.boxing }, intervals: { ...defaults.intervals }, intervalUnits: { work: 'S', rest: 'S', seriesRest: 'S', preparation: 'S' } };
  try {
    const saved = JSON.parse(storage?.getItem(preferenceKey) || 'null');
    if (saved?.design === 'classic') settings.design = 'classic';
    if (saved?.sound === false) settings.sound = false;
    for (const name of Object.keys(settings.intervalUnits)) if (saved?.intervalUnits?.[name] === 'M') settings.intervalUnits[name] = 'M';
    for (const kind of ['boxing', 'intervals']) {
      if (!saved?.[kind]) continue;
      const candidate = Object.fromEntries(Object.keys(defaults[kind]).map(key => [key, saved[kind][key] ?? defaults[kind][key]]));
      try {
        if (!['rounds', 'work', 'rest', 'preparation'].every(key => Number.isInteger(candidate[key]))) continue;
        candidate.warning = candidate.warning === true;
        makePhases(candidate);
        if (kind === 'boxing' && (![120, 180].includes(candidate.work) || ![30, 60].includes(candidate.rest) || ![0, 5, 10, 15, 30, 60].includes(candidate.preparation))) continue;
        settings[kind] = candidate;
      } catch { /* A stale or damaged preference does not prevent using the tool. */ }
    }
  } catch { /* Storage may be unavailable in a private session. */ }
  return settings;
}

/** Independent pointer streams allow both corners to be pressed at once. */
export function bindTap(button, callback) {
  const pointers = new Set();
  button.addEventListener('pointerdown', event => {
    if (event.pointerType === 'mouse' && event.button !== 0 || pointers.has(event.pointerId)) return;
    event.preventDefault();
    pointers.add(event.pointerId);
    button.classList.add('is-pressed');
    try { button.setPointerCapture(event.pointerId); } catch { /* Synthetic events and older browsers. */ }
    callback();
  });
  const release = event => { pointers.delete(event.pointerId); if (!pointers.size) button.classList.remove('is-pressed'); };
  for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) button.addEventListener(event, release);
  button.addEventListener('click', event => { if (event.detail === 0) callback(); }); // Keyboard and assistive technologies.
  button.addEventListener('contextmenu', event => event.preventDefault());
}

export function mountTools(root, { now = () => performance.now(), autoTick = true, storage, loadClassicScene = () => import('./classic-timer-scene.js'), loadBulletin = () => import('./bulletin-board.js'), ownerId = 'local', toolStore = null } = {}) {
  const doc = root.ownerDocument, view = doc.defaultView;
  const $ = id => root.querySelector(`#${id}`);
  if (storage === undefined) { try { storage = view.localStorage; } catch { storage = null; } }
  const settings = preferences(storage), timers = {};
  const draftKey = `gestionboxeur:timer-program:v1:${ownerId}`;
  let draft = { custom: false, text: '', edited: false }, advancedUI = null, intervalValid = true, intervalProgram = null, generationError = '';
  try {
    const saved = JSON.parse(storage?.getItem(draftKey) || 'null');
    if (typeof saved?.text === 'string' && saved.text.length <= 20080) {
      draft = { custom: saved.custom === true, text: saved.text, edited: typeof saved.edited === 'boolean' ? saved.edited : Boolean(saved.text) };
      // Older custom drafts kept preparation in the basic settings. Make it
      // explicit once, without discarding or replacing their original commands.
      if (saved.edited === undefined && draft.text && settings.intervals.preparation && !/^\s*-\s*[^\n]*@\s*pr[ée]paration\b/i.test(draft.text)) draft.text = `- ${settings.intervals.preparation}s @ Préparation\n\n${draft.text}`;
    }
  } catch { /* A draft never prevents access to the basic timer. */ }
  function refreshGeneratedDraft() {
    if (draft.edited) return;
    try { draft.text = basicTimerText(settings.intervals); generationError = ''; }
    catch (error) { draft.text = ''; generationError = error.message; }
    advancedUI?.setText(draft.text);
  }
  refreshGeneratedDraft();
  for (const kind of ['boxing', 'intervals']) {
    let phases = makePhases(settings[kind]);
    if (kind === 'intervals' && draft.custom) {
      try { intervalProgram = compileTimerText(draft.text); phases = intervalProgram.phases; }
      catch { intervalValid = false; }
    }
    timers[kind] = new RoundTimer(phases, now);
  }
  const steps = new StepCounter(now), scores = { blue: 0, red: 0, rounds: [] };
  let selected = null, previous = null, interval = null, destroyed = false, wake = null, wakePending = false, counterActive = false;
  let wakeNeeded = false, wakeVersion = 0;
  let classicScene = null, sceneTicket = 0, sceneHost = null;
  let audioTicket = 0;
  let presetsUI = null, bulletinUI = null, bulletinTicket = 0;
  const save = () => { try { storage?.setItem(preferenceKey, JSON.stringify(settings)); storage?.setItem(draftKey, JSON.stringify(draft)); } catch { /* Tools remain usable without storage. */ } };
  const notice = text => { if (!destroyed && $('toolNotice')) $('toolNotice').textContent = text; };
  const audio = createTimerSignals(view, () => notice('Le son est indisponible. Vérifie les réglages audio de ton navigateur et le volume du téléphone.'));
  const stopAudio = () => { audioTicket++; audio.stop(); };
  const isTimer = () => selected === 'boxing' || selected === 'intervals';
  const needsWake = () => !destroyed && doc.visibilityState !== 'hidden' && (isTimer() ? timers[selected].status === 'running' : selected && counterActive);
  async function syncWake() {
    const needed = Boolean(needsWake());
    if (needed !== wakeNeeded) { wakeNeeded = needed; wakeVersion++; }
    if (!needed) {
      if (wake) { const old = wake; wake = null; await old.release().catch(() => {}); }
      return;
    }
    if (!view.navigator.wakeLock?.request || wake || wakePending) return;
    const version = wakeVersion;
    wakePending = true;
    try {
      const acquired = await view.navigator.wakeLock.request('screen');
      if (!needsWake()) await acquired.release();
      else { wake = acquired; acquired.addEventListener('release', () => { if (wake === acquired) wake = null; }); }
    } catch { /* Availability depends on the browser, battery and device settings. */ }
    finally {
      wakePending = false;
      // A newer visible/running transition may have arrived during the request.
      // Retry only that newer demand, never a refusal or system release by itself.
      if (!wake && needsWake() && wakeVersion !== version) void syncWake();
    }
  }
  function drawTimer(state = timers[selected].snapshot()) {
    const config = settings[selected], board = $('timerBoard');
    const phase = state.status === 'done' ? 'done' : state.phase.kind;
    const custom = selected === 'intervals' && draft.custom, invalid = selected === 'intervals' && !intervalValid;
    const locked = ['running', 'paused'].includes(state.status);
    board.dataset.phase = phase;
    const warning = Boolean(state.phase.warning && state.remaining <= 30000 && ['running', 'paused'].includes(state.status));
    board.dataset.warning = String(warning);
    board.dataset.status = state.status;
    board.dataset.design = selected === 'boxing' ? settings.design : 'intervals';
    $('timerDigits').textContent = invalid ? '—' : formatTime(state.remaining);
    const unit = selected === 'boxing' ? 'Round' : 'Intervalle';
    $('timerRound').textContent = custom ? `Étape ${phase === 'prepare' ? 0 : state.phase.index || 0} / ${intervalProgram?.steps || 0}` : `${unit} ${state.status === 'done' ? config.rounds : state.phase.round} / ${config.infinite ? '∞' : config.rounds}`;
    const phaseLabel = invalid ? 'RÉGLAGES À CORRIGER' : warning ? 'DERNIÈRES 30 SECONDES' : { prepare: 'PRÉPARATION', work: selected === 'boxing' ? 'BOXE' : custom ? state.phase.label : 'TRAVAIL', rest: state.phase.seriesRest ? 'REPOS ENTRE SÉRIES' : 'REPOS', done: 'TERMINÉ' }[phase];
    if ($('timerPhase').textContent !== phaseLabel) $('timerPhase').textContent = phaseLabel;
    $('timerState').textContent = { idle: 'Prêt à démarrer', running: 'En cours', paused: 'En pause', done: 'Bien joué !' }[state.status];
    $('timerProgress').style.width = `${state.progress * 100}%`;
    $('timerStart').textContent = { idle: 'Démarrer', running: 'Pause', paused: 'Reprendre', done: 'Recommencer' }[state.status];
    $('timerStart').setAttribute('aria-label', `${$('timerStart').textContent} le timer`);
    $('timerStart').disabled = invalid && !locked;
    $('timerFields').disabled = locked;
    $('timerSettingsHint').hidden = !locked;
    $('timerSummary').textContent = invalid ? (custom ? 'Corrige les commandes dans Avancé avant de démarrer.' : 'Vérifie les réglages de base avant de démarrer.') : custom ? `${intervalProgram.steps} étapes · Total ${formatTime(state.total)} · Mode avancé` : `${config.infinite ? 'Rounds infinis' : `${config.rounds} ${selected === 'boxing' ? 'rounds' : 'répétitions'}`}${selected === 'intervals' ? ` × ${config.series} série${config.series > 1 ? 's' : ''}` : ''} · ${formatTime(config.work * 1000)} ${selected === 'boxing' ? 'de boxe' : 'd’effort'} · ${formatTime(config.rest * 1000)} de repos${config.infinite ? ' · Jusqu’à ton arrêt' : ` · Total ${formatTime(state.total)}`}`;
    const next = state.nextPhase;
    const nextLabel = next?.seriesRest ? 'Repos entre séries' : next?.kind === 'rest' ? 'Repos' : custom ? next?.label : selected === 'boxing' ? `Round ${next?.round}` : 'Travail';
    $('timerNext').textContent = invalid ? '' : next ? `Ensuite : ${nextLabel} · ${formatTime(next.seconds * 1000)}` : state.status === 'done' ? 'Séance terminée' : 'Ensuite : fin de séance';
    $('timerSeries').hidden = selected !== 'intervals' || invalid || (!custom && config.series === 1);
    $('timerSeries').textContent = custom ? `Bloc ${state.phase.group || 1} · Répétition ${state.phase.round || 1} / ${state.phase.rounds || 1}` : `Série ${state.phase.series || 1} / ${config.series || 1}`;
    if (selected === 'intervals') {
      const appearance = timerEffortAppearance(state.phase);
      board.dataset.colored = String(!invalid && ['work', 'rest'].includes(phase) && (state.status !== 'idle' || custom));
      board.style.setProperty('--interval-color', appearance.color);
      board.style.setProperty('--interval-high-color', appearance.highColor);
      board.style.setProperty('--interval-ink', appearance.ink);
      board.dataset.range = String(appearance.range);
      advancedUI?.setLocked(locked);
      presetsUI?.sync();
    }
    if (selected === 'boxing') {
      $('timerForm').elements.rounds.disabled = config.infinite;
      for (const name of ['work', 'rest']) {
        $(`classic${name}Value`).textContent = name === 'work' ? `${config.work / 60} min` : `${config.rest} s`;
        for (const control of root.querySelectorAll(`[data-adjust="${name}"]`)) control.disabled = locked || (Number(control.dataset.direction) < 0 ? config[name] === (name === 'work' ? 120 : 30) : config[name] === (name === 'work' ? 180 : 60));
      }
      $('classicControlsHint').textContent = locked ? 'Réinitialise le timer pour régler les boutons.' : 'Tourne les boutons du boîtier, ou utilise − et +.';
      syncClassicScene();
      classicScene?.update({ phase, warning, status: state.status, config });
    }
  }
  function releaseClassicScene() {
    sceneTicket++; classicScene?.destroy(); classicScene = null; sceneHost = null;
  }
  function adjustClassic(name, direction) {
    if (selected !== 'boxing' || !['idle', 'done'].includes(timers.boxing.status)) return;
    const choices = name === 'work' ? [120, 180] : [30, 60];
    const index = choices.indexOf(settings.boxing[name]);
    $('timerForm').elements[name].value = String(choices[(index + Math.sign(direction) + choices.length) % choices.length]);
    readTimerForm();
  }
  function syncClassicScene() {
    if (settings.design !== 'classic') { if (sceneHost) releaseClassicScene(); return; }
    const host = $('classicViewport');
    if (!host || sceneHost === host) return;
    sceneHost = host;
    const ticket = ++sceneTicket;
    host.dataset.render = 'loading';
    $('classicRenderStatus').textContent = 'Préparation du boîtier…';
    const fallback = () => {
      host.dataset.render = 'fallback';
      $('classicRenderStatus').textContent = 'Vue simplifiée · la 3D est indisponible sur ce navigateur.';
    };
    if (!view.WebGL2RenderingContext) { fallback(); return; }
    loadClassicScene().then(({ createClassicTimerScene }) => {
      if (destroyed || sceneTicket !== ticket || selected !== 'boxing' || settings.design !== 'classic') return;
      classicScene = createClassicTimerScene(host, { onAdjust: adjustClassic, onToggle: () => $('timerStart')?.click() });
      host.dataset.render = 'ready'; $('classicRenderStatus').textContent = '';
      drawTimer();
    }).catch(() => { if (!destroyed && sceneTicket === ticket) { classicScene?.destroy(); classicScene = null; fallback(); } });
  }
  function tick() {
    if (!isTimer() || destroyed) return;
    const state = timers[selected].snapshot(), cue = timerCue(previous, state);
    if (cue && settings.sound && doc.visibilityState !== 'hidden') audio.play(cue, selected === 'intervals' ? 'beep' : 'bell');
    if (state.status === 'done' && previous?.status === 'running') { notice('Séance terminée.'); syncWake(); }
    previous = state;
    drawTimer(state);
  }
  function timerMarkup(kind) {
    const config = settings[kind], boxing = kind === 'boxing';
    const classic = boxing ? `<div class="classic-instrument"><div id="classicViewport" class="classic-viewport" aria-label="Boîtier de timer de boxe en trois dimensions"><div class="classic-fallback" aria-hidden="true"><div class="classic-fallback-lights"><i class="beacon work"></i><i class="beacon warning"></i><i class="beacon rest"></i></div><div class="classic-fallback-case"><div class="classic-fallback-vents"></div><img src="${import.meta.env?.BASE_URL || './'}images/boxing-logo.png" alt="" width="96" height="96"></div></div></div><p id="classicRenderStatus" class="classic-render-status" role="status"></p><div class="classic-legend" aria-hidden="true"><span data-lamp="work"><i></i>Round</span><span data-lamp="warning"><i></i>30 secondes</span><span data-lamp="rest"><i></i>Repos</span></div></div>` : '';
    const knobs = boxing ? `<div class="classic-knobs" role="group" aria-label="Réglages des boutons du boîtier">${[['work', 'Round'], ['rest', 'Repos']].map(([name, label]) => `<div class="classic-knob-control"><span>${label}</span><div><button type="button" data-adjust="${name}" data-direction="-1" aria-label="Diminuer la durée ${name === 'work' ? 'du round' : 'du repos'}">−</button><output id="classic${name}Value"></output><button type="button" data-adjust="${name}" data-direction="1" aria-label="Augmenter la durée ${name === 'work' ? 'du round' : 'du repos'}">+</button></div></div>`).join('')}<p id="classicControlsHint"></p></div>` : '';
    const controls = boxing ? `<details class="timer-settings" id="timerSettings" open><summary>Réglages</summary><form id="timerForm"><fieldset id="timerFields" class="timer-fields">
      <label><span>Rounds</span><select name="roundMode">${options([['fixed', 'Nombre déterminé'], ['infinite', 'Infini']], config.infinite ? 'infinite' : 'fixed')}</select></label>
      <label><span>Nombre de rounds</span><input name="rounds" aria-label="Nombre de rounds" type="number" inputmode="numeric" min="1" max="99" value="${config.rounds}" required></label>
      <label><span>Durée du round</span><select name="work">${options([[120, '2 minutes'], [180, '3 minutes']], config.work)}</select></label>
      <label><span>Repos</span><select name="rest">${options([[30, '30 secondes'], [60, '1 minute']], config.rest)}</select></label>
      <label><span>Préparation</span><select name="preparation">${options([[0, 'Aucune'], [5, '5 secondes'], [10, '10 secondes'], [15, '15 secondes'], [30, '30 secondes'], [60, '1 minute']], config.preparation)}</select></label>
      <label class="timer-check"><input name="warning" type="checkbox"${config.warning ? ' checked' : ''}><span>Avertissement à 30 secondes</span></label>
      </fieldset></form><p id="timerSettingsHint" class="timer-help" hidden>Réinitialise le timer pour modifier les durées.</p></details>` : intervalControlsMarkup(config);
    return `<div class="timer-layout" data-tool="${kind}"><div class="timer-main"><div id="timerBoard" class="timer-board" data-design="${boxing ? settings.design : 'intervals'}">${classic}<div class="timer-readout"><span id="timerRound" class="timer-round"></span><span id="timerPhase" class="timer-phase" role="status" aria-live="polite"></span><span id="timerDigits" class="timer-digits" role="timer" aria-label="Temps restant" aria-live="off"></span><span id="timerState" class="timer-state"></span><span id="timerSeries" class="timer-series" hidden></span><span id="timerNext" class="timer-next"></span></div>${knobs}<div class="timer-progress" aria-hidden="true"><span id="timerProgress"></span></div></div><div class="timer-actions"><button id="timerStart" type="button" class="button primary">Démarrer</button><button id="timerReset" type="button" class="button secondary">Réinitialiser</button></div><p id="timerSummary" class="timer-summary"></p></div>
      <div class="timer-controls-panel">${controls}
      ${boxing ? `<label class="timer-appearance"><span>Apparence</span><select id="timerDesign">${options([['boxing', 'Moderne · Boxe'], ['classic', 'Classique · 3D']], settings.design)}</select></label>` : ''}
      <div class="timer-sound"><label><input id="timerSound" type="checkbox"${settings.sound ? ' checked' : ''}>${boxing ? 'Cloche de ring' : 'Signaux sonores'}</label><button id="testSound" type="button" class="button secondary">Tester le son</button></div>${boxing ? '<p class="timer-help">Trois coups de cloche au début et à la fin de chaque round, un signal bref à 30 secondes si activé. Garde cette page ouverte pour entendre les signaux. L’écran reste allumé lorsque ton appareil le permet.</p>' : ''}</div></div>${boxing ? '' : '<div id="timerPresets"></div>'}`;
  }
  function readTimerForm(report = false) {
    if (selected === 'intervals') {
      try {
        let phases;
        if (draft.custom) {
          if (!draft.edited && generationError) throw new Error(generationError);
          intervalProgram = compileTimerText(draft.text); phases = intervalProgram.phases;
        } else {
          const config = advancedUI.readConfig(report);
          if (!config) { intervalValid = false; drawTimer(); return false; }
          phases = makePhases(config); settings.intervals = config; refreshGeneratedDraft();
        }
        timers.intervals.configure(phases); intervalValid = true;
        advancedUI.setError(''); previous = timers.intervals.snapshot();
        save(); notice(''); drawTimer(); return true;
      } catch (error) {
        intervalValid = false; intervalProgram = null;
        advancedUI.setError(draft.custom ? error.message : '');
        save(); notice(draft.custom ? '' : error.message); drawTimer(); return false;
      }
    }
    const form = $('timerForm');
    form.elements.rounds.disabled = form.elements.roundMode.value === 'infinite';
    if (!(report ? form.reportValidity() : form.checkValidity())) return false;
    const config = {
      rounds: form.elements.rounds.disabled ? settings[selected].rounds : Number(form.elements.rounds.value),
      work: Number(form.elements.work.value), rest: Number(form.elements.rest.value),
      preparation: Number(form.elements.preparation.value), warning: Boolean(form.elements.warning?.checked),
      infinite: form.elements.roundMode.value === 'infinite',
    };
    try {
      const phases = makePhases(config);
      settings[selected] = config;
      timers[selected].configure(phases);
      previous = timers[selected].snapshot();
      save(); notice(''); drawTimer(); return true;
    } catch (error) {
      notice(error.message); return false;
    }
  }
  function mountTimer() {
    releaseClassicScene();
    presetsUI?.destroy(); presetsUI = null;
    advancedUI?.destroy(); advancedUI = null;
    $('toolStage').innerHTML = timerMarkup(selected);
    $('classicViewport')?.addEventListener('classic-timer-unavailable', () => {
      classicScene?.destroy(); classicScene = null;
      $('classicViewport').dataset.render = 'fallback';
      $('classicRenderStatus').textContent = 'Vue simplifiée · la 3D est indisponible sur ce navigateur.';
    });
    if (selected === 'boxing') for (const name of ['rounds', 'work', 'rest', 'preparation']) $('timerForm').elements[name].value = String(settings[selected][name]);
    if ($('timerDesign')) $('timerDesign').value = settings.design;
    if (selected === 'intervals') advancedUI = mountIntervalControls($('timerSettings'), { config: settings.intervals, units: settings.intervalUnits, draft, onChange() {
      if (!['idle', 'done'].includes(timers.intervals.status)) return;
      save(); readTimerForm();
    } });
    if (selected === 'intervals' && timers.intervals.status === 'idle') readTimerForm();
    if (selected === 'intervals') presetsUI = mountTimerPresets($('timerPresets'), {
      store: toolStore,
      isLocked: () => destroyed || selected !== 'intervals' || !['idle', 'done'].includes(timers.intervals.status),
      getPreset() {
        if (!readTimerForm(true)) throw new Error('Corrige les réglages avant d’enregistrer le timer.');
        return validateTimerPreset(draft.custom ? { mode: 'advanced', text: draft.text } : { mode: 'base', config: settings.intervals, units: settings.intervalUnits });
      },
      applyPreset(payload) {
        if (destroyed || selected !== 'intervals' || !['idle', 'done'].includes(timers.intervals.status)) throw new Error('Réinitialise le timer avant de charger un réglage.');
        const preset = validateTimerPreset(payload);
        if (preset.mode === 'advanced') {
          draft.custom = true; draft.edited = true; draft.text = preset.text; generationError = '';
        } else {
          // Freeze the other draft before replacing Base, even if it was generated.
          draft.edited = true; draft.custom = false;
          settings.intervals = preset.config; settings.intervalUnits = preset.units;
        }
        timers.intervals.reset(); stopAudio(); save(); mountTimer();
        notice('Timer chargé. Prêt à démarrer.');
      },
    });
    previous = timers[selected].snapshot();
    drawTimer();
    if (selected === 'boxing') {
      $('timerForm').addEventListener('submit', event => event.preventDefault());
      $('timerForm').addEventListener('change', () => { if (['idle', 'done'].includes(timers[selected].status)) readTimerForm(); });
    }
    $('timerStart').addEventListener('click', async () => {
      const kind = selected, timer = timers[kind];
      if (timer.status === 'running') { previous = timer.pause(); stopAudio(); drawTimer(); syncWake(); return; }
      if (['idle', 'done'].includes(timer.status) && !readTimerForm(true)) return;
      const wasIdle = timer.status === 'idle';
      const ticket = ++audioTicket;
      previous = timer.start();
      if (kind === 'boxing') $('timerSettings').open = false;
      notice(''); drawTimer(); syncWake();
      if (settings.sound && await audio.unlock() && !destroyed && ticket === audioTicket && settings.sound && selected === kind && timer.status === 'running' && wasIdle) audio.play(timer.snapshot().phase.kind === 'prepare' ? 'prepare' : 'phase', kind === 'intervals' ? 'beep' : 'bell');
    });
    $('timerReset').addEventListener('click', () => {
      previous = timers[selected].reset();
      stopAudio();
      if (selected === 'boxing') $('timerSettings').open = true;
      notice('Timer réinitialisé.'); drawTimer(); syncWake();
    });
    $('timerDesign')?.addEventListener('change', event => { settings.design = event.target.value; save(); drawTimer(); });
    root.querySelectorAll('[data-adjust]').forEach(control => control.addEventListener('click', () => adjustClassic(control.dataset.adjust, Number(control.dataset.direction))));
    $('timerSound').addEventListener('change', async event => {
      settings.sound = event.target.checked; save();
      if (settings.sound) await audio.unlock();
      else stopAudio();
    });
    $('testSound').addEventListener('click', async () => { const kind = selected, ticket = ++audioTicket; if (await audio.unlock() && !destroyed && ticket === audioTicket && selected === kind) audio.play('phase', kind === 'intervals' ? 'beep' : 'bell'); });
  }
  function mountPunches() {
    mountPunchCounter($('toolStage'), { state: scores, bindTap,
      onActivity() { counterActive = true; notice(''); syncWake(); },
      onReset() { counterActive = false; notice('Tous les rounds et les compteurs ont été remis à zéro.'); syncWake(); },
    });
  }
  function mountBulletin() {
    const ticket = ++bulletinTicket, host = $('toolStage');
    host.innerHTML = '<p role="status">Ouverture du babillard…</p>';
    loadBulletin().then(({ mountBulletinBoard }) => {
      if (destroyed || selected !== 'bulletin' || ticket !== bulletinTicket) return;
      bulletinUI = mountBulletinBoard(host, { store: toolStore });
    }).catch(() => {
      if (destroyed || ticket !== bulletinTicket) return;
      host.innerHTML = '<p role="alert">Impossible d’ouvrir le babillard. Reviens aux outils puis réessaie.</p>';
    });
  }
  function drawSteps() {
    const state = steps.snapshot();
    $('stepCount').textContent = String(state.count);
    $('stepCadence').textContent = state.cadence === null ? '—' : String(state.cadence);
    $('stepDuration').textContent = formatTime(state.elapsed);
    $('stepTap').setAttribute('aria-label', `Compter un pas. ${state.count} pas comptés`);
  }
  function mountSteps() {
    $('toolStage').innerHTML = `<div class="steps-panel"><p class="tool-instructions">Touche le bouton à chaque pas, pendant quelques secondes. La cadence se calcule entre le premier et le dernier appui.</p><dl class="steps-metrics"><div><dt>Pas / minute</dt><dd id="stepCadence">—</dd></div><div><dt>Pas comptés</dt><dd id="stepCount">0</dd></div><div><dt>Durée mesurée</dt><dd id="stepDuration">00:00</dd></div></dl><button id="stepTap" class="step-button" type="button"><strong>+ 1 pas</strong><span>Touche ici à chaque pas</span></button><div class="counter-actions"><button id="stepReset" class="button secondary" type="button">Nouvelle mesure</button></div></div>`;
    bindTap($('stepTap'), () => { steps.tap(); counterActive = true; drawSteps(); syncWake(); });
    $('stepReset').addEventListener('click', () => { steps.reset(); counterActive = false; drawSteps(); syncWake(); notice('Nouvelle mesure prête.'); });
    drawSteps();
  }
  function updateFullscreen() {
    const expanded = doc.fullscreenElement === $('toolDetail') || $('toolDetail').classList.contains('is-expanded');
    $('toolFullscreen').textContent = expanded ? 'Quitter le plein écran' : 'Plein écran';
    $('toolFullscreen').setAttribute('aria-pressed', String(expanded));
  }
  function closeFullscreen() {
    if (doc.fullscreenElement === $('toolDetail')) doc.exitFullscreen?.().catch(() => {});
    $('toolDetail').classList.remove('is-expanded');
    doc.body.classList.remove('tools-expanded');
    updateFullscreen();
  }
  function select(kind) {
    if (kind !== null && !Object.hasOwn(titles, kind)) return;
    if (selected === 'bulletin' && bulletinUI?.canLeave && !bulletinUI.canLeave()) return;
    const oldKind = selected;
    if (isTimer()) timers[selected].pause();
    stopAudio(); releaseClassicScene(); advancedUI?.destroy(); advancedUI = null;
    presetsUI?.destroy(); presetsUI = null; bulletinTicket++; bulletinUI?.destroy(); bulletinUI = null;
    selected = kind; counterActive = false;
    closeFullscreen(); syncWake(); notice('');
    $('toolsMenu').hidden = Boolean(kind); $('toolDetail').hidden = !kind;
    if (!kind) { root.querySelector(`[data-tool="${oldKind}"]`)?.focus({ preventScroll: true }); return; }
    $('toolTitle').textContent = titles[kind];
    if (isTimer()) mountTimer(); else if (kind === 'punches') mountPunches(); else if (kind === 'bulletin') mountBulletin(); else mountSteps();
    $('toolTitle').focus({ preventScroll: true });
  }
  root.querySelectorAll('[data-tool]').forEach(button => button.addEventListener('click', () => select(button.dataset.tool)));
  $('toolsBack').addEventListener('click', () => select(null));
  $('toolFullscreen').addEventListener('click', async () => {
    const detail = $('toolDetail');
    if (doc.fullscreenElement === detail || detail.classList.contains('is-expanded')) { closeFullscreen(); return; }
    try {
      if (!detail.requestFullscreen) throw new Error('unsupported');
      await detail.requestFullscreen();
    } catch { detail.classList.add('is-expanded'); doc.body.classList.add('tools-expanded'); }
    updateFullscreen();
  });
  const onKey = event => { if (event.key === 'Escape') closeFullscreen(); };
  const onVisibility = () => { tick(); syncWake(); };
  const onPageHide = () => { if (isTimer()) timers[selected].pause(); stopAudio(); counterActive = false; syncWake(); };
  doc.addEventListener('fullscreenchange', updateFullscreen);
  doc.addEventListener('keydown', onKey);
  doc.addEventListener('visibilitychange', onVisibility);
  view.addEventListener('pagehide', onPageHide);
  if (autoTick) interval = view.setInterval(tick, 100);
  return {
    tick, select,
    destroy() {
      destroyed = true; audioTicket++; view.clearInterval(interval); syncWake(); audio.destroy(); releaseClassicScene(); advancedUI?.destroy(); closeFullscreen();
      presetsUI?.destroy(); bulletinTicket++; bulletinUI?.destroy();
      doc.removeEventListener('fullscreenchange', updateFullscreen); doc.removeEventListener('keydown', onKey); doc.removeEventListener('visibilitychange', onVisibility); view.removeEventListener('pagehide', onPageHide);
      root.replaceChildren();
    },
  };
}
