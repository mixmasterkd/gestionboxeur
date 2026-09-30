import { RoundTimer, StepCounter, makePhases, formatTime, timerCue } from './tools-engine.js';

const preferenceKey = 'gestionboxeur:tools:v1';
const defaults = {
  boxing: { rounds: 3, work: 180, rest: 60, preparation: 10, warning: true },
  intervals: { rounds: 8, work: 45, rest: 15, preparation: 5, warning: false },
};
const titles = { boxing: 'Timer de boxe', intervals: 'Timer à intervalles', punches: 'Compteur de coups', steps: 'Compteur de pas' };
const options = (values, selected) => values.map(([value, label]) => `<option value="${value}"${value === selected ? ' selected' : ''}>${label}</option>`).join('');

function preferences(storage) {
  const settings = { design: 'boxing', sound: true, boxing: { ...defaults.boxing }, intervals: { ...defaults.intervals } };
  try {
    const saved = JSON.parse(storage?.getItem(preferenceKey) || 'null');
    if (saved?.design === 'classic') settings.design = 'classic';
    if (saved?.sound === false) settings.sound = false;
    for (const kind of ['boxing', 'intervals']) {
      if (!saved?.[kind]) continue;
      const candidate = Object.fromEntries(Object.keys(defaults[kind]).map(key => [key, saved[kind][key]]));
      try {
        if (!['rounds', 'work', 'rest', 'preparation'].every(key => Number.isInteger(candidate[key])) || ![0, 5, 10, 15, 30, 60].includes(candidate.preparation)) continue;
        candidate.warning = candidate.warning === true;
        makePhases(candidate);
        if (kind === 'boxing' && (![120, 180].includes(candidate.work) || ![30, 60].includes(candidate.rest))) continue;
        settings[kind] = candidate;
      } catch { /* A stale or damaged preference does not prevent using the tool. */ }
    }
  } catch { /* Storage may be unavailable in a private session. */ }
  return settings;
}

function signals(view, onUnavailable) {
  let context;
  return {
    async unlock() {
      try {
        const Audio = view.AudioContext || view.webkitAudioContext;
        if (!Audio) throw new Error('unsupported');
        context ||= new Audio();
        if (context.state === 'suspended') await context.resume();
        if (context.state !== 'running') throw new Error('suspended');
        return true;
      } catch { onUnavailable(); return false; }
    },
    play(cue) {
      if (!context || context.state !== 'running') return;
      const times = cue === 'warning' ? [0, .2, .4] : cue === 'finish' ? [0, .45, .9] : [0];
      for (const offset of times) {
        const oscillator = context.createOscillator(), gain = context.createGain();
        const at = context.currentTime + offset, length = cue === 'warning' ? .12 : .4;
        oscillator.type = cue === 'warning' ? 'sine' : 'triangle';
        oscillator.frequency.setValueAtTime(cue === 'warning' ? 1000 : 660, at);
        gain.gain.setValueAtTime(.0001, at);
        gain.gain.exponentialRampToValueAtTime(.2, at + .008);
        gain.gain.exponentialRampToValueAtTime(.0001, at + length);
        oscillator.connect(gain); gain.connect(context.destination);
        oscillator.start(at); oscillator.stop(at + length + .02);
        oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
      }
    },
    destroy() { context?.close().catch(() => {}); },
  };
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

export function mountTools(root, { now = () => performance.now(), autoTick = true, storage } = {}) {
  const doc = root.ownerDocument, view = doc.defaultView;
  const $ = id => root.querySelector(`#${id}`);
  if (storage === undefined) { try { storage = view.localStorage; } catch { storage = null; } }
  const settings = preferences(storage), timers = {};
  for (const kind of ['boxing', 'intervals']) timers[kind] = new RoundTimer(makePhases(settings[kind]), now);
  const steps = new StepCounter(now), scores = { blue: 0, red: 0 };
  let selected = null, previous = null, interval = null, destroyed = false, wake = null, wakePending = false, counterActive = false;
  const save = () => { try { storage?.setItem(preferenceKey, JSON.stringify(settings)); } catch { /* Tools remain usable without storage. */ } };
  const notice = text => { if (!destroyed && $('toolNotice')) $('toolNotice').textContent = text; };
  const audio = signals(view, () => notice('Le son est indisponible. Vérifie les réglages audio de ton navigateur et le volume du téléphone.'));
  const isTimer = () => selected === 'boxing' || selected === 'intervals';
  const needsWake = () => !destroyed && doc.visibilityState !== 'hidden' && (isTimer() ? timers[selected].status === 'running' : selected && counterActive);
  async function syncWake() {
    if (!needsWake()) {
      if (wake) { const old = wake; wake = null; await old.release().catch(() => {}); }
      return;
    }
    if (!view.navigator.wakeLock?.request || wake || wakePending) return;
    wakePending = true;
    try {
      const acquired = await view.navigator.wakeLock.request('screen');
      if (!needsWake()) await acquired.release();
      else { wake = acquired; acquired.addEventListener('release', () => { if (wake === acquired) wake = null; }); }
    } catch { /* Availability depends on the browser, battery and device settings. */ }
    finally { wakePending = false; }
  }
  function drawTimer(state = timers[selected].snapshot()) {
    const config = settings[selected], board = $('timerBoard');
    const phase = state.status === 'done' ? 'done' : state.phase.kind;
    board.dataset.phase = phase;
    board.dataset.warning = String(state.phase.warning && state.remaining <= 30000 && state.status !== 'done');
    board.dataset.design = selected === 'boxing' ? settings.design : 'classic';
    $('timerDigits').textContent = formatTime(state.remaining);
    const unit = selected === 'boxing' ? 'Round' : 'Intervalle';
    $('timerRound').textContent = `${unit} ${state.status === 'done' ? config.rounds : state.phase.round} / ${config.rounds}`;
    const phaseLabel = { prepare: 'PRÉPARATION', work: selected === 'boxing' ? 'BOXE' : 'EFFORT', rest: 'REPOS', done: 'TERMINÉ' }[phase];
    if ($('timerPhase').textContent !== phaseLabel) $('timerPhase').textContent = phaseLabel;
    $('timerState').textContent = { idle: 'Prêt à démarrer', running: 'En cours', paused: 'En pause', done: 'Bien joué !' }[state.status];
    $('timerProgress').style.width = `${state.progress * 100}%`;
    $('timerStart').textContent = { idle: 'Démarrer', running: 'Pause', paused: 'Reprendre', done: 'Recommencer' }[state.status];
    $('timerStart').setAttribute('aria-label', `${$('timerStart').textContent} le timer`);
    $('timerFields').disabled = ['running', 'paused'].includes(state.status);
    $('timerSettingsHint').hidden = !['running', 'paused'].includes(state.status);
    $('timerSummary').textContent = `${config.rounds} ${selected === 'boxing' ? 'rounds' : 'intervalles'} · ${formatTime(config.work * 1000)} ${selected === 'boxing' ? 'de boxe' : 'd’effort'} · ${formatTime(config.rest * 1000)} de repos · Total ${formatTime(state.total)}`;
  }
  function tick() {
    if (!isTimer() || destroyed) return;
    const state = timers[selected].snapshot(), cue = timerCue(previous, state);
    if (cue && settings.sound && doc.visibilityState !== 'hidden') audio.play(cue);
    if (state.status === 'done' && previous?.status === 'running') { notice('Séance terminée.'); syncWake(); }
    previous = state;
    drawTimer(state);
  }
  function timerMarkup(kind) {
    const config = settings[kind], boxing = kind === 'boxing';
    return `<div class="timer-layout"><div class="timer-main"><div id="timerBoard" class="timer-board" data-design="${boxing ? settings.design : 'classic'}"><span id="timerRound" class="timer-round"></span><span id="timerPhase" class="timer-phase" role="status" aria-live="polite"></span><span id="timerDigits" class="timer-digits" role="timer" aria-label="Temps restant" aria-live="off"></span><span id="timerState" class="timer-state"></span><div class="timer-progress" aria-hidden="true"><span id="timerProgress"></span></div></div><div class="timer-actions"><button id="timerStart" type="button" class="button primary">Démarrer</button><button id="timerReset" type="button" class="button secondary">Réinitialiser</button></div><p id="timerSummary" class="timer-summary"></p></div>
      <div class="timer-controls-panel"><details class="timer-settings" id="timerSettings" open><summary>Réglages</summary><form id="timerForm"><fieldset id="timerFields" class="timer-fields"><label><span>${boxing ? 'Nombre de rounds' : 'Répétitions'}</span><input name="rounds" aria-label="${boxing ? 'Nombre de rounds' : 'Répétitions'}" type="number" inputmode="numeric" min="1" max="99" value="${config.rounds}" required></label>
      ${boxing ? `<label><span>Durée du round</span><select name="work">${options([[120, '2 minutes'], [180, '3 minutes']], config.work)}</select></label><label><span>Repos</span><select name="rest">${options([[30, '30 secondes'], [60, '1 minute']], config.rest)}</select></label>` : `<label><span>Effort (secondes)</span><input name="work" type="number" inputmode="numeric" min="1" max="3600" value="${config.work}" required></label><label><span>Repos (secondes)</span><input name="rest" type="number" inputmode="numeric" min="0" max="3600" value="${config.rest}" required></label>`}
      <label><span>Préparation</span><select name="preparation">${options([[0, 'Aucune'], [5, '5 secondes'], [10, '10 secondes'], [15, '15 secondes'], [30, '30 secondes'], [60, '1 minute']], config.preparation)}</select></label>
      ${boxing ? `<label class="timer-check"><input name="warning" type="checkbox"${config.warning ? ' checked' : ''}><span>Avertissement à 30 secondes</span></label>` : ''}</fieldset></form><p id="timerSettingsHint" class="timer-help" hidden>Réinitialise le timer pour modifier les durées.</p></details>
      ${boxing ? `<label class="timer-appearance"><span>Apparence</span><select id="timerDesign">${options([['boxing', 'Boxe'], ['classic', 'Classique']], settings.design)}</select></label>` : ''}
      <div class="timer-sound"><label><input id="timerSound" type="checkbox"${settings.sound ? ' checked' : ''}>Signaux sonores</label><button id="testSound" type="button" class="button secondary">Tester le son</button></div><p class="timer-help">Garde cette page ouverte pour entendre les signaux. L’écran reste allumé lorsque ton appareil le permet.</p></div></div>`;
  }
  function readTimerForm(report = false) {
    const form = $('timerForm');
    if (!(report ? form.reportValidity() : form.checkValidity())) return false;
    const config = { rounds: Number(form.elements.rounds.value), work: Number(form.elements.work.value), rest: Number(form.elements.rest.value), preparation: Number(form.elements.preparation.value), warning: Boolean(form.elements.warning?.checked) };
    try {
      const phases = makePhases(config);
      settings[selected] = config;
      timers[selected].configure(phases);
      previous = timers[selected].snapshot();
      save(); drawTimer(); return true;
    } catch (error) { notice(error.message); return false; }
  }
  function mountTimer() {
    $('toolStage').innerHTML = timerMarkup(selected);
    for (const name of ['rounds', 'work', 'rest', 'preparation']) $('timerForm').elements[name].value = String(settings[selected][name]);
    if ($('timerDesign')) $('timerDesign').value = settings.design;
    previous = timers[selected].snapshot();
    drawTimer();
    $('timerForm').addEventListener('submit', event => event.preventDefault());
    $('timerForm').addEventListener('change', () => { if (['idle', 'done'].includes(timers[selected].status)) readTimerForm(); });
    $('timerStart').addEventListener('click', async () => {
      const kind = selected, timer = timers[kind];
      if (timer.status === 'running') { previous = timer.pause(); drawTimer(); syncWake(); return; }
      if (['idle', 'done'].includes(timer.status) && !readTimerForm(true)) return;
      const wasIdle = timer.status === 'idle';
      previous = timer.start();
      $('timerSettings').open = false;
      notice(''); drawTimer(); syncWake();
      if (settings.sound && await audio.unlock() && selected === kind && timer.status === 'running' && wasIdle) audio.play('phase');
    });
    $('timerReset').addEventListener('click', () => {
      previous = timers[selected].reset();
      $('timerSettings').open = true;
      notice('Timer réinitialisé.'); drawTimer(); syncWake();
    });
    $('timerDesign')?.addEventListener('change', event => { settings.design = event.target.value; save(); drawTimer(); });
    $('timerSound').addEventListener('change', async event => {
      settings.sound = event.target.checked; save();
      if (settings.sound) await audio.unlock();
    });
    $('testSound').addEventListener('click', async () => { if (await audio.unlock()) audio.play('phase'); });
  }
  function drawPunches() {
    for (const corner of ['blue', 'red']) {
      $(`${corner}Count`).textContent = String(scores[corner]);
      $(`${corner}Add`).setAttribute('aria-label', `Coin ${corner === 'blue' ? 'bleu' : 'rouge'} : ${scores[corner]} coups. Ajouter un coup`);
      $(`${corner}Undo`).disabled = !scores[corner];
    }
  }
  function mountPunches() {
    $('toolStage').innerHTML = `<p class="tool-instructions">Un appui = un coup. Les deux coins peuvent être touchés en même temps.</p><div class="punch-counters">${[['blue', 'bleu'], ['red', 'rouge']].map(([corner, name]) => `<div class="punch-corner"><button id="${corner}Add" type="button" class="punch-button punch-${corner}"><span>Coin ${name}</span><span id="${corner}Count" class="punch-number">0</span><span>+ 1 coup</span></button><button id="${corner}Undo" type="button" class="button secondary" aria-label="Retirer un coup au coin ${name}">− 1 coup</button></div>`).join('')}</div><div class="counter-actions"><button id="punchReset" class="button secondary" type="button">Remettre à zéro</button></div>`;
    for (const corner of ['blue', 'red']) {
      bindTap($(`${corner}Add`), () => { scores[corner]++; counterActive = true; drawPunches(); syncWake(); });
      $(`${corner}Undo`).addEventListener('click', () => { scores[corner] = Math.max(0, scores[corner] - 1); drawPunches(); });
    }
    $('punchReset').addEventListener('click', () => { scores.blue = scores.red = 0; counterActive = false; drawPunches(); syncWake(); notice('Compteurs remis à zéro.'); });
    drawPunches();
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
    const oldKind = selected;
    if (isTimer()) timers[selected].pause();
    selected = kind; counterActive = false;
    closeFullscreen(); syncWake(); notice('');
    $('toolsMenu').hidden = Boolean(kind); $('toolDetail').hidden = !kind;
    if (!kind) { root.querySelector(`[data-tool="${oldKind}"]`)?.focus({ preventScroll: true }); return; }
    $('toolTitle').textContent = titles[kind];
    if (isTimer()) mountTimer(); else if (kind === 'punches') mountPunches(); else mountSteps();
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
  const onPageHide = () => { if (isTimer()) timers[selected].pause(); counterActive = false; syncWake(); };
  doc.addEventListener('fullscreenchange', updateFullscreen);
  doc.addEventListener('keydown', onKey);
  doc.addEventListener('visibilitychange', onVisibility);
  view.addEventListener('pagehide', onPageHide);
  if (autoTick) interval = view.setInterval(tick, 100);
  return {
    tick, select,
    destroy() {
      destroyed = true; view.clearInterval(interval); syncWake(); audio.destroy(); closeFullscreen();
      doc.removeEventListener('fullscreenchange', updateFullscreen); doc.removeEventListener('keydown', onKey); doc.removeEventListener('visibilitychange', onVisibility); view.removeEventListener('pagehide', onPageHide);
      root.replaceChildren();
    },
  };
}
