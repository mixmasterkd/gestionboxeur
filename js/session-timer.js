import { compileSessionTimer, configureSessionIntervals } from './session-timer-program.js';
import { SessionTimer } from './session-timer-engine.js';
import { createTimerSignals } from './timer-audio.js';
import { formatTime, timerCue } from './tools-engine.js';
import { mountTimerSession } from './timer-session.js';
import { bindHoldAction } from './hold-action.js';
import { openDialog } from './ui.js';

export function mountSessionTimer(dialog, session, { now = () => performance.now(), autoTick = true, audioFactory = createTimerSignals } = {}) {
  const doc = dialog.ownerDocument, view = doc.defaultView;
  const sourceProgram = compileSessionTimer(session), untimed = sourceProgram.timedSeconds === 0;
  let program = sourceProgram, timer = new SessionTimer(program.phases, now), mode = 'free', configurationError = '';
  let destroyed = false, interval = null, previous = null, audioTicket = 0, screen = null, hold = null;
  let wake = null, wakePending = false, wakeVersion = 0, wakeNeeded = false;
  dialog.className = 'app-dialog session-timer-dialog';
  dialog.id = 'sessionTimerDialog'; dialog.setAttribute('aria-labelledby', 'sessionTimerTitle');
  const setup = untimed ? `<fieldset class="session-timer-setup"><legend>Aucune durée prévue</legend>
    <div class="session-timer-modes"><button type="button" data-timer-mode="free" aria-pressed="true">Chrono libre</button><button type="button" data-timer-mode="intervals" aria-pressed="false" aria-controls="sessionTimerSettings">Configurer des intervalles</button></div>
    <div id="sessionTimerSettings" class="session-timer-settings" hidden>
      <div class="session-timer-fields"><label>Effort (secondes)<input name="workSeconds" type="number" inputmode="numeric" min="1" max="3600" step="1" value="45" required></label>
      <label>Repos (secondes)<input name="restSeconds" type="number" inputmode="numeric" min="0" max="3600" step="1" value="15" required></label>
      ${sourceProgram.freeform ? '<label class="session-timer-rounds">Nombre d’intervalles<input name="rounds" type="number" inputmode="numeric" min="1" max="100" step="1" value="8" required></label>' : ''}</div>
      <p class="session-timer-settings-note">${sourceProgram.freeform ? 'Repos entre les intervalles, sans repos final ajouté.' : 'Étapes et rounds de la séance conservés. Repos entre les efforts, sans repos final ajouté.'} Ces temps s’appliquent uniquement à ce timer.</p>
      <p class="session-timer-config-error" role="alert"></p>
    </div></fieldset><p class="session-timer-settings-locked" hidden>Réinitialise le timer pour changer ces réglages.</p>` : '';
  dialog.innerHTML = `<header class="dialog-heading"><div><p class="eyebrow">TIMER DE L’ENTRAÎNEMENT</p><h2 id="sessionTimerTitle"></h2></div><button type="button" class="close-button" aria-label="Fermer le timer">×</button></header>
    <div class="session-timer-content">${setup}<div id="sessionTimerBoard" class="timer-board session-timer-board" data-design="intervals">
      <div class="timer-readout"><span class="timer-round"></span><span class="timer-phase" role="status" aria-live="polite"></span><span class="timer-digits" role="timer" aria-label="Temps restant" aria-live="off"></span><span class="session-timer-measure"></span><span class="timer-state"></span><span class="timer-next"></span></div>
      <div class="timer-progress" aria-hidden="true"><span></span></div>
    </div><div class="session-timer-actions"><button type="button" class="button primary session-timer-start">Démarrer</button><button type="button" class="button secondary session-timer-reset">Réinitialiser</button></div>
    <p class="session-timer-summary"></p><label class="session-timer-sound"><input type="checkbox" checked> Signaux sonores</label><p class="session-timer-notice" role="status"></p></div>`;
  const $ = selector => dialog.querySelector(selector), board = $('#sessionTimerBoard');
  $('#sessionTimerTitle').textContent = program.title;
  const phaseLabel = phase => phase.kind === 'rest' ? 'Repos' : 'Effort';
  const audio = audioFactory(view, () => { if (!destroyed) $('.session-timer-notice').textContent = 'Le son est indisponible. Vérifie le volume et les réglages audio du navigateur.'; });
  const stopAudio = () => { audioTicket++; audio.stop(); };
  const needsWake = () => !destroyed && dialog.open && timer.status === 'running' && doc.visibilityState !== 'hidden';
  async function syncWake() {
    const needed = needsWake();
    if (needed !== wakeNeeded) { wakeNeeded = needed; wakeVersion++; }
    if (!needed) { if (wake) { const old = wake; wake = null; await old.release().catch(() => {}); } return; }
    if (!view.navigator.wakeLock?.request || wake || wakePending) return;
    const version = wakeVersion; wakePending = true;
    try {
      const acquired = await view.navigator.wakeLock.request('screen');
      if (!needsWake()) await acquired.release();
      else { wake = acquired; acquired.addEventListener('release', () => { if (wake === acquired) wake = null; }); }
    } catch { /* Fullscreen still works when the device refuses a screen lock. */ }
    finally { wakePending = false; if (!wake && needsWake() && version !== wakeVersion) void syncWake(); }
  }
  const manual = doc.createElement('button');
  manual.type = 'button'; manual.className = 'session-timer-advance';
  manual.innerHTML = '<span>Terminer l’étape</span><small>Maintenir 2 secondes</small>';
  manual.setAttribute('aria-label', 'Maintenir 2 secondes pour terminer l’étape');
  function available() { const state = timer.snapshot(); return !destroyed && dialog.open && state.status === 'running' && state.phase.manual; }
  function configure(nextMode = mode) {
    if (destroyed || !untimed || timer.status !== 'idle' || screen?.locked) return;
    mode = nextMode;
    $('#sessionTimerSettings').hidden = mode !== 'intervals';
    dialog.querySelectorAll('[data-timer-mode]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.timerMode === mode)));
    dialog.querySelectorAll('.session-timer-settings input').forEach(input => input.setAttribute('aria-invalid', String(mode === 'intervals' && !input.checkValidity())));
    try {
      const next = mode === 'free' ? sourceProgram : configureSessionIntervals(sourceProgram, {
        workSeconds: $('[name="workSeconds"]').valueAsNumber,
        restSeconds: $('[name="restSeconds"]').valueAsNumber,
        rounds: $('[name="rounds"]')?.valueAsNumber,
      });
      const nextTimer = new SessionTimer(next.phases, now);
      hold?.cancel();stopAudio();timer.pause();program = next;timer = nextTimer;
      previous = timer.snapshot();configurationError = '';
    } catch (error) { configurationError = error.message; }
    $('.session-timer-config-error').textContent = configurationError;
    draw();
  }
  function draw(state = timer.snapshot()) {
    if (destroyed) return;
    const p = state.phase, done = state.status === 'done';
    board.dataset.phase = done ? 'done' : p.kind; board.dataset.status = state.status;
    board.dataset.colored = String(!done); board.dataset.range = String(Boolean(p.range));
    board.dataset.manual = String(p.manual && !done);
    board.style.setProperty('--interval-color', p.color); board.style.setProperty('--interval-high-color', p.highColor); board.style.setProperty('--interval-ink', p.ink);
    $('.timer-round').textContent = `Étape ${state.index + 1} / ${program.phases.length}${p.repetition ? ' · ' + p.repetition : ''}`;
    const label = done ? 'TERMINÉ' : phaseLabel(p);
    if ($('.timer-phase').textContent !== label) $('.timer-phase').textContent = label;
    // Count up only completed seconds on open-ended steps; countdown uses ceil.
    const digits = formatTime(done ? state.elapsed : p.manual ? Math.floor(state.phaseElapsed / 1000) * 1000 : state.remaining);
    $('.timer-digits').textContent = digits; board.dataset.longTime = String(digits.length > 5);
    $('.timer-digits').setAttribute('aria-label', done ? 'Durée réalisée' : p.manual ? 'Temps écoulé dans cette étape' : 'Temps restant');
    $('.session-timer-measure').textContent = done ? 'Durée réalisée' : p.manual ? 'Temps écoulé · passage manuel' : 'Temps restant';
    $('.timer-state').textContent = { idle: 'Prêt à démarrer', running: 'En cours', paused: 'En pause', done: 'Timer terminé' }[state.status];
    const next = state.nextPhase;
    $('.timer-next').textContent = next ? `Ensuite : ${phaseLabel(next)} · ${next.manual ? 'Sans durée' : formatTime(next.seconds * 1000)}` : done ? '' : 'Ensuite : fin de séance';
    $('.timer-progress span').style.width = `${state.progress * 100}%`;
    $('.timer-progress').hidden = p.manual;
    $('.session-timer-summary').textContent = program.manualSteps
      ? `${program.timedSeconds ? formatTime(program.timedSeconds * 1000) + ' chronométrées + ' : ''}${program.manualSteps} étape${program.manualSteps > 1 ? 's' : ''} libre${program.manualSteps > 1 ? 's' : ''} · passage manuel`
      : `${program.phases.length} étapes · ${formatTime(program.timedSeconds * 1000)}`;
    $('.session-timer-start').textContent = { idle: 'Démarrer', running: 'Pause', paused: 'Reprendre', done: 'Recommencer' }[state.status];
    $('.session-timer-start').disabled = Boolean(configurationError);
    if (untimed) {
      $('.session-timer-setup').disabled = state.status !== 'idle';
      $('.session-timer-settings-locked').hidden = state.status === 'idle';
    }
    manual.hidden = !p.manual || done || state.status === 'idle'; manual.disabled = state.status !== 'running';
    if (manual.hidden || manual.disabled) hold?.cancel();
    screen?.sync();
    if ($('#timerFocusOpen')) $('#timerFocusOpen').disabled = Boolean(configurationError);
  }
  function tick() {
    if (destroyed) return;
    hold?.tick();
    const state = timer.snapshot(), cue = timerCue(previous, state);
    if (cue && $('.session-timer-sound input').checked && doc.visibilityState !== 'hidden' && dialog.open) audio.play(cue, 'beep');
    previous = state; draw(state); void syncWake();
  }
  function toggle({ fromScreen = false } = {}) {
    if (destroyed || !dialog.open || configurationError || !fromScreen && screen?.locked) return;
    const state = timer.snapshot();
    hold?.cancel();
    if (state.status === 'running') { timer.pause(); stopAudio(); }
    else {
      timer.start();
      if ($('.session-timer-sound input').checked) {
        const ticket = ++audioTicket;
        void audio.unlock().then(ok => { if (ok && !destroyed && ticket === audioTicket && timer.status === 'running' && $('.session-timer-sound input').checked) audio.play('phase', 'beep'); });
      }
      // A synchronous user gesture enters fullscreen; CSS covers browsers without it.
      screen.enter();
    }
    previous = timer.snapshot(); draw(previous); void syncWake();
  }
  function reset() {
    if (screen?.locked || destroyed) return;
    hold.cancel();stopAudio();timer.reset();previous = timer.snapshot();draw(previous);void syncWake();
  }
  screen = mountTimerSession(board, { now, autoTick, getState: () => ({ status: timer.status, design: 'intervals' }), getWake: () => Boolean(wake), onToggle: () => toggle({ fromScreen: true }), onReset: reset });
  board.querySelector('.timer-session-controls').prepend(manual);
  hold = bindHoldAction(manual, { now, autoTick, available, action: () => { timer.advance(); tick(); } });
  $('.session-timer-start').addEventListener('click', () => toggle());
  $('.session-timer-reset').addEventListener('click', reset);
  dialog.querySelectorAll('[data-timer-mode]').forEach(button => button.addEventListener('click', () => configure(button.dataset.timerMode)));
  $('.session-timer-settings')?.addEventListener('input', () => configure());
  $('.session-timer-sound input').addEventListener('change', () => { if (!$('.session-timer-sound input').checked) stopAudio(); });
  const close = () => { if (screen.locked) return; screen.close(); dialog.close(); };
  $('.close-button').addEventListener('click', close);
  const cancel = event => { event.preventDefault(); close(); };
  const pause = () => { hold.cancel();timer.pause();stopAudio();previous = timer.snapshot();draw(previous);void syncWake(); };
  const onClose = () => { if (!destroyed) { screen.close();pause(); } };
  const onVisibility = () => { if (doc.visibilityState === 'hidden') { hold.cancel();stopAudio(); } tick(); };
  dialog.addEventListener('cancel', cancel);dialog.addEventListener('close', onClose);
  doc.addEventListener('visibilitychange', onVisibility);view.addEventListener('pagehide', pause);
  if (autoTick) interval = view.setInterval(tick, 100);
  draw();
  return {
    tick, snapshot: () => timer.snapshot(),
    open() { if (destroyed) return; openDialog(dialog, $('.session-timer-start'));tick(); },
    destroy() {
      if (destroyed) return;
      destroyed = true;hold.destroy();timer.pause();stopAudio();audio.destroy();void syncWake();view.clearInterval(interval);
      dialog.removeEventListener('cancel', cancel);dialog.removeEventListener('close', onClose);doc.removeEventListener('visibilitychange', onVisibility);view.removeEventListener('pagehide', pause);
      screen.destroy();dialog.close();dialog.remove();
    },
  };
}
