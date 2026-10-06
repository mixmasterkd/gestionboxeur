const MODES = new Set(['visual-memory', 'dual-task']);
export function validateMentalResult(mode, value) {
  if (!MODES.has(mode) || !value || typeof value !== 'object' || !Number.isFinite(Date.parse(value.date))) throw new Error('Résultat de jeu invalide.');
  const fields = mode === 'visual-memory' ? ['levelReached', 'maxLevel', 'errors'] : ['score', 'targetsHit', 'targetsMissed', 'inhibitionErrors', 'triangleCount', 'triangleAnswer', 'triangleError', 'precision'];
  for (const field of fields) if (!Number.isInteger(value[field]) || value[field] < 0 || value[field] > 10000) throw new Error('Résultat de jeu invalide.');
  if (mode === 'visual-memory' && (value.levelReached < 1 || value.levelReached > 30 || value.maxLevel > value.levelReached || value.errors > 3)) throw new Error('Résultat de mémoire invalide.');
  if (mode === 'dual-task') {
    if (value.targetsHit + value.targetsMissed + value.triangleCount !== 30 || value.triangleCount < 8 || value.triangleCount > 12 || value.triangleAnswer > 30 || value.inhibitionErrors > value.triangleCount || value.triangleError !== Math.abs(value.triangleCount - value.triangleAnswer) || value.precision > 100 || value.score > 600) throw new Error('Résultat de double tâche invalide.');
    for (const field of ['averageReactionTime', 'bestReactionTime']) if (value.targetsHit ? !Number.isInteger(value[field]) || value[field] < 1 || value[field] > 1150 : value[field] !== null) throw new Error('Temps de réaction invalide.');
  }
  return Object.fromEntries([...fields, ...(mode === 'dual-task' ? ['averageReactionTime', 'bestReactionTime'] : []), 'date'].map(key => [key, value[key]]));
}
export const mentalScore = (mode, result) => mode === 'visual-memory' ? result.maxLevel : result.score;

export function createMentalStore(client, ownerId) {
  if (import.meta.env?.DEV) {
    let storage; try { storage = globalThis.localStorage; } catch { storage = null; }
    return createLocalMentalRecordStore(storage, ownerId);
  }
  return createMentalRecordStore(client, ownerId);
}

/** Explicit local development records, scoped to the current account. Never a silent cloud fallback. */
export function createLocalMentalRecordStore(storage, ownerId) {
  if (!ownerId) throw new Error('Compte requis pour les records.');
  const key = `gestionboxeur:mental-records:v1:${ownerId}`;
  function read() {
    try { const value = JSON.parse(storage?.getItem(key) || '{}'); return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
    catch { throw new Error('Impossible de lire les records locaux.'); }
  }
  return {
    local: true,
    async getRecord(mode) {
      if (!MODES.has(mode)) throw new Error('Mode invalide.');
      const value = read()[mode];
      return value ? { best: validateMentalResult(mode, value.best), last: validateMentalResult(mode, value.last) } : null;
    },
    async saveResult(mode, value) {
      const result = validateMentalResult(mode, value), all = read(), prior = all[mode];
      const best = prior ? validateMentalResult(mode, prior.best) : null;
      const saved = { best: !best || mentalScore(mode, result) > mentalScore(mode, best) ? result : best, last: result };
      if (!storage) throw new Error('Le stockage local est indisponible.');
      try { storage.setItem(key, JSON.stringify({ ...all, [mode]: saved })); } catch { throw new Error('Le résultat n’a pas pu être enregistré localement.'); }
      return saved;
    },
  };
}

/** Uses the existing cognitive_records table once the prepared SQL upgrade is applied. */
export function createMentalRecordStore(client, ownerId) {
  async function receive(query, mode) {
    const response = await query;
    if (response.error) throw new Error(['42703', '42883', 'PGRST202'].includes(response.error.code) ? 'La mise à jour des records cognitifs est nécessaire.' : 'Enregistrement indisponible. Réessaie avec une connexion.');
    const row = response.data;
    if (row && row.mode !== mode) throw new Error('Le record reçu ne correspond pas au jeu.');
    return row ? { best: validateMentalResult(row.mode, row.best_result), last: validateMentalResult(row.mode, row.last_result) } : null;
  }
  return {
    local: false,
    async getRecord(mode) {
      if (!MODES.has(mode)) throw new Error('Mode invalide.');
      return receive(client.from('cognitive_records').select('mode,best_result,last_result').eq('owner_id', ownerId).eq('mode', mode).maybeSingle(), mode);
    },
    async saveResult(mode, value) {
      const result = validateMentalResult(mode, value);
      return receive(client.rpc('save_cognitive_result', { p_mode: mode, p_result: result, p_expected_owner: ownerId }).single(), mode);
    },
  };
}
