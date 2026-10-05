import { COLORS, ReactionGame } from './reaction-engine.js';

const MODES = { simple: 'Réaction simple', locate: 'Repérage', choice: 'Choix' };
const INPUTS = { touch: 'Tactile', mouse: 'Souris', keyboard: 'Clavier' };
const ERRORS = { early: 'Trop tôt', wrong: 'Mauvaise cible', multiple: 'Plusieurs appuis', timeout: 'Temps écoulé' };
const RULES = { simple: '1 bouton · Attends la couleur pour appuyer.', locate: '4 boutons · La couleur annoncée apparaît sur un seul bouton.', choice: '4 boutons, 4 couleurs · Touche uniquement la couleur annoncée.' };

export function mountReactionGame(host, { store = null, ownerId = 'local', storage, now = () => performance.now(), random = Math.random, autoTick = true, onActivity = () => {} } = {}) {
  const doc = host.ownerDocument, view = doc.defaultView;
  if (storage === undefined) { try { storage = view.localStorage; } catch { storage = null; } }
  const preferenceKey = `gestionboxeur:reaction:v1:${ownerId}`, config = { mode: 'simple', rounds: 5 };
  try {
    const value = JSON.parse(storage?.getItem(preferenceKey) || 'null');
    if (Object.hasOwn(MODES, value?.mode)) config.mode = value.mode;
    if ([1, 5, 10].includes(value?.rounds)) config.rounds = value.rounds;
  } catch { /* Only settings are local; account records never use localStorage. */ }
  let game = new ReactionGame({ ...config, now, random }), input = view.navigator.maxTouchPoints > 0 ? 'touch' : 'mouse';
  let destroyed = false, frame = null, activity = false, processed = 0, interruption = false;
  let loaded = false, loading = false, saving = false, resetPending = false, loadTicket = 0;
  let recordMessage = '', recordError = false, failedAction = null, lastResults = '';
  const records = new Map(), pending = new Map(), pointers = new Set(), keys = new Set();
  const $ = id => host.querySelector(`#${id}`), recordKey = (mode = config.mode, kind = input) => `${mode}:${kind}`;
  const formatTime = value => value === null || value === undefined ? '—' : `${value} ms`;
  host.innerHTML = `<section class="reaction" aria-label="Test de réactivité">
    <div class="reaction-settings"><label>Niveau<select id="reactionMode">${Object.entries(MODES).map(([value,label])=>`<option value="${value}">${label}</option>`).join('')}</select></label><label>Série<select id="reactionRounds"><option value="1">1 coup</option><option value="5">5 coups</option><option value="10">10 coups</option></select></label></div>
    <p id="reactionRule" class="reaction-rule"></p>
    <div class="reaction-play">
      <div class="reaction-announcement"><div><span class="reaction-eyebrow">Couleur à toucher</span><div class="reaction-target"><span id="reactionSwatch" class="reaction-swatch" aria-hidden="true"></span><strong id="reactionTargetName">—</strong></div></div><span id="reactionProgress" class="reaction-progress">—</span></div>
      <p id="reactionResult" class="reaction-result" role="status" aria-live="polite"></p>
      <div id="reactionArena" class="reaction-arena" tabindex="-1" aria-label="Zone de jeu"></div>
      <div class="reaction-actions"><button id="reactionStart" class="button primary" type="button">Démarrer</button><button id="reactionStop" class="button secondary" type="button" hidden>Arrêter</button></div>
    </div>
    <div class="reaction-metrics"><div><span>Meilleur de la série</span><output id="reactionBest">—</output></div><div><span>Moyenne valide</span><output id="reactionAverage">—</output></div><div><span>Erreurs</span><output id="reactionErrors">0</output></div></div>
    <ol id="reactionResults" class="reaction-results" aria-label="Résultats des coups"></ol>
    <div class="reaction-records"><div class="reaction-record-heading"><div><span class="reaction-eyebrow">Record personnel · <span id="reactionRecordMode"></span></span><output id="reactionRecord">—</output></div><label class="reaction-input-label">Commande<select id="reactionInput">${Object.entries(INPUTS).map(([value,label])=>`<option value="${value}">${label}</option>`).join('')}</select></label></div><div class="reaction-record-actions"><button id="reactionResetRecord" type="button" class="reaction-text-button">Effacer ce record</button><button id="reactionRetry" type="button" class="reaction-text-button" hidden>Réessayer</button></div><p id="reactionRecordStatus" role="status" hidden></p></div>
    <p class="reaction-footnote">Les records sont séparés par niveau et par commande. Le temps mesuré dépend aussi de l’appareil et du navigateur.</p>
    <p class="reaction-footnote"${store?.demo ? '' : ' hidden'}>Aperçu : les records restent en mémoire jusqu’au rechargement.</p>
  </section>`;
  const root = host.querySelector('.reaction');
  function setText(id, text) { const node = $(id); if (node.textContent !== text) node.textContent = text; }
  function updateRecordStatus() {
    if (destroyed) return;
    setText('reactionRecord', formatTime(records.get(recordKey())));
    setText('reactionRecordMode', MODES[config.mode]);
    $('reactionInput').value = input; $('reactionInput').disabled = resetPending;
    const status = $('reactionRecordStatus'); status.textContent = recordMessage; status.hidden = !recordMessage; status.classList.toggle('is-error', recordError);
    $('reactionRetry').hidden = !failedAction; $('reactionRetry').disabled = saving || loading || resetPending;
    $('reactionStart').disabled = resetPending;
    $('reactionResetRecord').disabled = !loaded || !store || game.active || loading || saving || resetPending || pending.size > 0 || !records.has(recordKey());
  }
  async function loadRecords() {
    if (destroyed || loading) return;
    const ticket = ++loadTicket; loading = true; recordMessage = 'Chargement des records…'; recordError = false; updateRecordStatus();
    try {
      if (!store) throw new Error('Connecte-toi pour enregistrer tes records.');
      const rows = await store.listRecords(); if (destroyed || ticket !== loadTicket) return;
      for (const row of rows) { const key = recordKey(row.mode, row.input); records.set(key, Math.min(records.get(key) ?? Infinity, row.best_ms)); }
      loaded = true; recordMessage = ''; failedAction = null;
    } catch (error) { if (!destroyed && ticket === loadTicket) { recordMessage = error.message || 'Records indisponibles.'; recordError = true; failedAction = loadRecords; } }
    finally { if (!destroyed && ticket === loadTicket) { loading = false; updateRecordStatus(); if (loaded) void flushRecords(); } }
  }
  async function flushRecords() {
    if (destroyed || saving || resetPending || loading || !pending.size) return;
    if (!loaded) { void loadRecords(); return; }
    saving = true; failedAction = null; recordError = false; recordMessage = 'Enregistrement du record…'; updateRecordStatus();
    try {
      while (!destroyed && pending.size) {
        const [key, value] = pending.entries().next().value, [mode, kind] = key.split(':');
        if (value >= (records.get(key) ?? Infinity)) { pending.delete(key); continue; }
        const row = await store.saveRecord(mode, kind, value);
        if (destroyed) return;
        records.set(key, Math.min(records.get(key) ?? Infinity, row.best_ms));
        if ((pending.get(key) ?? Infinity) >= value) pending.delete(key);
      }
      recordMessage = '';
    } catch (error) { if (!destroyed) { recordMessage = error.message || 'Record non enregistré. Réessaie.'; recordError = true; failedAction = flushRecords; } }
    finally { if (!destroyed) { saving = false; updateRecordStatus(); } }
  }
  function record(state) {
    for (; processed < state.results.length; processed++) {
      const result = state.results[processed];
      if (result.error || result.ms === null) continue;
      const key = recordKey(state.mode, result.input);
      if (result.ms < (records.get(key) ?? Infinity) && result.ms < (pending.get(key) ?? Infinity)) pending.set(key, result.ms);
    }
    if (pending.size && !failedAction) void flushRecords();
  }
  function draw(state = game.snapshot()) {
    if (destroyed) return;
    root.dataset.status = state.status;
    if (activity !== state.active) { activity = state.active; onActivity(activity); }
    $('reactionMode').disabled = $('reactionRounds').disabled = state.active || resetPending;
    $('reactionStart').hidden = state.active; $('reactionStop').hidden = !state.active;
    setText('reactionStart', state.status === 'idle' ? 'Démarrer' : 'Recommencer');
    const target = COLORS[state.target];
    setText('reactionTargetName', target?.name || '—');
    $('reactionSwatch').style.backgroundColor = target?.hex || '';
    setText('reactionProgress', state.trial ? `${state.trial} / ${state.rounds}` : `${state.rounds} coup${state.rounds > 1 ? 's' : ''}`);
    const last = state.last;
    let status = 'Prêt ? Attends le signal, puis touche la bonne couleur.';
    if (state.status === 'waiting') status = state.ready && (pointers.size || keys.size) ? 'Relâche les boutons…' : 'Attends l’apparition de la couleur…';
    else if (state.status === 'active') status = 'À toi !';
    else if (state.status === 'settling' || state.status === 'feedback') status = last?.error ? `${ERRORS[last.error]} · Coup non valide` : formatTime(last?.ms);
    else if (state.status === 'done') status = 'Série terminée';
    else if (state.status === 'interrupted') status = interruption ? 'Série interrompue en quittant la page.' : 'Série arrêtée.';
    setText('reactionResult', status);
    $('reactionResult').classList.toggle('is-error', ['settling','feedback'].includes(state.status) && Boolean(last?.error));
    for (const pad of $('reactionArena').querySelectorAll('.reaction-pad')) {
      const index = Number(pad.dataset.index), color = COLORS[state.colors[index]];
      pad.disabled = !['waiting', 'active', 'settling'].includes(state.status);
      pad.style.backgroundColor = color?.hex || '';
      pad.classList.toggle('is-lit', Boolean(color));
      pad.dataset.color = color?.id || '';
      pad.setAttribute('aria-label', color ? `${color.name}, bouton ${index + 1}` : `Bouton ${index + 1}`);
    }
    setText('reactionBest', formatTime(state.best)); setText('reactionAverage', formatTime(state.average)); setText('reactionErrors', String(state.errors));
    const resultKey = JSON.stringify(state.results);
    if (lastResults !== resultKey) {
      lastResults = resultKey;
      $('reactionResults').innerHTML = state.results.map(result=>`<li${result.error ? ' class="is-error"' : ''}><span>Coup ${result.trial}</span><strong>${result.error ? ERRORS[result.error] : formatTime(result.ms)}</strong></li>`).join('');
    }
    record(state); updateRecordStatus();
  }
  function schedule() {
    if (autoTick && !destroyed && game.active && frame === null) frame = view.requestAnimationFrame(() => { frame = null; tick(); schedule(); });
  }
  function tick() {
    if (destroyed) return;
    let state = game.tick();
    // This runs in requestAnimationFrame in production. The actual reveal, not
    // the wait deadline or the parent's 100 ms loop, starts the stopwatch.
    if (state.ready && !pointers.size && !keys.size) state = game.reveal();
    draw(state);
  }
  function hit(index, kind, overlapping = false) {
    if (destroyed) return;
    input = kind;
    let state = game.hit(index, kind);
    if (overlapping && state.status === 'settling') state = game.hit(index, kind);
    draw(state); schedule();
  }
  function board() {
    $('reactionMode').value = config.mode; $('reactionRounds').value = String(config.rounds);
    setText('reactionRule', RULES[config.mode]); root.dataset.mode = config.mode;
    $('reactionArena').innerHTML = Array.from({length:config.mode === 'simple' ? 1 : 4}, (_,index)=>`<button class="reaction-pad" type="button" data-index="${index}" aria-label="Bouton ${index+1}"><kbd aria-hidden="true">${config.mode === 'simple' ? 'Espace' : ['A','K','Z','M'][index]}</kbd></button>`).join('');
    draw();
  }
  function change() {
    if (game.active || resetPending || destroyed) return;
    config.mode = $('reactionMode').value; config.rounds = Number($('reactionRounds').value);
    if (!Object.hasOwn(MODES, config.mode) || ![1,5,10].includes(config.rounds)) return;
    game = new ReactionGame({ ...config, now, random }); processed = 0; interruption = false; pointers.clear(); keys.clear();
    try { storage?.setItem(preferenceKey, JSON.stringify(config)); } catch {}
    board();
  }
  $('reactionMode').addEventListener('change', change); $('reactionRounds').addEventListener('change', change);
  $('reactionInput').addEventListener('change', () => { if (!resetPending && Object.hasOwn(INPUTS, $('reactionInput').value)) { input = $('reactionInput').value; updateRecordStatus(); } });
  $('reactionStart').addEventListener('click', () => {
    if (game.active || resetPending || destroyed) return;
    processed = 0; interruption = false; pointers.clear(); keys.clear();
    if (view.matchMedia('(max-width:620px)').matches) root.querySelector('.reaction-play').scrollIntoView?.({block:'start',behavior:'instant'});
    draw(game.start()); $('reactionArena').focus({preventScroll:true}); schedule();
  });
  function interrupt(away) {
    interruption = away; pointers.clear(); keys.clear();
    if (frame !== null) { view.cancelAnimationFrame(frame); frame = null; }
    draw(game.interrupt());
  }
  $('reactionStop').addEventListener('click', () => interrupt(false));
  const onPointerDown = event => {
    const pad = event.target.closest?.('.reaction-pad');
    if (!pad || pad.disabled || (event.pointerType === 'mouse' && event.button !== 0)) return;
    event.preventDefault();
    if (pointers.has(event.pointerId)) return;
    const overlapping = pointers.size > 0 || keys.size > 0;
    pointers.add(event.pointerId);
    hit(Number(pad.dataset.index), event.pointerType === 'touch' ? 'touch' : 'mouse', overlapping);
  };
  const onRelease = event => pointers.delete(event.pointerId);
  const onKeyDown = event => {
    if (!game.active || event.altKey || event.ctrlKey || event.metaKey || event.target.closest?.('input,select,textarea,[contenteditable="true"]') || event.target.closest?.('button:not(.reaction-pad)')) return;
    const key = event.key.toLowerCase(), index = config.mode === 'simple' ? (key === ' ' || key === 'spacebar' ? 0 : -1) : ['a','k','z','m'].indexOf(key);
    if (index < 0) return;
    event.preventDefault();
    if (event.repeat || keys.has(key)) return;
    const overlapping = pointers.size > 0 || keys.size > 0; keys.add(key); hit(index, 'keyboard', overlapping);
  };
  const onKeyUp = event => keys.delete(event.key.toLowerCase());
  $('reactionArena').addEventListener('pointerdown', onPointerDown);
  $('reactionArena').addEventListener('click', event => {
    // Real pointers are measured on pointerdown. Only assistive/synthetic
    // activation without a pointer gets this fallback; no double counting.
    const pad = event.target.closest?.('.reaction-pad');
    if (event.detail === 0 && pad && !pad.disabled && !pointers.size && !keys.size) hit(Number(pad.dataset.index), 'keyboard');
  });
  $('reactionResetRecord').addEventListener('click', async () => {
    if (game.active || saving || loading || resetPending || pending.size || !loaded || !store || !records.has(recordKey())) return;
    const mode = config.mode, kind = input, key = recordKey();
    if (!view.confirm(`Effacer ton record ${MODES[mode]} · ${INPUTS[kind]} uniquement ?`)) return;
    resetPending = true; recordMessage = 'Suppression du record…'; recordError = false; failedAction = null; draw();
    try { await store.resetRecord(mode, kind); if (!destroyed) { records.delete(key); recordMessage = ''; } }
    catch (error) { if (!destroyed) { recordMessage = error.message || 'Impossible d’effacer ce record.'; recordError = true; } }
    finally { if (!destroyed) { resetPending = false; draw(); } }
  });
  $('reactionRetry').addEventListener('click', () => { if (!saving && !loading && !resetPending) void failedAction?.(); });
  const onVisibility = () => { if (doc.visibilityState === 'hidden' && game.active) interrupt(true); };
  const onAway = () => { if (game.active) interrupt(true); };
  const onBeforeUnload = event => { if (saving || resetPending || pending.size) { event.preventDefault(); event.returnValue = ''; } };
  view.addEventListener('pointerup', onRelease); view.addEventListener('pointercancel', onRelease);
  view.addEventListener('keydown', onKeyDown); view.addEventListener('keyup', onKeyUp);
  doc.addEventListener('visibilitychange', onVisibility); view.addEventListener('pagehide', onAway); view.addEventListener('blur', onAway); view.addEventListener('beforeunload', onBeforeUnload);
  board(); void loadRecords();
  return {
    tick,
    canLeave() { return !game.active && !saving && !resetPending && !pending.size || view.confirm(game.active ? 'Quitter ce test et arrêter la série ?' : 'Un record n’est pas encore enregistré. Quitter quand même ?'); },
    destroy() {
      destroyed = true; loadTicket++; game.interrupt(); if (frame !== null) view.cancelAnimationFrame(frame); pointers.clear(); keys.clear(); onActivity(false);
      view.removeEventListener('pointerup', onRelease); view.removeEventListener('pointercancel', onRelease); view.removeEventListener('keydown', onKeyDown); view.removeEventListener('keyup', onKeyUp);
      doc.removeEventListener('visibilitychange', onVisibility); view.removeEventListener('pagehide', onAway); view.removeEventListener('blur', onAway); view.removeEventListener('beforeunload', onBeforeUnload); host.replaceChildren();
    },
  };
}
