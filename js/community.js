import { client, loadAccount } from './data.js';
import { mountNavigation } from './navigation.js';
import { command, loadGroups, loadGroup } from './community-api.js';
import { mountMemberPicker } from './community-member-picker.js';
import { captureGroupJoinToken, clearGroupJoinToken, mountJoinLinkManager, mountJoinLinkLanding } from './community-join-links.js';
import { $, el, button, field, input, textarea, select, heading, openDialog, errorBox, showError, busy, toast, confirmAction } from './ui.js';

const roleLabels = { owner: 'Créateur', admin: 'Admin · coach du groupe', member: 'Membre' };
const statusLabels = { open: 'À discuter', planned: 'Prévue', done: 'Réalisée' };
const dateFormatter = new Intl.DateTimeFormat('fr-CA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const state = { user: null, groups: [], groupsLoaded: false, detail: null, selectedId: new URL(location.href).searchParams.get('group'), tab: 'suggestions', ready: false, generation: 0 };
let selectionTicket = 0;
let dialogCleanup = null, landing = null, landingTicket = 0;
let joinToken = captureGroupJoinToken();
const isManager = group => ['owner', 'admin'].includes(group?.role);
const badge = role => el('span', { class: 'community-badge', dataset: { role } }, roleLabels[role] || 'Membre');
const formatDate = value => value && Number.isFinite(new Date(value).getTime()) ? dateFormatter.format(new Date(value)) : '';
const groupIdFromUrl = () => new URL(location.href).searchParams.get('group');
const empty = (title, description) => el('div', { class: 'community-empty' }, el('h3', {}, title), el('p', {}, description));

function clearDialog() { dialogCleanup?.(); dialogCleanup = null; }
function clearLanding() {
  landingTicket++; landing?.destroy(); landing = null;
  if (joinToken) clearGroupJoinToken(joinToken);
  joinToken = null;
}

function report(error) {
  const missing = ['42P01', '42703', 'PGRST202', 'PGRST205'].includes(error?.code);
  showError($('communityError'), missing ? new Error('Les groupes ne sont pas encore disponibles dans cet environnement.') : error);
  $('communityRetry').hidden = false;
}
function clearError() { $('communityError').hidden = true; $('communityRetry').hidden = true; }
function validateForm(form) {
  for (const control of form.querySelectorAll('input[required], textarea[required], select[required]')) {
    control.setCustomValidity(control.value.trim() ? '' : 'Complète ce champ avant de continuer.');
    control.addEventListener('input', () => control.setCustomValidity(''), { once: true });
  }
  return form.reportValidity();
}
function groupUrl(id, replace = false) {
  const url = new URL(location.href);
  if (id) url.searchParams.set('group', id); else url.searchParams.delete('group');
  if (url.href !== location.href) history[replace ? 'replaceState' : 'pushState']({}, '', url);
}
function renderBreadcrumb() {
  const breadcrumb = $('communityBreadcrumb');
  breadcrumb.hidden = !state.selectedId;
  if (!state.selectedId) { breadcrumb.replaceChildren(); return; }
  const group = state.detail?.group.id === state.selectedId ? state.detail.group : state.groups.find(item => item.id === state.selectedId);
  breadcrumb.replaceChildren(button('← Mes groupes', () => selectGroup(null), 'button secondary community-back'),
    el('span', { class: 'community-current-group', 'aria-current': 'page' }, group?.name || 'Groupe'));
}
function renderGroupShell() {
  const group = state.groups.find(item => item.id === state.selectedId);
  state.detail = null;
  $('communityList').hidden = true;
  $('communityDetail').hidden = false;
  $('communityDetail').setAttribute('aria-labelledby', 'communityGroupTitle');
  $('communityDetail').replaceChildren(el('header', { class: 'community-group-heading' }, el('div', {},
    el('p', { class: 'eyebrow' }, 'Groupe'), el('h1', { id: 'communityGroupTitle', tabindex: '-1' }, group?.name || 'Groupe'))));
  document.title = group ? `${group.name} · Mes groupes` : 'Groupe · Mes groupes';
  renderBreadcrumb();
}
function renderList() {
  $('communityList').hidden = false;
  $('communityDetail').hidden = true;
  state.detail = null;
  renderBreadcrumb();
  document.title = 'Mes groupes · GBoxeur';
  $('communityGroups').replaceChildren(...(state.groups.length ? state.groups.map(group => {
    const card = button('', () => selectGroup(group.id), 'community-group-card');
    card.append(el('h2', {}, group.name), el('p', {}, group.description || 'Entraînements, suggestions et sondages du groupe.'),
      el('div', { class: 'community-meta' }, badge(group.role), el('span', {}, `${group.member_count || 0} membre${group.member_count === 1 ? '' : 's'}`)));
    return card;
  }) : state.groupsLoaded ? [empty('Ton prochain groupe commence ici', 'Crée un groupe pour partager des entraînements, des suggestions et des sondages. Tu peux aussi accepter une invitation dans le menu.')] : []));
}

async function refresh(preferredId = state.selectedId, { focus = false, force = false } = {}) {
  // A completed action in a previous group must not navigate away from the current view.
  if (preferredId !== state.selectedId) return;
  const generation = state.generation, ticket = ++selectionTicket;
  const current = () => generation === state.generation && ticket === selectionTicket && state.selectedId === preferredId;
  clearError();
  $('communityLoading').hidden = false;
  $('communityLoading').textContent = preferredId ? 'Chargement du groupe…' : state.groupsLoaded ? 'Actualisation de tes groupes…' : 'Chargement de tes groupes…';
  $('communityMain').setAttribute('aria-busy', 'true');
  const [groupsResult, detailResult] = await Promise.allSettled([
    loadGroups({ force }), preferredId ? loadGroup(preferredId) : Promise.resolve(null)
  ]);
  if (!current()) return;
  if (groupsResult.status === 'fulfilled') { state.groups = groupsResult.value; state.groupsLoaded = true; }
  if (!preferredId) renderList();
  else if (detailResult.status === 'fulfilled') { state.detail = detailResult.value; renderDetail(); }
  else renderGroupShell();
  if (detailResult.status === 'rejected') report(detailResult.reason);
  else if (groupsResult.status === 'rejected') report(groupsResult.reason);
  $('communityLoading').hidden = true;
  $('communityMain').removeAttribute('aria-busy');
  if (focus) $(preferredId ? 'communityGroupTitle' : 'communityListTitle')?.focus({ preventScroll: true });
}

async function selectGroup(id, { writeUrl = true, force = false, focus = true, tab } = {}) {
  id = typeof id === 'string' && id ? id : null;
  clearLanding();
  if (id !== state.selectedId) { clearDialog(); $('communityDialog').close(); }
  clearError();
  if (writeUrl) groupUrl(id);
  if (id !== state.selectedId) state.tab = 'suggestions';
  if (tab) state.tab = tab;
  state.selectedId = id;
  if (!id) renderList();
  else if (state.detail?.group.id !== id) renderGroupShell();
  window.dispatchEvent(new window.CustomEvent('community:selection', { detail: { groupId: id } }));
  await refresh(id, { focus, force });
}

function openForm(title, content, saveLabel, submit) {
  clearDialog();
  const dialog = $('communityDialog'), error = errorBox();
  const save = button(saveLabel, null, 'button primary', { type: 'submit' });
  const cancel = button('Annuler', () => dialog.close());
  const form = el('form', {}, el('div', { class: 'community-dialog-content' }, content, error), el('div', { class: 'community-dialog-actions' }, cancel, save));
  const generation = state.generation;
  form.addEventListener('submit', event => {
    event.preventDefault();
    if (save.disabled || !validateForm(form)) return;
    error.hidden = true;
    busy(save, async () => {
      try {
        await submit(new FormData(form), form);
        if (generation === state.generation && dialog.open) dialog.close();
      } catch (failure) { if (generation === state.generation) showError(error, failure); }
    });
  });
  dialog.replaceChildren(heading(title, state.detail?.group?.name || 'Mes groupes', dialog, 'communityDialogTitle'), form);
  openDialog(dialog, form.querySelector('input, textarea, select'));
}

function editGroup(group = null) {
  openForm(group ? 'Modifier le groupe' : 'Créer un groupe', [
    field('Nom du groupe', input('name', group?.name || '', 'text', { required: true, maxlength: 100, autocomplete: 'off' }), 'Par exemple : Compétiteurs, MRJEU ou IntelCore.'),
    field('Description (facultative)', textarea('description', group?.description || '', { maxlength: 2000, rows: 3 })),
    el('p', { class: 'muted' }, group ? 'Le nom et la description sont visibles par les membres.' : 'Tu seras le créateur. Tu pourras ensuite inviter des membres et choisir des admins pour t’aider.')
  ], group ? 'Enregistrer' : 'Créer le groupe', async data => {
    const result = await command('save_group', { name: data.get('name').trim(), description: data.get('description').trim(), ...(group ? { id: group.id, updated_at: group.updated_at } : {}) });
    const id = result.id || group?.id;
    $('communityDialog').close();
    toast(group ? 'Le groupe est mis à jour.' : 'Ton groupe est créé. Invite maintenant tes membres.');
    await selectGroup(id, { force: true, tab: group ? state.tab : 'members' });
  });
}

function renderDetail() {
  const { group } = state.detail;
  $('communityList').hidden = true;
  $('communityDetail').hidden = false;
  $('communityDetail').setAttribute('aria-labelledby', 'communityGroupTitle');
  document.title = `${group.name} · Mes groupes`;
  renderBreadcrumb();
  const header = el('header', { class: 'community-group-heading' },
    el('div', {}, el('p', { class: 'eyebrow' }, 'Groupe'), el('h1', { id: 'communityGroupTitle', tabindex: '-1' }, group.name),
      el('div', { class: 'community-meta' }, badge(group.role), el('span', {}, `${state.detail.members.length} membre${state.detail.members.length === 1 ? '' : 's'}`))),
    group.role === 'owner' ? button('Modifier le groupe', () => editGroup(group)) : null);
  const panel = el('section', { id: 'communityTabPanel', class: 'community-tab-panel', role: 'tabpanel', tabindex: '0' });
  const tabs = el('div', { class: 'community-tabs', role: 'tablist', 'aria-label': 'Sections du groupe' });
  const choices = [['suggestions', 'Suggestions'], ['polls', 'Sondages'], ['members', 'Membres']];
  for (const [key, label] of choices) {
    const tab = button(label, () => activateTab(key), '', { id: `communityTab-${key}`, role: 'tab', 'aria-selected': String(key === state.tab), 'aria-controls': panel.id, tabindex: key === state.tab ? '0' : '-1' });
    tab.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const index = choices.findIndex(([name]) => name === key);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? 2 : (index + (event.key === 'ArrowRight' ? 1 : -1) + 3) % 3;
      activateTab(choices[next][0], true);
    });
    tabs.append(tab);
  }
  $('communityDetail').replaceChildren(header, tabs, panel);
  activateTab(state.tab);
}

function activateTab(key, focus = false) {
  state.tab = key;
  for (const tab of $('communityDetail').querySelectorAll('[role="tab"]')) {
    const selected = tab.id === `communityTab-${key}`;
    tab.setAttribute('aria-selected', String(selected)); tab.tabIndex = selected ? 0 : -1;
    if (selected && focus) tab.focus();
  }
  const panel = $('communityTabPanel');
  panel.setAttribute('aria-labelledby', `communityTab-${key}`);
  panel.replaceChildren(key === 'suggestions' ? renderSuggestions() : key === 'polls' ? renderPolls() : renderMembers());
}

async function mutate(control, action, data, message) {
  clearError();
  const generation = state.generation, id = state.detail?.group.id;
  await busy(control, async () => {
    try {
      await command(action, data);
      if (generation !== state.generation) return;
      if (message) toast(message);
      if (state.detail?.group.id === id) await refresh(id);
    } catch (error) { if (generation === state.generation && state.selectedId === id) report(error); }
  });
}

function createSuggestion() {
  const group = state.detail.group;
  openForm('Faire une suggestion', [
    el('p', { class: 'muted' }, `Visible seulement par les membres de ${group.name}.`),
    field('Ton idée', textarea('content', '', { required: true, maxlength: 5000, rows: 5 }))
  ], 'Publier dans le groupe', async data => {
    await command('create_post', { group_id: group.id, kind: 'suggestion', content: data.get('content').trim() });
    $('communityDialog').close(); toast('Ta suggestion est publiée.');
    try { await refresh(group.id); } catch (error) { report(error); }
  });
}

function renderSuggestions() {
  const posts = state.detail.posts.filter(post => post.kind === 'suggestion').sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || new Date(b.created_at) - new Date(a.created_at));
  return el('div', {},
    el('div', { class: 'community-section-heading' }, el('div', {}, el('h2', {}, 'Les suggestions du groupe'), el('p', {}, 'Propose une idée, soutiens celles qui te plaisent et suis leur avancement.')),
      button('Faire une suggestion', createSuggestion, 'button primary')),
    el('div', { class: 'community-stack' }, posts.length ? posts.map(renderPost) : empty('Une idée pour le groupe ?', 'Fais une première suggestion pour améliorer vos entraînements ou votre organisation.')));
}

function renderPost(post) {
  const group = state.detail.group;
  const meta = el('div', { class: 'community-meta' }, el('span', { class: 'community-badge' }, 'Suggestion'),
    post.pinned ? el('span', {}, 'Épinglé') : null,
    el('span', {}, statusLabels[post.status] || statusLabels.open));
  const article = el('article', { class: 'community-post', 'aria-label': `Suggestion de ${post.author_name || 'Membre'}` },
    el('header', { class: 'community-post-header' }, el('div', { class: 'community-meta' }, el('strong', {}, post.author_name || 'Membre'), el('time', { datetime: post.created_at }, formatDate(post.created_at))), meta),
    el('p', { class: 'community-content' }, post.content));
  const actions = el('div', { class: 'community-post-footer' });
  const support = button(`${post.supported_by_me ? '✓ Je soutiens' : 'Soutenir'} · ${post.support_count || 0}`, () => mutate(support, 'support_post', { id: post.id }), 'button secondary', { 'aria-pressed': String(Boolean(post.supported_by_me)) });
  actions.append(support);
  if (isManager(group) || post.author_id === state.user.id) {
    const moderation = el('details', { class: 'community-details community-moderation' }, el('summary', {}, 'Gérer la suggestion'));
    const controls = el('div', { class: 'community-actions' });
    if (isManager(group)) {
      const pin = button(post.pinned ? 'Désépingler' : 'Épingler', () => mutate(pin, 'pin_post', { id: post.id }));
      controls.append(pin);
      const status = select('status', Object.entries(statusLabels).map(([value, label]) => ({ value, label })), post.status || 'open', { 'aria-label': 'Suivi de la suggestion' });
      const save = button('Mettre à jour', () => mutate(save, 'status_post', { id: post.id, status: status.value }));
      controls.append(status, save);
    }
    const remove = button('Supprimer', async () => {
      if (await confirmAction('Supprimer cette suggestion ?', 'La suggestion et ses commentaires seront retirés du groupe.', 'Supprimer')) await mutate(remove, 'delete_post', { id: post.id }, 'La suggestion est supprimée.');
    });
    controls.append(remove); moderation.append(controls); actions.append(moderation);
  }
  article.append(actions);
  const comments = post.comments || [];
  const discussion = el('details', { class: 'community-details community-comments' }, el('summary', {}, `${comments.length} commentaire${comments.length === 1 ? '' : 's'} · Répondre`));
  discussion.append(...comments.map(comment => el('div', { class: 'community-comment' },
    el('div', { class: 'community-meta' }, el('strong', {}, comment.author_name || 'Membre'), el('time', { datetime: comment.created_at }, formatDate(comment.created_at))), el('p', {}, comment.content))));
  const content = textarea('comment', '', { required: true, maxlength: 2000, rows: 2 });
  const error = errorBox();
  const send = button('Envoyer', null, 'button secondary', { type: 'submit' });
  const form = el('form', { class: 'community-comment-form' }, field('Ton commentaire', content), error, send);
  form.addEventListener('submit', event => {
    event.preventDefault(); if (send.disabled || !validateForm(form)) return;
    const generation = state.generation;
    busy(send, async () => {
      error.hidden = true;
      try {
        await command('comment_post', { id: post.id, content: content.value.trim() });
        if (generation !== state.generation) return;
        toast('Ton commentaire est ajouté.');
        await refresh(group.id);
      } catch (failure) { if (generation === state.generation) showError(error, failure); }
    });
  });
  discussion.append(form); article.append(discussion);
  return article;
}

function createPoll() {
  const group = state.detail.group;
  const options = el('div', { class: 'community-poll-option-fields' });
  const appendOption = () => options.append(field(`Choix ${options.children.length + 1}`, input('option', '', 'text', { required: true, maxlength: 200 })));
  appendOption(); appendOption();
  const add = button('Ajouter un choix', () => { if (options.children.length < 10) appendOption(); add.disabled = options.children.length >= 10; });
  openForm('Créer un sondage', [
    field('Question', textarea('question', '', { required: true, maxlength: 500, rows: 2 })), options, add,
    field('Date de fin (facultative)', input('closes_at', '', 'datetime-local'), 'Sans date, tu pourras fermer le sondage quand tu voudras.'),
    el('p', { class: 'muted' }, 'Chaque membre peut choisir une réponse et changer son vote tant que le sondage est ouvert.')
  ], 'Publier le sondage', async data => {
    const choiceValues = data.getAll('option').map(value => value.trim());
    if (new Set(choiceValues.map(value => value.toLocaleLowerCase('fr-CA'))).size !== choiceValues.length) throw new Error('Chaque choix doit être différent.');
    const ending = data.get('closes_at');
    if (ending && (!Number.isFinite(new Date(ending).getTime()) || new Date(ending).getTime() <= Date.now())) throw new Error('La date de fin doit être dans le futur.');
    await command('create_poll', { group_id: group.id, question: data.get('question').trim(), options: choiceValues, closes_at: ending ? new Date(ending).toISOString() : null });
    $('communityDialog').close(); toast('Le sondage est publié.');
    try { await refresh(group.id); } catch (error) { report(error); }
  });
}

function renderPolls() {
  return el('div', {},
    el('div', { class: 'community-section-heading' }, el('div', {}, el('h2', {}, 'La voix du groupe'), el('p', {}, 'Choisis une réponse pour participer.')),
      isManager(state.detail.group) ? button('Créer un sondage', createPoll, 'button primary') : null),
    el('div', { class: 'community-stack' }, state.detail.polls.length ? state.detail.polls.map(renderPoll) : empty('Aucun sondage pour le moment', 'Les sondages publiés par les admins apparaîtront ici.')));
}

function renderPoll(poll) {
  const closed = Boolean(poll.closed_at) || Boolean(poll.closes_at && new Date(poll.closes_at).getTime() <= Date.now());
  const total = Number(poll.total_votes) || 0;
  const article = el('article', { class: 'community-poll' }, el('h3', {}, poll.question),
    el('div', { class: 'community-meta' }, el('span', { class: 'community-badge' }, closed ? 'Terminé' : 'Ouvert'),
      el('span', {}, `${total} vote${total === 1 ? '' : 's'}`), poll.closes_at ? el('span', {}, `${closed ? 'Fin' : 'Jusqu’au'} ${formatDate(poll.closes_at)}`) : null));
  const options = el('div', { class: 'community-poll-options', role: 'group', 'aria-label': 'Réponses au sondage' });
  for (const option of poll.options) {
    const selected = option.id === poll.my_vote;
    const percentage = total ? Math.round(Number(option.votes || 0) / total * 100) : 0;
    const vote = button('', () => mutate(vote, 'vote', { poll_id: poll.id, option_id: option.id }, 'Ton vote est enregistré.'), 'community-poll-option', { disabled: closed, 'aria-pressed': String(selected) });
    vote.append(el('span', { class: 'community-option-fill', style: `width:${Math.min(100, Math.max(0, percentage))}%;`, 'aria-hidden': 'true' }),
      el('span', { class: 'community-option-label' }, `${selected ? '✓ ' : ''}${option.label}`), el('span', { class: 'community-option-count' }, `${option.votes || 0} · ${percentage} %`));
    options.append(vote);
  }
  article.append(options);
  if (!closed && isManager(state.detail.group)) {
    const close = button('Fermer le sondage', async () => {
      if (await confirmAction('Fermer ce sondage ?', 'Les résultats resteront visibles. Les membres ne pourront plus voter.', 'Fermer le sondage')) await mutate(close, 'close_poll', { id: poll.id }, 'Le sondage est terminé.');
    });
    article.append(close);
  }
  return article;
}

function inviteMember() {
  const group = state.detail.group;
  if (!isManager(group)) return;
  clearDialog();
  const dialog = $('communityDialog'), host = el('div', { class: 'community-dialog-content community-member-picker' });
  const generation = state.generation, userId = state.user.id;
  const current = () => generation === state.generation && state.user?.id === userId && state.selectedId === group.id && dialog.open && host.isConnected;
  dialog.replaceChildren(heading('Ajouter des membres', group.name, dialog, 'communityDialogTitle'), host,
    el('div', { class: 'community-dialog-actions' }, button('Terminé', () => dialog.close())));
  openDialog(dialog);
  const picker = mountMemberPicker(host, {
    group, isCurrent: current,
    onChanged: () => { if (current()) refresh(group.id); },
    onShare: (shareHost, isCurrent) => mountJoinLinkManager(shareHost, {
      groupId: group.id, isCurrent, onChanged: () => { if (current()) refresh(group.id); }
    })
  });
  dialogCleanup = () => picker.destroy();
}

function memberOptions(member) {
  const group = state.detail.group;
  const owner = group.role === 'owner', self = member.user_id === state.user.id;
  if (member.role === 'owner' || self || !isManager(group) || !owner && member.role !== 'member') return null;
  const controls = el('div', { class: 'community-actions' });
  if (owner && member.user_id) {
    const nextRole = member.role === 'admin' ? 'member' : 'admin';
    const promote = button(nextRole === 'admin' ? 'Nommer admin' : 'Remettre membre', async () => {
      const text = nextRole === 'admin' ? `${member.name} pourra gérer le calendrier, les membres, les suggestions et les sondages de ce groupe.` : `${member.name} restera membre et recevra les entraînements, sans gérer le groupe.`;
      if (await confirmAction(nextRole === 'admin' ? 'Nommer admin du groupe ?' : 'Changer son rôle ?', text, 'Confirmer')) await mutate(promote, 'set_role', { group_id: group.id, user_id: member.user_id, role: nextRole }, 'Le rôle est mis à jour.');
    });
    controls.append(promote);
  }
  const remove = button('Retirer du groupe', async () => {
    if (await confirmAction('Retirer cette personne ?', `${member.name} n’aura plus accès au groupe. Son historique d’entraînement sera conservé.`, 'Retirer')) await mutate(remove, 'remove_member', { group_id: group.id, ...(member.user_id ? { user_id: member.user_id } : { athlete_id: member.athlete_id }) }, 'Le membre est retiré du groupe.');
  });
  controls.append(remove);
  return el('details', { class: 'community-details community-member-options' }, el('summary', {}, 'Gérer le membre'), controls);
}

function renderMembers() {
  const { group, members, invitations = [] } = state.detail;
  const section = el('div', {}, el('div', { class: 'community-section-heading' },
    el('div', {}, el('h2', {}, 'Les membres')),
    isManager(group) ? button('Ajouter des membres', inviteMember, 'button primary') : null));
  section.append(el('div', { class: 'community-members' }, members.map(member =>
    el('article', { class: 'community-member' }, el('div', {}, el('h3', {}, `${member.name || 'Membre'}${member.user_id === state.user.id ? ' · toi' : ''}`),
      el('div', { class: 'community-meta' }, badge(member.role), !member.user_id ? el('span', {}, 'Compte non lié') : null), memberOptions(member))))));
  if (isManager(group) && invitations.length) {
    section.append(el('div', { class: 'community-group-settings' }, el('h3', {}, 'Invitations en attente'),
      el('div', { class: 'community-members' }, invitations.filter(invitation => !invitation.status || invitation.status === 'pending').map(invitation =>
        el('div', { class: 'community-member' }, el('div', {}, el('h3', {}, invitation.name || 'Invitation envoyée'), badge(invitation.role)), el('span', { class: 'muted' }, 'En attente'))))));
  }
  const settings = el('div', { class: 'community-group-settings' });
  if (group.role === 'owner') {
    settings.append(el('h3', {}, 'Gestion du groupe'), el('p', {}, 'Tu peux confier le groupe à un autre membre avant de le quitter.'),
      el('div', { class: 'community-actions' }, button('Transférer le groupe', transferGroup, 'button secondary', { disabled: !members.some(member => member.user_id && member.user_id !== state.user.id) }),
        button('Supprimer le groupe', () => removeGroup(group))));
  } else settings.append(button('Quitter le groupe', () => leaveGroup(group)));
  section.append(settings);
  return section;
}

function transferGroup() {
  const { group, members } = state.detail;
  openForm('Transférer le groupe', [
    field('Nouveau créateur', select('user_id', members.filter(member => member.user_id && member.user_id !== state.user.id).map(member => ({ value: member.user_id, label: member.name || 'Membre' })), '', { required: true })),
    el('p', { class: 'muted' }, 'Cette personne pourra nommer les admins, transférer ou supprimer le groupe. Tu resteras admin.')
  ], 'Transférer le groupe', async data => {
    await command('transfer_group', { group_id: group.id, user_id: data.get('user_id') });
    $('communityDialog').close(); toast('Le groupe est transféré.');
    try { await refresh(group.id); } catch (error) { report(error); }
  });
}

async function leaveGroup(group) {
  if (!await confirmAction('Quitter ce groupe ?', `Tu n’auras plus accès à ${group.name}. Ton historique d’entraînement sera conservé.`, 'Quitter le groupe')) return;
  const generation = state.generation;
  try {
    await command('leave_group', { group_id: group.id });
    if (generation !== state.generation) return;
    toast('Tu as quitté le groupe.'); state.groups = state.groups.filter(item => item.id !== group.id);
    if (state.selectedId === group.id) await selectGroup(null, { force: true });
    else if (!state.selectedId) await refresh(null, { force: true });
  } catch (error) { if (generation === state.generation && state.selectedId === group.id) report(error); }
}
async function removeGroup(group) {
  if (!await confirmAction('Supprimer ce groupe ?', `Les suggestions, les sondages et le groupe ${group.name} seront supprimés pour tous les membres. L’historique d’entraînement sera conservé.`, 'Supprimer le groupe')) return;
  const generation = state.generation;
  try {
    await command('delete_group', { group_id: group.id });
    if (generation !== state.generation) return;
    toast('Le groupe est supprimé.'); state.groups = state.groups.filter(item => item.id !== group.id);
    if (state.selectedId === group.id) await selectGroup(null, { force: true });
    else if (!state.selectedId) await refresh(null, { force: true });
  } catch (error) { if (generation === state.generation && state.selectedId === group.id) report(error); }
}

function renderJoinLanding() {
  const token = joinToken, generation = state.generation, ticket = ++landingTicket;
  landing?.destroy(); clearError();
  state.detail = null; state.selectedId = null; renderBreadcrumb();
  $('communityLoading').hidden = true; $('communityMain').removeAttribute('aria-busy');
  $('communityList').hidden = true; $('communityDetail').hidden = false;
  const host = el('div');
  $('communityDetail').replaceChildren(host);
  $('communityDetail').setAttribute('aria-labelledby', 'communityJoinTitle');
  document.title = 'Invitation à un groupe · GBoxeur';
  const current = () => generation === state.generation && ticket === landingTicket && joinToken === token && host.isConnected;
  landing = mountJoinLinkLanding(host, {
    token, user: state.user, isCurrent: current,
    onAccepted: ({ group_id }) => { if (current()) selectGroup(group_id, { force: true }); },
    onCancel: () => {
      if (!current()) return;
      if (state.user) selectGroup(null, { force: true });
      else { clearLanding(); location.replace('login.html'); }
    }
  });
}

async function initialize() {
  const generation = ++state.generation;
  try {
    const { data, error } = await client.auth.getUser();
    if (generation !== state.generation) return;
    if (!data?.user) {
      if (joinToken) { state.user = null; $('logoutButton').hidden = true; renderJoinLanding(); }
      else location.replace('login.html');
      return;
    }
    if (error) throw error;
    state.user = data.user;
    const account = await loadAccount(data.user);
    if (generation !== state.generation) return;
    $('accountName').textContent = account.profile.full_name || '';
    mountNavigation({ role: account.profile.account_type, isAdmin: account.profile.is_admin });
    state.ready = true;
    if (joinToken) { renderJoinLanding(); return; }
    await selectGroup(groupIdFromUrl(), { writeUrl: false, focus: false });
    if (generation === state.generation && location.hash === '#creer') {
      const url = new URL(location.href); url.hash = ''; history.replaceState({}, '', url);
      editGroup();
    }
  } catch (error) {
    if (generation === state.generation) { report(error); $('communityLoading').hidden = true; $('communityMain').removeAttribute('aria-busy'); }
  }
}

$('createGroupButton').addEventListener('click', () => editGroup());
$('communityDialog').addEventListener('close', () => { if (!$('communityDialog').open) clearDialog(); });
$('communityRetry').addEventListener('click', () => state.ready ? refresh(state.selectedId, { force: true }) : initialize());
$('logoutButton').addEventListener('click', async event => busy(event.currentTarget, async () => {
  const { error } = await client.auth.signOut({ scope: 'local' });
  if (error) report(error);
}));
window.addEventListener('popstate', () => selectGroup(groupIdFromUrl(), { writeUrl: false }));
window.addEventListener('community:navigate', event => {
  if (state.ready) selectGroup(event.detail?.groupId ?? null);
});
window.addEventListener('community-changed', event => {
  if (event.detail?.action === 'respond_invitation' && state.user) refresh(state.selectedId, { force: true });
});
client.auth.onAuthStateChange((event, session) => {
  const changed = event === 'SIGNED_IN' && state.user && session?.user?.id !== state.user.id;
  if (event !== 'SIGNED_OUT' && !changed) return;
  clearDialog(); landingTicket++; landing?.destroy(); landing = null;
  state.generation++; selectionTicket++; state.user = null; state.groups = []; state.groupsLoaded = false; state.detail = null; state.selectedId = null; state.ready = false;
  $('communityDetail').replaceChildren(); $('communityGroups').replaceChildren();
  renderBreadcrumb();
  $('communityDialog').close(); $('confirmDialog').close();
  location.replace(changed ? 'groups.html' : 'login.html');
});
initialize();
