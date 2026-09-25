import { BLOCK_TYPES, WORKOUT_LIMITS, makeBlock, validateBlocks } from './domain.js';
import { parseEffort, formatEffort } from './workout-effort.js';

export const TRAINING_TEXT_LIMIT = 20000;
const sources = new WeakMap();
const clone = value => structuredClone(value);
const normalize = value => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().replace(/\s+/g, ' ').toLowerCase();
const names = new Map(BLOCK_TYPES.flatMap(type => [[normalize(type.label), { type: type.id, title: type.label }], [normalize(type.id), { type: type.id, title: type.label }]]));
for (const [name, type, title] of [
  ['boxe', 'other', 'Boxe'], ['course à pied', 'run', 'Course'], ['corde', 'jump_rope', 'Corde à danser'], ['corde à sauter', 'jump_rope', 'Corde à danser'],
  ['abdos', 'strength', 'Abdos'], ['musculation', 'strength', 'Renforcement'], ['sparing', 'sparring', 'Sparring'], ['shadow boxing', 'shadow', 'Shadow'],
  ['marche', 'walk', 'Marche'], ['marcher', 'walk', 'Marche'], ['repos', 'recovery', 'Repos'], ['repos actif', 'active_recovery', 'Repos actif'],
]) names.set(normalize(name), { type, title });
const activityWordLimit = Math.max(...[...names.keys()].map(name => name.split(' ').length));
const defaults = { running: ['run', 'Course'], boxing: ['other', 'Boxe'], sparring: ['sparring', 'Sparring'], strength: ['strength', 'Renforcement'], mobility: ['mobility', 'Mobilité'] };
const decimal = '(?:\\d+(?:[.,]\\d+)?|[.,]\\d+)';
const units = 'kilomètres?|kilometres?|km|mètres?|metres?|mtrs?|heures?|h|minutes?|min|m|secondes?|sec|sc|s|\'|"';
const quantityStart = new RegExp(`${decimal}\\s*(?:${units})`, 'i');
const quantity = new RegExp(`(${decimal})\\s*(${units})`, 'iy');
const number = value => Number(value.replace(',', '.'));

function measurements(source) {
  const text = source.replace(/[’‘′]/g, "'").replace(/[“”″]/g, '"').trim();
  const values = { duration_seconds: null, distance_m: null };
  let position = 0, previousRank = 4, duration = 0, hasDuration = false, afterPlus = false;
  while (position < text.length) {
    while (/\s/.test(text[position] || '') && position < text.length) position++;
    if (text[position] === '+') { if (afterPlus || position === 0) throw new Error('Mesure invalide.'); afterPlus = true; previousRank = 4; position++; continue; }
    if (position === text.length) break;
    quantity.lastIndex = position;
    const token = quantity.exec(text);
    if (!token) {
      const rest = text.slice(position).trim();
      if (hasDuration && previousRank === 2 && new RegExp(`^${decimal}$`).test(rest)) { duration += number(rest); position = text.length; break; }
      throw new Error('Mesure non reconnue : utilise min, s, h, mtr ou km.');
    }
    const amount = number(token[1]), unit = normalize(token[2]);
    if (/^(?:km|kilometre|mtr|metre)/.test(unit)) {
      if (values.distance_m != null) throw new Error('La distance apparaît deux fois.');
      values.distance_m = amount * (/^(km|kilometre)/.test(unit) ? 1000 : 1);
      previousRank = 0;
    } else {
      const rank = unit === "'" || unit[0] === 'm' ? 2 : unit === '"' || unit[0] === 's' ? 1 : 3;
      if (rank >= previousRank || afterPlus && hasDuration) throw new Error('Indique les heures, minutes puis secondes, sans répéter une unité.');
      duration += amount * (rank === 3 ? 3600 : rank === 2 ? 60 : 1); hasDuration = true; previousRank = rank;
    }
    afterPlus = false; position = quantity.lastIndex;
  }
  if (afterPlus) throw new Error('Ajoute une mesure après le signe +.');
  if (hasDuration) values.duration_seconds = duration;
  for (const value of Object.values(values)) if (value != null && (!Number.isFinite(value) || value < 0 || value > 1e6)) throw new Error('La durée ou la distance dépasse la limite autorisée.');
  return values;
}

function measuredActivity(source) {
  let failure;
  try { return { measures: measurements(source), activity: null }; } catch (error) { failure = error; }
  // Only known activity names can follow a dose. Keep arbitrary trailing prose
  // out of the activity model, and inspect a bounded number of possible suffixes.
  const boundaries = [...source.matchAll(/\s+(?=\S)/g)].slice(-activityWordLimit);
  for (const boundary of boundaries) {
    const activity = names.get(normalize(source.slice(boundary.index + boundary[0].length)));
    if (!activity || activity.type === 'other') continue;
    try { return { measures: measurements(source.slice(0, boundary.index)), activity }; } catch {}
  }
  throw failure;
}

function separateInstruction(content) {
  const markers = [...content.matchAll(/\s+-\s*/g)], at = content.indexOf('@');
  const split = marker => [content.slice(0, marker.index).trim(), content.slice(marker.index + marker[0].length).trim()];
  if (!markers.length) return [content, ''];
  if (at < 0 || markers[0].index < at) {
    const marker=markers[0], before=content.slice(0,marker.index), after=content.slice(marker.index+marker[0].length);
    const negativeDose=quantityStart.exec(after);
    if(!quantityStart.test(before)&&negativeDose?.index===0)return [content,''];
    return split(marker);
  }
  const target = content.slice(at + 1).trim(); let failure;
  try { const whole = parseEffort(target); if (whole && whole.kind !== 'custom') return [content, '']; } catch (error) { failure = error; }
  for (const marker of [...markers].reverse()) {
    const left = content.slice(at + 1, marker.index).trim(), right = content.slice(marker.index + marker[0].length).trim();
    let effort; try { effort = parseEffort(left); } catch { continue; }
    if (!effort || effort.kind === 'custom') continue;
    const looksLikeBound = effort.kind === 'zone' ? /^(?:z(?:one)?\s*)?\d+(?:[.,]\d+)?\s*(?:$|-|fc\b|allure\b)/i.test(right)
      : effort.kind === 'rpe' ? /^(?:rpe\s*)?\d+(?:[.,]\d+)?(?:\s*\/\s*10)?\s*(?:$|-)/i.test(right)
      : effort.kind === 'color' && /^(?:vert|jaune|rouge)\s*(?:$|-)/i.test(right);
    if (looksLikeBound) throw failure || new Error('Fourchette d’effort invalide.');
    return split(marker);
  }
  // A named, nonnumeric target can still have its own free instruction.
  const first = markers[0];
  try { if (parseEffort(content.slice(at + 1, first.index))?.kind === 'custom') return split(first); } catch {}
  if (failure) throw failure;
  return [content, ''];
}

function parseStep(source, sport, inheritedActivity = null) {
  let [content, description] = separateInstruction(source.replace(/^\s*-\s*/, '').trim());
  const target = content.indexOf('@');
  const effort = target < 0 ? null : parseEffort(content.slice(target + 1));
  if (target >= 0) {
    if (!content.slice(target + 1).trim()) throw new Error('Ajoute une cible après @, ou retire @.');
    content = content.slice(0, target).trim();
  }
  const normalized = content.replace(/[’‘′]/g, "'").replace(/[“”″]/g, '"');
  const dose = quantityStart.exec(normalized);
  let activity = content, trailingActivity = null, measures = { duration_seconds: null, distance_m: null };
  if (dose) {
    if (dose.index && /[+-]\s*$/.test(normalized.slice(0, dose.index))) throw new Error('La durée ou la distance doit être positive.');
    activity = content.slice(0, dose.index).trim();
    if (activity) measures = measurements(normalized.slice(dose.index));
    else { const measured = measuredActivity(normalized.slice(dose.index)); measures = measured.measures; trailingActivity = measured.activity; }
  } else if (/\d/.test(content) && /(?:\b(?:min|sec|km|mtr|bpm)\b|\d\s*[:@])/.test(content)) throw new Error('Mesure non reconnue : utilise min, s, h, mtr ou km.');
  if (!activity && !dose && target < 0 && !description) return null;
  const fallback = defaults[sport] || ['other', 'Autre'];
  const identity = activity ? names.get(normalize(activity)) || { type: 'other', title: activity } : trailingActivity || inheritedActivity || { type: fallback[0], title: fallback[1] };
  if (identity.title.length > 500) throw new Error('Le nom de l’étape ne peut pas dépasser 500 caractères.');
  if (description.length > 10000) throw new Error('La consigne ne peut pas dépasser 10 000 caractères.');
  const recovery = { walk: 'Marche', recovery: 'Repos', active_recovery: 'Repos actif' }[identity.type];
  const targetEffort = effort || (recovery ? { kind: 'recovery', label: recovery } : null);
  return { ...makeBlock(identity.type), ...identity, ...measures, description, effort: targetEffort, zone: targetEffort?.kind === 'zone' && targetEffort.min === targetEffort.max ? targetEffort.min : null };
}

function textLines(text) {
  const lines = []; let start = 0, number = 1;
  for (const match of text.matchAll(/\r\n|\r|\n/g)) { lines.push({ line: number++, start, end: match.index, raw: text.slice(start, match.index) }); start = match.index + match[0].length; }
  lines.push({ line: number, start, end: text.length, raw: text.slice(start) }); return lines;
}

function repeatHeader(source) {
  const text = source.trim();
  if (text.startsWith('-')) return null;
  const simple = /^(\d+)\s*(x|×|rounds?)\s*$/i.exec(text);
  if (simple) return { count: Number(simple[1]), rounds: /^round/i.test(simple[2]), activity: null };
  const leading = /^(\d+)\s*(x|×|rounds?)\s+de\s+(.+)$/i.exec(text);
  const trailing = /^(.+?)\s+(\d+)\s*(x|×|rounds?)\s*$/i.exec(text);
  const activity = (leading?.[3] || trailing?.[1] || '').trim();
  if (!activity) return null;
  return { count: Number(leading?.[1] || trailing[2]), rounds: /^round/i.test(leading?.[2] || trailing[3]), activity: names.get(normalize(activity)) || { type: 'other', title: activity } };
}

/** The source remains the document. Only recognized steps contribute to its graph. */
export function parseTrainingText(text, { sport = 'other' } = {}) {
  const result = { blocks: [], errors: [], lines: [] };
  if (typeof text === 'string') sources.set(result, text);
  const fail = (line, message) => result.errors.push({ line, message });
  if (typeof text !== 'string') { fail(1, 'L’entraînement doit être du texte.'); return result; }
  if (text.length > TRAINING_TEXT_LIMIT) { fail(1, `Le texte ne peut pas dépasser ${TRAINING_TEXT_LIMIT.toLocaleString('fr-CA')} caractères.`); return result; }
  let group = null, groupLine = null, groupActivity = null, precedingActivity = null, count = 0, segments = 0;
  const finishGroup = () => {
    if (group && !group.children.length) {
      result.blocks.splice(result.blocks.indexOf(group), 1); count--;
      fail(groupLine.line, 'Ajoute au moins une étape après la répétition.'); delete groupLine.blockId;
    }
    group = null; groupLine = null; groupActivity = null;
  };
  for (const { raw, ...position } of textLines(text)) {
    // Only the immediately preceding activity-only line can label a neutral
    // group. Blank lines, instructions and steps interrupt this adjacency.
    const activityBefore = precedingActivity; precedingActivity = null;
    const line = { ...position, kind: raw.trim() ? 'text' : 'blank' }; result.lines.push(line);
    if (!raw.trim()) { finishGroup(); continue; }
    const repeat = repeatHeader(raw);
    if (repeat) {
      line.kind = 'repeat';
      if (group) { fail(line.line, 'Sépare les répétitions par une ligne vide; les groupes imbriqués ne sont pas interprétés.'); finishGroup(); }
      const repetitions = repeat.count;
      if (repetitions < 1 || repetitions > WORKOUT_LIMITS.repeat) { fail(line.line, `Choisis de 1 à ${WORKOUT_LIMITS.repeat} répétitions.`); continue; }
      if (repeat.activity?.title.length > 500) { fail(line.line, 'Le nom de l’activité ne peut pas dépasser 500 caractères.'); continue; }
      if (count >= WORKOUT_LIMITS.blocks || result.blocks.length >= WORKOUT_LIMITS.siblings) { fail(line.line, 'Le nombre maximal de blocs est atteint.'); continue; }
      group = { ...makeBlock('repeat'), repeat_count: repetitions, ...(repeat.rounds ? { repeat_unit: 'rounds' } : {}) };
      groupActivity = repeat.activity || activityBefore;
      line.blockId = group.id; groupLine = line; result.blocks.push(group); count++; continue;
    }
    if (!/^\s*-/.test(raw)) {
      const activity = names.get(normalize(raw));
      if (activity && activity.type !== 'other') precedingActivity = activity;
      continue;
    }
    line.kind = 'step';
    try {
      const block = parseStep(raw, sport, groupActivity); if (!block) { line.kind = 'text'; continue; }
      const list = group ? group.children : result.blocks, addedSegments = group?.repeat_count || 1;
      if (count >= WORKOUT_LIMITS.blocks || list.length >= WORKOUT_LIMITS.siblings) throw new Error('Le nombre maximal de blocs est atteint.');
      if (segments + addedSegments > WORKOUT_LIMITS.segments) throw new Error('La séance contient trop d’étapes répétées.');
      list.push(block); line.blockId = block.id; count++; segments += addedSegments;
    } catch (error) { fail(line.line, error.message || 'Cette étape ne peut pas être représentée.'); }
  }
  finishGroup(); return result;
}

const numericText = value => String(value).replace('.', ',');
function durationText(value) {
  if (value === 0) return '0s';
  if (!Number.isInteger(value)) return `${numericText(value)}s`;
  const hours = Math.floor(value / 3600), minutes = Math.floor(value % 3600 / 60), seconds = value % 60;
  return `${hours ? `${hours}h` : ''}${minutes ? `${minutes}min` : ''}${seconds ? `${seconds}s` : ''}`;
}
const oneLine = value => String(value || '').replace(/[\r\n]+/g, ' / ').trim();
function stepText(block) {
  const name = oneLine(block.type === 'other' || !BLOCK_TYPES.some(type => type.id === block.type) ? block.title || ({ walk: 'Marche', active_recovery: 'Repos actif' }[block.type]) || block.type : BLOCK_TYPES.find(type => type.id === block.type)?.label);
  const measures = [];
  if (block.duration_seconds != null && block.duration_seconds !== '') measures.push(durationText(block.duration_seconds));
  if (block.distance_m != null && block.distance_m !== '') measures.push(`${numericText(block.distance_m)}mtr`);
  const effort = formatEffort(block.effort || (block.zone ? { kind: 'zone', min: block.zone, max: block.zone } : null));
  const description = oneLine(block.description);
  return `- ${name}${measures.length ? ` ${measures.join(' + ')}` : ''}${effort ? ` @ ${effort}` : ''}${description ? ` - ${description}` : ''}`;
}

function plainBlocks(blocks) {
  const errors = validateBlocks(blocks); if (errors.length) throw new Error(errors.join(' '));
  const ids = new Set(); let derived = 0, count = 0;
  const identity = source => {
    const original = source.id || makeBlock().id;
    if (!ids.has(original)) { ids.add(original); return original; }
    const id = `${original}:copy:${++derived}`; ids.add(id); return id;
  };
  const push = (list, source) => {
    if (++count > WORKOUT_LIMITS.blocks || list.length >= WORKOUT_LIMITS.siblings) throw new Error('Cet ancien entraînement est trop volumineux pour être développé en texte sans perte.');
    list.push(source);
  };
  const steps = (source, list, context = []) => {
    if (source.kind === 'repeat') {
      const { children, ...note } = clone(source);
      for (let iteration = 0; iteration < source.repeat_count; iteration++) for (const child of source.children) steps(child, list, [...context, note]);
      return;
    }
    const base = clone(source);
    const extra = context.length ? { legacy_repeat_context: context } : {};
    if (source.rounds && source.work_seconds > 0) {
      for (let round = 0; round < source.rounds; round++) {
        push(list, { ...base, ...extra, id: identity(source), source_block_id: source.id, rounds: null, work_seconds: null, rest_seconds: null, duration_seconds: source.work_seconds, distance_m: round === 0 ? source.distance_m : null });
        if (round < source.rounds - 1 && source.rest_seconds > 0) push(list, { ...makeBlock('recovery'), ...extra, id: identity(source), source_block_id: source.id, title: 'Repos', duration_seconds: source.rest_seconds, effort: { kind: 'recovery', label: 'Repos' }, zone: 1 });
      }
    } else {
      const id = identity(source);
      push(list, { ...base, ...extra, id, ...(id !== source.id ? { source_block_id: source.id } : {}) });
    }
  };
  const result = [];
  for (const source of blocks) {
    if (source.kind === 'repeat') {
      const block = { ...clone(source), id: identity(source), children: [] };
      push(result, block);
      for (const child of source.children) steps(child, block.children);
    } else steps(source, result);
  }
  return result;
}

/** Extra mapping lets a legacy program keep its IDs when it first gains a document. */
export function serializeTrainingDocument(blocks) {
  const normalized = plainBlocks(blocks), rows = [];
  const addText = text => { for (const raw of String(text || '').split(/\r\n|\r|\n/)) if (raw) rows.push({ raw, kind: 'text' }); };
  const addStep = block => { rows.push({ raw: stepText(block), kind: 'step', blockId: block.id }); if (block.notes) addText(block.notes); };
  for (const block of normalized) {
    if (block.kind === 'repeat') {
      if (rows.length && rows.at(-1).raw !== '') rows.push({ raw: '', kind: 'blank' });
      rows.push({ raw: `${block.repeat_count}${block.repeat_unit === 'rounds' ? ' rounds' : 'x'}`, kind: 'repeat', blockId: block.id });
      addText(block.description); addText(block.notes); block.children.forEach(addStep); rows.push({ raw: '', kind: 'blank' });
    } else addStep(block);
  }
  if (rows.at(-1)?.raw === '') rows.pop();
  const text = rows.map(row => row.raw).join('\n');
  if (text.length > TRAINING_TEXT_LIMIT) throw new Error('Cet ancien entraînement est trop volumineux pour être converti en texte sans perte.');
  // Historical names or notes can themselves look like new notation. Refuse the
  // conversion instead of silently changing a dose, adding a step or moving a rest.
  const restored = parseTrainingText(text);
  const signature = list => list.map(block => ({
    kind: block.kind,
    ...(block.kind === 'repeat' ? { count: block.repeat_count, unit: block.repeat_unit || 'repetitions', children: signature(block.children) } : {
      type: block.type, duration: block.duration_seconds === '' ? null : block.duration_seconds ?? null,
      distance: block.distance_m === '' ? null : block.distance_m ?? null, description: oneLine(block.description),
    }),
  }));
  if (restored.errors.length || JSON.stringify(signature(restored.blocks)) !== JSON.stringify(signature(normalized))) {
    throw new Error('Cet entraînement contient un ancien nom ou une consigne qui ressemble à la nouvelle notation. Sa structure originale doit être conservée.');
  }
  let offset = 0;
  const lines = rows.map(({ raw, ...row }, index) => { const line = { ...row, line: index + 1, start: offset, end: offset + raw.length }; offset += raw.length + 1; return line; });
  return { text, blocks: normalized, lines };
}
export function serializeTrainingBlocks(blocks) { return serializeTrainingDocument(blocks).text; }

function indexBlocks(blocks) {
  const result = new Map(); const visit = list => list.forEach(block => { result.set(block.id, block); if (block.kind === 'repeat') visit(block.children); }); visit(blocks); return result;
}
const orderedBlocks = blocks => { const result = []; const visit = list => list.forEach(block => { result.push(block); if (block.kind === 'repeat') visit(block.children); }); visit(blocks); return result; };

/** Retains hidden legacy fields only for unchanged source lines, never overwriting edited doses. */
export function reconcileTrainingBlocks(result, previousBlocks = [], previousText = '') {
  const next = clone(result), current = indexBlocks(next.blocks), prior = parseTrainingText(previousText), priorParsed = indexBlocks(prior.blocks), ordered = orderedBlocks(previousBlocks), candidates = new Map();
  let index = 0;
  for (const line of prior.lines) {
    if (!line.blockId) continue;
    let block = ordered[index++];
    if (!block || block.kind !== (line.kind === 'repeat' ? 'repeat' : 'step')) continue;
    const key = `${line.kind}:${previousText.slice(line.start, line.end).trim()}`;
    if (!candidates.has(key)) candidates.set(key, []); candidates.get(key).push({ block, parsed: priorParsed.get(line.blockId) });
  }
  const used = new Set();
  for (const line of next.lines) {
    if (!line.blockId) continue;
    const block = current.get(line.blockId); if (!block) continue;
    // Source slices stay in a non-persisted index; only the caller stores the document.
    const source = sources.get(result) ?? result.sourceText ?? result.text;
    const key = `${line.kind}:${typeof source === 'string' ? source.slice(line.start, line.end).trim() : stepText(block)}`;
    let match = candidates.get(key)?.shift();
    if (!match) {
      const previous = ordered.find(value => !used.has(value.id) && value.kind === block.kind && (block.kind === 'repeat' ? value.repeat_count === block.repeat_count && value.repeat_unit === block.repeat_unit : stepText(value) === stepText(block)));
      if (previous) match = { block: previous };
    }
    const previous = match?.block;
    if (!previous || used.has(previous.id)) continue;
    used.add(previous.id); const oldId = block.id, children = block.children;
    // The source line can stay unchanged while its inherited activity changes.
    // Preserve its identity and hidden fields without restoring the old scope.
    const inherited = {};
    if (block.kind === 'step' && match.parsed && (block.type !== match.parsed.type || block.title !== match.parsed.title)) {
      Object.assign(inherited, { type: block.type, title: block.title });
      if (JSON.stringify(block.effort ?? null) !== JSON.stringify(match.parsed.effort ?? null)) Object.assign(inherited, { effort: clone(block.effort), zone: block.zone });
    }
    Object.assign(block, clone(previous), { id: previous.id || oldId, children });
    Object.assign(block, inherited);
    line.blockId = block.id;
  }
  if (sources.has(result)) sources.set(next, sources.get(result));
  return next;
}
