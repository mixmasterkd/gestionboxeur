/** Deliberate touch/keyboard action: one completed hold, never a release/click or key repeat. */
export function bindHoldAction(control, { milliseconds = 2000, now = () => performance.now(), available = () => true, action, autoTick = true } = {}) {
  const doc = control.ownerDocument, view = doc.defaultView;
  let press = null, frame = null, destroyed = false, suppressClick = false;
  function cancel() {
    press = null; control.style.setProperty('--hold-progress', '0%');
    if (frame !== null) { view.cancelAnimationFrame(frame); frame = null; }
  }
  function tick() {
    if (!press || destroyed) return;
    if (!available() || doc.visibilityState === 'hidden' || control.disabled) { cancel(); return; }
    const elapsed = Math.max(0, now() - press.at);
    control.style.setProperty('--hold-progress', `${Math.min(100, elapsed / milliseconds * 100)}%`);
    if (elapsed >= milliseconds) { cancel(); action(); }
  }
  function schedule() { if (autoTick && press && frame === null) frame = view.requestAnimationFrame(() => { frame = null; tick(); schedule(); }); }
  const down = event => {
    if (destroyed || press || control.disabled || !available() || event.pointerType === 'mouse' && event.button !== 0) return;
    event.preventDefault(); suppressClick = true; press = { id: event.pointerId, at: now() };
    try { control.setPointerCapture(event.pointerId); } catch { /* Keyboard and synthetic input. */ }
    schedule();
  };
  const release = event => { if (press?.id === event.pointerId) cancel(); };
  const keydown = event => {
    if (![' ', 'Enter'].includes(event.key)) return;
    event.preventDefault();
    if (!event.repeat && !press && available() && !control.disabled) { press = { id: event.key, at: now() }; schedule(); }
  };
  const keyup = event => { if ([' ', 'Enter'].includes(event.key)) { event.preventDefault(); cancel(); } };
  const suppress = event => event.preventDefault();
  const freshPointer = () => { if (!press) suppressClick = false; };
  const releaseClick = event => {
    if (suppressClick && event.detail !== 0) { suppressClick = false; event.preventDefault(); event.stopImmediatePropagation(); }
  };
  doc.addEventListener('pointerdown', freshPointer, true);doc.addEventListener('click', releaseClick, true);
  const visibility = () => { if (doc.visibilityState === 'hidden') cancel(); };
  const listeners = [['pointerdown',down],['pointerup',release],['pointercancel',release],['lostpointercapture',release],['keydown',keydown],['keyup',keyup],['blur',cancel],['click',suppress],['contextmenu',suppress]];
  listeners.forEach(([name,callback])=>control.addEventListener(name,callback));
  doc.addEventListener('visibilitychange',visibility);view.addEventListener('pagehide',cancel);
  return { tick, cancel, destroy() { destroyed = true; cancel(); doc.removeEventListener('pointerdown', freshPointer, true);doc.removeEventListener('click', releaseClick, true); listeners.forEach(([name,callback])=>control.removeEventListener(name,callback));doc.removeEventListener('visibilitychange',visibility);view.removeEventListener('pagehide',cancel); } };
}
