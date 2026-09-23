import test from 'node:test';
import assert from 'node:assert/strict';
import { createRosterStore } from '../js/roster-store.js';

const missingRole = { code: '42703', message: 'column profiles.account_type does not exist' };
const missingTable = { code: 'PGRST205', message: "Could not find the table 'public.coach_athletes' in the schema cache" };
function backend({ legacy = false, profileError, relationError, rpcError, missingUnrelated = false, profileOverrides = {}, athleteRows, relationRows, rpcData = null } = {}) {
  const calls = [];
  const athletes = athleteRows || [
    { id: 'athlete-one', coach_id: 'coach-id', first_name: 'Martin', last_name: '', status: 'available', is_active: true, notes: 'Private legacy note', selected: true },
    { id: 'athlete-two', coach_id: 'coach-id', first_name: 'Alex', last_name: '', status: 'injured', is_active: false, notes: 'Repos', selected: false },
  ];
  const profile = { id: 'coach-id', full_name: 'Camille', is_admin: false, phone: '', ...(!legacy ? { account_type: 'coach' } : {}), ...profileOverrides };
  const client = {
    from(table) {
      const request = { table, action: 'select', filters: [] };
      return {
        select(fields) { request.fields = fields; return this; },
        eq(field, value) { request.filters.push([field, value]); return this; },
        in(field, values) { request.filters.push([field, values]); return this; },
        order(field) { request.order = field; return this; },
        limit(count) { request.limit = count; return this; },
        single() { request.single = true; return this; },
        update(payload) { request.action = 'update'; request.payload = payload; return this; },
        insert(payload) { request.action = 'insert'; request.payload = payload; return this; },
        delete() { request.action = 'delete'; return this; },
        then(resolve, reject) {
          calls.push(structuredClone(request));
          let data = null, error = null;
          if (table === 'profiles') {
            if (request.fields.includes('account_type')) error = profileError || (legacy ? missingRole : null);
            data = profile;
          } else if (table === 'coach_athletes') {
            error = relationError || (legacy ? missingTable : null);
            data = relationRows || [{ athlete_id: 'athlete-one', private_notes: 'Private relation note', selected: true }];
          } else if (table === 'athletes') {
            data = request.action === 'select' ? athletes : { id: 'athlete-one' };
          }
          return Promise.resolve({ data, error }).then(resolve, reject);
        },
      };
    },
    async rpc(name, args) { calls.push({ rpc: name, args: structuredClone(args) }); return { data: rpcData, error: rpcError || null }; },
  };
  return { client, calls };
}

test('legacy mode requires both specific missing profile column and missing relation table', async () => {
  const mock = backend({ legacy: true });
  const store = createRosterStore(mock.client);
  const profile = await store.loadProfile('coach-id');
  assert.equal(profile.account_type, 'coach');
  assert.equal(store.mode, 'legacy');
  assert.deepEqual(mock.calls.map(call => call.table), ['profiles', 'coach_athletes', 'profiles']);
  const athletes = await store.loadAthletes();
  assert.equal(athletes.length, 2);
  assert.equal(athletes[1].row.is_active, false);
  assert.equal(athletes[1].row.status, 'injured');
  assert.equal(athletes[0].relation.private_notes, 'Private legacy note');
  assert.equal(athletes[0].relation.selected, true);
  const query = mock.calls.at(-1);
  assert.deepEqual(query.filters, [['coach_id', 'coach-id']]);
  assert.doesNotMatch(query.fields, /\*/);
});

test('legacy mutations keep owner filter, original notes/selection and do not conflate availability with is_active', async () => {
  const mock = backend({ legacy: true });
  const store = createRosterStore(mock.client);
  await store.loadProfile('coach-id');
  await store.saveAthlete('athlete-one', { first_name: 'Martin', status: 'unavailable', private_notes: 'Pour moi', selected: false });
  await store.saveAthlete('athlete-one', { selected: true });
  await store.saveAthlete('', { first_name: 'Alex', last_name: '', birth_date: null, sex: null, weight_kg: null, private_notes: '', selected: false });
  await store.removeAthlete('athlete-one');
  const mutations = mock.calls.filter(call => call.action !== 'select');
  assert.deepEqual(mutations.map(call => call.action), ['update', 'update', 'insert', 'delete']);
  assert.deepEqual(mutations[0].filters, [['id', 'athlete-one'], ['coach_id', 'coach-id']]);
  assert.deepEqual(mutations[0].payload, { first_name: 'Martin', status: 'unavailable', notes: 'Pour moi', selected: false });
  assert.deepEqual(mutations[1].payload, { selected: true });
  assert.equal(mutations[2].payload.coach_id, 'coach-id');
  assert.equal(mutations[2].payload.notes, null);
  assert.equal(mutations[2].payload.weight_kg, null);
  assert.deepEqual(mutations[3].filters, [['id', 'athlete-one'], ['coach_id', 'coach-id']]);
  assert.ok(mutations.every(call => !('is_active' in (call.payload || {}))));
  assert.equal(mock.calls.some(call => call.rpc), false);
});

test('modern mode never reads legacy private columns and writes only through relation-aware RPCs', async () => {
  const mock = backend(); const store = createRosterStore(mock.client);
  await store.loadProfile('coach-id');
  const rows = await store.loadAthletes();
  assert.equal(store.mode, 'modern');
  assert.equal(rows[0].relation.private_notes, 'Private relation note');
  await store.saveAthlete('athlete-one', { selected: true });
  await store.saveAthlete('', { first_name: 'Martin' });
  await store.removeAthlete('athlete-one');
  const athleteQueries = mock.calls.filter(call => call.table === 'athletes');
  assert.ok(athleteQueries.every(call => !/(notes|selected|\*)/.test(call.fields)));
  assert.ok(athleteQueries.every(call => call.action === 'select'));
  assert.deepEqual(mock.calls.filter(call => call.rpc).map(call => call.rpc), ['update_roster_athlete', 'create_roster_athlete', 'archive_roster_athlete']);
});

test('permission, network and unrelated missing-column errors never trigger compatibility fallback', async () => {
  for (const profileError of [
    { code: '42501', message: 'permission denied for table profiles' },
    { code: '42501', message: 'column profiles.account_type does not exist' },
    { message: 'Failed to fetch' },
    { code: '42703', message: 'column profiles.full_name does not exist' },
    { code: 'PGRST204', message: "Could not find the 'account_type' column of 'athletes' in the schema cache" },
  ]) {
    const mock = backend({ profileError }); const store = createRosterStore(mock.client);
    await assert.rejects(store.loadProfile('coach-id'), error => error === profileError);
    assert.equal(store.mode, 'unknown');
    assert.equal(mock.calls.length, 1);
    await assert.rejects(store.saveAthlete('athlete-one', { selected: true }), /Charge ton compte/);
  }
});

test('missing role without proven absent relations refuses old private data reads', async () => {
  const mock = backend({ profileError: missingRole }); const store = createRosterStore(mock.client);
  await assert.rejects(store.loadProfile('coach-id'), /ne correspondent pas/);
  assert.equal(store.mode, 'unknown');
  assert.equal(mock.calls.some(call => call.table === 'athletes'), false);
  for (const relationError of [
    { code: '42501', message: 'permission denied for table coach_athletes' },
    { message: 'Network failed' },
    { code: '42P01', message: 'relation "public.unrelated_table" does not exist' },
  ]) {
    const blocked = backend({ profileError: missingRole, relationError });
    await assert.rejects(createRosterStore(blocked.client).loadProfile('coach-id'), error => error === relationError);
    assert.equal(blocked.calls.length, 2);
  }
});

test('modern missing relation or RPC error does not switch to legacy operations', async () => {
  const readMock = backend({ relationError: missingTable }); const readStore = createRosterStore(readMock.client);
  await readStore.loadProfile('coach-id');
  await assert.rejects(readStore.loadAthletes(), error => error === missingTable);
  assert.equal(readStore.mode, 'modern');
  assert.equal(readMock.calls.some(call => call.table === 'athletes'), false);
  const rpcError = { code: 'PGRST202', message: 'Could not find function public.update_roster_athlete' };
  const writeMock = backend({ rpcError }); const writeStore = createRosterStore(writeMock.client);
  await writeStore.loadProfile('coach-id');
  await assert.rejects(writeStore.saveAthlete('athlete-one', { selected: true }), error => error === rpcError);
  assert.equal(writeStore.mode, 'modern');
  assert.equal(writeMock.calls.some(call => call.table === 'athletes'), false);
});

test('legacy missing-column cache and PostgreSQL missing-table formats are supported exactly', async () => {
  const mock = backend({ legacy: true,
    profileError: { code: 'PGRST204', message: "Could not find the 'account_type' column of 'profiles' in the schema cache" },
    relationError: { code: '42P01', message: 'relation "public.coach_athletes" does not exist' },
  });
  const store = createRosterStore(mock.client); await store.loadProfile('coach-id');
  assert.equal(store.mode, 'legacy');
  store.reset();
  assert.equal(store.mode, 'unknown');
  await assert.rejects(store.loadAthletes(), /Charge ton compte/);
});

test('a late profile response cannot restore store access after session reset', async () => {
  let resolveProfile;
  const profile = new Promise(resolve => { resolveProfile = resolve; });
  const client = { from() { return { select() { return this; }, eq() { return this; }, single() { return profile; } }; } };
  const store = createRosterStore(client);
  const loading = store.loadProfile('old-coach');
  store.reset();
  resolveProfile({ data: { id: 'old-coach', account_type: 'coach' }, error: null });
  await assert.rejects(loading, /session a changé/);
  assert.equal(store.mode, 'unknown');
  await assert.rejects(store.saveAthlete('athlete-id', { selected: true }), /Charge ton compte/);
});

const attachment = () => ({
  source: { id: 'a0000000-0000-4000-8000-000000000001', userId: null, updatedAt: '2026-09-22T10:00:00.000Z', relationUpdatedAt: '2026-09-22T10:01:00.000Z' },
  target: { id: 'a0000000-0000-4000-8000-000000000002', userId: 'b0000000-0000-4000-8000-000000000001', updatedAt: '2026-09-22T11:00:00.000Z', relationUpdatedAt: '2026-09-22T11:01:00.000Z' },
  choices: { weight: 'source', record: 'target' },
});

test('attachment sends both athlete versions, both relation versions and explicit conflict choices through one RPC', async () => {
  const { source, target, choices } = attachment();
  const original = structuredClone({ source, target, choices });
  const mock = backend({ rpcData: target.id }); const store = createRosterStore(mock.client);
  await store.loadProfile('coach-id'); mock.calls.length = 0;
  const result = await store.mergeAthletes(source, target, choices);
  assert.equal(result, target.id);
  assert.deepEqual(mock.calls, [{ rpc: 'merge_roster_athlete', args: {
    p_source_id: source.id, p_target_id: target.id,
    p_source_updated_at: source.updatedAt, p_target_updated_at: target.updatedAt,
    p_source_relation_updated_at: source.relationUpdatedAt, p_target_relation_updated_at: target.relationUpdatedAt,
    p_choices: { weight: 'source', record: 'target' },
  } }]);
  assert.deepEqual({ source, target, choices }, original, 'Snapshots and user choices must remain unchanged');
  await store.mergeAthletes(source, target, { weight: 'target', record: 'source' });
  assert.deepEqual(mock.calls.at(-1).args.p_choices, { weight: 'target', record: 'source' });
});

test('attachment is unavailable before profile load, after reset, in legacy mode and for non-coaches', async () => {
  const { source, target, choices } = attachment();
  const fresh = backend(); const unloaded = createRosterStore(fresh.client);
  await assert.rejects(unloaded.mergeAthletes(source, target, choices)); assert.equal(fresh.calls.length, 0);
  await unloaded.loadProfile('coach-id'); unloaded.reset(); fresh.calls.length = 0;
  await assert.rejects(unloaded.mergeAthletes(source, target, choices)); assert.equal(fresh.calls.length, 0);
  for (const options of [{ legacy: true }, { profileOverrides: { account_type: 'athlete' } }, { profileOverrides: { account_type: 'athlete', is_admin: true } }]) {
    const mock = backend(options); const store = createRosterStore(mock.client);
    await store.loadProfile('coach-id'); mock.calls.length = 0;
    await assert.rejects(store.mergeAthletes(source, target, choices));
    assert.equal(mock.calls.length, 0, 'Rejected attachment cannot fall back to direct table mutations');
  }
});

test('attachment rejects wrong direction and incomplete identity or concurrency snapshots before any RPC', async () => {
  const mock = backend(); const store = createRosterStore(mock.client);
  await store.loadProfile('coach-id'); mock.calls.length = 0;
  const cases = [
    ({ source }) => { source.userId = 'already-registered'; },
    ({ target }) => { target.userId = null; },
    ({ source, target }) => { target.id = source.id; },
    ({ source }) => { source.id = ''; },
    ({ target }) => { target.id = ''; },
    ({ source }) => { source.updatedAt = null; },
    ({ target }) => { delete target.updatedAt; },
    ({ source }) => { source.relationUpdatedAt = ''; },
    ({ target }) => { delete target.relationUpdatedAt; },
  ];
  for (const mutate of cases) {
    const fixture = attachment(); mutate(fixture);
    await assert.rejects(store.mergeAthletes(fixture.source, fixture.target, fixture.choices));
    assert.equal(mock.calls.length, 0);
  }
  const { source, target, choices } = attachment();
  await assert.rejects(store.mergeAthletes(null, target, choices));
  await assert.rejects(store.mergeAthletes(source, null, choices));
  assert.equal(mock.calls.length, 0);
});

test('attachment refuses missing or invalid weight and record choices before writing', async () => {
  const { source, target } = attachment();
  const mock = backend(); const store = createRosterStore(mock.client);
  await store.loadProfile('coach-id'); mock.calls.length = 0;
  for (const choices of [undefined, null, {}, { weight: 'source' }, { record: 'target' }, { weight: 'newest', record: 'target' }, { weight: 'source', record: 'both' }]) {
    await assert.rejects(store.mergeAthletes(source, target, choices));
    assert.equal(mock.calls.length, 0);
  }
});

test('missing attachment RPC, denied access, stale versions and transport errors never trigger another persistence path', async () => {
  const { source, target, choices } = attachment();
  for (const rpcError of [
    { code: 'PGRST202', message: 'Could not find the function public.merge_roster_athlete in the schema cache' },
    { code: '42501', message: 'Permission refusée' },
    { code: '40001', message: 'La fiche a changé. Actualise.' },
    new Error('Failed to fetch'),
  ]) {
    const mock = backend({ rpcError }); const store = createRosterStore(mock.client);
    await store.loadProfile('coach-id'); mock.calls.length = 0;
    await assert.rejects(store.mergeAthletes(source, target, choices), error => rpcError.code === 'PGRST202' ? /mise à jour de la base/.test(error.message) : error === rpcError);
    assert.equal(store.mode, 'modern');
    assert.equal(mock.calls.length, 1); assert.equal(mock.calls[0].rpc, 'merge_roster_athlete');
  }
});

test('modern roster keeps free sheets and registered accounts without calendar permission but excludes unrelated athlete rows', async () => {
  const source = { id: 'free-athlete', user_id: null, first_name: 'Martin', updated_at: '2026-09-22T10:00:00Z' };
  const target = { id: 'registered-athlete', user_id: 'athlete-user', first_name: 'Alex', updated_at: '2026-09-22T11:00:00Z' };
  const accepted = [
    { athlete_id: source.id, private_notes: 'Fiche libre', selected: true, can_view_calendar: false, updated_at: '2026-09-22T10:01:00Z' },
    { athlete_id: target.id, private_notes: 'Compte lié', selected: false, can_view_calendar: false, updated_at: '2026-09-22T11:01:00Z' },
  ];
  const mock = backend({ athleteRows: [source, target, { id: 'unrelated-athlete', user_id: 'another-user', first_name: 'À exclure' }], relationRows: accepted });
  const store = createRosterStore(mock.client); await store.loadProfile('coach-id');
  const rows = await store.loadAthletes();
  assert.deepEqual(rows.map(item => item.row.id), [source.id, target.id]);
  assert.ok(rows.every(item => item.relation.can_view_calendar === false));
  assert.deepEqual(rows.map(item => item.relation.updated_at), accepted.map(relation => relation.updated_at));
  assert.deepEqual(rows.map(item => item.row.updated_at), [source.updated_at, target.updated_at]);
  const relationQuery = mock.calls.find(call => call.table === 'coach_athletes');
  assert.deepEqual(relationQuery.filters, [['coach_id', 'coach-id'], ['status', 'accepted']]);
  assert.ok(relationQuery.fields.split(',').includes('can_view_calendar'));
  assert.ok(relationQuery.fields.split(',').includes('updated_at'));
  const athleteQuery = mock.calls.find(call => call.table === 'athletes');
  assert.deepEqual(athleteQuery.filters, [['id', [source.id, target.id]]]);
  assert.ok(athleteQuery.fields.split(',').includes('updated_at'));
});
