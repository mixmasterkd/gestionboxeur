import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Window } from 'happy-dom';
import { createMenuPanelLayout } from '../js/menu-panel-layout.js';

const source = await readFile(new URL('../js/profile-menu.js', import.meta.url), 'utf8');
const uiSource = await readFile(new URL('../js/ui.js', import.meta.url), 'utf8');
const settle = async () => { for (let i = 0; i < 8; i++) await new Promise(resolve => setTimeout(resolve, 1)); };
const example = [
  { id: 'group-1', type: 'group_invitation', title: 'MRJEU', message: 'Alex t’invite à rejoindre ce groupe.' },
  { id: 'invitation-1', type: 'coaching_invitation', title: 'Sam' },
  { id: 'request-1', type: 'coach_request', athlete_id: 'athlete-1', title: 'Jo' },
];

async function fixture({ isAdmin = false, notifications = example, load, respond, fallbackError, groups = [], loadGroups, url = 'https://example.test/planning.html' } = {}) {
  const window = new Window({ url });
  window.createMenuPanelLayout = createMenuPanelLayout;
  let actor = 'user-1', listener, unsubscribed = false;
  const calls = [], groupCalls = [], installCalls = [];
  window.__installed = false; window.__prepare = () => {}; window.__openInstall = options => installCalls.push(options);
  window.__groups = async options => { groupCalls.push(options); return loadGroups ? loadGroups(options) : groups; };
  window.__client = { auth: {
    getSession: async () => ({ data: { session: actor ? { user: { id: actor } } : null } }),
    onAuthStateChange(callback) { listener = callback; return { data: { subscription: { unsubscribe() { unsubscribed = true; } } } }; },
  } };
  window.__notifications = async () => {
    calls.push(['load']);
    if (fallbackError) throw fallbackError;
    return load ? load() : { items: notifications, count: notifications.length };
  };
  window.__command = async (action, data) => { calls.push([action, JSON.parse(JSON.stringify(data))]); return respond?.(action, data); };
  window.__rpc = async (action, data) => { calls.push([action, JSON.parse(JSON.stringify(data || {}))]); return respond?.(action, data) || []; };
  window.__account = async () => ({ relations: [], athletes: [] });
  window.eval(uiSource.replace(/^export /gm, '') + '\nwindow.__ui = {el,button,openDialog,displayName};');
  window.eval(source.replace(/^import .*;\n/gm, '')
    .replace(/^export /gm, '')
    .replace('const actionableTypes', 'const {el,button,openDialog,displayName}=window.__ui; const client=window.__client, command=window.__command, rpc=window.__rpc, loadNotifications=window.__notifications, loadAccount=window.__account, loadGroups=window.__groups, prepareMenuInstall=window.__prepare, openInstall=window.__openInstall, isAppInstalled=()=>window.__installed; const actionableTypes') + '\nwindow.__menu = {mountProfileMenu,pendingNotifications,respondToNotification};');
  const trigger = window.document.createElement('button'); trigger.textContent = 'Menu'; window.document.body.append(trigger);
  const mounted = window.__menu.mountProfileMenu({ trigger, isAdmin, route: path => new URL((/\/admin(?:\/|$)/.test(window.location.pathname) ? '../' : './') + path, window.location.href).href });
  await settle();
  return {
    window, trigger, calls, groupCalls, installCalls, mounted,
    get unsubscribed() { return unsubscribed; },
    get badge() { return trigger.querySelector('.profile-notification-badge'); },
    get dialog() { return window.document.getElementById('profileMenuDialog'); },
    auth(next) { actor = next; listener(next ? 'SIGNED_IN' : 'SIGNED_OUT', next ? { user: { id: next } } : null); },
    async openNotifications() { if (!window.document.getElementById('profileMenuDialog').open) trigger.click(); [...window.document.querySelectorAll('.profile-menu-item')].find(node => node.textContent.startsWith('Notifications')).click(); await settle(); },
    async destroy() { mounted.destroy(); await window.happyDOM.abort(); },
  };
}

test('profile menu keeps requests badged after reading and offers routes within the existing navigation', async () => {
  const f = await fixture();
  try {
    assert.equal(f.badge.textContent, '3'); assert.equal(f.badge.hidden, false);
    f.trigger.click();
    assert.equal(f.dialog.open, true); assert.equal(f.trigger.getAttribute('aria-expanded'), 'true');
    assert.deepEqual([...f.dialog.querySelectorAll('a')].map(node => [node.firstElementChild.textContent, node.getAttribute('href')]), [
      ['Coachs et invitations', 'https://example.test/planning.html#coachs'], ['Mes groupes', 'https://example.test/groups.html'], ['Mon profil', 'https://example.test/profile.html'],
    ]);
    f.trigger.click();
    await f.openNotifications();
    assert.equal(f.dialog.querySelectorAll('[data-notification-id]').length, 3);
    assert.equal(f.badge.textContent, '3');
    f.trigger.click();
    assert.equal(f.badge.textContent, '3');
    assert.equal(f.trigger.getAttribute('aria-expanded'), 'false');
    assert.equal(f.window.document.activeElement, f.trigger);
    assert.equal(f.calls.some(([action]) => /read|seen|dismiss/.test(action)), false);
  } finally { await f.destroy(); }
});

test('notification responses route to their exact group and coaching contracts', async () => {
  const f = await fixture();
  try {
    await f.window.__menu.respondToNotification(example[0], true);
    await f.window.__menu.respondToNotification(example[1], false);
    await f.window.__menu.respondToNotification(example[2], true);
    assert.deepEqual(f.calls.filter(([action]) => action !== 'load'), [
      ['respond_invitation', { id: 'group-1', accept: true }],
      ['respond_coaching_invitation', { p_invitation_id: 'invitation-1', p_accept: false }],
      ['respond_coach_request', { p_athlete_id: 'athlete-1', p_accept: true }],
    ]);
  } finally { await f.destroy(); }
});

test('successful answer removes the badge even if the follow-up load fails, failed answer stays pending', async () => {
  let answered = false, failResponse = true;
  const f = await fixture({ load: () => { if (answered) throw new Error('offline'); return { items: [example[0]] }; }, respond: () => { if (failResponse) throw new Error('Réponse impossible'); answered = true; } });
  try {
    await f.openNotifications();
    f.dialog.querySelector('[data-notification-action="refuse"]').click(); await settle();
    assert.equal(f.badge.textContent, '1');
    assert.match(f.dialog.textContent, /Réponse impossible/);
    failResponse = false;
    f.dialog.querySelector('[data-notification-action="accept"]').click(); await settle();
    assert.equal(f.badge.hidden, true);
    assert.equal(f.dialog.querySelector('[data-notification-action]'), null, 'answered request is not actionable twice');
    assert.match(f.dialog.textContent, /Impossible de charger/);
  } finally { await f.destroy(); }
});

test('sign-out clears badge and dialog immediately and ignores a late request', async () => {
  let resolve;
  const f = await fixture({ load: () => new Promise(done => { resolve = done; }) });
  try {
    f.trigger.click();
    f.auth(null);
    assert.equal(f.dialog.open, false); assert.equal(f.badge.hidden, true); assert.equal(f.dialog.textContent, '');
    resolve({ items: [example[0]] }); await settle();
    assert.equal(f.badge.hidden, true); assert.equal(f.dialog.textContent, '');
  } finally { await f.destroy(); }
});

test('account switch cannot reveal another account’s pending requests', async () => {
  const replies = [];
  const f = await fixture({ load: () => new Promise(done => replies.push(done)) });
  try {
    f.auth('user-2'); await settle();
    replies[0]({ items: [example[0]] });
    replies[1]({ items: [] }); await settle();
    assert.equal(f.badge.hidden, true);
    f.mounted.destroy();
    assert.equal(f.unsubscribed, true);
    assert.equal(f.dialog, null);
  } finally { await f.destroy(); }
});

test('completed and informational notifications never become actionable badges', async () => {
  const f = await fixture({ notifications: [...example, { ...example[0], id: 'old', status: 'accepted' }, { id: 'news', type: 'announcement' }] });
  try { assert.equal(f.badge.textContent, '3'); }
  finally { await f.destroy(); }
});

test('older backends retain actionable coach invitations without hiding network failures', async () => {
  const f = await fixture({ fallbackError: { code: 'PGRST202' }, respond: action => action === 'my_coaching_invitations' ? [{ id: 'old-invite', direction: 'incoming', coach_name: 'Coach local' }] : [] });
  try {
    assert.equal(f.badge.textContent, '1');
    await f.openNotifications();
    assert.match(f.dialog.textContent, /Coach local/);
    assert.ok(f.dialog.querySelector('[data-notification-action="accept"]'));
  } finally { await f.destroy(); }
  const unavailable = await fixture({ fallbackError: { code: 'NETWORK_ERROR', message: 'offline' } });
  try {
    await unavailable.openNotifications();
    assert.match(unavailable.dialog.textContent, /Impossible de charger/);
    assert.equal(unavailable.calls.some(([action]) => action === 'my_coaching_invitations'), false);
  } finally { await unavailable.destroy(); }
});

test('Menu toggles, closes outside, returns from Notifications and always reopens at root', async () => {
  const f = await fixture();
  const escape = () => f.window.document.dispatchEvent(new f.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  try {
    f.trigger.click(); assert.equal(f.dialog.open, true); assert.equal(f.trigger.classList.contains('is-open'), true);
    f.trigger.click(); assert.equal(f.dialog.open, false); assert.equal(f.trigger.classList.contains('is-open'), false);
    await f.openNotifications(); assert.equal(f.dialog.querySelector('h2').textContent, 'Notifications');
    escape(); assert.equal(f.dialog.open, true); assert.equal(f.dialog.querySelector('h2').textContent, 'Menu');
    assert.equal(f.window.document.activeElement.dataset.menuAction, 'notifications');
    escape(); assert.equal(f.dialog.open, false); assert.equal(f.window.document.activeElement, f.trigger);
    await f.openNotifications();
    f.window.document.body.dispatchEvent(new f.window.PointerEvent('pointerdown', { bubbles: true }));
    assert.equal(f.dialog.open, false);
    f.trigger.click(); assert.equal(f.dialog.querySelector('h2').textContent, 'Menu');
    assert.equal(f.calls.filter(([action]) => action === 'load').length, 1, 'opening submenus reuses the fresh notification result');
  } finally { await f.destroy(); }
});

test('all groups appear under Mes groupes and group selection opens main content with an active highlight', async () => {
  const groups = [{ id: 'b', name: 'MRJEU', role: 'admin' }, { id: 'a', name: 'Compétiteurs', role: 'member' }];
  const f = await fixture({ groups, url: 'https://example.test/groups.html?group=b' });
  const navigations = []; f.window.addEventListener('community:navigate', event => navigations.push(event.detail.groupId));
  try {
    f.trigger.click();
    assert.deepEqual([...f.dialog.querySelectorAll('[data-menu-action]')].map(node => node.dataset.menuAction), ['notifications', 'connections', 'groups', 'profile', 'install']);
    assert.equal(f.dialog.querySelector('[data-menu-groups]').previousElementSibling.dataset.menuAction, 'groups');
    assert.deepEqual([...f.dialog.querySelectorAll('[data-menu-group]')].map(node => node.querySelector('.profile-group-name').textContent), ['Compétiteurs', 'MRJEU']);
    assert.equal(f.dialog.querySelector('[data-menu-group="b"]').getAttribute('aria-current'), 'page');
    assert.equal(f.dialog.querySelector('[data-menu-group="a"]').getAttribute('href'), 'https://example.test/groups.html?group=a');
    f.dialog.querySelector('[data-menu-group="a"]').click();
    assert.equal(f.dialog.open, false); assert.deepEqual(navigations, ['a']);
    f.window.dispatchEvent(new f.window.CustomEvent('community:selection', { detail: { groupId: 'a' } }));
    f.trigger.click(); assert.equal(f.dialog.querySelector('[data-menu-group="a"]').getAttribute('aria-current'), 'page');
    f.dialog.querySelector('[data-menu-action="groups"]').click(); assert.deepEqual(navigations, ['a', null]);
  } finally { await f.destroy(); }
});

test('notifications lead the Menu and Coachs et invitations opens personal connections without a header button', async () => {
  const f = await fixture();
  const opens = []; f.window.addEventListener('connections:open', event => opens.push(event.detail));
  try {
    f.trigger.click();
    assert.equal(f.dialog.querySelector('[data-menu-action]').dataset.menuAction, 'notifications');
    const link = f.dialog.querySelector('[data-menu-action="connections"]');
    assert.equal(link.dataset.menuAction, 'connections'); assert.match(link.textContent, /^Coachs et invitations/);
    assert.equal(f.window.document.getElementById('connectionsButton'), null);
    link.click();
    assert.equal(f.dialog.open, false); assert.equal(opens.length, 1); assert.equal(opens[0].personal, true);
    assert.equal(f.window.location.href, 'https://example.test/planning.html');
  } finally { await f.destroy(); }
});

test('group refresh keeps the loaded list and keyboard focus while rejecting stale account results', async () => {
  const replies = [];
  const initial = [{ id: 'a', name: 'Compétiteurs' }];
  const f = await fixture({ loadGroups: options => options.force ? new Promise(done => replies.push(done)) : initial });
  try {
    f.trigger.click();
    assert.equal(f.dialog.querySelectorAll('[data-menu-group]').length, 1);
    const focus = f.dialog.querySelector('[data-menu-action="notifications"]'); focus.focus();
    replies[0]([...initial, { id: 'b', name: 'MRJEU' }]); await settle();
    assert.equal(f.window.document.activeElement, focus, 'background data never takes focus from another menu action');
    assert.equal(f.dialog.querySelectorAll('[data-menu-group]').length, 2);
    f.trigger.click(); f.trigger.click();
    assert.equal(f.dialog.querySelectorAll('[data-menu-group]').length, 2, 'cached content survives reopening while fresh data is pending');
    f.auth(null); replies[1]([{ id: 'secret', name: 'Ancien compte' }]); await settle();
    assert.equal(f.dialog.textContent, ''); assert.equal(f.dialog.open, false);
  } finally { await f.destroy(); }
});

test('installer closes Menu, returns to its root action and disappears once installed', async () => {
  const f = await fixture();
  try {
    f.trigger.click(); f.dialog.querySelector('[data-menu-action="install"]').click();
    assert.equal(f.dialog.open, false); assert.equal(f.installCalls.length, 1); assert.equal(f.installCalls[0].returnFocus, f.trigger);
    f.installCalls[0].onClose();
    assert.equal(f.dialog.open, true); assert.equal(f.window.document.activeElement.dataset.menuAction, 'install');
    const event = new f.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }); event.preventDefault();
    f.window.document.dispatchEvent(event); assert.equal(f.dialog.open, true, 'Escape already handled by installation cannot close Menu again');
    f.window.__installed = true; f.window.dispatchEvent(new f.window.Event('app-install-state'));
    assert.equal(f.dialog.querySelector('[data-menu-action="install"]').hidden, true);
  } finally { await f.destroy(); }
});


test('Administration belongs only to the administrator menu and clears on account changes', async () => {
  const ordinary = await fixture();
  try {
    ordinary.trigger.click();
    assert.equal(ordinary.dialog.querySelector('[data-menu-action="admin"]'), null);
  } finally { await ordinary.destroy(); }
  const admin = await fixture({ isAdmin: true, url: 'https://example.test/boxing/admin/' });
  try {
    admin.trigger.click();
    const entry = admin.dialog.querySelector('[data-menu-action="admin"]');
    assert.equal(entry.href, 'https://example.test/boxing/admin/');
    assert.equal(entry.getAttribute('aria-current'), 'page');
    assert.equal(entry.nextElementSibling.dataset.menuAction, 'install');
    admin.auth('user-2'); await settle(); admin.trigger.click();
    assert.equal(admin.dialog.querySelector('[data-menu-action="admin"]'), null);
  } finally { await admin.destroy(); }
});
