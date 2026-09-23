import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Window } from 'happy-dom';

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const ok = data => ({ data, error: null });
const account = { user: { id: 'admin-one' } };
const person = name => ({ id: name, full_name: name, email: `${name}@example.test`, account_type: 'coach' });
async function settle() { for (let i = 0; i < 15; i++) await Promise.resolve(); await new Promise(setImmediate); }
async function surface({ session = async () => ok({ session: account }), profile = async () => ok({ is_admin: true }), gym = async () => ok({ gym_name: 'Gym actuel', address: 'Adresse actuelle' }), invoke = async () => ok({ users: [person('Actuel')] }) } = {}) {
  const window = new Window({ url: 'https://example.test/team/admin/', settings: { disableJavaScriptFileLoading: true, disableCSSFileLoading: true } });
  window.document.write(await readFile(new URL('../admin/index.html', import.meta.url), 'utf8'));
  const calls = [], navigations = [], alerts = []; let callback;
  window.__client = {
    auth: { getSession: session, onAuthStateChange(fn) { callback = fn; }, async signOut() { callback('SIGNED_OUT'); return { error: null }; } },
    from(table) { calls.push(table); return { select() { return this; }, eq() { return this; }, single: profile, maybeSingle: gym }; },
    functions: { invoke: async (_name, { body }) => { calls.push(body.action); return invoke(body); } },
  };
  window.__navigate = url => navigations.push(url); window.confirm = () => true; window.alert = text => alerts.push(text);
  const source = (await readFile(new URL('../js/admin.js', import.meta.url), 'utf8')).replace(/^import \{ client \}.*$/m, 'const client = window.__client;').replace(/^import \{ beginTestSession \}.*$/m, 'const beginTestSession = async () => {};').replace(/^import \{ mountNavigation \}.*$/m, 'const mountNavigation = () => {};').replaceAll('location.replace(', 'window.__navigate(');
  window.eval(source); await settle();
  return { window, calls, alerts, navigations, $: id => window.document.getElementById(id), emit: (...args) => callback(...args), close: () => window.happyDOM.abort() };
}
function assertCleared(ui) {
  assert.equal(ui.$('gymBrand').textContent, 'Mon gym'); assert.equal(ui.$('gymAddress').textContent, '');
  assert.equal(ui.$('userRows').children.length, 0); assert.equal(ui.$('createTestButton').disabled, true); assert.equal(ui.$('refreshButton').disabled, true);
  assert.equal(ui.$('adminError').textContent, ''); assert.equal(ui.$('toast').textContent, '');
}

test('sign-out invalidates an initialization paused at session, profile or gym', async () => {
  for (const stage of ['session', 'profile', 'gym']) {
    const pending = deferred();
    const ui = await surface({ [stage]: () => pending.promise });
    try {
      ui.emit('SIGNED_OUT');
      pending.resolve(ok(stage === 'session' ? { session: account } : stage === 'profile' ? { is_admin: true } : { gym_name: 'Ancien gym privé', address: 'Ancienne adresse' }));
      await settle(); assertCleared(ui);
      assert.equal(ui.calls.includes('list'), false, stage); assert.deepEqual(ui.navigations, ['../login.html']);
    } finally { await ui.close(); }
  }
});

test('an old initialization cannot overwrite a newer persisted-page initialization', async () => {
  const oldGym = deferred(); let count = 0;
  const ui = await surface({ gym: () => ++count === 1 ? oldGym.promise : Promise.resolve(ok({ gym_name: 'Nouveau gym', address: 'Nouvelle adresse' })) });
  try {
    const restored = new ui.window.Event('pageshow'); Object.defineProperty(restored, 'persisted', { value: true });
    ui.window.dispatchEvent(restored); await settle();
    assert.equal(ui.$('gymBrand').textContent, 'Nouveau gym');
    oldGym.resolve(ok({ gym_name: 'Ancien gym', address: 'Ancienne adresse' })); await settle();
    assert.equal(ui.$('gymBrand').textContent, 'Nouveau gym'); assert.equal(ui.$('gymAddress').textContent, 'Nouvelle adresse');
    assert.equal(ui.calls.filter(call => call === 'list').length, 1);
  } finally { await ui.close(); }
});

test('the newest overlapping user-list request wins', async () => {
  const older = deferred(), newer = deferred(); let count = 0;
  const ui = await surface({ invoke: body => {
    count++; return count === 1 ? Promise.resolve(ok({ users: [person('Initial')] })) : count === 2 ? older.promise : newer.promise;
  } });
  try {
    ui.$('refreshButton').click(); await settle();
    ui.$('refreshButton').dispatchEvent(new ui.window.Event('click')); await settle();
    assert.equal(count, 3);
    newer.resolve(ok({ users: [person('Newest')] })); await settle();
    assert.match(ui.$('userRows').textContent, /Newest/); assert.equal(ui.$('refreshButton').disabled, false);
    older.resolve(ok({ users: [person('Stale')] })); await settle();
    assert.match(ui.$('userRows').textContent, /Newest/); assert.doesNotMatch(ui.$('userRows').textContent, /Stale/);
  } finally { await ui.close(); }
});

test('stale list errors after sign-out cannot repopulate messages or enable controls', async () => {
  const pending = deferred();
  const ui = await surface({ invoke: () => pending.promise });
  try {
    ui.emit('SIGNED_OUT'); pending.resolve({ data: null, error: { message: 'Ancienne erreur privée' } }); await settle();
    assertCleared(ui);
  } finally { await ui.close(); }
});

test('late mutation responses after sign-out cannot reveal credentials or re-enable row actions', async () => {
  const creation = deferred(), reset = deferred(), removal = deferred();
  const ui = await surface({ invoke: body => body.action === 'athlete_test_session' ? creation.promise : body.action === 'reset_password' ? reset.promise : body.action === 'delete' ? removal.promise : Promise.resolve(ok({ users: [person('Original')] })) });
  try {
    const resetButton = ui.$('userRows').querySelector('.edit'), removeButton = ui.$('userRows').querySelector('.danger');
    resetButton.click(); removeButton.click(); ui.$('createTestButton').click(); await settle();
    ui.emit('SIGNED_OUT');
    creation.resolve(ok({ email: 'sensitive@example.test', password: 'do-not-display' })); reset.resolve(ok({})); removal.resolve(ok({})); await settle();
    assertCleared(ui); assert.equal(ui.alerts.length, 0); assert.equal(resetButton.disabled, true); assert.equal(removeButton.disabled, true);
    assert.equal(ui.calls.filter(call => call === 'list').length, 1);
  } finally { await ui.close(); }
});
