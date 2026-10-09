import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Window } from 'happy-dom';
import * as ui from '../js/ui.js';

const source = (await readFile(new URL('../js/community-member-picker.js', import.meta.url), 'utf8'))
  .replace(/^import .*;\n/gm, '').replace('export function', 'function');
const makeCandidate = (id, status = 'available', name = `Prénom ${id}`) => ({ user_id: status === 'sans_compte' ? null : id, athlete_id: `athlete-${id}`, name, email: `${id}@example.test`, status });
const tick = () => new Promise(resolve => setTimeout(resolve, 5));
function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }

async function fixture({ role = 'owner', command, onShare } = {}) {
  const window = new Window({ url: 'http://localhost/groups.html' });
  const previous = globalThis.document;
  globalThis.document = window.document;
  const host = window.document.createElement('div'); window.document.body.append(host);
  const calls = [], changes = [];
  let active = true;
  const rpc = async (action, data) => {
    calls.push({ action, data });
    return command ? command(action, data) : { items: [], next_offset: null };
  };
  const bindings = { ...ui, communityCommand: rpc };
  const mount = new Function(...Object.keys(bindings), `${source}\nreturn mountMemberPicker;`)(...Object.values(bindings));
  const picker = mount(host, { group: { id: 'group-a', role }, command: rpc, searchDelay: 0, isCurrent: () => active, onChanged: () => changes.push(true), onShare });
  await tick();
  return { window, host, calls, changes, picker,
    setCurrent(value) { active = value; },
    async search(value) { const control = host.querySelector('[name="member_search"]'); control.value = value; control.dispatchEvent(new window.Event('input')); await tick(); },
    choose(id) { const checkbox = host.querySelector(`input[name="candidate"][value="${id}"]`); assert.ok(checkbox); checkbox.click(); },
    async close() { picker.destroy(); await window.happyDOM.abort(); if (previous === undefined) delete globalThis.document; else globalThis.document = previous; }
  };
}

test('picker shows names first, separate email and disabled membership statuses without inviting on load', async () => {
  const items = [makeCandidate('a', 'available', '<b>Sam Test</b>'), makeCandidate('b', 'member'), makeCandidate('c', 'pending'), makeCandidate('d', 'sans_compte')];
  const f = await fixture({ command: async () => ({ items, next_offset: null }) });
  try {
    assert.deepEqual(f.calls, [{ action: 'invite_candidates', data: { group_id: 'group-a', query: '', offset: 0 } }]);
    assert.equal(f.host.querySelector('.community-candidate strong').textContent, '<b>Sam Test</b>');
    assert.equal(f.host.querySelector('.community-candidate b'), null);
    assert.deepEqual([...f.host.querySelectorAll('[name="candidate"]')].map(node => node.disabled), [false, true, true, true]);
    assert.match(f.host.textContent, /Déjà membre/); assert.match(f.host.textContent, /Invitation envoyée/); assert.match(f.host.textContent, /Compte non lié/);
    assert.equal(f.host.querySelector('[name="member_search"]').maxLength, 200);
    assert.equal(f.host.querySelector('[name="role"]').value, 'member');
  } finally { await f.close(); }
});

test('selection survives name/email searches and pagination; invitations use one explicit batch', async () => {
  const f = await fixture({ command: async (action, data) => {
    if (action === 'invite_members') return { invited_count: 3, items: data.user_ids.map(user_id => ({ user_id, status: 'invited' })) };
    if (data.query) return { items: [makeCandidate('c')], next_offset: null };
    return data.offset ? { items: [makeCandidate('a'), makeCandidate('b')], next_offset: null } : { items: [makeCandidate('a')], next_offset: 30 };
  } });
  try {
    f.choose('a'); f.host.querySelector('.community-picker-more').click(); await tick();
    assert.equal(f.host.querySelectorAll('[name="candidate"]').length, 2);
    assert.equal(f.host.querySelector('[value="a"]').checked, true);
    f.choose('b'); await f.search(' c@example.test '); f.choose('c');
    assert.equal(f.host.querySelector('.community-picker-selection summary').textContent, '3 personnes sélectionnées');
    assert.deepEqual(f.calls.at(-1), { action: 'invite_candidates', data: { group_id: 'group-a', query: 'c@example.test', offset: 0 } });
    f.host.querySelector('[name="role"]').value = 'admin';
    f.host.querySelector('.community-picker-send button').click(); await tick();
    assert.deepEqual(f.calls.at(-1), { action: 'invite_members', data: { group_id: 'group-a', user_ids: ['a', 'b', 'c'], role: 'admin' } });
    assert.equal(f.host.querySelector('[value="c"]').disabled, true);
    assert.match(f.host.querySelector('.community-picker-outcome').textContent, /3 invitations envoyées/);
    assert.equal(f.host.querySelector('.community-picker-selection').hidden, true);
    assert.equal(f.changes.length, 1);
  } finally { await f.close(); }
});

test('late search results cannot replace a newer query and a failed page retries its original offset', async () => {
  const old = deferred(); let fail = true;
  const f = await fixture({ command: async (_action, data) => {
    if (data.query === 'old') return old.promise;
    if (data.offset && fail) throw new Error('Connexion interrompue.');
    return { items: [makeCandidate(data.offset ? 'second' : data.query || 'first')], next_offset: data.offset ? null : 30 };
  } });
  try {
    await f.search('old'); await f.search('new'); old.resolve({ items: [makeCandidate('old')], next_offset: null }); await tick();
    assert.equal(f.host.querySelector('[value="old"]'), null); assert.ok(f.host.querySelector('[value="new"]'));
    f.host.querySelector('.community-picker-more').click(); await tick();
    assert.ok(f.host.querySelector('[value="new"]')); assert.match(f.host.textContent, /Connexion interrompue/);
    fail = false; [...f.host.querySelectorAll('button')].find(node => node.textContent === 'Réessayer').click(); await tick();
    assert.deepEqual(f.calls.at(-1).data, { group_id: 'group-a', query: 'new', offset: 30 });
    assert.ok(f.host.querySelector('[value="second"]'));
  } finally { await f.close(); }
});

test('failed batch keeps selection for an idempotent retry and duplicate clicks never send twice', async () => {
  const first = deferred(); let attempt = 0;
  const f = await fixture({ command: async (action) => {
    if (action === 'invite_candidates') return { items: [makeCandidate('a'), makeCandidate('b'), makeCandidate('c')], next_offset: null };
    attempt++; if (attempt === 1) return first.promise;
    return { invited_count: 1, pending_count: 1, member_count: 1, items: [{ user_id: 'a', status: 'pending' }, { user_id: 'b', status: 'member' }, { user_id: 'c', status: 'invited' }] };
  } });
  try {
    f.choose('a'); f.choose('b'); f.choose('c');
    const send = f.host.querySelector('.community-picker-send button'); send.click(); send.click();
    assert.equal(attempt, 1); assert.equal(send.disabled, true);
    first.reject(new Error('Réponse réseau indisponible.')); await tick();
    assert.equal(send.textContent, 'Réessayer l’envoi'); assert.equal(send.disabled, false);
    assert.equal(f.host.querySelector('.community-picker-selection summary').textContent, '3 personnes sélectionnées');
    send.click(); await tick();
    const writes = f.calls.filter(call => call.action === 'invite_members');
    assert.equal(writes.length, 2); assert.deepEqual(writes[0].data, writes[1].data);
    assert.match(f.host.querySelector('.community-picker-outcome').textContent, /1 invitation envoyée\. 1 invitation déjà en attente\. 1 personne déjà membre\./);
    assert.equal([...f.host.querySelectorAll('[name="candidate"]')].every(node => node.disabled), true);
  } finally { await f.close(); }
});

test('admins invite as members; manual email remains secondary and trims the address', async () => {
  const f = await fixture({ role: 'admin' });
  try {
    assert.equal(f.host.querySelector('[name="role"]'), null);
    assert.match(f.host.textContent, /Tes athlètes apparaîtront ici une fois leur lien coach accepté/);
    assert.equal(f.calls.filter(call => call.action === 'invite_member').length, 0);
    const form = f.host.querySelector('.community-picker-manual');
    form.querySelector('[name="email"]').value = '  personne@example.test  ';
    form.dispatchEvent(new f.window.Event('submit', { bubbles: true, cancelable: true })); await tick();
    assert.deepEqual(f.calls.find(call => call.action === 'invite_member'), { action: 'invite_member', data: { group_id: 'group-a', email: 'personne@example.test', role: 'member' } });
    assert.equal(f.changes.length, 1);
  } finally { await f.close(); }
});

test('closing or changing context suppresses late sends, reads, callbacks and stale controls', async () => {
  const sending = deferred(), reading = deferred();
  const f = await fixture({ command: async (action, data) => action === 'invite_members' ? sending.promise : data.query ? reading.promise : { items: [makeCandidate('a')], next_offset: null } });
  try {
    f.choose('a'); await f.search('pending');
    f.host.querySelector('.community-picker-send button').click();
    reading.resolve({ items: [makeCandidate('late')], next_offset: null }); await tick();
    assert.equal(f.host.querySelector('[value="late"]'), null);
    f.setCurrent(false); sending.resolve({ invited_count: 1, items: [{ user_id: 'a', status: 'invited' }] }); await tick();
    assert.equal(f.changes.length, 0); assert.equal(f.host.querySelector('.community-picker-outcome').hidden, true);
    const staleSearch = f.host.querySelector('[name="member_search"]'), before = f.calls.length;
    f.picker.destroy(); staleSearch.dispatchEvent(new f.window.Event('input')); await tick();
    assert.equal(f.calls.length, before); assert.equal(f.host.childElementCount, 0);
  } finally { await f.close(); }
});

test('selection limits a batch to 50 and exposes removable names across searches', async () => {
  const f = await fixture({ command: async () => ({ items: Array.from({ length: 51 }, (_, index) => makeCandidate(`u${index}`)), next_offset: null }) });
  try {
    for (let index = 0; index < 51; index++) f.choose(`u${index}`);
    assert.equal(f.host.querySelector('[value="u50"]').checked, false);
    assert.equal(f.host.querySelectorAll('.community-picker-selection-list li').length, 50);
    assert.match(f.host.textContent, /jusqu’à 50 invitations/);
    f.host.querySelector('.community-picker-selection-list button').click();
    assert.equal(f.host.querySelector('[value="u0"]').checked, false);
    assert.equal(f.host.querySelectorAll('.community-picker-selection-list li').length, 49);
  } finally { await f.close(); }
});

test('share manager mounts only after opening its section and is destroyed on close or picker teardown', async () => {
  const managers = [];
  const f = await fixture({ onShare: (_host, isCurrent) => { const item = { isCurrent, destroyed: false, destroy() { this.destroyed = true; } }; managers.push(item); return item; } });
  try {
    assert.equal(managers.length, 0);
    const details = [...f.host.querySelectorAll('details')].find(node => node.querySelector('summary').textContent === 'Partager un lien d’invitation');
    details.open = true; details.dispatchEvent(new f.window.Event('toggle'));
    assert.equal(managers.length, 1); assert.equal(managers[0].isCurrent(), true);
    details.open = false; details.dispatchEvent(new f.window.Event('toggle'));
    assert.equal(managers[0].destroyed, true); assert.equal(managers[0].isCurrent(), false);
    details.open = true; details.dispatchEvent(new f.window.Event('toggle'));
    f.picker.destroy(); assert.equal(managers[1].destroyed, true);
  } finally { await f.close(); }
});
