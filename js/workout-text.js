import { BLOCK_TYPES, WORKOUT_LIMITS, makeBlock, validateBlocks, summarizeBlocks } from './domain.js';

/** Workout text uses m for minutes; distances always have an explicit distance unit. */
export const syntaxHelp = 'Course / Shadow / Sac / Abdos / Corde : un en-tête choisit le travail. 1m30 @ Z2 - Consigne. 3 rounds 1m/1m - Consigne. 2x puis ses étapes indentées de deux espaces. Distance : 400 mètres ou 1km. Libre - Consigne sans durée.';
export const advancedSyntaxHelp = 'Un titre personnalisé s’écrit « Course : Jog léger ». Les options conservées automatiquement apparaissent après | sous forme JSON (notes, zones, répétitions, etc.). Ne les efface pas si tu veux les conserver. Les identifiants internes des blocs sont recréés.';

const normalize = value => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('fr').trim();
const headings = new Map();
for (const type of BLOCK_TYPES) {
  headings.set(normalize(type.label), { type: type.id, title: type.label });
  headings.set(normalize(type.id), { type: type.id, title: type.label });
}
for (const [label, type] of [['Course à pied', 'run'], ['Abdos', 'strength'], ['Corde', 'cardio'], ['Corde à sauter', 'cardio'], ['Musculation', 'strength'], ['Repos', 'recovery']]) headings.set(normalize(label), { type, title: label });
headings.set('sparing', { type: 'sparring', title: 'Sparring' });
const numeric = '(?:\\d+(?:[.,]\\d*)?|[.,]\\d+)(?:[eE][+-]?\\d+)?';
const number = value => Number(value.replace(',', '.'));
const distancePattern = new RegExp(`^(${numeric})\\s*(km|mtr|mtrs|mètres?|metres?)$`, 'i');
const durationToken = new RegExp(`(${numeric})\\s*(heures?|h|minutes?|min|m|secondes?|sec|s)`, 'iy');
const bareNumber = new RegExp(`^${numeric}$`);
const MAX_TEXT = 8_000_000, MAX_LINES = 5000;
const structuralKeys = new Set(['id', 'kind', 'children', '__proto__', 'prototype', 'constructor']);

function duration(value) {
  const source = value.trim(); let total = 0, position = 0, previousUnit = 4, tokens = 0;
  while (position < source.length) {
    while (/\s/.test(source[position] || '') && position < source.length) position++;
    durationToken.lastIndex = position;
    const token = durationToken.exec(source);
    if (!token) {
      const remaining = source.slice(position).trim();
      if (tokens && previousUnit === 2 && bareNumber.test(remaining)) { total += number(remaining); position = source.length; break; }
      throw new Error('Durée invalide : utilise 1m30s, 1m30, 30s ou 10m. Pour une distance, écris mètres ou km.');
    }
    const unit = token[2].toLowerCase()[0], rank = unit === 'h' ? 3 : unit === 'm' ? 2 : 1;
    if (rank >= previousUnit) throw new Error('Indique les heures, minutes puis secondes, sans répéter une unité.');
    total += number(token[1]) * (rank === 3 ? 3600 : rank === 2 ? 60 : 1);
    previousUnit = rank; position = durationToken.lastIndex; tokens++;
  }
  if (!tokens || !Number.isFinite(total)) throw new Error('Durée invalide.');
  return total;
}
function measurement(value) {
  const match = distancePattern.exec(value.trim());
  return match ? { distance_m: number(match[1]) * (match[2].toLowerCase() === 'km' ? 1000 : 1) } : { duration_seconds: duration(value) };
}
function jsonValue(value, ancestors = new Set(), depth = 0) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (!value || typeof value !== 'object' || depth > 32 || ancestors.has(value)) throw new Error('Une option ne peut pas être conservée en texte : valeur non JSON, circulaire ou trop profonde.');
  if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) throw new Error('Une option contient un objet non JSON.');
  ancestors.add(value);
  for (const item of Object.values(value)) jsonValue(item, ancestors, depth + 1);
  ancestors.delete(value);
}
function annotation(line) {
  const marker = /\s+\|\s*/.exec(line);
  if (!marker) return { text: line, metadata: {} };
  let metadata;
  try { metadata = JSON.parse(line.slice(marker.index + marker[0].length)); }
  catch { throw new Error('Options avancées invalides : après |, utilise un objet JSON valide.'); }
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) throw new Error('Les options après | doivent être un objet JSON.');
  for (const key of Object.keys(metadata)) if (structuralKeys.has(key)) throw new Error(`L’option « ${key} » ne peut pas modifier la structure des blocs.`);
  jsonValue(metadata);
  return { text: line.slice(0, marker.index).trimEnd(), metadata };
}
function heading(text, context) {
  const colon = text.indexOf(':');
  const key = colon < 0 ? text : text.slice(0, colon);
  const known = headings.get(normalize(key));
  if (known) {
    const title = colon < 0 ? known.title : text.slice(colon + 1).trim();
    if (!title) throw new Error('Ajoute un titre après les deux-points.');
    return { type: known.type, title };
  }
  if (/^[^\d\s][^|]*:\s*$/.test(text)) return { type: context.type, title: text.slice(0, -1).trim() };
  return null;
}
function parseStep(text, context) {
  const inline = /^(sparring|sparing)\s+(?=\d|libre\b)(.+)$/i.exec(text);
  if (inline) return parseStep(inline[2], { type: 'sparring', title: 'Sparring' });
  let description = '';
  const separator = /\s+-\s*/.exec(text);
  if (separator) { description = text.slice(separator.index + separator[0].length); text = text.slice(0, separator.index).trimEnd(); }
  else if (/^-\s*\D/.test(text)) { description = text.slice(1).trimStart(); text = 'Libre'; }
  let zone = null;
  const zoneMatch = /\s*@\s*Z\s*(\d+)\s*$/i.exec(text);
  if (zoneMatch) { zone = Number(zoneMatch[1]); text = text.slice(0, zoneMatch.index).trimEnd(); }
  const repeat = /^(\d+)\s*[x×](?:\s*:\s*(.+))?$/i.exec(text);
  if (repeat) return { ...makeBlock('repeat'), repeat_count: Number(repeat[1]), title: repeat[2]?.trim() || 'Répétition', description, zone };
  const block = { ...makeBlock(context.type), title: context.title, description, zone };
  if (/^libre$/i.test(text)) return block;
  const rounds = /^(\d+)\s*rounds?\s*(.+)$/i.exec(text);
  if (rounds) {
    const parts = rounds[2].split('/');
    if (parts.length > 2 || parts.some(part => !part.trim())) throw new Error('Rounds invalides : écris par exemple 3 rounds 1m/1m.');
    block.rounds = Number(rounds[1]); block.work_seconds = duration(parts[0]);
    if (parts.length === 2) block.rest_seconds = duration(parts[1]);
    return block;
  }
  const quantities = text.split(/\s+\+\s+/);
  if (quantities.length > 2) throw new Error('Indique au maximum une durée et une distance.');
  for (const quantity of quantities) {
    const dose = measurement(quantity), key = Object.keys(dose)[0];
    if (block[key] != null) throw new Error('La durée ou la distance apparaît deux fois.');
    block[key] = dose[key];
  }
  return block;
}

/** Invalid text always returns line-addressable errors; callers must not apply a partial result. */
export function parseWorkoutText(text, { sport = 'other' } = {}) {
  const blocks = [], errors = [], locations = new WeakMap();
  const fail = (line, message) => errors.push({ line, message });
  if (typeof text !== 'string') return { blocks, errors: [{ line: 1, message: 'Le programme doit être du texte.' }] };
  if (text.length > MAX_TEXT) return { blocks, errors: [{ line: 1, message: 'Le programme texte est trop volumineux.' }] };
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  if (lines.length > MAX_LINES) return { blocks, errors: [{ line: 1, message: `Le programme ne peut pas dépasser ${MAX_LINES} lignes.` }] };
  const context = sport === 'running' ? { type: 'run', title: 'Course' } : sport === 'sparring' ? { type: 'sparring', title: 'Sparring' } : { type: 'other', title: 'Autre' };
  const stack = [{ list: blocks, context, pending: null, last: null, canNest: false }]; let count = 0;
  const close = frame => { if (frame.pending) fail(frame.pending, 'Cet en-tête doit être suivi d’une étape (par exemple 1m ou Libre - Consigne).'); };
  try {
    for (let index = 0; index < lines.length; index++) {
      const source = lines[index], line = index + 1;
      if (!source.trim()) continue;
      const prefix = /^\s*/.exec(source)[0];
      if (/[^ ]/.test(prefix) || prefix.length % 2) { fail(line, 'Utilise deux espaces par niveau d’indentation, sans tabulation.'); continue; }
      const depth = prefix.length / 2 + 1;
      if (depth > WORKOUT_LIMITS.depth) { fail(line, `Maximum ${WORKOUT_LIMITS.depth} niveaux de blocs.`); continue; }
      if (depth > stack.length) {
        const parent = stack.at(-1);
        if (depth !== stack.length + 1 || !parent.canNest || parent.last?.kind !== 'repeat') { fail(line, 'Une étape indentée doit suivre une répétition (2x, par exemple), avec deux espaces de plus.'); continue; }
        stack.push({ list: parent.last.children, context: { ...parent.context }, pending: null, last: null, canNest: false }); parent.canNest = false;
      }
      while (stack.length > depth) close(stack.pop());
      const frame = stack.at(-1);
      try {
        const { text: content, metadata } = annotation(source.trim());
        const section = heading(content, frame.context);
        if (section) {
          if (Object.keys(metadata).length) throw new Error('Place les options avancées sur une ligne d’étape, pas sur un en-tête.');
          close(frame); frame.context = section; frame.pending = line; frame.canNest = false; continue;
        }
        const parsed = parseStep(content, frame.context);
        const block = { ...parsed, ...metadata };
        const validation = validateBlocks([block.kind === 'repeat' ? { ...block, children: [makeBlock()] } : block]);
        if (validation.length) throw new Error(validation.join(' '));
        if (frame.list.length >= WORKOUT_LIMITS.siblings) throw new Error(`Maximum ${WORKOUT_LIMITS.siblings} blocs dans une même liste.`);
        if (++count > WORKOUT_LIMITS.blocks) { fail(line, `Maximum ${WORKOUT_LIMITS.blocks} blocs.`); break; }
        frame.list.push(block); locations.set(block, line); frame.last = block; frame.canNest = block.kind === 'repeat'; frame.pending = null;
      } catch (error) { fail(line, error.message || 'Ligne de programme invalide.'); frame.canNest = false; }
    }
    stack.forEach(close);
    const emptyRepeats = list => list.forEach(block => { if (block.kind === 'repeat') { if (!block.children.length) fail(locations.get(block), 'Ajoute au moins une étape indentée sous cette répétition.'); emptyRepeats(block.children); } });
    emptyRepeats(blocks);
    if (!errors.length) {
      const summary = summarizeBlocks(blocks);
      for (const message of summary.errors) fail(locations.get(blocks.find(block => block.kind === 'repeat') || blocks[0]) || 1, message);
    }
  } catch (error) { fail(1, error.message || 'Programme texte invalide.'); }
  return { blocks, errors: errors.sort((a, b) => a.line - b.line) };
}

/** Session-wide prose shares the text surface without becoming timed workout blocks. */
export function parseSessionText(text, options) {
  const notes = [];
  const program = text.split('\n').map(line => {
    if (/^#(?: |$)/.test(line)) { notes.push(line.replace(/^# ?/, '')); return ''; }
    return line;
  }).join('\n');
  const result = parseWorkoutText(program, options);
  if (notes.join('\n').length > 20000) result.errors.push({ line: 1, message: 'Le texte libre ne peut pas dépasser 20 000 caractères.' });
  return { ...result, notes: notes.join('\n') };
}
export function serializeSessionText(blocks, notes = '') {
  return [notes ? notes.split('\n').map(line => `# ${line}`).join('\n') : '', serializeWorkoutText(blocks)].filter(Boolean).join('\n\n');
}

function formatTime(seconds) {
  if (!Number.isInteger(seconds)) return `${seconds}s`;
  if (!seconds) return '0s';
  const hours = Math.floor(seconds / 3600), minutes = Math.floor(seconds % 3600 / 60), rest = seconds % 60;
  return `${hours ? `${hours}h` : ''}${minutes ? `${minutes}m` : ''}${rest ? `${rest}s` : ''}`;
}
const safeText = value => typeof value === 'string' && value === value.trim() && !/[\r\n]/.test(value) && !/\s+\|\s*/.test(value);
const numericValue = value => typeof value === 'number' && Number.isFinite(value);
function canonicalHeading(block) {
  const alias = typeof block.title === 'string' ? headings.get(normalize(block.title)) : null;
  if (alias?.type === block.type && block.title === alias.title) return { ...alias, text: alias.title };
  const known = BLOCK_TYPES.find(type => type.id === block.type) || BLOCK_TYPES.find(type => type.id === 'other');
  const title = safeText(block.title) && block.title ? block.title : known.label;
  return { type: known.id, title, text: title === known.label ? known.label : `${known.label} : ${title}` };
}

/** Serializes every semantic field, using JSON extensions only for fields without plain syntax. */
export function serializeWorkoutText(blocks) {
  const summary = summarizeBlocks(blocks);
  if (summary.errors.length) throw new Error(`Impossible de convertir le programme en texte : ${summary.errors.join(' ')}`);
  const output = [];
  function visit(list, depth, inherited = null) {
    let context = inherited;
    for (const block of list) {
      if (!Array.isArray(block.children)) throw new Error('Impossible de conserver une structure de sous-blocs invalide.');
      const repeat = block.kind === 'repeat';
      let baseline = makeBlock(repeat ? 'repeat' : 'other'), line;
      if (repeat) {
        baseline.repeat_count = block.repeat_count; line = `${block.repeat_count}x`;
        if (safeText(block.title) && block.title && !/\s+-\s*/.test(block.title) && !/@\s*Z\s*\d+\s*$/i.test(block.title)) { baseline.title = block.title; if (block.title !== 'Répétition') line += ` : ${block.title}`; }
      } else {
        const section = canonicalHeading(block);
        if (!context || section.type !== context.type || section.title !== context.title) output.push('  '.repeat(depth) + section.text);
        context = section; baseline = { ...baseline, type: section.type, title: section.title };
        if (numericValue(block.rounds) && numericValue(block.work_seconds)) {
          baseline.rounds = block.rounds; baseline.work_seconds = block.work_seconds;
          line = `${block.rounds} rounds ${formatTime(block.work_seconds)}`;
          if (numericValue(block.rest_seconds)) { baseline.rest_seconds = block.rest_seconds; line += `/${formatTime(block.rest_seconds)}`; }
        } else {
          const quantities = [];
          if (numericValue(block.duration_seconds)) { baseline.duration_seconds = block.duration_seconds; quantities.push(formatTime(block.duration_seconds)); }
          if (numericValue(block.distance_m)) { baseline.distance_m = block.distance_m; quantities.push(`${block.distance_m} mètres`); }
          line = quantities.join(' + ') || 'Libre';
        }
      }
      if (numericValue(block.zone)) { baseline.zone = block.zone; line += ` @ Z${block.zone}`; }
      if (safeText(block.description) && block.description) { baseline.description = block.description; line += ` - ${block.description}`; }
      const metadata = Object.create(null);
      for (const [key, value] of Object.entries(block)) {
        if (['id', 'kind', 'children'].includes(key)) continue;
        if (structuralKeys.has(key)) throw new Error(`Impossible de conserver l’option structurelle « ${key} ».`);
        jsonValue(value);
        if (JSON.stringify(value) !== JSON.stringify(baseline[key])) metadata[key] = value;
      }
      if (Object.keys(metadata).length) line += ` | ${JSON.stringify(metadata)}`;
      output.push('  '.repeat(depth) + line);
      if (repeat) visit(block.children, depth + 1, context ? { ...context } : null);
    }
  }
  visit(blocks, 0);
  const result = output.join('\n');
  if (result.length > MAX_TEXT || output.length > MAX_LINES) throw new Error('Le programme est trop volumineux pour être converti en texte sans perte.');
  return result;
}
