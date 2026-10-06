import { CognitiveGame, cognitiveModeKey } from './cognitive-engine.js';
import { createCognitiveAudio } from './cognitive-audio.js';

export function mountCognitiveGames(host, { store = null, ownerId = 'local', storage, initialVariant, now = () => performance.now(), random = Math.random, autoTick = true, loadBag = () => import('./cognitive-bag-scene.js'), onActivity = () => {} } = {}) {
  const doc = host.ownerDocument, view = doc.defaultView;
  if (storage === undefined) { try { storage = view.localStorage; } catch { storage = null; } }
  const preferenceKey = `gestionboxeur:cognitive:v1:${ownerId}`;
  const config = { variant: 'tiles', count: 6, mode: 'sequence', numbers: true, sound: true };
  try {
    const value = JSON.parse(storage?.getItem(preferenceKey) || 'null');
    if (value?.variant === 'bag') config.variant = 'bag';
    if ([4, 6, 8].includes(value?.count)) config.count = value.count;
    if (value?.mode === 'targets') config.mode = 'targets';
    if (value?.numbers === false) config.numbers = false;
    if (value?.sound === false) config.sound = false;
  } catch { /* Preferences are optional; records never use localStorage. */ }
  if (['tiles', 'bag'].includes(initialVariant)) config.variant = initialVariant;
  let game = new CognitiveGame({ ...config, now, random }), scene = null, sceneTicket = 0;
  let destroyed = false, interval = null, lastCue = null, recorded = false, activity = false;
  let records = new Map(), loaded = false, loading = false, loadTicket = 0, saving = false, resetPending = false;
  let failedAction = null, recordMessage = '', recordError = false, interruption = false;
  const pendingScores = new Map();
  const $ = id => host.querySelector(`#${id}`);
  host.innerHTML = `<section class="cognitive" data-variant="${config.variant}" aria-label="Jeux cognitifs">
    <h2 id="cognitiveGameTitle" class="cognitive-game-title">${config.variant === 'tiles' ? 'Tuiles' : 'Sac'}</h2>
    <div id="cognitivePanel" role="region" aria-labelledby="cognitiveGameTitle">
      <div class="cognitive-settings">
        <div id="cognitiveTileSettings" class="cognitive-choice" role="group" aria-label="Nombre de tuiles"><span>Tuiles</span>${[4,6,8].map(n=>`<button type="button" data-count="${n}" aria-label="${n} tuiles">${n}</button>`).join('')}</div>
        <div id="cognitiveBagSettings" class="cognitive-bag-settings"><div class="cognitive-choice" role="group" aria-label="Mode du sac"><button type="button" data-mode="sequence">Séquence</button><button type="button" data-mode="targets">Cibles</button></div><label><input id="cognitiveNumbers" type="checkbox">Numéros</label></div>
        <label class="cognitive-sound"><input id="cognitiveSound" type="checkbox">Son</label>
      </div>
      <div class="cognitive-metrics"><div><span>Score</span><output id="cognitiveScore">0</output></div><div><span>Record</span><output id="cognitiveRecord">—</output></div><div><span id="cognitiveMetricLabel">Séquence</span><output id="cognitiveMetric">—</output></div></div>
      <div id="cognitiveBoard" class="cognitive-board"></div>
      <p id="cognitiveStatus" class="cognitive-status" role="status" aria-live="polite"></p>
      <div class="cognitive-actions"><button id="cognitiveStart" class="button primary" type="button">Démarrer</button><button id="cognitiveStop" class="button secondary" type="button" hidden>Arrêter</button></div>
      <p id="cognitiveRule" class="cognitive-rule"></p>
      <p id="cognitiveAudioError" class="cognitive-error" role="status" hidden></p>
      <div class="cognitive-records"><button id="cognitiveResetRecord" type="button" class="cognitive-text-button">Effacer ce record</button><p id="cognitiveRecordStatus" role="status" hidden></p><button id="cognitiveRetry" type="button" class="cognitive-text-button" hidden>Réessayer</button></div>
      <p class="cognitive-demo"${store?.demo ? '' : ' hidden'}>Aperçu : les records restent en mémoire jusqu’au rechargement.</p>
    </div>
  </section>`;
  const root = host.querySelector('.cognitive');
  const audio = createCognitiveAudio(view, () => {
    if (destroyed) return; $('cognitiveAudioError').textContent = 'Son indisponible. Le jeu reste utilisable sans son.'; $('cognitiveAudioError').hidden = false;
  });
  function savePreferences() { try { storage?.setItem(preferenceKey, JSON.stringify(config)); } catch {} }
  function stopSound() { audio.stop(); }
  function updateRecordStatus() {
    if (destroyed) return;
    const key = cognitiveModeKey(config);
    $('cognitiveRecord').textContent = records.has(key) ? String(records.get(key)) : loaded ? '0' : '—';
    const status = $('cognitiveRecordStatus'); status.textContent = recordMessage; status.hidden = !recordMessage; status.classList.toggle('is-error', recordError);
    $('cognitiveRetry').hidden = !failedAction; $('cognitiveRetry').disabled = saving || loading || resetPending;
    $('cognitiveStart').disabled = resetPending;
    $('cognitiveResetRecord').disabled = !loaded || !store || game.active || loading || saving || resetPending || pendingScores.size > 0 || !records.has(key);
  }
  async function loadRecords() {
    if (destroyed || loading) return;
    const ticket = ++loadTicket; loading = true; recordMessage = 'Chargement des records…'; recordError = false; updateRecordStatus();
    try {
      if (!store) throw new Error('Connecte-toi pour enregistrer tes records.');
      const rows = await store.listRecords(); if (destroyed || ticket !== loadTicket) return;
      for (const row of rows) records.set(row.mode, Math.max(records.get(row.mode) || 0, row.score));
      loaded = true; recordMessage = ''; failedAction = null;
    } catch (error) { if (!destroyed && ticket === loadTicket) { recordMessage = error.message || 'Records indisponibles.'; recordError = true; failedAction = loadRecords; } }
    finally { if (!destroyed && ticket === loadTicket) { loading = false; updateRecordStatus(); if (loaded) void flushScores(); } }
  }
  async function flushScores() {
    if (destroyed || saving || resetPending || loading || !pendingScores.size) return;
    if (!loaded) { void loadRecords(); return; }
    saving = true; failedAction = null; recordError = false; recordMessage = 'Enregistrement du record…'; updateRecordStatus();
    try {
      while (!destroyed && pendingScores.size) {
        const [mode, score] = pendingScores.entries().next().value;
        const row = await store.saveRecord(mode, score);
        if (destroyed) return;
        records.set(mode, Math.max(records.get(mode) || 0, row.score));
        if ((pendingScores.get(mode) || 0) <= score) pendingScores.delete(mode);
      }
      recordMessage = '';
    } catch (error) { if (!destroyed) { recordMessage = error.message || 'Record non enregistré. Réessaie.'; recordError = true; failedAction = flushScores; } }
    finally { if (!destroyed) { saving = false; updateRecordStatus(); } }
  }
  function record(state) {
    if (recorded || state.status !== 'finished') return;
    recorded = true;
    if (state.score > (records.get(state.key) || 0)) {
      pendingScores.set(state.key, Math.max(pendingScores.get(state.key) || 0, state.score)); void flushScores();
    }
  }
  function draw(state = game.snapshot()) {
    if (destroyed) return;
    root.dataset.status = state.status;
    if (activity !== state.active) { activity = state.active; onActivity(activity); }
    for (const button of host.querySelectorAll('button[data-count],button[data-mode]')) button.disabled = state.active || resetPending;
    $('cognitiveNumbers').disabled = state.active || resetPending;
    $('cognitiveStart').hidden = state.active; $('cognitiveStop').hidden = !state.active;
    $('cognitiveStart').textContent = state.status === 'idle' ? 'Démarrer' : 'Recommencer';
    $('cognitiveScore').textContent = String(state.score);
    const targets = config.variant === 'bag' && config.mode === 'targets';
    $('cognitiveMetricLabel').textContent = targets ? 'Temps' : 'Séquence';
    $('cognitiveMetric').textContent = targets ? `${Math.ceil(state.remaining / 1000)} s` : state.length ? String(state.length) : '—';
    const status = state.status === 'idle' ? (targets ? 'Prêt' : 'Prêt') : state.status === 'showing' ? 'Regarde' : state.status === 'input' ? 'À toi' : state.status === 'success' ? 'Réussi' : state.status === 'interrupted' ? (interruption ? 'Partie interrompue après avoir quitté la page.' : 'Partie arrêtée.') : state.reason === 'mistake' ? 'Fin de la séquence' : 'Terminé';
    if ($('cognitiveStatus').textContent !== status) $('cognitiveStatus').textContent = status;
    if (config.variant === 'tiles') {
      for (const tile of host.querySelectorAll('.cognitive-tile')) {
        const index = Number(tile.dataset.index); tile.disabled = state.status !== 'input';
        tile.classList.toggle('is-lit', state.lit === index || state.flash?.index === index && state.flash.correct);
        tile.classList.toggle('is-wrong', state.flash?.index === index && !state.flash.correct);
      }
    } else {
      const cue = $('cognitiveCue'); const cueText = state.lit === null ? '' : String(state.lit + 1);
      if (cue.textContent !== cueText) cue.textContent = cueText;
      const sceneState = { numbers: config.numbers, enabled: state.status === 'input', target: targets ? state.target : null, flash: state.flash };
      scene?.update(sceneState);
      for (const zone of host.querySelectorAll('.cognitive-fallback-zone')) {
        const index = Number(zone.dataset.index); zone.disabled = state.status !== 'input';
        zone.querySelector('span').hidden = !config.numbers;
        zone.classList.toggle('is-target', sceneState.target === index);
        zone.classList.toggle('is-hit', state.flash?.index === index && state.flash.correct);
        zone.classList.toggle('is-wrong', state.flash?.index === index && !state.flash.correct);
      }
    }
    const cueKey = state.lit === null ? null : `${state.length}:${game.demoIndex}:${state.lit}`;
    if (cueKey && cueKey !== lastCue && config.sound && config.variant === 'tiles') audio.play(state.lit);
    lastCue = cueKey;
    record(state); updateRecordStatus();
  }
  function hit(index) {
    if (destroyed) return;
    const state = game.hit(index); if (state.accepted) {
      scene?.hit(index); if (config.sound) audio.play(index, config.variant);
    }
    draw(state);
  }
  function releaseScene() { sceneTicket++; scene?.destroy(); scene = null; }
  function board() {
    releaseScene(); root.dataset.variant = config.variant;
    for (const button of root.querySelectorAll('[data-count]')) button.setAttribute('aria-pressed', String(Number(button.dataset.count) === config.count));
    for (const button of root.querySelectorAll('[data-mode]')) button.setAttribute('aria-pressed', String(button.dataset.mode === config.mode));
    $('cognitiveTileSettings').hidden = config.variant !== 'tiles'; $('cognitiveBagSettings').hidden = config.variant !== 'bag';
    $('cognitiveNumbers').checked = config.numbers; $('cognitiveSound').checked = config.sound;
    $('cognitiveRule').textContent = config.variant === 'tiles' ? 'Reproduis la séquence. Une étape de plus à chaque réussite.' : config.mode === 'sequence' ? 'Mémorise les chiffres, puis touche les zones dans le même ordre.' : '30 secondes · Bonne cible +1 · Erreur −1';
    if (config.variant === 'tiles') {
      $('cognitiveBoard').innerHTML = `<div class="cognitive-tiles" data-count="${config.count}">${Array.from({ length: config.count }, (_, i) => `<button class="cognitive-tile" type="button" data-index="${i}" aria-label="Tuile ${i + 1}"></button>`).join('')}</div>`;
      for (const tile of host.querySelectorAll('.cognitive-tile')) tile.addEventListener('click', () => hit(Number(tile.dataset.index)));
    } else {
      $('cognitiveBoard').innerHTML = `<div id="cognitiveCue" class="cognitive-cue" role="status" aria-label="Chiffre à mémoriser" aria-live="polite"></div><div id="cognitiveBagViewport" class="cognitive-bag-viewport" data-render="loading"><div class="cognitive-bag-fallback"><div class="cognitive-fallback-chain"></div><div class="cognitive-fallback-body">${Array.from({length:6},(_,i)=>`<button class="cognitive-fallback-zone" type="button" data-index="${i}" aria-label="Zone ${i+1}"><span>${i+1}</span></button>`).join('')}</div></div></div><p id="cognitiveRenderStatus" class="cognitive-render-status" role="status">Préparation du sac…</p>`;
      for (const zone of host.querySelectorAll('.cognitive-fallback-zone')) zone.addEventListener('click', () => hit(Number(zone.dataset.index)));
      const ticket = ++sceneTicket, viewport = $('cognitiveBagViewport');
      const fallback = () => {
        if (destroyed || ticket !== sceneTicket) return;
        scene?.destroy(); scene = null; viewport.dataset.render = 'fallback';
        $('cognitiveRenderStatus').textContent = 'Vue simplifiée : la 3D est indisponible.'; draw();
      };
      if (!view.WebGL2RenderingContext) fallback();
      else loadBag().then(({ createCognitiveBagScene }) => {
        if (destroyed || ticket !== sceneTicket) return;
        scene = createCognitiveBagScene(viewport, { onHit: hit, onUnavailable: fallback });
        viewport.dataset.render = 'ready'; $('cognitiveRenderStatus').textContent = ''; draw();
      }).catch(fallback);
    }
    draw();
  }
  function change(values) {
    if (game.active || resetPending || destroyed) return;
    stopSound(); Object.assign(config, values); game = new CognitiveGame({ ...config, now, random }); recorded = false; lastCue = null; interruption = false; savePreferences(); board();
  }
  for (const button of root.querySelectorAll('[data-count]')) button.addEventListener('click', () => change({count:Number(button.dataset.count)}));
  for (const button of root.querySelectorAll('[data-mode]')) button.addEventListener('click', () => change({mode:button.dataset.mode}));
  $('cognitiveNumbers').addEventListener('change', event => change({numbers:event.target.checked}));
  $('cognitiveSound').addEventListener('change', () => { config.sound = $('cognitiveSound').checked; savePreferences(); if (config.sound) void audio.unlock(); else stopSound(); });
  $('cognitiveStart').addEventListener('click', () => {
    if (game.active || resetPending || destroyed) return; interruption = false; recorded = false; lastCue = null;
    stopSound();
    if (config.sound) void audio.unlock();
    draw(game.start());
  });
  $('cognitiveStop').addEventListener('click', () => { stopSound(); interruption = false; draw(game.interrupt()); });
  $('cognitiveResetRecord').addEventListener('click', async () => {
    if (game.active || saving || loading || resetPending || pendingScores.size || !store || !loaded) return;
    const mode = cognitiveModeKey(config); if (!view.confirm('Effacer ton record pour ce mode uniquement ? Les autres records seront conservés.')) return;
    resetPending = true; recordMessage = 'Suppression du record…'; recordError = false; draw();
    try { await store.resetRecord(mode); if (!destroyed) { records.delete(mode); recordMessage = ''; } }
    catch (error) { if (!destroyed) { recordMessage = error.message || 'Impossible d’effacer ce record.'; recordError = true; } }
    finally { if (!destroyed) { resetPending = false; draw(); void flushScores(); } }
  });
  $('cognitiveRetry').addEventListener('click', () => { if (!saving && !loading && !resetPending) void failedAction?.(); });
  const onVisibility = () => { if (doc.visibilityState === 'hidden') { interruption = true; stopSound(); draw(game.interrupt()); } };
  const onPageHide = () => { interruption = true; stopSound(); draw(game.interrupt()); };
  const beforeUnload = event => { if (saving || resetPending || pendingScores.size) { event.preventDefault(); event.returnValue = ''; } };
  doc.addEventListener('visibilitychange', onVisibility); view.addEventListener('pagehide', onPageHide); view.addEventListener('beforeunload', beforeUnload);
  if (autoTick) interval = view.setInterval(() => draw(game.tick()), 50);
  board(); void loadRecords();
  return {
    tick() { draw(game.tick()); },
    canLeave() { return !game.active && !saving && !resetPending && !pendingScores.size || view.confirm(game.active ? 'Quitter ce jeu et arrêter la partie ?' : 'Un record n’est pas encore enregistré. Quitter quand même ?'); },
    destroy() {
      destroyed = true; loadTicket++; view.clearInterval(interval); stopSound(); audio.destroy(); releaseScene(); onActivity(false);
      doc.removeEventListener('visibilitychange', onVisibility); view.removeEventListener('pagehide', onPageHide); view.removeEventListener('beforeunload', beforeUnload); host.replaceChildren();
    },
  };
}
