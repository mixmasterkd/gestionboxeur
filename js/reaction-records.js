const modes = new Set(['simple', 'locate', 'choice']);
const inputs = new Set(['touch', 'mouse', 'keyboard']);

function validVariant(mode, input) {
  if (!modes.has(mode)) throw new Error('Ce mode de réaction est invalide.');
  if (!inputs.has(input)) throw new Error('Ce type de commande est invalide.');
}
function record(value) {
  validVariant(value?.mode, value?.input);
  if (!Number.isInteger(value.best_ms) || value.best_ms < 1 || value.best_ms > 10000) throw new Error('Le temps doit être un entier entre 1 et 10 000 millisecondes.');
  return { mode: value.mode, input: value.input, best_ms: value.best_ms };
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
  let message = error?.message || 'Impossible d’accéder aux records de réaction. Réessaie lorsque la connexion est rétablie.';
  if (['42P01', '42703', '42883', 'PGRST202', 'PGRST205'].includes(error?.code)) message = 'La mise à jour de la base de données des temps de réaction est nécessaire.';
  else if (['42501', 'PGRST301', 'PGRST302', 'PGRST303'].includes(error?.code)) message = 'Les records sont privés. Reconnecte-toi à ton compte pour y accéder.';
  else if (['23514', '22023', '22P02'].includes(error?.code)) message = 'Le mode, le type de commande ou le temps du record est invalide.';
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

/** Private personal bests, not verified competition results. Lower is better. */
export function createReactionRecordStore(client, ownerId) {
  if (typeof ownerId !== 'string' || !ownerId.trim()) throw new Error('Connecte-toi pour enregistrer tes records.');
  const enqueue = serialQueue();
  return {
    demo: false,
    listRecords() {
      return enqueue(async () => {
        const rows = await result(client.from('reaction_records').select('mode,input,best_ms').eq('owner_id', ownerId).order('mode').order('input'));
        if (!Array.isArray(rows)) throw new Error('Les records reçus sont invalides. Réessaie.');
        return rows.map(record);
      });
    },
    saveRecord(mode, input, best_ms) {
      return enqueue(async () => {
        record({ mode, input, best_ms });
        // auth.uid() chooses the owner. This argument only rejects an old
        // view/queued write after the shared client changes accounts.
        const row = await result(client.rpc('save_reaction_record', { p_mode: mode, p_input: input, p_best_ms: best_ms, p_expected_owner: ownerId }).single());
        const saved = record(row);
        if (saved.mode !== mode || saved.input !== input) throw new Error('Le record reçu ne correspond pas au mode et au type de commande joués.');
        return saved;
      });
    },
    resetRecord(mode, input) {
      return enqueue(async () => {
        validVariant(mode, input);
        await result(client.from('reaction_records').delete().eq('owner_id', ownerId).eq('mode', mode).eq('input', input));
      });
    },
  };
}

/** Explicit in-memory preview, never an offline fallback for an account save. */
export function createDemoReactionRecordStore() {
  const records = new Map(), enqueue = serialQueue();
  const key = (mode, input) => `${mode}:${input}`;
  return {
    demo: true,
    listRecords() {
      return enqueue(() => [...records.values()].sort((left, right) => left.mode.localeCompare(right.mode) || left.input.localeCompare(right.input)).map(value => ({ ...value })));
    },
    saveRecord(mode, input, best_ms) {
      return enqueue(() => {
        record({ mode, input, best_ms });
        const id = key(mode, input), best = Math.min(records.get(id)?.best_ms ?? Infinity, best_ms);
        const saved = { mode, input, best_ms: best };
        records.set(id, saved);
        return { ...saved };
      });
    },
    resetRecord(mode, input) { return enqueue(() => { validVariant(mode, input); records.delete(key(mode, input)); }); },
  };
}
