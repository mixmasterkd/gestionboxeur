import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Window } from 'happy-dom';
import { captureGroupJoinToken, clearGroupJoinToken, groupJoinUrl, pendingGroupJoinToken, rememberGroupJoinToken } from '../js/community-join-state.js';

const token = 'a'.repeat(64), nextToken = 'b'.repeat(64);
const expires_at = new Date(Date.now() + 7 * 86400000).toISOString();
const uiSource = await readFile(new URL('../js/ui.js', import.meta.url), 'utf8');
const stateSource = await readFile(new URL('../js/community-join-state.js', import.meta.url), 'utf8');
const source = await readFile(new URL('../js/community-join-links.js', import.meta.url), 'utf8');
const settle = async () => { for (let n = 0; n < 20; n++) await Promise.resolve(); await new Promise(resolve => setImmediate(resolve)); };
const detail = { id: 'link', group: { id: 'group-1', name: 'MRJEU', description: 'Mardi et jeudi' }, inviter_name: 'Alex', expires_at, already_member: false, role: 'member' };

function fixture({ execute, links = [], clipboard, url = 'http://localhost:4174/groups.html' } = {}) {
  const window = new Window({ url }), doc = window.document, calls = [];
  let live = true;
  const accepted = [], cancelled = [], changed = [];
  const host = doc.createElement('div'); doc.body.append(host);
  window.__command = async (action, data) => {
    calls.push([action, JSON.parse(JSON.stringify(data))]);
    return execute ? execute(action, data) : action === 'create_join_link' ? { id: 'link', group_id: 'group-1', token, expires_at }
      : action === 'inspect_join_link' ? detail : action === 'accept_join_link' ? { group_id: 'group-1', accepted: true } : { revoked: true };
  };
  window.__loadGroup = async groupId => { calls.push(['group_detail', { group_id: groupId }]); return { join_links: links }; };
  Object.defineProperty(window.navigator, 'clipboard', { value: clipboard });
  window.eval(uiSource.replace(/^export /gm, '') + '\nwindow.__ui={el,button,field,errorBox,showError};');
  window.eval(stateSource.replace(/^export /gm, '') + '\nwindow.__join={validGroupJoinToken,rememberGroupJoinToken,clearGroupJoinToken,groupJoinUrl};');
  window.eval('{ const {el,button,field,errorBox,showError}=window.__ui; const {validGroupJoinToken,rememberGroupJoinToken,clearGroupJoinToken,groupJoinUrl}=window.__join; const command=window.__command,loadGroup=window.__loadGroup; ' + source.replace(/^import .*;\n/gm, '').replace(/^export \{.*;\n/gm, '').replace(/^export /gm, '') + '\nwindow.__mounts={mountJoinLinkManager,mountJoinLinkLanding}; }');
  let mounted;
  return {
    window, doc, host, calls, accepted, cancelled, changed,
    button: label => [...host.querySelectorAll('button')].find(node => node.textContent === label),
    manager(options = {}) { mounted = window.__mounts.mountJoinLinkManager(host, { groupId: 'group-1', isCurrent: () => live, onChanged: change => changed.push(change), ...options }); return mounted; },
    landing(options = {}) { mounted = window.__mounts.mountJoinLinkLanding(host, { token, user: { id: 'viewer' }, isCurrent: () => live, onAccepted: value => accepted.push(value), onCancel: () => cancelled.push(true), ...options }); return mounted; },
    stale() { live = false; },
    async destroy() { mounted?.destroy(); await window.happyDOM.abort(); },
  };
}

test('join state scrubs URL tokens, survives reload and only builds same-directory destinations', async () => {
  const view = new Window({ url: `https://example.test/team/groups.html?join=${token}&group=old#selection` });
  try {
    assert.equal(captureGroupJoinToken(view), token);
    assert.equal(view.location.href, 'https://example.test/team/groups.html?group=old#selection');
    assert.equal(captureGroupJoinToken(view), token);
    assert.equal(groupJoinUrl(token, { view, login: true, signup: true }), `https://example.test/team/login.html?join=${token}&mode=signup`);
    assert.throws(() => groupJoinUrl('https://evil.test', { view }), /invalide/);
    rememberGroupJoinToken(nextToken, view); clearGroupJoinToken(token, view);
    assert.equal(pendingGroupJoinToken(view), nextToken, 'late completion cannot erase a newer invitation');
    clearGroupJoinToken(undefined, view); assert.equal(pendingGroupJoinToken(view), null);
    view.history.replaceState({}, '', 'groups.html?join=https://evil.test');
    assert.equal(captureGroupJoinToken(view), 'invalid'); assert.equal(view.location.search, '');
  } finally { await view.happyDOM.abort(); }
});

test('blocked session storage keeps a valid token in the protected URL for reload', async () => {
  const view = new Window({ url: `https://example.test/team/groups.html?join=${token}` });
  try {
    Object.defineProperty(view, 'sessionStorage', { get() { throw new Error('blocked'); } });
    assert.equal(captureGroupJoinToken(view), token); assert.equal(new URL(view.location.href).searchParams.get('join'), token);
    clearGroupJoinToken(token, view); assert.equal(view.location.search, '');
  } finally { await view.happyDOM.abort(); }
});

test('manager opens with read-only status and creates, copies, renews and revokes only on explicit action', async () => {
  const copied = [], f = fixture({ clipboard: { writeText: async value => copied.push(value) } });
  try {
    f.manager(); await settle();
    assert.deepEqual(f.calls.map(call => call[0]), ['group_detail']);
    f.button('Créer un lien').click(); await settle();
    assert.deepEqual(f.calls[1], ['create_join_link', { group_id: 'group-1' }]);
    assert.equal(f.host.querySelector('textarea').value, `http://localhost:4174/groups.html?join=${token}`);
    f.button('Copier le lien').click(); await settle(); assert.deepEqual(copied, [`http://localhost:4174/groups.html?join=${token}`]);
    assert.match(f.host.textContent, /Lien copié/);
    f.button('Renouveler le lien').click(); await settle(); assert.equal(f.calls.filter(call => call[0] === 'create_join_link').length, 2);
    f.button('Révoquer le lien').click(); await settle();
    assert.deepEqual(f.calls.at(-1), ['revoke_join_link', { group_id: 'group-1' }]);
    assert.equal(f.host.querySelector('textarea').value, ''); assert.equal(f.button('Révoquer le lien').hidden, true);
    assert.equal(f.changed.length, 3);
  } finally { await f.destroy(); }
});

test('existing manager link metadata is never represented as a recoverable token and HTTP copy has a manual fallback', async () => {
  const f = fixture();
  try {
    f.manager({ joinLinks: [{ id: 'old', expires_at }] }); await settle();
    assert.equal(f.calls.length, 0); assert.equal(f.host.querySelector('textarea').value, '');
    assert.match(f.host.textContent, /Renouvelle-le/);
    f.button('Renouveler le lien').click(); await settle(); f.button('Copier le lien').click(); await settle();
    const field = f.host.querySelector('textarea');
    assert.equal(f.doc.activeElement, field); assert.equal(field.selectionStart, 0); assert.equal(field.selectionEnd, field.value.length);
    assert.match(f.host.textContent, /Lien sélectionné/);
  } finally { await f.destroy(); }
});

test('anonymous recipients are offered login and signup without any lookup or implicit acceptance', async () => {
  const f = fixture();
  try {
    f.landing({ user: null }); await settle();
    assert.equal(f.calls.length, 0);
    const links = [...f.host.querySelectorAll('a')]; assert.equal(links.length, 2);
    assert.equal(links[0].href, `http://localhost:4174/login.html?join=${token}`);
    assert.equal(links[1].href, `http://localhost:4174/login.html?join=${token}&mode=signup`);
    assert.ok(links.every(link => link.referrerPolicy === 'no-referrer'));
    f.button('Annuler').click(); assert.equal(f.cancelled.length, 1); assert.equal(pendingGroupJoinToken(f.window), null);
  } finally { await f.destroy(); }
});

test('signed-in recipients see group and inviter before explicit acceptance without coaching side effects', async () => {
  const f = fixture();
  try {
    f.landing(); await settle();
    assert.deepEqual(f.calls, [['inspect_join_link', { token }]]); assert.match(f.host.textContent, /MRJEU/); assert.match(f.host.textContent, /Alex/);
    assert.equal(f.accepted.length, 0); f.button('Accepter et rejoindre').click(); await settle();
    assert.deepEqual(f.calls.map(call => call[0]), ['inspect_join_link', 'accept_join_link']);
    assert.equal(f.accepted[0].group_id, 'group-1'); assert.equal(pendingGroupJoinToken(f.window), null);
  } finally { await f.destroy(); }
});

test('already-member, expired and malformed links cannot trigger an implicit or stale join', async () => {
  const member = fixture({ execute: () => ({ ...detail, already_member: true }) });
  try {
    member.landing(); await settle(); member.button('Ouvrir le groupe').click();
    assert.equal(member.calls.length, 1); assert.equal(member.accepted[0].group_id, 'group-1');
  } finally { await member.destroy(); }
  for (const malformed of [false, true]) {
    const f = fixture({ execute: async () => { throw new Error('Lien d’invitation invalide ou expiré.'); } });
    try {
      f.landing(malformed ? { token: 'bad' } : {}); await settle();
      assert.match(f.host.textContent, /invalide ou expiré/); assert.equal(f.button('Accepter et rejoindre'), undefined);
      assert.equal(f.calls.length, malformed ? 0 : 1);
    } finally { await f.destroy(); }
  }
});

test('revocation between review and acceptance removes the action and retains a clean cancel route', async () => {
  const f = fixture({ execute: action => { if (action === 'inspect_join_link') return detail; throw new Error('Lien d’invitation invalide ou expiré.'); } });
  try {
    f.landing(); await settle(); f.button('Accepter et rejoindre').click(); await settle();
    assert.equal(f.accepted.length, 0); assert.equal(f.button('Accepter et rejoindre'), undefined); assert.equal(f.button('Annuler').disabled, false);
    assert.equal(pendingGroupJoinToken(f.window), null);
  } finally { await f.destroy(); }
});

test('permission denials explain invalid invitations during inspection and acceptance only', async () => {
  const denied = () => { throw new Error('Tu n’as pas la permission d’effectuer cette action.'); };
  for (const accepting of [false, true]) {
    const f = fixture({ execute: action => accepting && action === 'inspect_join_link' ? detail : denied() });
    try {
      f.landing(); await settle();
      if (accepting) { f.button('Accepter et rejoindre').click(); await settle(); }
      assert.match(f.host.textContent, /Lien d’invitation invalide ou expiré/);
      assert.doesNotMatch(f.host.textContent, /permission/);
      assert.equal(f.button('Accepter et rejoindre'), undefined);
      assert.equal(f.button('Réessayer'), undefined);
      assert.equal(f.button('Annuler').disabled, false);
      assert.equal(pendingGroupJoinToken(f.window), null);
      assert.equal(f.accepted.length, 0);
    } finally { await f.destroy(); }
  }
  const manager = fixture({ execute: denied });
  try {
    manager.manager({ joinLinks: [] }); manager.button('Créer un lien').click(); await settle();
    assert.match(manager.host.textContent, /Tu n’as pas la permission/);
    assert.doesNotMatch(manager.host.textContent, /invalide ou expiré/);
  } finally { await manager.destroy(); }
});

test('network failures remain retryable and preserve the invitation during inspection and acceptance', async () => {
  for (const accepting of [false, true]) {
    const f = fixture({ execute: action => {
      if (accepting && action === 'inspect_join_link') return detail;
      throw new Error('Connexion réseau interrompue. Réessaie.');
    } });
    try {
      f.landing(); await settle();
      if (accepting) { f.button('Accepter et rejoindre').click(); await settle(); }
      assert.match(f.host.textContent, /Connexion réseau interrompue/);
      assert.doesNotMatch(f.host.textContent, /invalide ou expiré/);
      assert.equal(f.button(accepting ? 'Accepter et rejoindre' : 'Réessayer').disabled, false);
      assert.equal(pendingGroupJoinToken(f.window), token);
      assert.equal(f.accepted.length, 0);
    } finally { await f.destroy(); }
  }
});

test('account/group changes and destruction discard late tokens, names and navigation callbacks', async () => {
  let resolve;
  const manager = fixture({ execute: () => new Promise(done => { resolve = done; }) });
  try {
    const mounted = manager.manager({ joinLinks: [] }); manager.button('Créer un lien').click(); manager.stale(); mounted.destroy();
    resolve({ id: 'new', token, expires_at }); await settle();
    assert.equal(manager.host.textContent, ''); assert.equal(manager.changed.length, 0);
  } finally { await manager.destroy(); }
  const landing = fixture({ execute: () => new Promise(done => { resolve = done; }) });
  try {
    const mounted = landing.landing(); landing.stale(); mounted.destroy(); resolve(detail); await settle();
    assert.equal(landing.host.textContent, ''); assert.equal(landing.accepted.length, 0);
  } finally { await landing.destroy(); }
});
