import { makePhases } from './tools-engine.js';
import { compileTimerText } from './timer-program.js';

export function validateTimerPreset(value) {
  if (value?.mode === 'advanced') {
    if (typeof value.text !== 'string' || value.text.length > 20000) throw new Error('Commandes du timer invalides.');
    compileTimerText(value.text);
    return { mode: 'advanced', text: value.text };
  }
  if (value?.mode !== 'base' || !value.config) throw new Error('Ce timer enregistré est invalide.');
  const config = {};
  for (const name of ['rounds', 'series', 'work', 'rest', 'seriesRest', 'preparation']) {
    if (!Number.isInteger(value.config[name])) throw new Error('Les durées et répétitions du timer sont invalides.');
    config[name] = value.config[name];
  }
  config.warning = false;
  makePhases(config);
  const units = Object.fromEntries(['work', 'rest', 'seriesRest', 'preparation'].map(name => [name, value.units?.[name] === 'M' ? 'M' : 'S']));
  return { mode: 'base', config, units };
}

function titleOf(title) {
  if (typeof title !== 'string' || !title.trim() || title.trim().length > 100) throw new Error('Choisis un titre de 1 à 100 caractères.');
  return title.trim();
}
function boardNotes(board) {
  const notes = board?.notes;
  if (!Array.isArray(notes) || notes.length > 30) throw new Error('Le babillard accepte jusqu’à 30 notes.');
  const ids = new Set();
  return notes.map(note => {
    if (typeof note.id !== 'string' || !note.id || note.id.length > 100 || ids.has(note.id)) throw new Error('Identifiant de note invalide.');
    ids.add(note.id);
    if (typeof note.title !== 'string' || !note.title.trim() || note.title.length > 100 || typeof note.body !== 'string' || note.body.length > 1200 || !['cream', 'yellow', 'mint', 'rose'].includes(note.color) || !Array.isArray(note.links) || note.links.length > 6) throw new Error('Le contenu d’une note est invalide.');
    const links = note.links.map(link => {
      if (typeof link.label !== 'string' || !link.label.trim() || link.label.length > 100 || typeof link.url !== 'string' || link.url.length > 2048) throw new Error('Lien de note invalide.');
      let url;
      try { url = new URL(link.url); } catch { throw new Error('Le lien doit commencer par https:// ou http://.'); }
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('Le lien doit être une adresse Web sans identifiants.');
      return { label: link.label, url: url.href };
    });
    return { id: note.id, title: note.title, body: note.body, color: note.color, links };
  });
}
async function result(query) {
  const { data, error } = await query;
  if (!error) return data;
  if (['42P01', '42703', 'PGRST205'].includes(error.code)) throw new Error('La mise à jour de la base de données des outils est nécessaire.');
  if (['PGRST116', '23505'].includes(error.code)) throw new Error('Cet élément a changé ailleurs. Rouvre l’outil pour charger la version à jour.');
  if (error.code === '42501') throw new Error('Cette sauvegarde est privée. Reconnecte-toi à ton compte.');
  throw error;
}

/** RLS enforces ownership; explicit filters also keep every request scoped. */
export function createToolStore(database, ownerId) {
  if (!ownerId) throw new Error('Connecte-toi pour enregistrer tes outils.');
  let boardRevision;
  // Serialize reads too: reopening during a write must receive that write's
  // content and revision together, never old content with a newer token.
  let boardQueue = Promise.resolve();
  const queuedBoard = action => {
    const pending = boardQueue.catch(() => {}).then(action);
    boardQueue = pending; return pending;
  };
  return {
    demo: false,
    async listTimers() {
      const rows = [];
      for (let offset = 0; ; offset += 200) {
        const page = await result(database.from('timer_presets').select('id,title,payload,created_at').eq('owner_id', ownerId).order('created_at', { ascending: false }).order('id').range(offset, offset + 199));
        rows.push(...page);
        if (page.length < 200) return rows;
      }
    },
    async saveTimer({ title, payload }) {
      return result(database.from('timer_presets').insert({ owner_id: ownerId, title: titleOf(title), payload: validateTimerPreset(payload) }).select('id,title,payload,created_at').single());
    },
    async deleteTimer(id) {
      await result(database.from('timer_presets').delete().eq('owner_id', ownerId).eq('id', id).select('id').single());
    },
    async loadBoard() {
      return queuedBoard(async () => {
        const row = await result(database.from('bulletin_boards').select('notes,revision').eq('owner_id', ownerId).maybeSingle());
        boardRevision = row?.revision ?? null;
        return row ? { notes: row.notes } : null;
      });
    },
    async saveBoard(board) {
      const notes = boardNotes(board);
      return queuedBoard(async () => {
        if (boardRevision === undefined) throw new Error('Ouvre d’abord ton babillard avant de le modifier.');
        const revision = crypto.randomUUID();
        const query = boardRevision === null
          ? database.from('bulletin_boards').insert({ owner_id: ownerId, notes, revision })
          : database.from('bulletin_boards').update({ notes, revision }).eq('owner_id', ownerId).eq('revision', boardRevision);
        const row = await result(query.select('notes,revision').single());
        boardRevision = row.revision;
        return { notes: row.notes };
      });
    },
  };
}

/** Explicit development preview only, never used as a silent offline fallback. */
export function createDemoToolStore() {
  let timers = [], board = null;
  return {
    demo: true,
    async listTimers() { return structuredClone(timers); },
    async saveTimer({ title, payload }) {
      const row = { id: crypto.randomUUID(), title: titleOf(title), payload: validateTimerPreset(payload), created_at: new Date().toISOString() };
      timers.unshift(row); return structuredClone(row);
    },
    async deleteTimer(id) { timers = timers.filter(row => row.id !== id); },
    async loadBoard() { return structuredClone(board); },
    async saveBoard(value) { board = { notes: boardNotes(value) }; return structuredClone(board); },
  };
}
