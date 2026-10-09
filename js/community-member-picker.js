import { command as communityCommand } from './community-api.js';
import { el, button, field, input, select, errorBox, showError } from './ui.js';

const statusLabels = { member: 'Déjà membre', pending: 'Invitation envoyée', sans_compte: 'Compte non lié' };
const candidateKey = item => item.user_id || `athlete:${item.athlete_id}`;
const candidateName = item => item.name || [item.first_name, item.last_name].filter(Boolean).join(' ') || 'Athlète';

/** Invite only after an explicit selection; accepted coaching links are filtered by the server. */
export function mountMemberPicker(host, { group, isCurrent = () => true, onChanged = () => {}, onShare, command = communityCommand, searchDelay = 180 } = {}) {
  let destroyed = false, request = 0, timer, query = '', nextOffset = null, retryOffset = 0;
  let items = [], loading = false, sending = false, shareManager = null, failedSend = false;
  const selected = new Map();
  const current = () => !destroyed && host.isConnected && isCurrent();
  const search = input('member_search', '', 'search', { autocomplete: 'off', maxlength: 200 });
  const role = group.role === 'owner' ? select('role', [
    { value: 'member', label: 'Membre' }, { value: 'admin', label: 'Admin · coach du groupe' }
  ], 'member') : null;
  const loadingText = el('p', { class: 'muted community-picker-status', role: 'status', hidden: true });
  const error = errorBox(), sendError = errorBox(), manualError = errorBox();
  const results = el('ul', { class: 'community-candidate-list', 'aria-label': 'Athlètes liés à ton compte' });
  const retry = button('Réessayer', () => fetchCandidates(retryOffset), 'button secondary', { hidden: true });
  const more = button('Voir plus d’athlètes', () => fetchCandidates(nextOffset), 'button secondary community-picker-more', { hidden: true });
  const selectedList = el('ul', { class: 'community-picker-selection-list' });
  const selectionLabel = el('summary');
  const selection = el('details', { class: 'community-details community-picker-selection', hidden: true }, selectionLabel, selectedList);
  const send = button('Envoyer les invitations', sendSelected, 'button primary', { disabled: true });
  const outcome = el('p', { class: 'community-picker-outcome', role: 'status', hidden: true });
  const email = input('email', '', 'email', { required: true, maxlength: 320, autocomplete: 'email' });
  const manualSend = button('Envoyer l’invitation', null, 'button secondary', { type: 'submit' });
  const manual = el('form', { class: 'community-picker-manual' },
    field('Courriel de son compte', email, 'Pour une personne qui ne figure pas dans ta liste.'), manualError, manualSend);
  const shareHost = el('div', { class: 'community-picker-share' });
  const share = onShare ? el('details', { class: 'community-details community-picker-alternative' },
    el('summary', {}, 'Partager un lien d’invitation'), shareHost) : null;

  host.replaceChildren(el('p', { class: 'community-picker-guide' }, 'Choisis tes athlètes liés. Chaque personne devra accepter son invitation.'),
    field('Rechercher un athlète', search, 'Prénom, nom ou courriel.'),
    loadingText, error, retry, results, more, selection,
    role ? field('Rôle dans ce groupe', role) : null,
    sendError, outcome, el('div', { class: 'community-picker-send' }, send),
    el('details', { class: 'community-details community-picker-alternative' }, el('summary', {}, 'Inviter par courriel'), manual), share);

  function renderSelection() {
    selection.hidden = !selected.size;
    selectionLabel.textContent = `${selected.size} personne${selected.size === 1 ? '' : 's'} sélectionnée${selected.size === 1 ? '' : 's'}`;
    selectedList.replaceChildren(...[...selected.values()].map(item => el('li', {}, el('span', {}, candidateName(item)),
      button('Retirer', () => {
        if (!current() || sending) return;
        selected.delete(item.user_id); failedSend = false; sendError.hidden = true; renderSelection(); renderCandidates();
      }, 'button secondary', { disabled: sending, 'aria-label': `Retirer ${candidateName(item)} de la sélection` }))));
    syncControls();
  }

  function syncControls() {
    search.disabled = sending;
    if (role) role.disabled = sending;
    email.disabled = sending; manualSend.disabled = sending;
    send.disabled = sending || !selected.size;
    send.textContent = sending ? 'Envoi en cours…' : failedSend ? 'Réessayer l’envoi' : selected.size ? `Envoyer ${selected.size} invitation${selected.size === 1 ? '' : 's'}` : 'Envoyer les invitations';
    send.setAttribute('aria-busy', String(sending));
    more.disabled = loading || sending;
    retry.disabled = loading || sending;
    for (const control of results.querySelectorAll('input')) control.disabled = sending || loading || control.dataset.available !== 'true';
    for (const control of selectedList.querySelectorAll('button')) control.disabled = sending;
  }

  function renderCandidates() {
    if (!items.length) {
      results.replaceChildren(...(loading || !error.hidden ? [] : [el('li', { class: 'community-candidate-empty' }, query ? 'Aucun athlète ne correspond à ta recherche.' : 'Tes athlètes apparaîtront ici une fois leur lien coach accepté. Tu peux aussi inviter une personne par courriel ou partager un lien.')]));
      syncControls(); return;
    }
    results.replaceChildren(...items.map(item => {
      const available = item.status === 'available' && Boolean(item.user_id);
      const checkbox = input('candidate', item.user_id || '', 'checkbox', {
        checked: Boolean(item.user_id && selected.has(item.user_id)), disabled: !available,
        dataset: { available: String(available) }
      });
      checkbox.addEventListener('change', () => {
        if (!current() || sending || loading || !available) return;
        sendError.hidden = true; outcome.hidden = true; failedSend = false;
        if (!checkbox.checked) selected.delete(item.user_id);
        else if (selected.size < 50) selected.set(item.user_id, item);
        else { checkbox.checked = false; showError(sendError, new Error('Tu peux envoyer jusqu’à 50 invitations à la fois.')); }
        renderSelection();
      });
      return el('li', {}, el('label', { class: 'community-candidate', dataset: { status: item.status } }, checkbox,
        el('span', { class: 'community-candidate-person' }, el('strong', {}, candidateName(item)),
          item.email ? el('span', { class: 'community-candidate-email' }, item.email) : null,
          statusLabels[item.status] ? el('span', { class: 'community-candidate-status' }, statusLabels[item.status]) : null)));
    }));
    syncControls();
  }

  async function fetchCandidates(offset = 0) {
    if (!current() || sending || offset === null) return;
    const ticket = ++request, requestedQuery = query;
    loading = true; retryOffset = offset; retry.hidden = true; error.hidden = true;
    loadingText.hidden = false; loadingText.textContent = 'Recherche des athlètes…';
    results.setAttribute('aria-busy', 'true'); syncControls();
    try {
      const data = await command('invite_candidates', { group_id: group.id, query: requestedQuery, offset });
      if (!current() || ticket !== request) return;
      const incoming = Array.isArray(data?.items) ? data.items : [];
      const combined = new Map((offset ? items : []).map(item => [candidateKey(item), item]));
      for (const item of incoming) {
        combined.set(candidateKey(item), item);
        if (item.user_id && item.status !== 'available') selected.delete(item.user_id);
      }
      items = [...combined.values()]; nextOffset = data?.next_offset ?? null;
      more.hidden = nextOffset === null;
    } catch (failure) {
      if (!current() || ticket !== request) return;
      showError(error, failure); retry.hidden = false; more.hidden = true;
    } finally {
      if (current() && ticket === request) {
        loading = false; loadingText.hidden = true; results.removeAttribute('aria-busy');
        renderCandidates(); renderSelection();
      }
    }
  }

  async function sendSelected() {
    if (!current() || sending || !selected.size) return;
    const userIds = [...selected.keys()];
    request++; clearTimeout(timer); loading = false; loadingText.hidden = true; results.removeAttribute('aria-busy');
    sending = true; failedSend = false; sendError.hidden = true; outcome.hidden = true; syncControls();
    try {
      const result = await command('invite_members', { group_id: group.id, user_ids: userIds, role: role?.value || 'member' });
      if (!current()) return;
      const statuses = new Map((result?.items || []).map(item => [item.user_id, item.status === 'member' ? 'member' : 'pending']));
      for (const id of userIds) selected.delete(id);
      items = items.map(item => statuses.has(item.user_id) ? { ...item, status: statuses.get(item.user_id) } : item);
      const invited = Number(result?.invited_count) || 0, pending = Number(result?.pending_count) || 0, members = Number(result?.member_count) || 0;
      const messages = [];
      if (invited) messages.push(`${invited} invitation${invited === 1 ? '' : 's'} envoyée${invited === 1 ? '' : 's'}.`);
      if (pending) messages.push(`${pending} invitation${pending === 1 ? '' : 's'} déjà en attente.`);
      if (members) messages.push(`${members} personne${members === 1 ? '' : 's'} déjà membre${members === 1 ? '' : 's'}.`);
      outcome.textContent = messages.join(' ') || 'Les invitations sont à jour.'; outcome.hidden = false;
      onChanged();
    } catch (failure) {
      if (current()) { failedSend = true; showError(sendError, failure); }
    } finally {
      if (current()) { sending = false; renderCandidates(); renderSelection(); }
    }
  }

  search.addEventListener('input', () => {
    if (!current() || sending) return;
    clearTimeout(timer); request++; query = search.value.trim(); items = []; nextOffset = null;
    loading = true; error.hidden = true; retry.hidden = true; more.hidden = true;
    loadingText.hidden = false; loadingText.textContent = 'Recherche des athlètes…'; results.setAttribute('aria-busy', 'true');
    renderCandidates();
    timer = setTimeout(() => fetchCandidates(0), searchDelay);
  });
  manual.addEventListener('submit', async event => {
    event.preventDefault();
    if (!current() || sending || !manual.reportValidity()) return;
    request++; clearTimeout(timer); loading = false; loadingText.hidden = true; results.removeAttribute('aria-busy');
    sending = true; manualError.hidden = true; outcome.hidden = true; syncControls();
    try {
      await command('invite_member', { group_id: group.id, email: email.value.trim(), role: role?.value || 'member' });
      if (!current()) return;
      email.value = ''; outcome.textContent = 'L’invitation est envoyée.'; outcome.hidden = false; onChanged();
    } catch (failure) { if (current()) showError(manualError, failure); }
    finally {
      if (current()) { sending = false; syncControls(); fetchCandidates(0); }
    }
  });
  share?.addEventListener('toggle', () => {
    if (!current()) return;
    if (share.open && !shareManager) shareManager = onShare(shareHost, () => current() && share.open);
    else if (!share.open) { shareManager?.destroy(); shareManager = null; shareHost.replaceChildren(); }
  });
  fetchCandidates(0);
  return { destroy() {
    if (destroyed) return;
    destroyed = true; request++; clearTimeout(timer); shareManager?.destroy(); selected.clear(); host.replaceChildren();
  } };
}
