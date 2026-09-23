/** Explicit attachment of a coach's free roster entry to an already linked account.
 * Opening/comparing is read-only. Only the final confirmation calls the atomic RPC.
 */
export function createRosterAttachmentUI({ document: doc, getContext, store, onInvite, onRefresh, onToast }) {
  let activeDialog;
  let generation = 0;
  const name = athlete => [athlete.firstName, athlete.lastName].filter(Boolean).join(' ');
  const weight = athlete => athlete.weightKg == null ? 'Non renseigné' : `${athlete.weightKg} kg`;
  const record = athlete => `${athlete.fights ?? 0} combats · ${athlete.wins ?? '—'} victoires · ${athlete.losses ?? '—'} défaites`;
  const sameRecord = (a, b) => ['fights', 'wins', 'losses'].every(key => a[key] === b[key]);
  function el(tag, text = '', attrs = {}) {
    const element = doc.createElement(tag);
    element.textContent = text;
    for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, value);
    return element;
  }
  function invalidate() {
    generation++;
    const dialog = activeDialog;
    activeDialog = null;
    if (dialog) { dialog.close(); dialog.remove(); }
  }
  function open(sourceId) {
    invalidate();
    const context = getContext();
    const sourceRow = context.athletes.find(athlete => athlete.id === sourceId && !athlete.userId);
    if (!context.userId || context.mode !== 'modern' || !sourceRow) return;
    const owner = context.userId;
    const ticket = generation;
    const source = { ...sourceRow };
    const candidates = context.athletes.filter(athlete => athlete.userId).map(athlete => ({ ...athlete }));
    const dialog = el('dialog', '', { class: 'roster-link-dialog', 'aria-labelledby': 'rosterLinkTitle' });
    activeDialog = dialog;
    const current = () => ticket === generation && getContext().userId === owner;
    const box = el('div', '', { class: 'dialog-box' });
    const header = el('header', '', { class: 'dialog-head' });
    const close = el('button', '×', { type: 'button', class: 'close', 'aria-label': 'Fermer' });
    close.addEventListener('click', () => dialog.close());
    header.append(el('h2', `Rattacher ${name(source)}`, { id: 'rosterLinkTitle' }), close);
    const body = el('div', '', { class: 'dialog-body' });
    body.append(el('p', 'Cette fiche peut rester dans tes listes sans compte ni calendrier. Le rattachement est facultatif.', { class: 'hint' }));
    const invitation = el('section', '', { class: 'roster-link-candidates' });
    invitation.append(el('h3', 'Pas encore de compte ?'));
    invitation.append(el('p', 'Invite l’athlète à s’inscrire à partir de cette fiche pour la conserver, sans créer de doublon.'));
    const inviteButton = el('button', 'Inviter à partir de cette fiche', { type: 'button', class: 'button secondary', 'data-action': 'invite' });
    inviteButton.addEventListener('click', () => {
      if (!current() || !dialog.open) return;
      dialog.close();
      onInvite(source);
    });
    invitation.append(inviteButton);
    body.append(invitation, el('h3', 'Un compte existe déjà ?'));
    const guidance = el('p', 'Si le compte n’apparaît pas ici, l’athlète doit demander le lien avec ton code coach. Accepte sa demande, puis reviens rattacher sa fiche. ');
    guidance.append(el('a', 'Voir les connexions', { href: 'planning.html?coachs=1' }));
    body.append(guidance);
    const form = el('form');
    const targetLabel = el('label', 'Compte de la même personne');
    const targetSelect = el('select', '', { id: 'rosterLinkTarget', required: '' });
    targetSelect.append(el('option', 'Choisir un compte déjà lié…', { value: '' }));
    for (const target of candidates) targetSelect.append(el('option', `${name(target)}${target.birthDate ? ` · ${target.birthDate}` : ''}`, { value: target.id }));
    targetSelect.disabled = !candidates.length;
    targetLabel.append(targetSelect);
    const details = el('div');
    const error = el('p', '', { role: 'alert', class: 'error' });
    error.hidden = true;
    const confirmLabel = el('label', '', { class: 'check-label' });
    const confirm = el('input', '', { type: 'checkbox', id: 'rosterLinkConfirm', required: '' });
    confirmLabel.append(confirm, doc.createTextNode(' Je confirme que ces deux fiches concernent la même personne.'));
    const actions = el('div', '', { class: 'roster-link-actions' });
    const cancel = el('button', 'Annuler', { type: 'button', class: 'button secondary' });
    cancel.addEventListener('click', () => dialog.close());
    const submit = el('button', 'Confirmer le rattachement', { type: 'submit', class: 'button' });
    submit.disabled = true;
    actions.append(cancel, submit);
    form.append(targetLabel, details, confirmLabel, error, actions);
    body.append(form); box.append(header, body); dialog.append(box); doc.body.append(dialog);
    dialog.addEventListener('close', () => { if (activeDialog === dialog) activeDialog = null; dialog.remove(); }, { once: true });
    let target = null;
    let choices = {};
    let busy = false;
    function ready() { submit.disabled = busy || !target || !confirm.checked || !choices.weight || !choices.record; }
    function comparisonColumn(athlete, title) {
      const section = el('section');
      const list = el('dl');
      for (const [label, value] of [['Nom', name(athlete)], ['Naissance', athlete.birthDate || 'Non renseignée'], ['Genre', athlete.sex || 'Non renseigné'], ['Poids', weight(athlete)], ['Bilan', record(athlete)]]) {
        list.append(el('dt', label), el('dd', value));
      }
      section.append(el('h3', title), list);
      return section;
    }
    function addChoice(container, key, title, format, identical) {
      if (identical) { choices[key] = 'target'; return; }
      const label = el('label', title);
      const select = el('select', '', { required: '', 'data-choice': key });
      select.append(el('option', 'Choisir la valeur à conserver…', { value: '' }),
        el('option', `Fiche libre : ${format(source)}`, { value: 'source' }),
        el('option', `Compte inscrit : ${format(target)}`, { value: 'target' }));
      select.addEventListener('change', () => { choices[key] = select.value; ready(); });
      label.append(select); container.append(label);
    }
    targetSelect.addEventListener('change', () => {
      target = candidates.find(athlete => athlete.id === targetSelect.value) || null;
      choices = {}; confirm.checked = false; details.replaceChildren(); error.hidden = true;
      if (target) {
        const columns = el('div', '', { class: 'roster-link-comparison' });
        columns.append(comparisonColumn(source, 'Fiche libre'), comparisonColumn(target, 'Compte inscrit'));
        const fields = el('div', '', { class: 'roster-link-choices' });
        addChoice(fields, 'weight', 'Poids à conserver', weight, source.weightKg === target.weightKg);
        addChoice(fields, 'record', 'Bilan de combats à conserver', record, sameRecord(source, target));
        details.append(columns, fields,
          el('p', 'L’identité du compte inscrit, son calendrier et ses droits d’accès restent inchangés. Les combats ne sont jamais additionnés.'),
          el('p', 'Tes notes des deux fiches sont conservées. La sélection pour les listes est conservée si l’athlète est disponible. L’ancienne fiche est retirée uniquement de ton tableau ; aucun compte ni calendrier n’est supprimé et les autres coachs ne sont pas touchés.'));
      }
      ready();
    });
    confirm.addEventListener('change', ready);
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (busy || !current() || !dialog.open || !target || !confirm.checked || !choices.weight || !choices.record) return;
      const latest = getContext();
      if (!latest.athletes.some(a => a.id === source.id && !a.userId) || !latest.athletes.some(a => a.id === target.id && a.userId === target.userId)) {
        error.textContent = 'Les fiches ont changé. Ferme cette fenêtre et recharge le tableau.'; error.hidden = false; return;
      }
      busy = true; error.hidden = true;
      const controls = [...form.querySelectorAll('input,select,button[type="submit"]'), inviteButton];
      controls.forEach(control => { control.disabled = true; });
      let saved = false;
      try {
        await store.mergeAthletes(source, target, { ...choices });
        saved = true;
        if (getContext().userId !== owner) return;
        if (current()) dialog.close();
        await onRefresh();
        if (current()) onToast('Fiche rattachée. Le compte et son calendrier sont conservés.');
      } catch (failure) {
        if (!current()) return;
        if (saved) onToast('Rattachement enregistré. Recharge la page pour actualiser le tableau.');
        else if (dialog.open) { error.textContent = failure.message || 'Impossible de rattacher les fiches.'; error.hidden = false; }
      } finally {
        busy = false;
        if (current() && dialog.open) { controls.forEach(control => { control.disabled = false; }); ready(); }
      }
    });
    dialog.showModal();
  }
  return { open, invalidate };
}
