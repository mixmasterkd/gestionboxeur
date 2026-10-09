import test from 'node:test';
import assert from 'node:assert/strict';
import { createGroupListCache } from '../js/community-group-cache.js';

const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const tick = () => new Promise(resolve => setImmediate(resolve));

test('group list shares concurrent reads, clones returned data, caches briefly and refreshes on demand', async () => {
  let calls = 0, time = 0;
  const cache = createGroupListCache({ getAccountId: async () => 'alex', fetchGroups: async () => { calls++; return [{ id: 'a', members: ['sam'] }]; }, now: () => time });
  const [first, second] = await Promise.all([cache.load(), cache.load(), cache.load({ force: true })]);
  assert.equal(calls, 1);
  first[0].members.push('other'); assert.deepEqual(second[0].members, ['sam']);
  assert.deepEqual((await cache.load())[0].members, ['sam']); assert.equal(calls, 1);
  await cache.load({ force: true }); assert.equal(calls, 2);
  time = 30001; await cache.load(); assert.equal(calls, 3);
});

test('sign out clears groups and a late read cannot expose the previous account', async () => {
  let user = 'camille'; const pending = deferred();
  const cache = createGroupListCache({ getAccountId: async () => user, fetchGroups: () => pending.promise });
  const first = cache.load(); await tick();
  user = null; cache.setAccount(null);
  assert.deepEqual(await cache.load(), []);
  pending.resolve([{ id: 'private' }]);
  await assert.rejects(first, { code: 'STALE_COMMUNITY_READ' });
  assert.deepEqual(await cache.load(), []);
});

test('a new account read survives an old read finishing late and has its own groups', async () => {
  let user = 'camille', calls = 0; const old = deferred(), fresh = deferred();
  const cache = createGroupListCache({ getAccountId: async () => user, fetchGroups: () => (++calls === 1 ? old.promise : fresh.promise) });
  const first = cache.load(); await tick();
  user = 'sam'; cache.setAccount(user);
  const next = cache.load(); await tick();
  old.resolve([{ id: 'camille-only' }]); await assert.rejects(first, { code: 'STALE_COMMUNITY_READ' });
  const shared = cache.load({ force: true }); await tick(); assert.equal(calls, 2);
  fresh.resolve([{ id: 'sam-group' }]);
  assert.deepEqual(await next, [{ id: 'sam-group' }]); assert.deepEqual(await shared, await cache.load());
});

test('membership changes retire an in-flight request and force a new read without changing identity', async () => {
  let calls = 0; const old = deferred();
  const cache = createGroupListCache({ getAccountId: async () => 'alex', fetchGroups: () => ++calls === 1 ? old.promise : [{ id: 'remaining' }] });
  const first = cache.load(); await tick();
  const identity = cache.accountRevision;
  cache.invalidate(); assert.equal(cache.accountRevision, identity);
  assert.deepEqual(await cache.load({ force: true }), [{ id: 'remaining' }]);
  old.resolve([{ id: 'removed' }]); await assert.rejects(first, { code: 'STALE_COMMUNITY_READ' });
  assert.deepEqual(await cache.load(), [{ id: 'remaining' }]); assert.equal(calls, 2);
});

test('failed refresh does not cache an error and can be retried', async () => {
  let calls = 0;
  const cache = createGroupListCache({ getAccountId: async () => 'sam', fetchGroups: async () => { if (++calls === 1) throw new Error('offline'); return []; } });
  await assert.rejects(cache.load(), /offline/);
  assert.deepEqual(await cache.load(), []); assert.equal(calls, 2);
});
