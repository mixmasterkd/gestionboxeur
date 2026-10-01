const modeLabel = mode => mode === 'advanced' ? 'Avancé' : mode === 'base' ? 'Base' : 'Mode inconnu';
const copy = value => JSON.parse(JSON.stringify(value));

/** Personal interval presets. The caller validates and applies each timer payload. */
export function mountTimerPresets(host, { store, getPreset, applyPreset, isLocked = () => false }) {
  const doc = host.ownerDocument;
  const available = Boolean(store && ['listTimers', 'saveTimer', 'deleteTimer'].every(method => typeof store[method] === 'function'));
  let destroyed = false, busy = false, panel = null, operation = 0, rows = [], confirming = null;
  const element = (tag, className, text) => {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const button = (text, action, className = 'button secondary') => {
    const node = element('button', className, text);
    node.type = 'button'; node.dataset.presetAction = action;
    return node;
  };
  const root = element('section', 'timer-presets');
  root.setAttribute('aria-label', 'Timers enregistrés');
  const toolbar = element('div', 'timer-presets-toolbar');
  const saveButton = button('Enregistrer', 'open-save');
  const loadButton = button('Charger', 'open-load');
  saveButton.setAttribute('aria-expanded', 'false'); loadButton.setAttribute('aria-expanded', 'false');
  toolbar.append(saveButton, loadButton);
  const lockedHint = element('p', 'timer-presets-hint', 'Réinitialise le timer pour enregistrer, charger ou supprimer un timer.');
  const demoHint = element('p', 'timer-presets-hint', 'Mode démo : les timers sont conservés pour cette session uniquement.');
  demoHint.hidden = !store?.demo;
  const unavailableHint = element('p', 'timer-presets-hint', 'La bibliothèque de timers est indisponible. Vérifie la connexion à ton compte ou recharge la page.');
  unavailableHint.hidden = available;
  const status = element('p', 'timer-presets-status');
  status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const error = element('p', 'timer-presets-error');
  error.setAttribute('role', 'alert'); error.hidden = true;

  const savePanel = element('form', 'timer-presets-panel');
  savePanel.hidden = true;
  const saveHeading = element('h3', '', 'Enregistrer ce timer');
  const label = element('label', 'timer-presets-title');
  label.append(element('span', '', 'Titre du timer'));
  const title = element('input');
  title.type = 'text'; title.name = 'timerPresetTitle'; title.maxLength = 100; title.required = true;
  title.autocomplete = 'off'; title.placeholder = 'Ex. Fractionné du mardi';
  label.append(title);
  const saveInfo = element('p', 'timer-presets-hint', 'Seul le mode actuellement affiché, Base ou Avancé, sera enregistré avec ses réglages.');
  const saveActions = element('div', 'timer-presets-panel-actions');
  const confirmSave = button('Enregistrer', 'save', 'button primary'); confirmSave.type = 'submit';
  const cancelSave = button('Annuler', 'close');
  saveActions.append(confirmSave, cancelSave);
  savePanel.append(saveHeading, label, saveInfo, saveActions);

  const loadPanel = element('section', 'timer-presets-panel'); loadPanel.hidden = true;
  loadPanel.setAttribute('aria-label', 'Liste des timers enregistrés');
  const loadHeader = element('div', 'timer-presets-panel-header');
  const loadHeading = element('h3', '', 'Mes timers'); loadHeading.tabIndex = -1;
  const closeLoad = button('Fermer', 'close');
  loadHeader.append(loadHeading, closeLoad);
  const list = element('ul', 'timer-presets-list');
  const empty = element('p', 'timer-presets-hint', 'Aucun timer enregistré pour le moment.'); empty.hidden = true;
  const retry = button('Réessayer', 'retry'); retry.hidden = true;
  loadPanel.append(loadHeader, list, empty, retry);
  root.append(toolbar, lockedHint, demoHint, unavailableHint, savePanel, loadPanel, status, error);
  host.append(root);

  const current = ticket => !destroyed && ticket === operation;
  const canAct = () => available && !destroyed && !busy && !isLocked();
  function feedback(message = '', problem = '') {
    status.textContent = message; error.textContent = problem; error.hidden = !problem;
  }
  function showPanel(next) {
    panel = next;
    savePanel.hidden = next !== 'save'; loadPanel.hidden = next !== 'load';
    saveButton.setAttribute('aria-expanded', String(next === 'save'));
    loadButton.setAttribute('aria-expanded', String(next === 'load'));
  }
  function sync() {
    if (destroyed) return;
    const locked = Boolean(isLocked());
    root.setAttribute('aria-busy', String(busy)); lockedHint.hidden = !locked;
    for (const control of root.querySelectorAll('button')) {
      control.disabled = busy || (control.dataset.presetAction !== 'close' && (locked || !available));
    }
    title.disabled = busy || locked || !available;
    confirmSave.textContent = busy && panel === 'save' ? 'Enregistrement…' : 'Enregistrer';
  }
  function renderRows() {
    list.replaceChildren(); empty.hidden = rows.length !== 0;
    for (const row of rows) {
      const item = element('li', 'timer-presets-item');
      const description = element('div', 'timer-presets-description');
      description.append(element('strong', '', String(row.title || 'Sans titre')), element('span', 'timer-presets-mode', modeLabel(row.payload?.mode)));
      const actions = element('div', 'timer-presets-item-actions');
      const load = button('Charger', 'load');
      load.setAttribute('aria-label', `Charger ${row.title || 'ce timer'}`);
      load.addEventListener('click', () => loadRow(row));
      const remove = button('×', 'delete', 'timer-presets-delete');
      remove.setAttribute('aria-label', `Supprimer ${row.title || 'ce timer'}`);
      remove.title = 'Supprimer ce timer';
      remove.addEventListener('click', () => {
        if (!canAct()) return;
        confirming = row.id; renderRows(); sync();
        list.querySelector('[data-preset-action="confirm-delete"]')?.focus();
      });
      actions.append(load, remove); item.append(description, actions);
      if (confirming === row.id) {
        actions.hidden = true;
        const confirmation = element('div', 'timer-presets-confirm');
        confirmation.append(element('p', '', `Supprimer « ${row.title || 'ce timer'} » ?`));
        const confirm = button('Supprimer', 'confirm-delete', 'button timer-presets-danger');
        confirm.addEventListener('click', () => deleteRow(row));
        const cancel = button('Annuler', 'cancel-delete');
        cancel.addEventListener('click', () => {
          if (busy || destroyed) return;
          confirming = null; renderRows(); sync();
          const index = rows.indexOf(row); list.children[index]?.querySelector('[data-preset-action="delete"]')?.focus();
        });
        confirmation.append(confirm, cancel); item.append(confirmation);
      }
      list.append(item);
    }
  }
  async function fetchRows() {
    if (!canAct()) return;
    const ticket = ++operation;
    busy = true; confirming = null; rows = []; list.replaceChildren(); empty.hidden = true; retry.hidden = true;
    feedback('Chargement des timers…'); sync();
    try {
      const result = await store.listTimers();
      if (!current(ticket)) return;
      rows = Array.isArray(result) ? result : [];
      renderRows(); feedback();
    } catch (cause) {
      if (!current(ticket)) return;
      retry.hidden = false; feedback('', cause?.message || 'Impossible de charger les timers. Réessaie.');
    } finally { if (current(ticket)) { busy = false; sync(); } }
  }
  async function save(event) {
    event.preventDefault();
    if (!canAct()) return;
    const name = title.value.trim();
    if (!name) { feedback('', 'Donne un titre à ce timer.'); title.focus(); return; }
    let payload;
    try { payload = copy(getPreset()); }
    catch (cause) { feedback('', cause?.message || 'Vérifie les réglages du timer avant de l’enregistrer.'); return; }
    if (isLocked()) { sync(); return; }
    const ticket = ++operation;
    let completed = false;
    busy = true; feedback('Enregistrement du timer…'); sync();
    try {
      await store.saveTimer({ title: name, payload });
      if (!current(ticket)) return;
      showPanel(null); title.value = ''; feedback(`« ${name} » enregistré · ${modeLabel(payload.mode)}.`);
      completed = true;
    } catch (cause) {
      if (current(ticket)) feedback('', cause?.message || 'Impossible d’enregistrer le timer. Réessaie.');
    } finally { if (current(ticket)) { busy = false; sync(); if (completed && !isLocked()) saveButton.focus(); } }
  }
  async function loadRow(row) {
    if (!canAct()) return;
    const ticket = ++operation;
    let completed = false;
    busy = true; feedback(); sync();
    try {
      const payload = copy(row.payload);
      if (isLocked()) return;
      const result = await applyPreset(payload);
      if (!current(ticket)) return;
      if (result === false) throw new Error('Ce timer n’a pas pu être chargé.');
      showPanel(null); feedback(`« ${row.title || 'Timer'} » chargé · ${modeLabel(payload.mode)}.`);
      completed = true;
    } catch (cause) {
      if (current(ticket)) feedback('', cause?.message || 'Ce timer est invalide ou ne peut pas être chargé.');
    } finally { if (current(ticket)) { busy = false; sync(); if (completed && !isLocked()) loadButton.focus(); } }
  }
  async function deleteRow(row) {
    if (!canAct() || confirming !== row.id) return;
    const ticket = ++operation;
    busy = true; feedback('Suppression du timer…'); sync();
    try {
      await store.deleteTimer(row.id);
      if (!current(ticket)) return;
      rows = rows.filter(item => item.id !== row.id); confirming = null;
      renderRows(); feedback(`« ${row.title || 'Timer'} » supprimé.`); loadHeading.focus();
    } catch (cause) {
      if (current(ticket)) feedback('', cause?.message || 'Impossible de supprimer le timer. Réessaie.');
    } finally { if (current(ticket)) { busy = false; sync(); } }
  }
  function close() {
    if (destroyed || busy) return;
    const previous = panel; confirming = null; showPanel(null); feedback();
    (previous === 'save' ? saveButton : loadButton).focus();
  }
  saveButton.addEventListener('click', () => {
    if (!canAct()) return;
    showPanel('save'); feedback(); title.focus();
  });
  loadButton.addEventListener('click', () => {
    if (!canAct()) return;
    showPanel('load'); fetchRows();
  });
  retry.addEventListener('click', fetchRows);
  savePanel.addEventListener('submit', save);
  cancelSave.addEventListener('click', close); closeLoad.addEventListener('click', close);
  root.addEventListener('keydown', event => {
    if (event.key === 'Escape' && panel && !busy) { event.preventDefault(); event.stopPropagation(); close(); }
  });
  sync();
  return {
    sync,
    destroy() { if (!destroyed) { destroyed = true; operation++; root.remove(); } },
  };
}
