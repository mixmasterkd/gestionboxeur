import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { defaultBulletinBoard, mountBulletinBoard, normalizeBulletinBoard, safeBulletinURL } from '../js/bulletin-board.js';

const flush = () => new Promise(resolve => setTimeout(resolve, 0));
async function fixture({ initial = null, load, save, demo = false } = {}) {
  const window = new Window({ url: 'https://example.test/tools.html' });
  const host = window.document.createElement('div'); window.document.body.append(host);
  const calls = []; let persisted = structuredClone(initial);
  const store = {
    demo,
    async loadBoard() { return load ? load() : structuredClone(persisted); },
    async saveBoard(value) { calls.push(structuredClone(value)); if (save) await save(value); persisted = structuredClone(value); },
  };
  const ui = mountBulletinBoard(host, { store, createScene: () => null }); await ui.ready;
  const $ = selector => host.querySelector(selector);
  return { window, host, ui, $, calls, saved: () => persisted,
    submit() { $('#bulletinForm').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })); },
    async close() { ui.destroy(); await window.happyDOM.abort(); },
  };
}

test('default board supplies three notes and six verified public links as independent copies', () => {
  const first = defaultBulletinBoard(), second = defaultBulletinBoard();
  assert.equal(first.notes.length, 3); assert.equal(first.notes.flatMap(note => note.links).length, 6);
  for (const note of first.notes) for (const link of note.links) assert.ok(safeBulletinURL(link.url));
  first.notes[0].title = 'changed'; assert.notEqual(second.notes[0].title, first.notes[0].title);
  assert.deepEqual(normalizeBulletinBoard(second), second);
});

test('URL validation rejects executable, relative and credential-bearing URLs', () => {
  for (const url of ['javascript:alert(1)', 'data:text/html,hello', '/page', '//bad.test', 'file:///tmp/test', 'https://name:secret@example.com', null]) assert.equal(safeBulletinURL(url), null);
  assert.equal(safeBulletinURL(' https://fqbo.qc.ca/ '), 'https://fqbo.qc.ca/');
  assert.equal(safeBulletinURL('http://example.com'), 'http://example.com/');
});

test('schema rejects malformed notes, duplicate IDs and excessive input', () => {
  for (const invalid of [null, {}, { notes: Array(31).fill({}) }]) assert.throws(() => normalizeBulletinBoard(invalid));
  const board = defaultBulletinBoard(); board.notes[1].id = board.notes[0].id; assert.throws(() => normalizeBulletinBoard(board));
  for (const patch of [{ title: ' ' }, { title: 'x'.repeat(101) }, { body: 'x'.repeat(1201) }, { color: 'red' }, { links: [{ label: 'unsafe', url: 'javascript:void(0)' }] }]) assert.throws(() => normalizeBulletinBoard({ notes: [{ ...defaultBulletinBoard().notes[0], ...patch }] }));
});

test('never-saved board seeds once visually and saved empty board stays empty', async () => {
  const app = await fixture();
  try {
    assert.equal(app.host.querySelectorAll('.bulletin-note').length, 3);
    assert.equal(app.calls.length, 0, 'simply visiting does not write account data');
    assert.equal(app.$('#bulletinAdd').disabled, false);
    assert.ok([...app.host.querySelectorAll('.bulletin-note-links a')].every(anchor => anchor.target === '_blank' && anchor.rel.includes('noopener')));
  } finally { await app.close(); }
  const empty = await fixture({ initial: { notes: [] } });
  try {
    assert.equal(empty.host.querySelectorAll('.bulletin-note').length, 0); assert.equal(empty.$('#bulletinEmpty').hidden, false);
  } finally { await empty.close(); }
});

test('board stays free of slogans and persistent success messages for new and saved accounts', async () => {
  for (const initial of [null, defaultBulletinBoard()]) {
    const app = await fixture({ initial });
    try {
      for (const phrase of ['Ton coin du gym', 'Les bons repères, à portée de main', 'Enregistré dans ton compte', 'LE COIN DU RING']) assert.equal(app.host.textContent.includes(phrase), false);
      assert.equal(app.$('.bulletin-nameplate'), null);
      assert.equal(app.$('.bulletin-toolbar').children.length, 1);
      assert.equal(app.$('.bulletin-toolbar').firstElementChild.id, 'bulletinAdd');
      assert.equal(app.$('.bulletin-state').hidden, true);
      assert.equal(app.$('#bulletinStatus').textContent, '');
    } finally { await app.close(); }
  }
});

test('saving remains visible only while pending and disappears completely after success', async () => {
  let release;
  const app = await fixture({ save: () => new Promise(resolve => { release = resolve; }) });
  try {
    app.$('[data-action="down"]').click();
    assert.equal(app.$('.bulletin-state').hidden, false);
    assert.equal(app.$('#bulletinStatus').textContent, 'Enregistrement…');
    await flush(); release(); await flush();
    assert.equal(app.$('.bulletin-state').hidden, true);
    assert.equal(app.$('#bulletinStatus').textContent, '');
  } finally { await app.close(); }
});

test('create, edit, order and delete notes persist the entire active board safely', async () => {
  const app = await fixture({ initial: { notes: [] } });
  try {
    app.$('#bulletinAdd').click(); const form = app.$('#bulletinForm');
    form.elements.title.value = 'Ma liste <img src=x onerror=alert(1)>';
    form.elements.body.value = '<script>alert(1)</script>\nGants et protège-dents.';
    app.$('#bulletinAddLink').click();
    app.$('[data-link-label]').value = 'FQBO'; app.$('[data-link-url]').value = 'https://fqbo.qc.ca/';
    app.submit(); await flush();
    assert.equal(app.$('#bulletinEditor').open, false); assert.equal(app.calls.length, 1);
    assert.equal(app.$('.bulletin-note h2').textContent, 'Ma liste <img src=x onerror=alert(1)>');
    assert.equal(app.$('.bulletin-note img'), null); assert.equal(app.$('.bulletin-note script'), null);
    assert.equal(app.saved().notes[0].links[0].url, 'https://fqbo.qc.ca/');
    app.$('[data-action="edit"]').click(); form.elements.title.value = 'Mon matériel'; app.submit(); await flush();
    assert.equal(app.saved().notes[0].title, 'Mon matériel');
    app.$('#bulletinAdd').click(); form.elements.title.value = 'Une autre note'; app.submit(); await flush();
    app.$('[data-action="down"]').click(); await flush();
    assert.deepEqual(app.saved().notes.map(note => note.title), ['Une autre note', 'Mon matériel']);
    app.$('[data-action="remove"]').click(); assert.equal(app.$('#bulletinDelete').open, true);
    app.$('#bulletinDeleteCancel').click(); assert.equal(app.saved().notes.length, 2);
    app.$('[data-action="remove"]').click(); app.$('#bulletinDeleteConfirm').click(); await flush();
    assert.deepEqual(app.saved().notes.map(note => note.title), ['Mon matériel']);
    assert.equal(app.ui.canLeave(), true);
  } finally { await app.close(); }
});

test('invalid manual links keep editor open and never persist', async () => {
  const app = await fixture({ initial: { notes: [] } });
  try {
    app.$('#bulletinAdd').click(); app.$('#bulletinForm').elements.title.value = 'Test'; app.$('#bulletinAddLink').click();
    app.$('[data-link-label]').value = 'Mauvais lien'; app.$('[data-link-url]').value = 'javascript:alert(1)';
    app.submit(); await flush();
    assert.equal(app.calls.length, 0); assert.equal(app.$('#bulletinEditor').open, true); assert.match(app.$('#bulletinFormError').textContent, /https/);
  } finally { await app.close(); }
});

test('pointer drag captures the stable board, commits order on release and cancels without a write', async () => {
  const app = await fixture();
  try {
    const surface = app.$('.bulletin-surface'), list = app.$('#bulletinNotes');
    let captured = null;
    surface.setPointerCapture = id => { captured = id; };
    surface.releasePointerCapture = () => { captured = null; };
    app.window.document.elementFromPoint = () => list.children[1];
    const pointer = (type, x) => new app.window.PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 7, button: 0, clientX: x, clientY: 200 });
    app.$('.bulletin-grip').dispatchEvent(pointer('pointerdown', 100)); assert.equal(captured, 7);
    surface.dispatchEvent(pointer('pointermove', 200)); surface.dispatchEvent(pointer('pointerup', 200)); await flush();
    assert.deepEqual(app.saved().notes.map(note => note.id), ['first-bout', 'boxing-quebec', 'medical-forms']);
    assert.equal(captured, null); assert.equal(app.calls.length, 1);
    app.$('.bulletin-grip').dispatchEvent(pointer('pointerdown', 100)); surface.dispatchEvent(pointer('pointermove', 200)); surface.dispatchEvent(pointer('pointercancel', 200)); await flush();
    assert.equal(app.calls.length, 1); assert.equal(list.firstElementChild.dataset.noteId, 'first-bout');
  } finally { await app.close(); }
});

test('load failure does not silently reseed or enable mutations, retry recovers original board', async () => {
  let offline = true;
  const app = await fixture({ load: () => { if (offline) throw new Error('offline'); return { notes: [] }; } });
  try {
    assert.equal(app.$('#bulletinAdd').disabled, true); assert.equal(app.$('#bulletinRetry').hidden, false); assert.equal(app.calls.length, 0);
    assert.equal(app.$('.bulletin-state').hidden, false);
    assert.match(app.$('#bulletinStatus').textContent, /Aucune note/);
    offline = false; app.$('#bulletinRetry').click(); await flush();
    assert.equal(app.$('#bulletinAdd').disabled, false); assert.equal(app.$('#bulletinEmpty').hidden, false);
    assert.equal(app.$('.bulletin-state').hidden, true);
  } finally { await app.close(); }
});

test('save failure preserves local edits, shows backend conflict cause, guards leaving and retries', async () => {
  let fail = true;
  const app = await fixture({ save: () => { if (fail) throw new Error('Le babillard a changé ailleurs. Rouvre-le avant de réessayer.'); } });
  try {
    app.$('[data-action="edit"]').click(); app.$('#bulletinForm').elements.title.value = 'Texte à conserver'; app.submit(); await flush();
    assert.match(app.$('#bulletinStatus').textContent, /changé ailleurs/); assert.equal(app.$('#bulletinRetry').hidden, false);
    assert.equal(app.$('.bulletin-state').hidden, false);
    assert.equal(app.$('.bulletin-note h2').textContent, 'Texte à conserver');
    let asks = 0; app.window.confirm = () => { asks++; return false; }; assert.equal(app.ui.canLeave(), false); assert.equal(asks, 1);
    fail = false; app.$('#bulletinRetry').click(); await flush();
    assert.equal(app.saved().notes[0].title, 'Texte à conserver'); assert.equal(app.ui.canLeave(), true); assert.equal(app.$('#bulletinRetry').hidden, true);
    assert.equal(app.$('.bulletin-state').hidden, true);
  } finally { await app.close(); }
});

test('saves are ordered, and destroy skips queued not-yet-started saves', async () => {
  let release;
  const app = await fixture({ save: () => new Promise(resolve => { release = resolve; }) });
  try {
    app.$('[data-action="down"]').click(); await flush(); assert.equal(app.calls.length, 1);
    app.$('[data-action="down"]').click(); await flush(); assert.equal(app.calls.length, 1);
    app.ui.destroy(); release(); await flush(); assert.equal(app.calls.length, 1);
  } finally { await app.close(); }
});

test('demo wording is explicit and late loads never rebuild a destroyed board', async () => {
  const app = await fixture({ demo: true });
  try { assert.equal(app.$('#bulletinDemo').hidden, false); assert.match(app.$('#bulletinDemo').textContent, /Démo : rien n’est enregistré/); assert.equal(app.$('.bulletin-state').hidden, true); } finally { await app.close(); }
  const window = new Window({ url: 'https://example.test' }), host = window.document.createElement('div'); window.document.body.append(host);
  let release; const store = { loadBoard: () => new Promise(resolve => { release = resolve; }), saveBoard: async () => {} };
  const ui = mountBulletinBoard(host, { store, createScene: () => null });
  assert.equal(host.querySelector('.bulletin-state').hidden, false);
  assert.match(host.querySelector('#bulletinStatus').textContent, /Chargement/);
  ui.destroy(); release(defaultBulletinBoard()); await ui.ready;
  assert.equal(host.children.length, 0); await window.happyDOM.abort();
});
