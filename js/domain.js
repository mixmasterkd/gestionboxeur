/** Shared workout model. Dates are local calendar dates; no UTC conversion. */
export const SPORTS = [
  { id: 'running', label: 'Course', icon: '↗' },
  { id: 'boxing', label: 'Boxe', icon: '◈' },
  { id: 'sparring', label: 'Sparring', icon: '◈' },
  { id: 'strength', label: 'Musculation', icon: '▰' },
  { id: 'mobility', label: 'Mobilité', icon: '◎' },
  { id: 'other', label: 'Autre', icon: '＋' },
];
export const BLOCK_TYPE_GROUPS = [
  { label: '🥊 Boxe', types: [['shadow', 'Shadow'], ['bag', 'Sac'], ['pads', 'Pads'], ['sparring', 'Sparring'], ['jump_rope', 'Corde à danser'], ['speed_ball', 'Speed ball'], ['double_end_bag', 'Double end bag'], ['technique', 'Technique'], ['footwork', 'Déplacements']] },
  { label: '🏃 Course', types: [['run', 'Course'], ['jog', 'Jog'], ['interval', 'Intervalle']] },
  { label: 'Préparation physique', types: [['warmup', 'Échauffement'], ['burpees', 'Burpees'], ['agility', 'Agilité'], ['conditioning', 'Conditioning'], ['cardio', 'Cardio'], ['strength', 'Renforcement'], ['mobility', 'Mobilité']] },
  { label: 'Autres', types: [['recovery', 'Récupération'], ['other', 'Autre']] },
];
export const BLOCK_TYPES = BLOCK_TYPE_GROUPS.flatMap(group => group.types.map(([id, label]) => ({ id, label })));
export function blockName(block) {
  if (block.kind === 'repeat') return block.repeat_unit === 'rounds' ? 'Rounds' : 'Répétition';
  return block.type === 'other' ? block.title || 'Autre' : BLOCK_TYPES.find(type => type.id === block.type)?.label || block.type || 'Étape';
}
export const ZONE_COLORS = { 1: '#9298a1', 2: '#3b82f6', 3: '#25a567', 4: '#ed9427', 5: '#e54b4b', 6: '#9b60db', 7: '#442c65' };
export const WORKOUT_LIMITS = Object.freeze({ depth: 4, blocks: 200, siblings: 100, repeat: 100, segments: 10000 });
const finitePositive = value => typeof value === 'number' && Number.isFinite(value) && value > 0;
const makeId = () => globalThis.crypto?.randomUUID?.() || `block-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

export function makeBlock(type = 'other') {
  const repeat = type === 'repeat';
  return { id: makeId(), kind: repeat ? 'repeat' : 'step', title: repeat ? 'Répétition' : '',
    type: repeat || type === 'step' ? 'other' : type, description: '', notes: '',
    duration_seconds: null, distance_m: null, repetitions: null, rounds: null,
    work_seconds: null, rest_seconds: null, intensity: null, zone: null,
    repeat_count: repeat ? 2 : 1, children: [] };
}

function asLocalDate(value) {
  if (value instanceof Date && Number.isFinite(value.getTime())) return new Date(value.getFullYear(), value.getMonth(), value.getDate(), 12);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value));
  if (!match) throw new TypeError('Date attendue au format AAAA-MM-JJ.');
  const [, y, m, d] = match.map(Number);
  const date = new Date(y, m - 1, d, 12);
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) throw new RangeError('Date invalide.');
  return date;
}
const dateString = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
export function todayLocal() { return dateString(new Date()); }
export function addDays(value, days) {
  if (!Number.isInteger(days)) throw new TypeError('Le décalage doit être un nombre entier de jours.');
  const date = asLocalDate(value); date.setDate(date.getDate() + days); return dateString(date);
}
export function weekStart(value = todayLocal()) {
  const date = asLocalDate(value); return addDays(date, -((date.getDay() + 6) % 7));
}
/** A stable six-week grid, starting on Monday. */
export function monthDates(value = todayLocal()) {
  const date = asLocalDate(value); date.setDate(1);
  const start = weekStart(date); return Array.from({ length: 42 }, (_, index) => addDays(start, index));
}
export function formatDuration(seconds) {
  if (!finitePositive(seconds)) return '0 min';
  const total = Math.round(seconds), hours = Math.floor(total / 3600), minutes = Math.floor(total % 3600 / 60), rest = total % 60;
  return [hours && `${hours} h`, minutes && `${minutes} min`, rest && `${rest} s`].filter(Boolean).join(' ') || '0 s';
}

/** Returns user-readable errors. Traversal is bounded even for hostile/cyclic objects. */
export function validateBlocks(blocks) {
  const errors = [], seen = new WeakSet(); let count = 0;
  if (!Array.isArray(blocks)) return ['Les blocs doivent former une liste.'];
  function visit(list, depth) {
    if (depth > WORKOUT_LIMITS.depth) { errors.push(`Maximum ${WORKOUT_LIMITS.depth} niveaux de blocs.`); return; }
    if (list.length > WORKOUT_LIMITS.siblings) { errors.push(`Maximum ${WORKOUT_LIMITS.siblings} blocs dans une même liste.`); return; }
    for (const block of list) {
      if (++count > WORKOUT_LIMITS.blocks) { errors.push(`Maximum ${WORKOUT_LIMITS.blocks} blocs.`); return; }
      if (!block || typeof block !== 'object' || Array.isArray(block)) { errors.push('Bloc invalide.'); continue; }
      if (seen.has(block)) { errors.push('Une référence circulaire ou partagée existe dans les blocs.'); continue; }
      seen.add(block);
      const name = String(block.title || 'Bloc').slice(0, 80);
      if (!['step', 'repeat'].includes(block.kind)) errors.push(`${name} : type de bloc invalide.`);
      for (const key of ['title', 'description', 'notes']) {
        if (block[key] != null && (typeof block[key] !== 'string' || block[key].length > (key === 'title' ? 500 : 10000))) errors.push(`${name} : ${key} est invalide ou trop long.`);
      }
      for (const key of ['duration_seconds', 'distance_m', 'work_seconds', 'rest_seconds']) {
        const value = block[key];
        if (value != null && value !== '' && (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1e6)) errors.push(`${name} : valeur ${key} invalide.`);
      }
      for (const key of ['rounds', 'repetitions']) {
        const value = block[key];
        if (value != null && value !== '' && (!Number.isInteger(value) || value < 1 || value > 10000)) errors.push(`${name} : ${key} doit être un entier positif (maximum 10 000).`);
      }
      if (block.zone != null && (!Number.isInteger(block.zone) || block.zone < 1 || block.zone > 7)) errors.push(`${name} : zone de 1 à 7 attendue.`);
      if (block.intensity != null && !['easy', 'moderate', 'hard', 'max'].includes(block.intensity)) errors.push(`${name} : intensité invalide.`);
      if (block.kind === 'repeat') {
        if (!Number.isInteger(block.repeat_count) || block.repeat_count < 1 || block.repeat_count > WORKOUT_LIMITS.repeat) errors.push(`${name} : de 1 à ${WORKOUT_LIMITS.repeat} répétitions requises.`);
        if (!Array.isArray(block.children) || !block.children.length) errors.push(`${name} : ajoute au moins un sous-bloc.`);
        else visit(block.children, depth + 1);
      } else if (Array.isArray(block.children) && block.children.length) errors.push(`${name} : utilise un bloc Répétition pour les sous-blocs.`);
    }
  }
  visit(blocks, 1);
  return [...new Set(errors)];
}

/**
 * Expands repetitions in order. A round is work + recovery, except the final
 * round which has no trailing recovery. A rounds block's overall duration is
 * ignored when work_seconds is supplied, preventing double counting. Movement
 * repetitions do not multiply time. Distance is the total distance of a step.
 * Throws on invalid input or an expansion over 10,000 segments.
 */
export function flattenBlocks(blocks) {
  const errors = validateBlocks(blocks);
  if (errors.length) throw new RangeError(errors.join(' '));
  const result = [];
  function push(segment) {
    if (result.length >= WORKOUT_LIMITS.segments) throw new RangeError(`La séance dépasse ${WORKOUT_LIMITS.segments.toLocaleString('fr')} intervalles développés.`);
    result.push(segment);
  }
  function visit(list, repeatedRound = null) {
    for (const block of list) {
      if (block.kind === 'repeat') {
        for (let iteration = 0; iteration < block.repeat_count; iteration++) visit(block.children, block.repeat_unit === 'rounds' ? iteration + 1 : repeatedRound);
      } else if (block.rounds && finitePositive(block.work_seconds)) {
        for (let round = 0; round < block.rounds; round++) {
          push({ ...block, children: [], duration_seconds: block.work_seconds, distance_m: round === 0 ? (block.distance_m || 0) : 0, phase: 'work', round: round + 1 });
          if (round < block.rounds - 1 && finitePositive(block.rest_seconds)) push({ ...block, children: [], title: 'Repos', duration_seconds: block.rest_seconds, distance_m: 0, zone: 1, intensity: 'easy', phase: 'rest', round: round + 1 });
        }
      } else push({ ...block, children: [], duration_seconds: block.duration_seconds || 0, distance_m: block.distance_m || 0, phase: 'step', ...(repeatedRound == null ? {} : {round:repeatedRound}) });
    }
  }
  visit(blocks);
  return result;
}

export function summarizeBlocks(blocks = []) {
  const summary = { duration_seconds: 0, distance_m: 0, hasTime: false, hasDistance: false, hasUnquantified: false, hasDistanceOnly: false, mixed: false, segments: [], errors: [] };
  try { summary.segments = flattenBlocks(blocks); } catch (error) { summary.errors = [error.message]; return summary; }
  for (const block of summary.segments) {
    summary.duration_seconds += block.duration_seconds;
    summary.distance_m += block.distance_m;
    if (block.duration_seconds > 0) summary.hasTime = true;
    if (block.distance_m > 0) summary.hasDistance = true;
    if (!block.duration_seconds && block.distance_m) summary.hasDistanceOnly = true;
    if (!block.duration_seconds && !block.distance_m) summary.hasUnquantified = true;
  }
  summary.duration_seconds = Math.round(summary.duration_seconds * 1000) / 1000;
  summary.distance_m = Math.round(summary.distance_m * 1000) / 1000;
  summary.mixed = summary.hasTime && summary.hasDistanceOnly;
  return summary;
}
