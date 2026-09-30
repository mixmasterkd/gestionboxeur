import * as defaultApi from './data.js';
import { el, button, field, input, displayName, errorBox, showError, busy, openDialog } from './ui.js';
import { createRecipientPicker, planningAthletes } from './group-selection.js';

export function createGroupsUI({ getUser, onToast = () => {}, api = defaultApi }) {
  const section = document.getElementById('groupDirectory');
  if (!section) return { refresh() {}, invalidate() {} };
  const list = document.getElementById('groupList'), error = document.getElementById('groupError');
  const add = document.getElementById('addGroupButton');
  let groups = [], account = null, generation = 0;
  const ownerCurrent = () => account?.user.id === getUser()?.id;
  const dialog = el('dialog', { class: 'group-dialog', 'aria-labelledby': 'groupDialogTitle' });
  document.body.append(dialog);
  function activate(groupsActive) {
    document.getElementById('athleteDirectory').hidden = groupsActive;
    document.getElementById('coachesDirectory').hidden = groupsActive;
    section.hidden = !groupsActive;
    for (const tab of document.querySelectorAll('[data-directory]')) tab.setAttribute('aria-pressed', String((tab.dataset.directory === 'groups') === groupsActive));
    const url = new URL(location.href); url.hash = groupsActive ? 'groupes' : ''; history.replaceState(history.state, '', url);
  }
  for (const tab of document.querySelectorAll('[data-directory]')) tab.addEventListener('click', () => activate(tab.dataset.directory === 'groups'));
  activate(location.hash === '#groupes');
  function symbol() {
    const node = el('span', { class: 'group-symbol', 'aria-hidden': 'true' });
    node.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="9" cy="7" r="3"/><path d="M3 20v-3a6 6 0 0 1 12 0v3M17 4a3 3 0 0 1 0 6m1 3a5 5 0 0 1 3 5"/></svg>';
    return node;
  }
  function render() {
    list.replaceChildren();
    for (const group of groups) {
      const members = (account?.athletes || []).filter(a => group.athlete_ids.includes(a.id));
      const href = new URL('planning.html', location.href); href.searchParams.set('group', group.id);
      list.append(el('article', { class: 'group-card' },
        el('div', { class: 'group-card-heading' }, symbol(), el('div', {}, el('h2', {}, group.name), el('p', { class: 'muted' }, `${group.athlete_ids.length} membre${group.athlete_ids.length > 1 ? 's' : ''}`))),
        el('p', { class: 'group-member-names' }, members.length ? members.map(displayName).join(', ') : 'Aucun membre'),
        el('div', { class: 'group-actions' }, el('a', { href: href.href, class: 'button' }, 'Calendrier'), button('Modifier', () => edit(group), 'button'))));
    }
    if (!groups.length) list.append(el('p', { class: 'group-empty' }, 'Crée un groupe pour planifier les entraînements de plusieurs athlètes ensemble.'));
  }
  function clear() {
    groups = []; account = null; list.replaceChildren(); add.disabled = true; error.hidden = true;
    if (dialog.open) dialog.close();
    dialog.replaceChildren();
  }
  async function refresh() {
    const ticket = ++generation, user = getUser(); clear();
    if (!user) return;
    try {
      const [loadedAccount, loadedGroups] = await Promise.all([api.loadAccount(user), api.loadTrainingGroups()]);
      if (ticket !== generation || user.id !== getUser()?.id) return;
      if (loadedAccount.profile?.account_type !== 'coach') throw new Error('La gestion des groupes est réservée aux coachs.');
      if (loadedAccount.planningAvailable === false) throw new Error('La planification doit être disponible pour gérer les groupes.');
      account = { ...loadedAccount, user }; groups = loadedGroups; render(); add.disabled = false;
    } catch (failure) { if (ticket === generation && user.id === getUser()?.id) { list.replaceChildren(); showError(error, failure); } }
  }
  function edit(group = null) {
    if (!account || !ownerCurrent() || group?.coach_id && group.coach_id !== getUser().id) return;
    const owner = getUser().id, ticket = generation;
    const name = input('group_name', group?.name || '', 'text', { required: true, maxLength: 100 });
    const eligible = planningAthletes(account);
    // Keep inaccessible existing members visible so their checked entry can be removed.
    const unavailable = (group?.athlete_ids || []).filter(id => !eligible.some(athlete => athlete.id === id));
    const athletes = [...eligible, ...unavailable.map(id => ({ ...(account.athletes.find(athlete => athlete.id === id) || { id, first_name: 'Athlète indisponible' }), planning_unavailable: true }))];
    const picker = createRecipientPicker({ athletes, athleteIds: group?.athlete_ids || [], allowGroups: false, legend: 'Membres' });
    picker.open();
    const failure = errorBox(), submit = el('button', { type: 'submit', class: 'button button-dark' }, 'Enregistrer');
    const cancel = button('Annuler', () => dialog.close(), 'button');
    const footer = el('footer', { class: 'group-actions' }, cancel, submit);
    const form = el('form', { class: 'group-form' }, field('Nom du groupe', name), picker.root,
      el('p', { class: 'muted group-rule' }, 'Les changements de membres s’appliquent aux séances à venir. L’historique et les bilans restent conservés.'), failure, footer);
    const close = button('×', () => dialog.close(), 'close', { 'aria-label': 'Fermer' });
    dialog.replaceChildren(el('header', { class: 'group-dialog-heading' }, el('h2', { id: 'groupDialogTitle', tabIndex: -1 }, group ? 'Modifier le groupe' : 'Créer un groupe'), close), form);
    let saving = false;
    const current = () => owner === getUser()?.id && ticket === generation && dialog.open;
    const preventClose = event => { if (saving) event.preventDefault(); };
    dialog.addEventListener('cancel', preventClose);
    dialog.addEventListener('close', () => dialog.removeEventListener('cancel', preventClose), { once: true });
    async function save(action, message) {
      if (saving || !current()) return;
      saving = true; failure.hidden = true; close.disabled = true; cancel.disabled = true;
      try {
        await busy(submit, action);
        if (!current()) return;
        dialog.close(); onToast(message); await refresh();
      } catch (err) { if (current()) showError(failure, err); }
      finally { saving = false; close.disabled = false; cancel.disabled = false; }
    }
    form.addEventListener('submit', event => {
      event.preventDefault(); if (!form.reportValidity()) return;
      if (!name.value.trim()) { showError(failure, new Error('Donne un nom au groupe.')); return; }
      if (picker.value().athlete_ids.some(id => unavailable.includes(id))) { showError(failure, new Error('Retire les membres dont l’accès à la planification a été retiré avant d’enregistrer.')); return; }
      void save(() => api.saveTrainingGroup({ name: name.value.trim(), athlete_ids: picker.value().athlete_ids }, group), 'Groupe enregistré.');
    });
    if (group) {
      const warning = el('p', { class: 'group-delete-warning', hidden: true }, 'Supprimer ce groupe retire ses séances à venir non réalisées lorsqu’elles ne sont pas attribuées autrement. Les séances passées et les bilans sont conservés.');
      let confirming = false;
      const remove = button('Supprimer le groupe', () => {
        if (saving) return;
        if (!confirming) { confirming = true; warning.hidden = false; remove.textContent = 'Confirmer la suppression'; return; }
        void save(() => api.deleteTrainingGroup(group), 'Groupe supprimé.');
      }, 'button danger');
      footer.before(warning); footer.prepend(remove);
    }
    openDialog(dialog, name);
  }
  add.addEventListener('click', () => edit());
  return { refresh, invalidate() { generation++; clear(); } };
}
