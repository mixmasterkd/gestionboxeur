export const TIMER_UNLOCK_MS = 3000;
export function mountTimerSession(board, { now = () => performance.now(), autoTick = true, getState, getWake = () => false, onToggle, onReset } = {}) {
  const doc = board.ownerDocument, view = doc.defaultView;
  let active = false, locked = false, destroyed = false, frame = null, press = null, suppressClick = false, previousStatus = null;
  const controls = doc.createElement('div'); controls.className = 'timer-session-controls';
  controls.innerHTML = '<button id="timerSessionLock" type="button" class="timer-session-lock" aria-label="Maintenir 3 secondes pour déverrouiller"><span aria-hidden="true">🔒</span><span class="timer-session-lock-label">Maintenir 3 s</span></button><p class="timer-session-status" role="status" aria-live="polite"></p><div class="timer-session-actions"><button id="timerSessionToggle" class="button" type="button">Pause</button><button id="timerSessionReset" class="button" type="button">Réinitialiser</button><button id="timerSessionClose" class="button" type="button">Réduire</button></div>';
  const open = doc.createElement('button'); open.id = 'timerFocusOpen'; open.type = 'button'; open.className = 'timer-focus-open'; open.setAttribute('aria-label', 'Agrandir le timer en mode séance'); open.textContent = '⛶'; board.append(open, controls);
  const lock = controls.querySelector('#timerSessionLock'), actions = controls.querySelector('.timer-session-actions'), status = controls.querySelector('.timer-session-status'), toggle = controls.querySelector('#timerSessionToggle');
  const cancel = () => { press = null; lock.style.setProperty('--hold-progress', '0%'); };
  function sync() {
    if (destroyed) return;
    const state = getState(); open.hidden = state.design === 'classic';
    if (active && state.design === 'classic') close();
    if (active && state.status === 'running' && previousStatus !== 'running') locked = true;
    previousStatus = state.status;
    if (press && active && locked) {
      const elapsed = Math.max(0, now() - press.at); lock.style.setProperty('--hold-progress', `${Math.min(100, elapsed / TIMER_UNLOCK_MS * 100)}%`);
      if (elapsed >= TIMER_UNLOCK_MS) { locked = false; cancel(); }
    }
    board.classList.toggle('is-session', active); board.dataset.sessionLocked = String(locked); actions.hidden = locked;
    lock.querySelector('span').textContent = locked ? '🔒' : '🔓';
    lock.querySelector('.timer-session-lock-label').textContent = locked ? 'Maintenir 3 s' : 'Verrouiller';
    lock.setAttribute('aria-label', locked ? 'Maintenir 3 secondes pour déverrouiller' : 'Verrouiller les commandes');
    const text = locked ? `Commandes verrouillées${getWake() ? ' · Écran maintenu allumé' : ''}` : 'Commandes accessibles';
    if (status.textContent !== text) status.textContent = text;
    toggle.textContent = { running: 'Pause', paused: 'Reprendre', idle: 'Démarrer', done: 'Recommencer' }[state.status];
  }
  function schedule() { if (autoTick && press && frame === null) frame = view.requestAnimationFrame(() => { frame = null; sync(); schedule(); }); }
  function enter() {
    if (destroyed || getState().design === 'classic') return;
    active = true; locked = ['running', 'paused'].includes(getState().status); cancel(); doc.body.classList.add('timer-session-open'); sync(); lock.focus({ preventScroll: true });
    if (!doc.fullscreenElement && board.requestFullscreen) void board.requestFullscreen().then(() => { if (destroyed || !active) void doc.exitFullscreen?.().catch(() => {}); }).catch(() => {});
  }
  function close() {
    active = false; locked = false; cancel(); if (frame !== null) view.cancelAnimationFrame(frame); frame = null;
    doc.body.classList.remove('timer-session-open'); if (doc.fullscreenElement === board) void doc.exitFullscreen?.().catch(() => {}); sync(); open.focus({ preventScroll: true });
  }
  open.addEventListener('click', enter);
  lock.addEventListener('pointerdown', event => {
    if (!active || !locked || press || event.pointerType === 'mouse' && event.button !== 0) return;
    event.preventDefault(); suppressClick = true; press = { id: event.pointerId, at: now() }; try { lock.setPointerCapture(event.pointerId); } catch {} schedule();
  });
  const release = event => { if (press?.id === event.pointerId) { cancel(); sync(); } };
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) lock.addEventListener(name, release);
  lock.addEventListener('keydown', event => {
    if (![' ', 'Enter'].includes(event.key) || !locked) return;
    event.preventDefault(); if (!event.repeat && !press) { press = { id: event.key, at: now() }; schedule(); }
  });
  lock.addEventListener('keyup', event => { if ([' ', 'Enter'].includes(event.key)) { event.preventDefault(); cancel(); sync(); } });
  lock.addEventListener('blur', cancel);
  lock.addEventListener('click', event => { if (suppressClick && event.detail !== 0) { suppressClick = false; return; } if (!locked) { locked = true; cancel(); sync(); } });
  lock.addEventListener('contextmenu', event => event.preventDefault());
  toggle.addEventListener('click', () => { if (!locked) { onToggle(); sync(); } });
  controls.querySelector('#timerSessionReset').addEventListener('click', () => { if (!locked) { onReset(); sync(); } });
  controls.querySelector('#timerSessionClose').addEventListener('click', () => { if (!locked) close(); });
  const hidden = () => { if (doc.visibilityState === 'hidden') cancel(); };
  doc.addEventListener('visibilitychange', hidden); view.addEventListener('pagehide', cancel); sync();
  return { sync, get locked() { return active && locked; }, destroy() { close(); destroyed = true; doc.removeEventListener('visibilitychange', hidden); view.removeEventListener('pagehide', cancel); open.remove(); controls.remove(); } };
}
