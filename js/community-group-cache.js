/** Memory only; an account change or membership edit retires all pending reads. */
export function createGroupListCache({ getAccountId, fetchGroups, now = Date.now, ttl = 30000 }) {
  let account, revision = 0, accountRevision = 0, cached = null, savedAt = 0, inflight = null;
  const stale = () => Object.assign(new Error('Le compte ou les groupes ont changé. Réessaie.'), { code: 'STALE_COMMUNITY_READ' });
  const copy = value => structuredClone(value);
  function invalidate() { revision++; cached = null; inflight = null; }
  function setAccount(id) {
    if (account !== id) { account = id; accountRevision++; invalidate(); }
  }
  async function load({ force = false } = {}) {
    const before = revision;
    const id = await getAccountId();
    // An auth event may have arrived while getSession was resolving.
    if (before !== revision) return load({ force });
    setAccount(id);
    if (!id) return [];
    if (!force && cached && now() - savedAt < ttl) return copy(cached);
    if (inflight) return copy(await inflight);
    const ticket = revision;
    const request = Promise.resolve().then(fetchGroups).then(value => {
      if (ticket !== revision || id !== account) throw stale();
      cached = copy(value); savedAt = now();
      return value;
    });
    inflight = request;
    try { return copy(await request); }
    finally { if (inflight === request) inflight = null; }
  }
  return { load, invalidate, setAccount, get revision() { return revision; }, get accountRevision() { return accountRevision; } };
}
