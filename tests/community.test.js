import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Window } from 'happy-dom';
import * as ui from '../js/ui.js';

const source = (await readFile(new URL('../js/community.js', import.meta.url), 'utf8'))
  .replace(/^import .*;\n/gm, '').replace(/initialize\(\);\s*$/, '');
const html = await readFile(new URL('../groups.html', import.meta.url), 'utf8');
const pickerSource = (await readFile(new URL('../js/community-member-picker.js', import.meta.url), 'utf8')).replace(/^import .*;\n/gm, '').replace('export function', 'function');
const makeDetail = role => ({
  group: { id: 'group-a', name: 'Compétiteurs', description: 'Un groupe ouvert', role, member_count: 3, updated_at: '2026-10-08T12:00:00Z' },
  members: [{ user_id: 'owner', athlete_id: 'a1', name: 'Camille', role: 'owner' }, { user_id: 'admin', athlete_id: 'a2', name: 'Alex', role: 'admin' }, { user_id: 'member', athlete_id: 'a3', name: 'Sam', role: 'member' }],
  posts: [{ id: 'post-a', kind: 'suggestion', content: '<img src=x onerror=alert(1)> Une idée', author_id: 'member', author_name: 'Sam', created_at: '2026-10-08T12:00:00Z', status: 'open', support_count: 1, supported_by_me: false, comments: [] }],
  polls: [{ id: 'poll-a', question: 'Quand s’entraîner ?', closes_at: null, closed_at: null, total_votes: 1, my_vote: null, options: [{ id: 'choice-a', label: 'Mardi', votes: 1 }, { id: 'choice-b', label: 'Jeudi', votes: 0 }] }],
});

async function fixture(role = 'member', options = {}) {
  const window = new Window({ url: 'http://localhost/groups.html?group=group-a', settings: { disableJavaScriptEvaluation: true, disableJavaScriptFileLoading: true, disableCSSFileLoading: true } });
  window.document.write(html);
  window.matchMedia = () => ({ matches: false });
  for (const dialog of window.document.querySelectorAll('dialog')) {
    dialog.showModal = () => { dialog.open = true; };
    dialog.close = () => { const wasOpen = dialog.open; dialog.open = false; if (wasOpen) dialog.dispatchEvent(new window.Event('close')); };
  }
  const globals = ['window', 'document', 'location', 'history', 'FormData'];
  const previous = Object.fromEntries(globals.map(key => [key, globalThis[key]]));
  for (const key of globals) globalThis[key] = window[key];
  const detail = makeDetail(role), calls = [];
  const command = async (action, data) => { calls.push({ action, data }); return options.command ? options.command(action, data) : action === 'invite_candidates' ? { items: [], next_offset: null } : { id: 'created-id' }; };
  const pickerBindings = { ...ui, communityCommand: command };
  const mountMemberPicker = new Function(...Object.keys(pickerBindings), `${pickerSource}\nreturn mountMemberPicker;`)(...Object.values(pickerBindings));
  const bindings = { ...ui, mountMemberPicker, captureGroupJoinToken: () => options.joinToken || null,
    clearGroupJoinToken() {}, mountJoinLinkManager: options.mountJoinLinkManager || (() => ({ destroy() {} })),
    mountJoinLinkLanding: options.mountJoinLinkLanding || (() => ({ destroy() {} })),
    client: { auth: { onAuthStateChange() {} } }, loadAccount() {}, mountNavigation() {}, command,
    loadGroups: options.loadGroups || (async () => [detail.group]), loadGroup: options.loadGroup || (async () => detail), toast() {}, confirmAction: async () => true };
  const api = new Function(...Object.keys(bindings), `${source}\nreturn {state, renderList, renderDetail, activateTab, createSuggestion, createPoll, inviteMember, editGroup, refresh, selectGroup, renderJoinLanding};`)(...Object.values(bindings));
  api.state.user = { id: role === 'owner' ? 'owner' : role === 'admin' ? 'admin' : 'member' };
  api.state.detail = detail; api.state.groups = [detail.group]; api.state.groupsLoaded = true; api.state.ready = true;
  return { window, document: window.document, api, detail, calls,
    async close() { await window.happyDOM.abort(); for (const key of globals) { if (previous[key] === undefined) delete globalThis[key]; else globalThis[key] = previous[key]; } } };
}

test('ordinary members see a concise detail with no calendar block or group administration controls', async () => {
  const f = await fixture('member');
  try {
    f.api.renderDetail();
    assert.equal(f.document.querySelector('.community-group-calendar'), null);
    assert.equal(f.document.getElementById('communityDetail').textContent.includes(f.detail.group.description), false);
    assert.equal(f.detail.group.description, 'Un groupe ouvert');
    assert.equal(f.document.body.textContent.includes('Modifier le groupe'), false);
    f.api.activateTab('members');
    assert.equal(f.document.body.textContent.includes('Ajouter des membres'), false);
    assert.equal(f.document.body.textContent.includes('Gérer le membre'), false);
    assert.equal(f.document.body.textContent.includes('Quitter le groupe'), true);
    f.api.activateTab('polls');
    assert.equal(f.document.body.textContent.includes('Créer un sondage'), false);
    assert.equal(f.document.querySelector('.community-poll-option').disabled, false);
  } finally { await f.close(); }
});

test('group admins can invite and manage ordinary members without owner powers', async () => {
  const f = await fixture('admin');
  try {
    f.api.renderDetail();
    assert.equal(f.document.querySelector('.community-group-calendar'), null);
    f.api.activateTab('members');
    assert.equal(f.document.body.textContent.includes('Ajouter des membres'), true);
    assert.equal(f.document.querySelectorAll('.community-member-options').length, 1);
    assert.equal(f.document.body.textContent.includes('Nommer admin'), false);
    assert.equal(f.document.body.textContent.includes('Supprimer le groupe'), false);
    f.api.inviteMember();
    assert.equal(f.document.querySelector('#communityDialog select[name="role"]'), null);
    f.api.activateTab('polls');
    assert.equal(f.document.querySelector('#communityTabPanel').textContent.includes('Créer un sondage'), true);
  } finally { await f.close(); }
});

test('owners see role management and user-provided text stays literal', async () => {
  const f = await fixture('owner');
  try {
    f.api.renderDetail();
    assert.equal(f.document.querySelector('.community-post img'), null);
    assert.match(f.document.querySelector('.community-content').textContent, /<img src=x/);
    f.api.activateTab('members');
    assert.equal(f.document.body.textContent.includes('Nommer admin'), true);
    assert.equal(f.document.body.textContent.includes('Transférer le groupe'), true);
    assert.equal(f.document.body.textContent.includes('Supprimer le groupe'), true);
    f.api.inviteMember();
    assert.equal(f.document.querySelector('#communityDialog select[name="role"]').value, 'member');
  } finally { await f.close(); }
});

test('group section tabs support keyboard navigation and one active focus target', async () => {
  const f = await fixture();
  try {
    f.api.renderDetail();
    f.document.getElementById('communityTab-suggestions').dispatchEvent(new f.window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    assert.equal(f.api.state.tab, 'polls');
    assert.equal(f.document.activeElement.id, 'communityTab-polls');
    assert.equal(f.document.querySelectorAll('[role="tab"][tabindex="0"]').length, 1);
    assert.equal(f.document.getElementById('communityTabPanel').getAttribute('aria-labelledby'), 'communityTab-polls');
  } finally { await f.close(); }
});

test('suggestion submission keeps the chosen group and trims its content', async () => {
  const f = await fixture();
  try {
    f.api.renderDetail(); f.api.createSuggestion();
    const form = f.document.querySelector('#communityDialog form');
    form.querySelector('textarea').value = '  Plus de push-up en équipe  ';
    f.api.state.detail = { ...f.detail, group: { ...f.detail.group, id: 'group-b' } };
    form.dispatchEvent(new f.window.Event('submit', { bubbles: true, cancelable: true }));
    await f.window.happyDOM.whenAsyncComplete();
    assert.deepEqual(f.calls[0], { action: 'create_post', data: { group_id: 'group-a', kind: 'suggestion', content: 'Plus de push-up en équipe' } });
  } finally { await f.close(); }
});

test('closed polls keep their results visible and disable voting', async () => {
  const f = await fixture();
  try {
    f.detail.polls[0].closed_at = '2026-10-08T13:00:00Z';
    f.api.renderDetail(); f.api.activateTab('polls');
    assert.equal([...f.document.querySelectorAll('.community-poll-option')].every(option => option.disabled), true);
    assert.match(f.document.querySelector('.community-poll').textContent, /Terminé/);
    assert.match(f.document.querySelector('.community-poll').textContent, /100 %/);
  } finally { await f.close(); }
});

test('historical athletes without a linked account can be removed but not promoted or made owner', async () => {
  const f = await fixture('owner');
  try {
    f.detail.members = [f.detail.members[0], { user_id: null, athlete_id: 'legacy-athlete', name: 'Ancien profil', role: 'member' }];
    f.api.renderDetail(); f.api.activateTab('members');
    assert.match(f.document.getElementById('communityTabPanel').textContent, /Compte non lié/);
    assert.equal(f.document.body.textContent.includes('Nommer admin'), false);
    const transfer = [...f.document.querySelectorAll('button')].find(control => control.textContent === 'Transférer le groupe');
    assert.equal(transfer.disabled, true);
    const remove = [...f.document.querySelectorAll('button')].find(control => control.textContent === 'Retirer du groupe');
    remove.click(); await f.window.happyDOM.whenAsyncComplete();
    assert.deepEqual(f.calls[0], { action: 'remove_member', data: { group_id: 'group-a', athlete_id: 'legacy-athlete' } });
  } finally { await f.close(); }
});

test('Suggestions hides existing messages without deleting or changing stored content', async () => {
  const f = await fixture();
  try {
    const message = { ...f.detail.posts[0], id: 'old-message', kind: 'message', content: 'Message historique à conserver.' };
    f.detail.posts.push(message);
    f.api.renderDetail();
    assert.equal(f.document.querySelectorAll('.community-post').length, 1);
    assert.equal(f.document.body.textContent.includes(message.content), false);
    assert.equal(f.document.body.textContent.includes('Écrire un message'), false);
    assert.equal(f.document.body.textContent.includes('Babillard'), false);
    assert.equal(f.document.getElementById('communityTab-suggestions').textContent, 'Suggestions');
    assert.equal(f.detail.posts.length, 2);
    assert.deepEqual(f.calls, []);
  } finally { await f.close(); }
});

function deferred() {
  let resolve, reject;
  const promise = new Promise((success, failure) => { resolve = success; reject = failure; });
  return { promise, resolve, reject };
}
const withGroup = (id, name) => { const detail = makeDetail('member'); detail.group = { ...detail.group, id, name }; return detail; };

test('group list and detail load concurrently rather than waiting on the list', async () => {
  const groups = deferred(), detail = withGroup('group-b', 'MRJEU');
  let detailCalls = 0;
  const f = await fixture('member', { loadGroups: () => groups.promise, loadGroup: async () => { detailCalls++; return detail; } });
  try {
    const loading = f.api.selectGroup('group-b');
    assert.equal(detailCalls, 1);
    assert.equal(f.document.getElementById('communityLoading').hidden, false);
    assert.equal(f.document.getElementById('communityBreadcrumb').hidden, false);
    groups.resolve([detail.group]); await loading;
    assert.equal(f.document.getElementById('communityGroupTitle').textContent, 'MRJEU');
  } finally { await f.close(); }
});

test('late errors from a previous selection cannot replace the newer group or show an obsolete error', async () => {
  const first = deferred(), second = deferred();
  const detail = withGroup('group-b', 'IntelCore');
  const f = await fixture('member', { loadGroups: async () => [makeDetail('member').group, detail.group], loadGroup: id => id === 'group-a' ? first.promise : second.promise });
  try {
    const pendingFirst = f.api.selectGroup('group-a');
    const pendingSecond = f.api.selectGroup('group-b');
    second.resolve(detail); await pendingSecond;
    first.reject(new Error('Ancien chargement échoué.')); await pendingFirst;
    assert.equal(f.document.getElementById('communityGroupTitle').textContent, 'IntelCore');
    assert.equal(f.document.getElementById('communityList').hidden, true);
    assert.equal(f.document.getElementById('communityError').hidden, true);
    assert.equal(f.document.getElementById('communityLoading').hidden, true);
  } finally { await f.close(); }
});

test('returning to Mes groupes immediately restores the cached list even while requests are pending', async () => {
  const detail = deferred(), groups = deferred();
  const f = await fixture('member', { loadGroups: () => groups.promise, loadGroup: () => detail.promise });
  try {
    const pendingGroup = f.api.selectGroup('group-b');
    const pendingList = f.api.selectGroup(null);
    assert.equal(f.document.getElementById('communityList').hidden, false);
    assert.equal(f.document.getElementById('communityDetail').hidden, true);
    assert.equal(f.document.querySelector('.community-group-card h2').textContent, 'Compétiteurs');
    assert.equal(new URL(f.window.location.href).searchParams.has('group'), false);
    groups.resolve([f.detail.group]); await pendingList;
    detail.reject(new Error('Chargement abandonné.')); await pendingGroup;
    assert.equal(f.document.getElementById('communityList').hidden, false);
    assert.equal(f.document.getElementById('communityError').hidden, true);
  } finally { await f.close(); }
});

test('menu navigation updates the current page and broadcasts selection, while popstate restores the list', async () => {
  const f = await fixture();
  const selections = [];
  try {
    f.window.addEventListener('community:selection', event => selections.push(event.detail.groupId));
    f.window.dispatchEvent(new f.window.CustomEvent('community:navigate', { detail: { groupId: null } }));
    await f.window.happyDOM.whenAsyncComplete();
    assert.equal(f.document.getElementById('communityList').hidden, false);
    f.window.dispatchEvent(new f.window.CustomEvent('community:navigate', { detail: { groupId: 'group-a' } }));
    await f.window.happyDOM.whenAsyncComplete();
    assert.equal(f.document.getElementById('communityGroupTitle').textContent, 'Compétiteurs');
    assert.equal(new URL(f.window.location.href).searchParams.get('group'), 'group-a');
    f.window.history.replaceState({}, '', '/groups.html');
    f.window.dispatchEvent(new f.window.PopStateEvent('popstate'));
    await f.window.happyDOM.whenAsyncComplete();
    assert.equal(f.document.getElementById('communityList').hidden, false);
    assert.deepEqual(selections, [null, 'group-a', null]);
  } finally { await f.close(); }
});

test('a failed load keeps navigation available and Retry forces a fresh list request', async () => {
  const requested = []; let fails = true;
  const f = await fixture('member', { loadGroups: async options => { requested.push(options); if (fails) throw new Error('Connexion temporairement interrompue.'); return [makeDetail('member').group]; } });
  try {
    await f.api.selectGroup(null);
    assert.equal(f.document.getElementById('communityList').hidden, false);
    assert.equal(f.document.getElementById('communityRetry').hidden, false);
    fails = false;
    f.document.getElementById('communityRetry').click();
    await f.window.happyDOM.whenAsyncComplete();
    assert.deepEqual(requested.at(-1), { force: true });
    assert.equal(f.document.getElementById('communityError').hidden, true);
    assert.equal(f.document.getElementById('communityRetry').hidden, true);
  } finally { await f.close(); }
});

test('group descriptions remain available in cards and the editor without adding detail-page reminders', async () => {
  const f = await fixture('owner');
  try {
    f.api.renderList();
    assert.match(f.document.querySelector('.community-group-card').textContent, /Un groupe ouvert/);
    f.api.state.detail = f.detail; f.api.renderDetail(); f.api.activateTab('members');
    assert.equal(f.document.querySelector('.community-section-heading p'), null);
    f.api.editGroup(f.detail.group);
    assert.equal(f.document.querySelector('[name="description"]').value, 'Un groupe ouvert');
    assert.equal(f.calls.length, 0);
  } finally { await f.close(); }
});

test('navigating away destroys the member picker so a late invitation cannot reopen or refresh its group', async () => {
  const write = deferred(); let reads = 0;
  const f = await fixture('owner', {
    loadGroup: async () => { reads++; return makeDetail('owner'); },
    command: async action => action === 'invite_candidates' ? { items: [{ user_id: 'candidate', athlete_id: 'a4', name: 'Zoé', status: 'available' }], next_offset: null } : write.promise
  });
  try {
    f.api.renderDetail(); f.api.inviteMember(); await f.window.happyDOM.whenAsyncComplete();
    f.document.querySelector('[name="candidate"]').click();
    f.document.querySelector('.community-picker-send button').click();
    await f.api.selectGroup(null);
    assert.equal(f.document.getElementById('communityDialog').open, false);
    write.resolve({ invited_count: 1, items: [{ user_id: 'candidate', status: 'invited' }] });
    await f.window.happyDOM.whenAsyncComplete();
    assert.equal(f.api.state.selectedId, null); assert.equal(reads, 0);
    assert.equal(f.document.getElementById('communityList').hidden, false);
    assert.equal(f.document.querySelector('.community-member-picker').childElementCount, 0);
  } finally { await f.close(); }
});

test('join landing passes the viewer and guards callbacks after ordinary group navigation', async () => {
  let received, destroyed = 0;
  const f = await fixture('member', { joinToken: 'a'.repeat(64), mountJoinLinkLanding: (_host, options) => { received = options; return { destroy() { destroyed++; } }; } });
  try {
    f.api.renderJoinLanding();
    assert.equal(received.token, 'a'.repeat(64)); assert.equal(received.user.id, 'member'); assert.equal(received.isCurrent(), true);
    assert.equal(f.document.getElementById('communityList').hidden, true);
    await f.api.selectGroup(null);
    assert.equal(destroyed, 1); assert.equal(received.isCurrent(), false);
    received.onAccepted({ group_id: 'stale-group' });
    await f.window.happyDOM.whenAsyncComplete();
    assert.equal(f.api.state.selectedId, null);
  } finally { await f.close(); }
});

test('accepting a join landing opens the joined group and refreshes memberships', async () => {
  let received; const requests = [];
  const f = await fixture('member', { joinToken: 'b'.repeat(64), loadGroups: async options => { requests.push(options); return [makeDetail('member').group]; },
    mountJoinLinkLanding: (_host, options) => { received = options; return { destroy() {} }; } });
  try {
    f.api.renderJoinLanding(); received.onAccepted({ group_id: 'group-a' });
    await f.window.happyDOM.whenAsyncComplete();
    assert.equal(f.api.state.selectedId, 'group-a');
    assert.equal(f.document.getElementById('communityDetail').getAttribute('aria-labelledby'), 'communityGroupTitle');
    assert.deepEqual(requests.at(-1), { force: true });
  } finally { await f.close(); }
});
