import { VisualMemoryGame, DualTaskGame } from './mental-engine.js';
import { mentalScore } from './mental-records.js';

const TITLES = { 'visual-memory': 'Mémoire visuelle', 'dual-task': 'Double Tâche' };
export function mountMentalGame(host, { mode, store, now = () => performance.now(), random = Math.random, autoTick = true, onActivity = () => {} } = {}) {
  if (!Object.hasOwn(TITLES, mode)) throw new Error('Mode de jeu invalide.');
  const doc = host.ownerDocument, view = doc.defaultView, memory = mode === 'visual-memory';
  const game = memory ? new VisualMemoryGame({ now, random }) : new DualTaskGame({ now, random });
  let destroyed = false, frame = null, activity = false, recorded = false, saving = false, best = null, pending = null;
  let message = '', recordError = false, away = false;
  const $ = id => host.querySelector(`#${id}`);
  host.innerHTML = `<section class="mental" data-game="${mode}" aria-label="${TITLES[mode]}">
    <header class="mental-heading"><h2>${TITLES[mode]}</h2></header>
    <p id="mentalIntro" class="mental-intro">${memory ? 'Mémorise les cases éclairées ensemble, puis retrouve-les dans l’ordre de ton choix. Trois vies pour toute la partie.' : 'Touche les cercles rapidement. Ne touche pas les triangles : compte-les mentalement. Trente symboles, puis une question.'}</p>
    <div class="mental-metrics">${memory ? '<div><span>Niveau</span><output id="mentalLevel">1</output></div><div><span>Retrouvées</span><output id="mentalFound">0 / 3</output></div><div><span>Vies</span><output id="mentalLives">3</output></div>' : '<div><span>Série</span><output id="mentalProgress">0 / 30</output></div><div><span>Objectif</span><output>Cercles</output></div>'}<div><span>Record</span><output id="mentalBest">—</output></div></div>
    <p id="mentalStatus" class="mental-status" role="status" aria-live="polite">Prêt</p>
    ${memory ? `<div class="mental-grid" aria-label="Grille de 6 lignes et 6 colonnes">${Array.from({ length: 36 }, (_, i) => `<button class="mental-cell" type="button" data-cell="${i}" aria-label="Ligne ${Math.floor(i / 6) + 1}, colonne ${i % 6 + 1}" disabled><span aria-hidden="true"></span></button>`).join('')}</div><p id="mentalExposure" class="mental-exposure"></p>` : '<div id="mentalArena" class="mental-arena" aria-label="Zone des symboles"><button id="mentalStimulus" class="mental-stimulus" type="button" hidden><span aria-hidden="true"></span></button><span id="mentalFeedback" class="mental-feedback" aria-hidden="true"></span></div>'}
    <form id="mentalAnswerForm" class="mental-answer" hidden><label for="mentalAnswer">Combien de triangles as-tu vus ?</label><input id="mentalAnswer" type="number" inputmode="numeric" min="0" max="30" step="1" required autocomplete="off"><button class="button primary" type="submit">Valider</button><p id="mentalAnswerError" role="alert" hidden>Entre un nombre entier de 0 à 30.</p></form>
    <div id="mentalResults" class="mental-results" hidden><h3>Résultat</h3><dl id="mentalResultList"></dl></div>
    <div class="mental-actions"><button id="mentalStart" class="button primary" type="button">Commencer</button><button id="mentalStop" class="button secondary" type="button" hidden>Arrêter</button></div>
    <p id="mentalRecordStatus" class="mental-record-status" role="status"></p><button id="mentalRetry" class="text-button" type="button" hidden>Réessayer la sauvegarde</button>
    <p class="mental-storage">${store?.local ? 'Records et dernier résultat conservés sur cet appareil, pour ce compte.' : 'Records privés de ton compte.'}</p>
  </section>`;
  const root = host.querySelector('.mental');
  const setText = (id, value) => { const node = $(id); if (node.textContent !== String(value)) node.textContent = String(value); };
  function recordStatus() {
    if (destroyed) return;
    setText('mentalBest', best ? mentalScore(mode, best) : '—');
    setText('mentalRecordStatus', message); $('mentalRecordStatus').classList.toggle('is-error', recordError);
    $('mentalRetry').hidden = !pending || saving; $('mentalStart').disabled = saving || Boolean(pending);
  }
  async function save() {
    if (!pending || saving || destroyed) return;
    saving = true; recordError = false; message = 'Enregistrement…'; recordStatus();
    try {
      if (!store) throw new Error('Stockage des records indisponible.');
      const result = await store.saveResult(mode, pending);
      if (destroyed) return;
      best = result.best; pending = null; message = store.local ? 'Résultat enregistré sur cet appareil.' : 'Résultat enregistré.';
    } catch (error) { if (!destroyed) { message = error.message || 'Résultat non enregistré. Réessaie.'; recordError = true; } }
    finally { saving = false; recordStatus(); }
  }
  function results() {
    const value = game.result(), ms = number => number === null ? '—' : `${number} ms`;
    const fields = memory ? [['Niveau atteint', value.levelReached], ['Dernier niveau réussi', value.maxLevel], ['Erreurs', value.errors]] : [
      ['Score', value.score], ['Réaction moyenne', ms(value.averageReactionTime)], ['Meilleure réaction', ms(value.bestReactionTime)],
      ['Cercles réussis', value.targetsHit], ['Cercles manqués', value.targetsMissed], ['Triangles touchés', value.inhibitionErrors],
      ['Triangles apparus', value.triangleCount], ['Ta réponse', value.triangleAnswer], ['Écart', value.triangleError], ['Précision du comptage', `${value.precision} %`],
    ];
    $('mentalResultList').replaceChildren();
    for (const [label, result] of fields) {
      const row = doc.createElement('div'), term = doc.createElement('dt'), description = doc.createElement('dd');
      term.textContent = label; description.textContent = String(result); row.append(term, description); $('mentalResultList').append(row);
    }
    if (!recorded) { recorded = true; pending = value; void save(); }
  }
  function draw(state = game.snapshot()) {
    if (destroyed) return;
    root.dataset.status = state.status;
    root.classList.toggle('is-playing', state.active && state.status !== 'answer');
    if (state.active !== activity) { activity = state.active; onActivity(activity); }
    $('mentalIntro').hidden = state.active || state.status === 'done';
    $('mentalStart').hidden = state.active; $('mentalStart').textContent = state.status === 'idle' ? 'Commencer' : 'Rejouer';
    $('mentalStop').hidden = !state.active; $('mentalResults').hidden = state.status !== 'done';
    $('mentalAnswerForm').hidden = state.status !== 'answer';
    setText('mentalStatus', state.status === 'interrupted' ? away ? 'Partie interrompue après avoir quitté la page.' : 'Partie arrêtée.' : memory ? ({ idle: 'Prêt', showing: 'Mémorise', input: 'Retrouve les cases', success: 'Réussi !', done: state.lives ? 'Tous les niveaux réussis !' : 'Partie terminée' }[state.status]) : ({ idle: 'Prêt', waiting: 'Observe', stimulus: 'Cercles : toucher · Triangles : compter', gap: 'Observe', answer: 'À toi de répondre', done: 'Série terminée' }[state.status]));
    if (memory) {
      setText('mentalLevel', state.level); setText('mentalFound', `${state.found.length} / ${state.count}`); setText('mentalLives', state.lives);
      setText('mentalExposure', `Exposition : ${(state.exposure / 1000).toLocaleString('fr-CA')} s`);
      for (const cell of host.querySelectorAll('[data-cell]')) {
        const index = Number(cell.dataset.cell), correct = state.found.includes(index), wrong = state.wrong.includes(index);
        cell.disabled = state.status !== 'input' || correct || wrong;
        cell.classList.toggle('is-lit', state.status === 'showing' && state.pattern.includes(index));
        cell.classList.toggle('is-correct', correct); cell.classList.toggle('is-wrong', wrong);
        cell.classList.toggle('is-missed', state.status === 'done' && state.pattern.includes(index) && !correct);
        cell.querySelector('span').textContent = correct ? '✓' : wrong ? '×' : '';
      }
    } else {
      setText('mentalProgress', `${state.index} / ${state.total}`);
      const stimulus = $('mentalStimulus'); stimulus.hidden = !state.stimulus || state.responded;
      if (state.stimulus) {
        stimulus.dataset.shape = state.stimulus.type; stimulus.style.left = `clamp(40px, ${state.stimulus.x}%, calc(100% - 40px))`; stimulus.style.top = `clamp(40px, ${state.stimulus.y}%, calc(100% - 40px))`;
        stimulus.setAttribute('aria-label', state.stimulus.type === 'circle' ? 'Cercle : touche' : 'Triangle : ne touche pas');
      }
      setText('mentalFeedback', state.flash === 'correct' ? '✓' : state.flash === 'wrong' ? '×' : '');
      $('mentalFeedback').dataset.feedback = state.flash;
    }
    if (state.status === 'done') results(); recordStatus();
  }
  function tick() { let state = game.tick(); if (!memory && state.ready) state = game.reveal(); draw(state); }
  function schedule() {
    if (autoTick && !destroyed && game.active && game.status !== 'answer' && frame === null) frame = view.requestAnimationFrame(() => { frame = null; tick(); schedule(); });
  }
  function hit(event) {
    const button = memory ? event.target.closest?.('[data-cell]') : event.target.closest?.('#mentalStimulus');
    if (!button || button.disabled || button.hidden) return;
    if (event.type === 'pointerdown') { if (event.pointerType === 'mouse' && event.button !== 0) return; event.preventDefault(); }
    else if (event.detail !== 0) return;
    draw(memory ? game.hit(Number(button.dataset.cell)) : game.hit()); schedule();
  }
  root.addEventListener('pointerdown', hit); root.addEventListener('click', hit);
  $('mentalStart').addEventListener('click', () => { if (saving || pending || game.active) return; recorded = false; away = false; $('mentalAnswer').value = ''; $('mentalAnswerError').hidden = true; draw(game.start()); schedule(); });
  function interrupt(hidden = false) { away = hidden; if (frame !== null) view.cancelAnimationFrame(frame); frame = null; draw(game.interrupt()); }
  $('mentalStop').addEventListener('click', () => { if (view.confirm('Arrêter cette partie ? Elle ne sera pas enregistrée.')) interrupt(); });
  $('mentalAnswerForm').addEventListener('submit', event => {
    event.preventDefault(); const raw = $('mentalAnswer').value, answer = raw.trim() === '' ? NaN : Number(raw);
    if (!game.answer?.(answer)) { $('mentalAnswerError').hidden = false; return; }
    $('mentalAnswerError').hidden = true; $('mentalAnswer').blur(); draw();
  });
  $('mentalRetry').addEventListener('click', () => { void save(); });
  const visibility = () => { if (doc.visibilityState === 'hidden' && game.active) interrupt(true); };
  const pageHide = () => { if (game.active) interrupt(true); };
  const beforeUnload = event => { if (saving || pending) { event.preventDefault(); event.returnValue = ''; } };
  doc.addEventListener('visibilitychange', visibility); view.addEventListener('pagehide', pageHide); view.addEventListener('beforeunload', beforeUnload);
  draw();
  if (store) void store.getRecord(mode).then(value => { if (!destroyed) { if (value && (!best || mentalScore(mode, value.best) > mentalScore(mode, best))) best = value.best; recordStatus(); } }).catch(error => { if (!destroyed) { message = error.message; recordError = true; recordStatus(); } });
  return {
    tick,
    canLeave() { return !(game.active || saving || pending) || view.confirm(game.active ? 'Quitter ce jeu et arrêter la partie ?' : 'Le résultat n’est pas enregistré. Quitter quand même ?'); },
    destroy() { destroyed = true; if (frame !== null) view.cancelAnimationFrame(frame); onActivity(false); doc.removeEventListener('visibilitychange', visibility); view.removeEventListener('pagehide', pageHide); view.removeEventListener('beforeunload', beforeUnload); host.replaceChildren(); },
  };
}
