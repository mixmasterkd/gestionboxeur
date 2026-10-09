import { command, loadGroup } from './community-api.js';
import { el, button, field, errorBox, showError } from './ui.js';
import { validGroupJoinToken, rememberGroupJoinToken, clearGroupJoinToken, groupJoinUrl } from './community-join-state.js';
export { captureGroupJoinToken, clearGroupJoinToken } from './community-join-state.js';

const dateLabel = value => {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('fr-CA', { dateStyle: 'long', timeStyle: 'short' }).format(date) : '';
};
const invalidLink = error => /invalide|expiré|révoqué/i.test(error?.message || '');
// The shared data layer hides SQL permission details. Here, the server uses that
// same denial for a revoked, expired or inaccessible invitation token.
const invitationError = error => error?.message === 'Tu n’as pas la permission d’effectuer cette action.'
  ? new Error('Lien d’invitation invalide ou expiré.') : error;

/** Mount only when the manager chooses to open link sharing. Creation is explicit. */
export function mountJoinLinkManager(host, { groupId, joinLinks, isCurrent = () => true, onChanged = () => {}, onClose } = {}) {
  const view = host.ownerDocument.defaultView;
  let destroyed = false, loading = joinLinks === undefined, loadFailed = false, pending = false, active = [], generated = null;
  const current = () => !destroyed && host.isConnected && isCurrent();
  const error = errorBox(), status = el('p', { class: 'muted', role: 'status' });
  const urlField = el('textarea', { rows: 3, readOnly: true, spellcheck: false, 'aria-label': 'Lien d’invitation du groupe' });
  const linkRegion = el('div', { hidden: true }, field('Lien à partager', urlField));
  const create = button('Créer un lien', () => mutate('create_join_link'), 'button primary');
  const revoke = button('Révoquer le lien', () => mutate('revoke_join_link'));
  const copy = button('Copier le lien', copyLink);
  const copyStatus = el('p', { class: 'muted', role: 'status' });
  const retry = button('Réessayer', loadStatus, 'button secondary', { hidden: true });
  linkRegion.append(el('div', { class: 'intro-actions' }, copy), copyStatus);
  const controls = el('div', { class: 'intro-actions' }, create, revoke, retry, onClose ? button('Fermer', onClose) : null);
  host.replaceChildren(el('section', { class: 'community-join-link-manager', 'aria-label': 'Lien d’invitation du groupe' },
    el('p', { class: 'muted' }, 'La personne qui reçoit ce lien pourra créer son compte et choisir de rejoindre le groupe comme membre.'),
    status, error, linkRegion, controls,
    el('p', { class: 'muted' }, 'Le lien est valable 7 jours. Le renouveler désactive le précédent. Tu peux aussi le révoquer.')));

  function render() {
    if (!current()) return;
    active = active.filter(link => new Date(link.expires_at).getTime() > Date.now());
    const hasActive = active.length > 0;
    status.textContent = loading ? 'Chargement du lien…' : loadFailed ? 'Le lien actif n’a pas pu être vérifié.' : hasActive
      ? `Un lien est actif jusqu’au ${dateLabel(active[0].expires_at)}.${generated ? '' : ' Renouvelle-le pour obtenir un nouveau lien à copier.'}`
      : 'Aucun lien actif.';
    create.textContent = hasActive ? 'Renouveler le lien' : 'Créer un lien';
    create.disabled = pending || loading || loadFailed; revoke.disabled = pending || loading || loadFailed || !hasActive;
    revoke.hidden = !hasActive;
    retry.hidden = !loadFailed; retry.disabled = loading;
    copy.disabled = pending;
    linkRegion.hidden = !generated || !hasActive;
    if (generated) urlField.value = groupJoinUrl(generated.token, { view });
    host.setAttribute('aria-busy', String(pending || loading));
  }
  async function mutate(action) {
    if (!current() || pending || loading || loadFailed) return;
    pending = true; error.hidden = true; copyStatus.textContent = ''; render();
    try {
      const result = await command(action, { group_id: groupId });
      if (!current()) return;
      if (action === 'create_join_link') {
        if (!validGroupJoinToken(result?.token)) throw new Error('Le lien n’a pas été renvoyé. Réessaie en le renouvelant.');
        generated = result; active = [result];
      } else { generated = null; active = []; urlField.value = ''; }
      pending = false; render();
      onChanged({ action, group_id: groupId });
    } catch (failure) {
      if (current()) showError(error, failure);
    } finally { pending = false; render(); }
  }
  async function copyLink() {
    if (!current() || pending || !generated) return;
    const value = urlField.value;
    try {
      if (!view.navigator.clipboard?.writeText) throw new Error('clipboard unavailable');
      await view.navigator.clipboard.writeText(value);
      if (current() && value === urlField.value) copyStatus.textContent = 'Lien copié.';
    } catch {
      if (!current() || value !== urlField.value) return;
      urlField.focus({ preventScroll: true }); urlField.select();
      let copied = false;
      try { copied = Boolean(host.ownerDocument.execCommand?.('copy')); } catch { /* Manual copy remains available on HTTP LAN. */ }
      copyStatus.textContent = copied ? 'Lien copié.' : 'Lien sélectionné. Utilise Copier dans le menu de ton appareil, ou Ctrl+C / ⌘C.';
    }
  }
  function loadStatus() {
    if (!current()) return;
    loading = true; loadFailed = false; error.hidden = true; render();
    loadGroup(groupId).then(detail => { if (current()) active = [...(detail?.join_links || [])]; })
      .catch(failure => { if (current()) { loadFailed = true; showError(error, failure); } })
      .finally(() => { loading = false; render(); });
  }
  if (joinLinks !== undefined) { active = Array.isArray(joinLinks) ? [...joinLinks] : []; render(); }
  else loadStatus();
  return { destroy() { destroyed = true; generated = null; active = []; urlField.value = ''; host.replaceChildren(); host.removeAttribute('aria-busy'); } };
}

/** A link never joins automatically: signed-in users review the group first. */
export function mountJoinLinkLanding(host, { token, user = null, isCurrent = () => true, onAccepted = () => {}, onCancel = () => {} } = {}) {
  token = validGroupJoinToken(token) || token;
  const view = host.ownerDocument.defaultView;
  let destroyed = false, completed = false, pending = false, ticket = 0, inspected = null;
  const current = () => !destroyed && !completed && host.isConnected && isCurrent();
  const title = el('h1', { id: 'communityJoinTitle', tabindex: '-1' }, 'Invitation à un groupe');
  const content = el('div', { class: 'community-dialog-content' });
  const error = errorBox();
  const cancel = button('Annuler', () => {
    if (!current() || pending) return;
    completed = true; clearGroupJoinToken(token, view); onCancel();
  });
  const actions = el('div', { class: 'intro-actions' }, cancel);
  const section = el('section', { class: 'community-join-landing', 'aria-labelledby': title.id }, title, content, error, actions);
  host.replaceChildren(section);
  function finish(value) {
    if (!current()) return;
    completed = true; clearGroupJoinToken(token, view); onAccepted(value);
  }
  async function accept() {
    if (!current() || pending || !inspected) return;
    if (inspected.already_member) { finish({ group_id: inspected.group.id, already_member: true }); return; }
    pending = true; error.hidden = true;
    for (const control of actions.querySelectorAll('button')) control.disabled = true;
    section.setAttribute('aria-busy', 'true');
    try {
      const result = await command('accept_join_link', { token });
      if (current()) finish(result);
    } catch (failure) {
      if (!current()) return;
      const explanation = invitationError(failure);
      showError(error, explanation);
      if (invalidLink(explanation)) {
        inspected = null; actions.replaceChildren(cancel); clearGroupJoinToken(token, view);
      }
    } finally {
      pending = false;
      if (current()) { section.removeAttribute('aria-busy'); for (const control of actions.querySelectorAll('button')) control.disabled = false; }
    }
  }
  async function inspect() {
    if (!current()) return;
    const revision = ++ticket;
    error.hidden = true; content.replaceChildren(el('p', { role: 'status', class: 'muted' }, 'Chargement de l’invitation…'));
    actions.replaceChildren(cancel); section.setAttribute('aria-busy', 'true');
    try {
      const detail = await command('inspect_join_link', { token });
      if (!current() || revision !== ticket) return;
      if (!detail?.group?.id || !detail.group.name) throw new Error('Lien d’invitation invalide ou expiré.');
      inspected = detail;
      content.replaceChildren(el('h2', {}, detail.group.name),
        el('p', {}, `${detail.inviter_name || 'Un membre'} t’invite à rejoindre ce groupe.`),
        detail.group.description ? el('p', {}, detail.group.description) : null,
        el('p', { class: 'muted' }, detail.already_member ? 'Tu fais déjà partie de ce groupe.' : 'En acceptant, tu deviens membre du groupe. Ses entraînements apparaîtront dans ton calendrier.'),
        el('p', { class: 'muted' }, `Invitation valable jusqu’au ${dateLabel(detail.expires_at)}.`));
      actions.append(button(detail.already_member ? 'Ouvrir le groupe' : 'Accepter et rejoindre', accept, 'button primary'));
    } catch (failure) {
      if (!current() || revision !== ticket) return;
      const explanation = invitationError(failure);
      content.replaceChildren(); showError(error, explanation);
      if (invalidLink(explanation)) clearGroupJoinToken(token, view);
      else actions.append(button('Réessayer', inspect, 'button primary'));
    } finally { if (current() && revision === ticket) section.removeAttribute('aria-busy'); }
  }
  if (!validGroupJoinToken(token)) {
    showError(error, new Error('Lien d’invitation invalide ou expiré.'));
  } else {
    rememberGroupJoinToken(token, view);
    if (user?.id) void inspect();
    else {
      content.append(el('p', {}, 'Connecte-toi ou crée ton compte pour voir le groupe et choisir de le rejoindre.'));
      actions.append(el('a', { class: 'button secondary', href: groupJoinUrl(token, { login: true, view }), referrerPolicy: 'no-referrer' }, 'Se connecter'),
        el('a', { class: 'button primary', href: groupJoinUrl(token, { login: true, signup: true, view }), referrerPolicy: 'no-referrer' }, 'Créer mon compte'));
    }
  }
  return { destroy() { destroyed = true; ticket++; inspected = null; host.replaceChildren(); } };
}
