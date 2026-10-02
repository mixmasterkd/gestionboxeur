const COLORS = ['cream', 'yellow', 'mint', 'rose'];
const LIMITS = { notes: 30, title: 100, body: 1200, links: 6, label: 100, url: 2048 };
const icons = {
  grip: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M7 4h.01M13 4h.01M7 10h.01M13 10h.01M7 16h.01M13 16h.01" stroke-width="3.3"/></svg>',
  edit: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="m12 4 4 4M3 17l4-1L17 6a2.8 2.8 0 0 0-4-4L3 12Z"/></svg>',
  remove: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 5 10 10M5 15 15 5"/></svg>',
  up: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 12 5-5 5 5"/></svg>',
  down: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 8 5 5 5-5"/></svg>',
};

/** Only public web links are ever navigable; never javascript:, data: or relative URLs. */
export function safeBulletinURL(value) {
  if (typeof value !== 'string' || value.length > LIMITS.url) return null;
  try {
    const url = new URL(value.trim());
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

/** A fresh copy, used only when the account has never saved a board. Empty is intentional. */
export function defaultBulletinBoard() {
  return { notes: [
    {
      id: 'boxing-quebec', title: 'Dans le coin du boxeur', color: 'cream',
      body: 'Les bons liens pour rester au courant et préparer la prochaine sortie du club.',
      links: [
        { label: 'Fédération québécoise de boxe olympique', url: 'https://fqbo.qc.ca/' },
        { label: 'Calendrier des événements', url: 'https://fqbo.qc.ca/events' },
      ],
    },
    {
      id: 'first-bout', title: 'Mon premier combat', color: 'yellow',
      body: 'Un bon départ, ça se prépare. Les repères à relire avec son coach avant de monter sur le ring.',
      links: [
        { label: 'Guide du premier combat amateur', url: 'https://www.fqbo.qc.ca/modules/publications/Clinique-initiation-aux-combats.pdf' },
        { label: 'Articles et règles — Boxe Canada (2025)', url: 'https://www.fqbo.qc.ca/modules/publications/Boxe%20Canada-Article%20et%20regle-Jan2025.pdf' },
      ],
    },
    {
      id: 'medical-forms', title: 'Dans mon sac de combat', color: 'mint',
      body: 'Les formulaires médicaux à vérifier avec le club et l’organisateur avant la compétition.',
      links: [
        { label: 'Formulaire médical annuel', url: 'https://www.fqbo.qc.ca/modules/publications/formulaire_medical_annuel.pdf' },
        { label: 'Questionnaire médical précombat', url: 'https://www.fqbo.qc.ca/modules/publications/medicalprecombat.pdf' },
      ],
    },
  ] };
}

export function normalizeBulletinBoard(value) {
  if (!value || !Array.isArray(value.notes) || value.notes.length > LIMITS.notes) throw new Error('Le format du babillard est invalide.');
  const ids = new Set();
  return { notes: value.notes.map(note => {
    if (!note || typeof note.id !== 'string' || !note.id || note.id.length > 100 || ids.has(note.id)) throw new Error('Une note du babillard est invalide.');
    ids.add(note.id);
    if (typeof note.title !== 'string' || !note.title.trim() || note.title.length > LIMITS.title || typeof note.body !== 'string' || note.body.length > LIMITS.body || !COLORS.includes(note.color) || !Array.isArray(note.links) || note.links.length > LIMITS.links) throw new Error('Une note du babillard est invalide.');
    const links = note.links.map(link => {
      const url = safeBulletinURL(link?.url);
      if (!url || typeof link.label !== 'string' || !link.label.trim() || link.label.length > LIMITS.label) throw new Error('Un lien du babillard est invalide.');
      return { label: link.label.trim(), url };
    });
    return { id: note.id, title: note.title.trim(), body: note.body, color: note.color, links };
  }) };
}

/** Personal board. The injected account store owns all persistence and authorization. */
export function mountBulletinBoard(host, { store, createScene } = {}) {
  const doc = host.ownerDocument, view = doc.defaultView;
  let board = { notes: [] }, disposed = false, loaded = false, version = 0, savedVersion = 0;
  let saving = Promise.resolve(), scene = null, sceneFrame = 0, resizeObserver = null, drag = null, editing = null;
  let returnFocus = null, loadGeneration = 0;
  const $ = selector => host.querySelector(selector);
  host.innerHTML = `
    <section class="bulletin" aria-label="Mon babillard personnel">
      <div class="bulletin-toolbar"><button id="bulletinAdd" type="button" class="button primary" disabled>+ Épingler une note</button></div>
      <div class="bulletin-state"><p id="bulletinStatus" role="status" aria-live="polite">Chargement de ton babillard…</p><button id="bulletinRetry" type="button" class="button secondary" hidden>Réessayer</button></div>
      <div class="bulletin-surface" data-render="fallback">
        <div class="bulletin-scene" aria-hidden="true"></div>
        <ol id="bulletinNotes" class="bulletin-notes" aria-label="Notes épinglées"></ol>
        <p id="bulletinEmpty" class="bulletin-empty" hidden>Un peu de place pour tes idées.<br><span>Épingle ta première note.</span></p>
      </div>
      <p class="bulletin-footnote">Babillard personnel · Liens ouverts dans un nouvel onglet<span id="bulletinDemo" hidden> · Démo : rien n’est enregistré dans un compte.</span></p>
      <dialog id="bulletinEditor" class="bulletin-dialog" aria-labelledby="bulletinEditorTitle">
        <form id="bulletinForm"><header><h2 id="bulletinEditorTitle">Épingler une note</h2><button type="button" class="bulletin-icon" data-close aria-label="Fermer">${icons.remove}</button></header>
          <label class="bulletin-field"><span>Titre</span><input name="title" required maxlength="100" autocomplete="off"></label>
          <label class="bulletin-field"><span>Ta note <small>facultatif</small></span><textarea name="body" rows="4" maxlength="1200"></textarea></label>
          <fieldset class="bulletin-colors"><legend>Couleur du papier</legend>${[['cream', 'Crème'], ['yellow', 'Jaune'], ['mint', 'Sauge'], ['rose', 'Rose']].map(([color, label]) => `<label data-color="${color}"><input type="radio" name="color" value="${color}" aria-label="${label}"><span aria-hidden="true"></span></label>`).join('')}</fieldset>
          <div class="bulletin-links-heading"><h3>Liens <small>facultatifs</small></h3><button id="bulletinAddLink" type="button" class="button secondary">+ Ajouter un lien</button></div>
          <div id="bulletinLinkFields" class="bulletin-link-fields"></div>
          <p id="bulletinFormError" class="bulletin-form-error" role="alert" hidden></p>
          <footer><button type="button" class="button secondary" data-close>Annuler</button><button type="submit" class="button primary">Épingler</button></footer>
        </form>
      </dialog>
      <dialog id="bulletinDelete" class="bulletin-dialog bulletin-delete-dialog" aria-labelledby="bulletinDeleteTitle"><h2 id="bulletinDeleteTitle">Retirer cette note ?</h2><p id="bulletinDeleteText"></p><p>Elle sera supprimée de ton babillard personnel.</p><footer><button id="bulletinDeleteCancel" type="button" class="button secondary">Annuler</button><button id="bulletinDeleteConfirm" type="button" class="button danger-button">Retirer la note</button></footer></dialog>
    </section>`;
  const surface = $('.bulletin-surface'), list = $('#bulletinNotes'), editor = $('#bulletinEditor'), deleteDialog = $('#bulletinDelete'), form = $('#bulletinForm');
  $('#bulletinDemo').hidden = !store?.demo;

  function message(text, { error = false, retry = false } = {}) {
    if (disposed) return;
    $('#bulletinStatus').textContent = text;
    $('#bulletinStatus').classList.toggle('is-error', error);
    $('#bulletinRetry').hidden = !retry;
    $('.bulletin-state').hidden = !text && !retry;
  }
  function updateScene() {
    if (disposed || sceneFrame) return;
    sceneFrame = view.requestAnimationFrame(() => { sceneFrame = 0; if (!disposed) scene?.update([...list.children]); });
  }
  async function startScene() {
    try {
      const factory = createScene || (await import('./bulletin-board-scene.js')).createBulletinBoardScene;
      if (disposed) return;
      scene = factory($('.bulletin-scene'), { surface, onFallback: () => { surface.dataset.render = 'fallback'; } });
      if (scene) { surface.dataset.render = 'ready'; updateScene(); }
    } catch { if (!disposed) surface.dataset.render = 'fallback'; }
  }
  function statusSaved() {
    message('');
  }
  function save() {
    if (!loaded || disposed) return;
    const revision = ++version, snapshot = normalizeBulletinBoard(board);
    message('Enregistrement…');
    // Serialize requests so an earlier slow save can never overwrite a newer one.
    saving = saving.catch(() => {}).then(() => { if (!disposed) return store.saveBoard(snapshot); }).then(() => {
      savedVersion = revision;
      if (!disposed && revision === version) statusSaved();
    }).catch(error => {
      const detail = typeof error?.message === 'string' ? error.message.slice(0, 350) : 'Vérifie ta connexion, puis réessaie.';
      if (!disposed && revision === version) message(`Non enregistré. Tes modifications sont encore affichées ici. ${detail}`, { error: true, retry: true });
    });
  }
  function iconButton(kind, label, action) {
    const button = doc.createElement('button'); button.type = 'button'; button.className = 'bulletin-icon'; button.innerHTML = icons[kind];
    button.title = label; button.setAttribute('aria-label', label); button.dataset.action = kind;
    if (action) button.addEventListener('click', action);
    return button;
  }
  function draw(focusId, focusAction = 'edit') {
    const nodes = board.notes.map((note, index) => {
      const card = doc.createElement('li'); card.className = 'bulletin-note'; card.dataset.noteId = note.id; card.dataset.color = note.color;
      const angle = [-1.8, 1.2, -1.05, 1.65, -.6, 1][index % 6];
      card.dataset.angle = String(angle); card.style.setProperty('--note-angle', `${angle}deg`);
      card.setAttribute('aria-label', note.title);
      const pin = doc.createElement('span'); pin.className = 'bulletin-pin'; pin.setAttribute('aria-hidden', 'true'); card.append(pin);
      const actions = doc.createElement('div'); actions.className = 'bulletin-note-actions';
      const grip = iconButton('grip', `Déplacer « ${note.title} »`); grip.classList.add('bulletin-grip');
      grip.addEventListener('pointerdown', event => startDrag(event, card));
      const up = iconButton('up', `Monter « ${note.title} »`, () => moveNote(note.id, -1)); up.disabled = index === 0;
      const down = iconButton('down', `Descendre « ${note.title} »`, () => moveNote(note.id, 1)); down.disabled = index === board.notes.length - 1;
      actions.append(grip, up, down, iconButton('edit', `Modifier « ${note.title} »`, event => openEditor(note, event.currentTarget)), iconButton('remove', `Retirer « ${note.title} »`, event => openDelete(note, event.currentTarget)));
      const heading = doc.createElement('h2'); heading.textContent = note.title;
      const body = doc.createElement('p'); body.className = 'bulletin-note-body'; body.textContent = note.body; body.hidden = !note.body;
      const links = doc.createElement('ul'); links.className = 'bulletin-note-links';
      for (const link of note.links) {
        const row = doc.createElement('li'), anchor = doc.createElement('a');
        anchor.href = safeBulletinURL(link.url); anchor.target = '_blank'; anchor.rel = 'noopener noreferrer'; anchor.textContent = link.label;
        const arrow = doc.createElement('span'); arrow.textContent = '↗'; arrow.setAttribute('aria-hidden', 'true'); anchor.append(arrow); row.append(anchor); links.append(row);
      }
      card.append(actions, heading, body, links); return card;
    });
    list.replaceChildren(...nodes);
    $('#bulletinEmpty').hidden = !loaded || board.notes.length > 0;
    $('#bulletinAdd').disabled = !loaded || board.notes.length >= LIMITS.notes;
    if (focusId) [...list.children].find(card => card.dataset.noteId === focusId)?.querySelector(`[data-action="${focusAction}"]:not(:disabled)`)?.focus({ preventScroll: true });
    updateScene();
  }
  function moveNote(id, offset) {
    const index = board.notes.findIndex(note => note.id === id), next = index + offset;
    if (index < 0 || next < 0 || next >= board.notes.length) return;
    [board.notes[index], board.notes[next]] = [board.notes[next], board.notes[index]];
    draw(id, offset < 0 ? 'up' : 'down'); save();
    // Edge move buttons become disabled; leave focus on the same note's grip instead.
    if (!list.contains(doc.activeElement)) [...list.children].find(card => card.dataset.noteId === id)?.querySelector('.bulletin-grip').focus({ preventScroll: true });
  }
  function startDrag(event, card) {
    if (event.button !== 0 || !loaded || board.notes.length < 2) return;
    event.preventDefault();
    drag = { id: card.dataset.noteId, button: event.currentTarget, pointerId: event.pointerId, changed: false, startX: event.clientX, startY: event.clientY };
    // The paper itself moves in the DOM. Capture on the fixed board, otherwise
    // browsers release capture when a paper is reinserted and cancel the gesture.
    surface.setPointerCapture?.(event.pointerId); card.classList.add('is-dragging');
  }
  function moveDrag(event) {
    if (!drag || event.pointerId !== drag.pointerId || Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 8) return;
    event.preventDefault();
    const moving = [...list.children].find(card => card.dataset.noteId === drag.id);
    const hit = doc.elementFromPoint?.(event.clientX, event.clientY)?.closest('.bulletin-note');
    if (hit && hit !== moving && list.contains(hit)) {
      const children = [...list.children];
      list.insertBefore(moving, children.indexOf(hit) > children.indexOf(moving) ? hit.nextSibling : hit);
      drag.changed = true; updateScene();
    }
    if (event.clientY < 85) view.scrollBy?.(0, -12);
    else if (event.clientY > view.innerHeight - 85) view.scrollBy?.(0, 12);
  }
  function finishDrag(commit) {
    if (!drag) return;
    const previous = drag; drag = null;
    try { surface.releasePointerCapture?.(previous.pointerId); } catch { /* Capture may already be lost. */ }
    if (commit && previous.changed) {
      const byId = new Map(board.notes.map(note => [note.id, note]));
      board.notes = [...list.children].map(card => byId.get(card.dataset.noteId)); save();
    }
    draw(previous.id, 'grip');
  }
  function endDrag(event) { if (drag?.pointerId === event.pointerId) finishDrag(true); }
  function cancelDrag(event) { if (drag?.pointerId === event.pointerId) finishDrag(false); }
  surface.addEventListener('pointermove', moveDrag);
  surface.addEventListener('pointerup', endDrag);
  surface.addEventListener('pointercancel', cancelDrag);
  surface.addEventListener('lostpointercapture', cancelDrag);
  function openDialog(dialog) {
    if (typeof dialog.showModal === 'function') dialog.showModal(); else dialog.setAttribute('open', '');
  }
  function closeDialog(dialog) {
    if (typeof dialog.close === 'function') dialog.close(); else dialog.removeAttribute('open');
    if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true }); else $('#bulletinAdd').focus({ preventScroll: true });
  }
  function linkField(link = { label: '', url: '' }) {
    const row = doc.createElement('div'); row.className = 'bulletin-link-field';
    const labelWrap = doc.createElement('label'), labelText = doc.createElement('span'), label = doc.createElement('input');
    labelText.textContent = 'Texte du lien'; label.type = 'text'; label.maxLength = LIMITS.label; label.value = link.label; label.autocomplete = 'off'; label.dataset.linkLabel = '';
    labelWrap.append(labelText, label);
    const urlWrap = doc.createElement('label'), urlText = doc.createElement('span'), url = doc.createElement('input');
    urlText.textContent = 'Adresse https://'; url.type = 'url'; url.maxLength = LIMITS.url; url.value = link.url; url.placeholder = 'https://…'; url.autocomplete = 'off'; url.dataset.linkUrl = '';
    urlWrap.append(urlText, url);
    const remove = iconButton('remove', 'Retirer ce lien', () => { row.remove(); $('#bulletinAddLink').disabled = false; $('#bulletinAddLink').focus(); });
    row.append(labelWrap, urlWrap, remove); $('#bulletinLinkFields').append(row);
    $('#bulletinAddLink').disabled = $('#bulletinLinkFields').children.length >= LIMITS.links;
    return label;
  }
  function openEditor(note = null, opener = $('#bulletinAdd')) {
    if (!loaded) return;
    editing = note?.id || null; returnFocus = opener;
    form.reset(); form.elements.title.value = note?.title || ''; form.elements.body.value = note?.body || '';
    const selectedColor = note?.color || COLORS[board.notes.length % COLORS.length];
    for (const radio of form.querySelectorAll('[name="color"]')) radio.checked = radio.value === selectedColor;
    $('#bulletinLinkFields').replaceChildren(); $('#bulletinAddLink').disabled = false;
    for (const link of note?.links || []) linkField(link);
    $('#bulletinFormError').hidden = true;
    $('#bulletinEditorTitle').textContent = note ? 'Modifier la note' : 'Épingler une note';
    form.querySelector('[type="submit"]').textContent = note ? 'Enregistrer' : 'Épingler';
    openDialog(editor); form.elements.title.focus();
  }
  function openDelete(note, opener) {
    editing = note.id; returnFocus = opener; $('#bulletinDeleteText').textContent = `« ${note.title} »`;
    openDialog(deleteDialog); $('#bulletinDeleteCancel').focus();
  }
  form.addEventListener('submit', event => {
    event.preventDefault();
    try {
      const title = form.elements.title.value.trim(), body = form.elements.body.value.trim(), color = form.querySelector('[name="color"]:checked')?.value;
      const links = [...$('#bulletinLinkFields').children].flatMap(row => {
        const label = row.querySelector('[data-link-label]').value.trim(), address = row.querySelector('[data-link-url]').value.trim();
        if (!label && !address) return [];
        const url = safeBulletinURL(address);
        if (!url) throw new Error('Utilise une adresse complète commençant par https:// ou http://.');
        if (!label) throw new Error('Ajoute un texte pour chaque lien.');
        return [{ label, url }];
      });
      if (!title) throw new Error('Donne un titre à ta note.');
      const id = editing || view.crypto?.randomUUID?.() || `note-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      const note = { id, title, body, color, links };
      const notes = editing ? board.notes.map(item => item.id === editing ? note : item) : [...board.notes, note];
      board = normalizeBulletinBoard({ notes });
      closeDialog(editor); draw(id); save();
    } catch (error) { $('#bulletinFormError').textContent = error.message; $('#bulletinFormError').hidden = false; }
  });
  $('#bulletinAdd').addEventListener('click', () => openEditor());
  $('#bulletinAddLink').addEventListener('click', () => { if ($('#bulletinLinkFields').children.length < LIMITS.links) linkField().focus(); });
  for (const button of form.querySelectorAll('[data-close]')) button.addEventListener('click', () => closeDialog(editor));
  $('#bulletinDeleteCancel').addEventListener('click', () => closeDialog(deleteDialog));
  $('#bulletinDeleteConfirm').addEventListener('click', () => {
    board.notes = board.notes.filter(note => note.id !== editing); closeDialog(deleteDialog); draw(); save(); $('#bulletinAdd').focus();
  });
  for (const dialog of [editor, deleteDialog]) dialog.addEventListener('cancel', event => { event.preventDefault(); closeDialog(dialog); });
  $('#bulletinRetry').addEventListener('click', () => loaded ? save() : load());
  async function load() {
    const generation = ++loadGeneration;
    message('Chargement de ton babillard…'); $('#bulletinRetry').disabled = true;
    try {
      if (!store?.loadBoard || !store?.saveBoard) throw new Error('Compte indisponible.');
      const saved = await store.loadBoard();
      if (disposed || generation !== loadGeneration) return;
      board = saved == null ? defaultBulletinBoard() : normalizeBulletinBoard(saved); loaded = true; draw();
      statusSaved();
    } catch {
      if (!disposed && generation === loadGeneration) message('Impossible de charger ton babillard. Vérifie ta connexion, puis réessaie. Aucune note n’a été remplacée.', { error: true, retry: true });
    } finally { if (!disposed && generation === loadGeneration) $('#bulletinRetry').disabled = false; }
  }
  const beforeUnload = event => { if (loaded && version > savedVersion) { event.preventDefault(); event.returnValue = ''; } };
  view.addEventListener('beforeunload', beforeUnload);
  view.addEventListener('resize', updateScene);
  if (view.ResizeObserver) { resizeObserver = new view.ResizeObserver(updateScene); resizeObserver.observe(surface); resizeObserver.observe(list); }
  void startScene(); const ready = load();
  return {
    ready,
    canLeave() {
      return !loaded || version <= savedVersion || view.confirm('Ton babillard n’est pas encore enregistré. Quitter cet outil et abandonner les modifications non enregistrées ?');
    },
    destroy() {
      if (disposed) return;
      disposed = true; loadGeneration++;
      if (sceneFrame) view.cancelAnimationFrame(sceneFrame);
      resizeObserver?.disconnect(); scene?.destroy();
      for (const dialog of [editor, deleteDialog]) if (dialog.open) dialog.close?.();
      view.removeEventListener('resize', updateScene); view.removeEventListener('beforeunload', beforeUnload);
      host.replaceChildren();
    },
  };
}
