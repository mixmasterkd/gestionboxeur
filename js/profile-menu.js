import { createMenuPanelLayout } from './menu-panel-layout.js';
import { client, rpc, loadAccount } from './data.js';
import { command, loadGroups, loadNotifications } from './community-api.js';
import { prepareMenuInstall, openInstall, isAppInstalled } from './app-install.js';
import { el, button, displayName } from './ui.js';
import '../css/profile-menu.css';
import '../css/menu-panels.css';
import '../css/app-install.css';

const actionableTypes = new Set(['group_invitation', 'coaching_invitation', 'coach_request']);
const unavailable = error => ['42883', 'PGRST202'].includes(error?.code);

/** Pending requests are counted until answered, never dismissed by viewing them. */
export function pendingNotifications(value) {
  const items = Array.isArray(value) ? value : value?.items || [];
  return items.filter(item => actionableTypes.has(item.type) && (!item.status || item.status === 'pending'));
}

export async function respondToNotification(item, accept) {
  if (item.type === 'group_invitation') return command('respond_invitation', { id: item.id, accept });
  if (item.type === 'coaching_invitation') return rpc('respond_coaching_invitation', { p_invitation_id: item.id, p_accept: accept });
  if (item.type === 'coach_request') return rpc('respond_coach_request', { p_athlete_id: item.athlete_id, p_accept: accept });
  throw new Error('Cette notification ne demande pas de réponse.');
}

// Existing coaching requests remain usable when the community migration has not
// been deployed yet. Network/permission failures are never treated as an empty list.
async function fetchNotifications(userId) {
  try { return pendingNotifications(await loadNotifications()); }
  catch (error) {
    if (!unavailable(error)) throw error;
    const [invitations, account] = await Promise.all([rpc('my_coaching_invitations'), loadAccount({ id: userId })]);
    return [
      ...(invitations || []).filter(item => item.direction === 'incoming').map(item => ({
        id: item.id, type: 'coaching_invitation', title: item.coach_name, coach_id: item.coach_id,
      })),
      ...(account.relations || []).filter(item => item.status === 'pending').map(item => ({
        id: item.athlete_id, type: 'coach_request', athlete_id: item.athlete_id,
        title: displayName(account.athletes?.find(athlete => athlete.id === item.athlete_id)),
      })),
    ];
  }
}

export function mountProfileMenu({ trigger, route, isAdmin = false }) {
  prepareMenuInstall();
  let destroyed = false, userId = null, authRevision = 0, requestRevision = 0, groupRevision = 0;
  let items = [], loadError = '', loading = false, busy = false, view = 'menu';
  let notificationTask = null, notificationsLoadedAt = 0;
  let groups = [], groupsReady = false, groupError = '', groupsLoading = false;
  let activeGroup = location.pathname.endsWith('/groups.html') ? new URLSearchParams(location.search).get('group') : null;
  let refreshAfterAction = false, authTimer;
  const badge = el('span', { class: 'profile-notification-badge', hidden: true, 'aria-hidden': 'true' });
  trigger.append(badge);
  trigger.title = 'Ouvrir le menu';
  trigger.setAttribute('aria-haspopup', 'dialog');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.setAttribute('aria-controls', 'profileMenuDialog');
  const dialog = el('dialog', { id: 'profileMenuDialog', class: 'profile-menu-dialog', 'aria-labelledby': 'profileMenuTitle', 'aria-modal': 'false' });
  document.body.append(dialog);

  const current = (id, revision) => !destroyed && userId === id && requestRevision === revision;
  const plainClick = event => !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey;
  function updateOpenState() {
    if (!dialog.open) layout.close();
    trigger.setAttribute('aria-expanded', String(dialog.open));
    trigger.classList.toggle('is-open', dialog.open);
    trigger.title = dialog.open ? 'Fermer le menu' : 'Ouvrir le menu';
  }
  function updateBadge() {
    const count = items.length;
    badge.hidden = !count;
    badge.textContent = count > 99 ? '99+' : String(count);
    trigger.setAttribute('aria-label', count ? `Menu, ${count} demande${count > 1 ? 's' : ''} en attente` : 'Menu');
    const innerBadge = dialog.querySelector('[data-menu-count]');
    if (innerBadge) { innerBadge.hidden = !count; innerBadge.textContent = count > 99 ? '99+' : String(count); }
  }
  const layout = createMenuPanelLayout({ dialog, trigger, onDismiss: () => close() });
  const position = () => layout.position();
  function close({ restoreFocus = true } = {}) {
    layout.close();
    if (!dialog.open) return;
    dialog.close(); updateOpenState();
    if (restoreFocus && !destroyed && trigger.isConnected) trigger.focus({ preventScroll: true });
  }
  function header(title, back = false) {
    return el('header', { class: 'profile-menu-heading' },
      back ? button('← Menu', () => showRoot('notifications'), 'profile-menu-back', { 'aria-label': 'Retour au menu' }) : el('h2', { id: 'profileMenuTitle', tabindex: '-1' }, title),
      back ? el('h2', { id: 'profileMenuTitle', tabindex: '-1' }, title) : null);
  }
  function link(label, href, key) {
    return el('a', { class: 'profile-menu-item', href: route(href), dataset: { menuAction: key } },
      el('span', {}, label), el('span', { class: 'profile-menu-chevron', 'aria-hidden': 'true' }, '›'));
  }
  function connectGroupLink(node, groupId) {
    node.addEventListener('click', event => {
      if (!plainClick(event)) return;
      close({ restoreFocus: false });
      if (location.pathname.endsWith('/groups.html')) {
        event.preventDefault(); window.dispatchEvent(new CustomEvent('community:navigate', { detail: { groupId } }));
      }
    });
  }
  function renderGroupList() {
    const region = dialog.querySelector('[data-menu-groups]');
    if (!region || view !== 'menu') return;
    const focusedId = region.contains(document.activeElement) ? document.activeElement.closest('[data-menu-group]')?.dataset.menuGroup : null;
    const ordered = [...groups].sort((a, b) => a.name.localeCompare(b.name, 'fr-CA'));
    const existing = new Map([...region.querySelectorAll('[data-menu-group]')].map(node => [node.dataset.menuGroup, node]));
    const rows = ordered.map(group => {
      const row = existing.get(group.id) || el('a', { class: 'profile-menu-group', href: route(`groups.html?group=${encodeURIComponent(group.id)}`), dataset: { menuGroup: group.id } },
        el('span', { class: 'profile-group-mark', 'aria-hidden': 'true' }), el('span', { class: 'profile-group-name' }));
      if (!existing.has(group.id)) connectGroupLink(row, group.id);
      row.querySelector('.profile-group-mark').textContent = group.name.trim().slice(0, 1).toLocaleUpperCase('fr-CA');
      row.querySelector('.profile-group-name').textContent = group.name;
      if (activeGroup === group.id) row.setAttribute('aria-current', 'page'); else row.removeAttribute('aria-current');
      return row;
    });
    const beforeIds = [...region.querySelectorAll('[data-menu-group]')].map(node => node.dataset.menuGroup).join(',');
    const afterIds = ordered.map(group => group.id).join(',');
    if (beforeIds !== afterIds || !rows.length) {
      region.replaceChildren(...rows);
      if (focusedId) region.querySelector(`[data-menu-group="${CSS.escape(focusedId)}"]`)?.focus({ preventScroll: true });
    }
    region.querySelector('[data-menu-group-status]')?.remove();
    if (!rows.length || groupError) {
      const status = el('p', { class: 'profile-menu-group-status', dataset: { menuGroupStatus: 'true' } },
        groupError || (groupsLoading || !groupsReady ? 'Chargement des groupes…' : 'Aucun groupe pour le moment.'));
      region.append(status);
    }
    position();
  }
  function renderMenu() {
    view = 'menu';
    const groupsLink = link('Mes groupes', 'groups.html', 'groups');
    groupsLink.classList.add('profile-menu-groups-heading'); connectGroupLink(groupsLink, null);
    const groupRegion = el('div', { class: 'profile-menu-groups', dataset: { menuGroups: 'true' }, 'aria-label': 'Mes groupes' });
    const notifications = button('', () => openNotifications(), 'profile-menu-item', { dataset: { menuAction: 'notifications' } });
    notifications.append(el('span', {}, 'Notifications'), el('span', { class: 'profile-menu-count', dataset: { menuCount: 'true' }, 'aria-hidden': 'true' }));
    const connections = link('Coachs et invitations', 'planning.html#coachs', 'connections');
    connections.addEventListener('click', event => {
      if (!plainClick(event)) return;
      close({ restoreFocus: false });
      if (location.pathname.endsWith('/planning.html')) {
        event.preventDefault(); window.dispatchEvent(new CustomEvent('connections:open', { detail: { personal: true } }));
      }
    });
    const install = button('Installer GBoxeur', () => {
      const actor = userId;
      close({ restoreFocus: false });
      openInstall({ returnFocus: trigger, onClose: () => { if (!destroyed && userId === actor) showRoot('install'); } });
    }, 'profile-menu-item', { dataset: { menuAction: 'install' }, hidden: isAppInstalled() });
    const profile = link('Mon profil', 'profile.html', 'profile');
    profile.addEventListener('click', event => { if (plainClick(event)) close({ restoreFocus: false }); });
    const admin = isAdmin ? link('Administration', 'admin/', 'admin') : null;
    if (admin) {
      if (/\/admin(?:\/|$)/.test(location.pathname)) admin.setAttribute('aria-current', 'page');
      admin.addEventListener('click', event => { if (plainClick(event)) close({ restoreFocus: false }); });
    }
    dialog.replaceChildren(header('Menu'), el('nav', { class: 'profile-menu-list', 'aria-label': 'Menu du compte' },
      notifications, connections, groupsLink, groupRegion, el('div', { class: 'profile-menu-divider', 'aria-hidden': 'true' }), profile, admin, install));
    renderGroupList(); updateBadge();
  }
  function renderNotifications(message = '') {
    if (!dialog.open || view !== 'notifications') return;
    const focused = dialog.querySelector(':focus');
    const focusedAction = focused?.dataset.notificationAction;
    const focusedItem = focused?.closest('[data-notification-id]')?.dataset.notificationId;
    const focusSelector = focused?.classList.contains('profile-menu-back') ? '.profile-menu-back' : focused?.classList.contains('profile-menu-close') ? '.profile-menu-close' : focused?.id === 'profileMenuTitle' ? '#profileMenuTitle' : null;
    const body = el('div', { class: 'profile-notifications', 'aria-busy': String(loading || busy) });
    if (message) body.append(el('p', { class: 'profile-notification-status', role: 'status' }, message));
    if (loading && !items.length) body.append(el('p', { role: 'status', class: 'muted' }, 'Chargement des demandes…'));
    else if (!items.length && !loadError) body.append(el('p', { class: 'profile-notifications-empty' }, 'Tout est à jour. Aucune demande en attente.'));
    if (loadError) body.append(el('p', { class: 'form-error', role: 'alert' }, loadError), button('Réessayer', () => refresh(true), 'button secondary', { disabled: busy || loading }));
    for (const item of items) {
      const group = item.type === 'group_invitation', requested = item.type === 'coach_request';
      const card = el('article', { class: 'profile-notification-card', dataset: { notificationId: String(item.id), notificationType: item.type } });
      const explanation = group
        ? `${item.message || `${item.actor_name || 'Un membre'} t’invite à rejoindre ce groupe.`} ${item.role === 'admin' ? 'Tu pourras gérer son calendrier, ses suggestions et ses sondages comme admin.' : 'Ses entraînements apparaîtront dans ton calendrier.'}`
        : requested ? item.message || 'Cette personne te demande de devenir son coach.'
          : `${item.message || 'Ce coach propose de te suivre.'} En acceptant, tu lui permets de voir ton calendrier et tes bilans, d’ajouter des séances et de modifier les éléments déverrouillés. Tu pourras ajuster ses permissions dans Coachs et invitations.`;
      card.append(el('p', { class: 'profile-notification-kind' }, group ? 'Invitation à un groupe' : requested ? 'Demande de suivi' : 'Invitation de coach'),
        el('h3', {}, item.title || (group ? 'Un groupe' : 'Un membre')), el('p', {}, explanation));
      const respond = async accept => {
        if (busy || !userId) return;
        const actor = userId; busy = true; requestRevision++; loading = false; notificationTask = null; notificationsLoadedAt = 0;
        renderNotifications(); let message = '';
        try {
          await respondToNotification(item, accept);
          if (destroyed || userId !== actor) return;
          items = items.filter(value => !(value.id === item.id && value.type === item.type));
          loadError = ''; updateBadge(); message = accept ? 'Demande acceptée.' : 'Demande refusée.';
          if (item.type !== 'group_invitation') window.dispatchEvent(new CustomEvent('community-changed', { detail: { action: item.type === 'coaching_invitation' ? 'respond_coaching_invitation' : 'respond_coach_request' } }));
          refreshAfterAction = true;
        } catch (error) {
          if (!destroyed && userId === actor) loadError = error.message || 'Impossible de répondre. Réessaie.';
        } finally {
          if (!destroyed && userId === actor) {
            busy = false; renderNotifications(message);
            if (dialog.open && view === 'notifications') dialog.querySelector('h2')?.focus();
            if (refreshAfterAction) { refreshAfterAction = false; refresh(true); refreshGroups(true); }
          }
        }
      };
      card.append(el('div', { class: 'profile-notification-actions' },
        button('Accepter', () => respond(true), 'button primary', { disabled: busy, dataset: { notificationAction: 'accept' }, 'aria-label': `Accepter ${item.title || 'la demande'}` }),
        button('Refuser', () => respond(false), 'button secondary', { disabled: busy, dataset: { notificationAction: 'refuse' }, 'aria-label': `Refuser ${item.title || 'la demande'}` })));
      body.append(card);
    }
    dialog.replaceChildren(header('Notifications', true), body);
    if (focusedItem && focusedAction) dialog.querySelector(`[data-notification-id="${CSS.escape(focusedItem)}"] [data-notification-action="${focusedAction}"]`)?.focus({ preventScroll: true });
    else if (focusSelector) dialog.querySelector(focusSelector)?.focus({ preventScroll: true });
    position();
  }
  async function refresh(force = false) {
    if (destroyed || !userId) return;
    if (busy) { refreshAfterAction = true; return; }
    if (notificationTask && !force) return notificationTask;
    if (!force && Date.now() - notificationsLoadedAt < 15000) return;
    const actor = userId, revision = ++requestRevision;
    loading = true; loadError = ''; renderNotifications();
    notificationTask = (async () => {
      try {
        const loaded = await fetchNotifications(actor);
        if (!current(actor, revision)) return;
        items = loaded; notificationsLoadedAt = Date.now(); updateBadge();
      } catch {
        if (current(actor, revision)) loadError = 'Impossible de charger les demandes. Réessaie dans un instant.';
      } finally {
        if (current(actor, revision)) { loading = false; notificationTask = null; renderNotifications(); }
      }
    })();
    return notificationTask;
  }
  async function refreshGroups(force = false) {
    if (destroyed || !userId) return;
    const actor = userId, revision = ++groupRevision;
    groupsLoading = true; groupError = ''; renderGroupList();
    try {
      const loaded = await loadGroups({ force });
      if (destroyed || userId !== actor || revision !== groupRevision) return;
      groups = Array.isArray(loaded) ? loaded : []; groupsReady = true;
    } catch {
      if (destroyed || userId !== actor || revision !== groupRevision) return;
      groupError = 'Groupes indisponibles pour le moment.';
    } finally {
      if (!destroyed && userId === actor && revision === groupRevision) { groupsLoading = false; renderGroupList(); }
    }
  }
  function openNotifications() {
    view = 'notifications'; renderNotifications(); refresh(); dialog.querySelector('.profile-menu-back')?.focus();
  }
  function showRoot(focusKey = null) {
    if (destroyed) return;
    renderMenu(); if (!dialog.open) dialog.show(); updateOpenState(); position();
    const focusTarget = focusKey ? dialog.querySelector(`[data-menu-action="${focusKey}"]`) : null;
    (focusTarget && !focusTarget.hidden ? focusTarget : dialog.querySelector('h2'))?.focus({ preventScroll: true });
    refresh(); refreshGroups(true);
  }
  function toggle(event) {
    if (event && !plainClick(event)) return;
    event?.preventDefault(); if (destroyed) return;
    if (dialog.open) close(); else showRoot();
  }
  function onKey(event) {
    if (!dialog.open || event.key !== 'Escape' || event.defaultPrevented) return;
    event.preventDefault(); event.stopPropagation();
    if (view === 'notifications') showRoot('notifications'); else close();
  }
  function onOutside(event) {
    if (dialog.open && !dialog.contains(event.target) && !trigger.contains(event.target) && !event.target.closest?.('.menu-drawer-dismiss')) close({ restoreFocus: false });
  }
  function cleared() {
    requestRevision++; groupRevision++; items = []; groups = []; groupsReady = false; groupError = ''; groupsLoading = false;
    notificationTask = null; notificationsLoadedAt = 0;
    loadError = ''; busy = false; loading = false; refreshAfterAction = false;
    close({ restoreFocus: false }); dialog.replaceChildren(); updateBadge();
  }
  function setUser(next) {
    if (destroyed || next === userId) return;
    // A later navigation mount supplies the next account's verified role.
    if (userId) isAdmin = false;
    cleared(); userId = next; clearTimeout(authTimer);
    if (userId) authTimer = setTimeout(() => { refresh(); refreshGroups(); }, 0);
  }
  const subscription = client.auth.onAuthStateChange((event, session) => {
    authRevision++; setUser(session?.user?.id || null);
  })?.data?.subscription;
  const initialRevision = authRevision;
  client.auth.getSession().then(({ data, error }) => {
    if (!destroyed && !error && authRevision === initialRevision) setUser(data?.session?.user?.id || null);
  }).catch(() => {});
  const onChanged = () => { refresh(true); refreshGroups(true); };
  const onVisibility = () => { if (document.visibilityState === 'visible') { refresh(true); refreshGroups(true); } };
  const onSelection = event => { activeGroup = event.detail?.groupId || null; renderGroupList(); };
  const onInstalled = () => { const install = dialog.querySelector('[data-menu-action="install"]'); if (install) install.hidden = isAppInstalled(); position(); };
  const onFocus = event => { if (dialog.open && !dialog.contains(event.target) && !trigger.contains(event.target) && !event.target.closest?.('.menu-drawer-dismiss')) close({ restoreFocus: false }); };
  const onScroll = event => { if (dialog.open && !dialog.contains(event.target)) position(); };
  trigger.addEventListener('click', toggle);
  dialog.addEventListener('close', updateOpenState);
  document.addEventListener('pointerdown', onOutside);
  document.addEventListener('keydown', onKey);
  document.addEventListener('focusin', onFocus);
  document.addEventListener('scroll', onScroll, true);
  window.addEventListener('resize', position);
  window.visualViewport?.addEventListener('resize', position);
  window.visualViewport?.addEventListener('scroll', position);
  window.addEventListener('community-changed', onChanged);
  window.addEventListener('community:selection', onSelection);
  window.addEventListener('app-install-state', onInstalled);
  document.addEventListener('visibilitychange', onVisibility);
  updateBadge();
  return {
    refresh,
    destroy() {
      destroyed = true; requestRevision++; groupRevision++; clearTimeout(authTimer); subscription?.unsubscribe();
      trigger.removeEventListener('click', toggle); dialog.removeEventListener('close', updateOpenState);
      document.removeEventListener('pointerdown', onOutside); document.removeEventListener('keydown', onKey); document.removeEventListener('focusin', onFocus); document.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', position); window.removeEventListener('community-changed', onChanged); window.removeEventListener('community:selection', onSelection); window.removeEventListener('app-install-state', onInstalled);
      document.removeEventListener('visibilitychange', onVisibility);
      window.visualViewport?.removeEventListener('resize', position);
      window.visualViewport?.removeEventListener('scroll', position);
      close({ restoreFocus: false }); layout.destroy(); dialog.remove(); badge.remove();
    },
  };
}
