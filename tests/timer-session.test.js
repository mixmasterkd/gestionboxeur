import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Window } from 'happy-dom';
import { mountTools } from '../js/tools.js';
const html = await readFile(new URL('../tools.html', import.meta.url), 'utf8');
function fixture() {
  const window = new Window({ settings: { disableJavaScriptEvaluation: true, disableCSSFileLoading: true } }); window.document.write(html); window.confirm = () => true;
  window.localStorage.setItem('gestionboxeur:tools:v1', JSON.stringify({ sound: false })); let time = 0;
  const ui = mountTools(window.document.getElementById('toolsApp'), { autoTick: false, now: () => time }); const $ = id => window.document.getElementById(id);
  return { window, ui, $, advance(ms) { time += ms; ui.tick(); }, pointer(type) { $('timerSessionLock').dispatchEvent(new window.PointerEvent(type, { pointerId: 1, pointerType: 'touch', bubbles: true })); }, async close() { ui.destroy(); await window.happyDOM.abort(); } };
}
test('session locks every timer command, cancels short holds and unlocks without stopping or resetting', async () => {
  const app = fixture(); try {
    app.ui.select('intervals'); app.$('timerStart').click(); app.$('timerFocusOpen').click();
    assert.equal(app.$('timerBoard').dataset.sessionLocked, 'true');
    app.$('timerReset').click(); app.$('timerStart').click(); app.$('timerSessionClose').click(); app.$('toolsBack').click(); assert.equal(app.$('timerBoard').dataset.status, 'running');
    app.pointer('pointerdown'); app.advance(2900); app.pointer('pointerup'); app.advance(1000); assert.equal(app.$('timerBoard').dataset.sessionLocked, 'true');
    app.pointer('pointerdown'); app.advance(3000); assert.equal(app.$('timerBoard').dataset.sessionLocked, 'false'); assert.equal(app.$('timerBoard').dataset.status, 'running');
    app.pointer('pointerup'); app.$('timerSessionLock').dispatchEvent(new app.window.MouseEvent('click', { detail: 1 })); assert.equal(app.$('timerBoard').dataset.sessionLocked, 'false');
    app.$('timerSessionToggle').click(); assert.equal(app.$('timerBoard').dataset.status, 'paused');
    app.window.confirm = () => { assert.fail('Reset must not ask for confirmation'); }; app.$('timerSessionReset').click(); assert.equal(app.$('timerBoard').dataset.status, 'idle');
    app.$('timerSessionClose').click(); assert.equal(app.$('timerBoard').classList.contains('is-session'), false);
  } finally { await app.close(); }
});
test('every timer resets immediately while running and paused without confirmation', async () => {
  for (const design of ['intervals', 'boxing', 'classic']) {
    const app = fixture(); try {
      app.window.confirm = () => { assert.fail('Reset must not ask for confirmation'); };
      app.ui.select(design === 'classic' ? 'boxing' : design);
      if (design === 'classic') { app.$('timerDesign').value = 'classic'; app.$('timerDesign').dispatchEvent(new app.window.Event('change')); }
      for (const paused of [false, true]) {
        app.$('timerStart').click(); app.advance(1000); if (paused) app.$('timerStart').click();
        app.$('timerReset').click(); assert.equal(app.$('timerBoard').dataset.status, 'idle'); assert.equal(app.$('timerFields').disabled, false);
      }
    } finally { await app.close(); }
  }
});
test('session enlarges the same modern boxing timer, relocks on start and leaves classic unchanged', async () => {
  const app = fixture(); try {
    app.ui.select('boxing'); app.$('timerFocusOpen').click(); assert.equal(app.$('timerBoard').dataset.sessionLocked, 'false'); app.$('timerSessionToggle').click(); assert.equal(app.$('timerBoard').dataset.sessionLocked, 'true');
    app.pointer('pointerdown'); app.advance(3000); app.pointer('pointerup'); app.$('timerSessionClose').click();
    app.$('timerDesign').value = 'classic'; app.$('timerDesign').dispatchEvent(new app.window.Event('change')); assert.equal(app.$('timerFocusOpen').hidden, true);
    app.$('timerFocusOpen').click(); assert.equal(app.$('timerBoard').classList.contains('is-session'), false);
  } finally { await app.close(); }
});
