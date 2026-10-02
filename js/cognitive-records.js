const modes = new Set([
  'tiles-4', 'tiles-6', 'tiles-8',
  'bag-sequence-visible', 'bag-sequence-hidden',
  'bag-targets-visible', 'bag-targets-hidden',
]);

function validMode(mode) {
  if (!modes.has(mode)) throw new Error('Ce mode de jeu cognitif est invalide.');
  return mode;
}
function record(value) {
  validMode(value?.mode);
  if (!Number.isInteger(value.score) || value.score < 0 || value.score > 10000) throw new Error('Le score doit être un entier entre 0 et 10 000.');
  return { mode: value.mode, score: value.score };
}
function serialQueue() {
  let tail = Promise.resolve();
  return operation => {
    const next = tail.then(operation);
    tail = next.catch(() => {});
    return next;
  };
}
function storageError(error) {
  let message = error?.message || 'Impossible d’accéder aux records. Réessaie lorsque la connexion est rétablie.';
  if (['42P01', '42703', '42883', 'PGRST202', 'PGRST205'].includes(error?.code)) message = 'La mise à jour de la base de données des jeux cognitifs est nécessaire.';
  else if (['42501', 'PGRST301', 'PGRST302', 'PGRST303'].includes(error?.code)) message = 'Les records sont privés. Reconnecte-toi à ton compte pour y accéder.';
  else if (['23514', '22023', '22P02'].includes(error?.code)) message = 'Le mode ou le score du record est invalide.';
  const result = new Error(message, { cause: error });
  if (error?.code) result.code = error.code;
  return result;
}
async function result(query) {
  let response;
  try { response = await query; }
  catch (error) { throw storageError(error); }
  if (response?.error) throw storageError(response.error);
  return response?.data;
}

/** Account-private personal bests, not verified competition scores. */
export function createCognitiveRecordStore(client, ownerId) {
  if (typeof ownerId !== 'string' || !ownerId.trim()) throw new Error('Connecte-toi pour enregistrer tes records.');
  const enqueue = serialQueue();
  return {
    demo: false,
    listRecords() {
      return enqueue(async () => {
        const rows = await result(client.from('cognitive_records').select('mode,score').eq('owner_id', ownerId).order('mode'));
        if (!Array.isArray(rows)) throw new Error('Les records reçus sont invalides. Réessaie.');
        return rows.map(record);
      });
    },
    saveRecord(mode, score) {
      return enqueue(async () => {
        record({ mode, score });
        // Ownership comes from auth.uid(); the expected id only rejects a stale
        // view/queued write after the shared client signs into another account.
        const row = await result(client.rpc('save_cognitive_record', { p_mode: mode, p_score: score, p_expected_owner: ownerId }).single());
        const saved = record(row);
        if (saved.mode !== mode) throw new Error('Le record reçu ne correspond pas au mode joué.');
        return saved;
      });
    },
    resetRecord(mode) {
      return enqueue(async () => {
        validMode(mode);
        await result(client.from('cognitive_records').delete().eq('owner_id', ownerId).eq('mode', mode));
      });
    },
  };
}

/** Explicit session-only preview, never a fallback for a failed account save. */
export function createDemoCognitiveRecordStore() {
  const records = new Map(), enqueue = serialQueue();
  return {
    demo: true,
    listRecords() { return enqueue(() => [...records].sort(([left], [right]) => left.localeCompare(right)).map(([mode, score]) => ({ mode, score }))); },
    saveRecord(mode, score) {
      return enqueue(() => {
        record({ mode, score });
        const best = Math.max(records.get(mode) ?? 0, score);
        records.set(mode, best);
        return { mode, score: best };
      });
    },
    resetRecord(mode) { return enqueue(() => { validMode(mode); records.delete(mode); }); },
  };
}
