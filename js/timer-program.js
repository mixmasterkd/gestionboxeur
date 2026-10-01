import { flattenBlocks, WORKOUT_LIMITS } from './domain.js';
import { parseTrainingText, TRAINING_TEXT_LIMIT } from './workout-document.js';
import { parseEffort, formatEffort } from './workout-effort.js';
import { effortAppearance } from './session-chart.js';

const WORK_COLOR = '#25a567';
const REST_COLOR = '#a3a9b2';
const INK = '#101722';
const normalize = value => String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
const fail = (message, line) => { throw new Error(`${line ? `Ligne ${line} : ` : ''}${message}`); };
const lineError = errors => errors.map(error => `Ligne ${error.line} : ${error.message}`).join(' ');

/** Uses the graph's palette; zones are never inferred from HR, pace or RPE. */
export function timerEffortAppearance(value = null) {
  const phase = value && ['work', 'rest', 'prepare'].includes(value.kind) ? value : null;
  if (phase?.kind === 'prepare') return { label: 'Préparation', name: 'Préparation', color: '#111317', highColor: '#111317', range: false, ink: '#ffffff', effort: null };
  const effort = phase ? phase.effort : value?.effort || value;
  const rest = phase?.kind === 'rest' || effort?.kind === 'recovery' && normalize(effort.label) === 'repos';
  if (rest) return { label: 'Repos', name: 'Repos', color: REST_COLOR, highColor: REST_COLOR, range: false, ink: INK, effort: { kind: 'recovery', label: 'Repos' } };
  if (!effort) return { label: 'Travail', name: 'Travail', color: WORK_COLOR, highColor: WORK_COLOR, range: false, ink: INK, effort: null };
  const appearance = effortAppearance({ effort });
  return { ...appearance, label: appearance.name, ink: INK };
}

function timerEffort(block, line) {
  const stored = block.phase === 'rest' ? { kind: 'recovery', label: 'Repos' }
    : block.effort || (block.zone ? { kind: 'zone', min: block.zone, max: block.zone } : null)
      || ({ recovery: { kind: 'recovery', label: 'Repos' }, walk: { kind: 'recovery', label: 'Marche' }, active_recovery: { kind: 'recovery', label: 'Repos actif' } }[block.type]) || null;
  if (!stored) return null;
  let effort;
  try { effort = parseEffort(formatEffort(stored)); }
  catch { fail('Intensité invalide : vérifie la zone, le RPE, les bpm ou l’allure.', line); }
  if (!effort || effort.kind === 'custom') fail('Cette cible ne peut pas piloter le timer. Utilise une zone, un RPE, Vert/Jaune/Rouge, Repos, Marche, des bpm ou une allure.', line);
  return effort;
}

function formatSeconds(seconds) {
  if (!Number.isInteger(seconds)) {
    const [coefficient, exponent] = String(seconds).split('e-');
    const decimal = exponent ? `0.${'0'.repeat(Number(exponent) - 1)}${coefficient.replace('.', '')}` : coefficient;
    return `${decimal.replace('.', ',')}s`;
  }
  const hours = Math.floor(seconds / 3600), minutes = Math.floor(seconds % 3600 / 60), rest = seconds % 60;
  return `${hours ? `${hours}h` : ''}${minutes ? `${minutes}m` : ''}${rest ? `${rest}s` : ''}`;
}
const command = block => `- ${formatSeconds(block.seconds)}${block.kind === 'prepare' ? ' @ Préparation' : block.effort ? ` @ ${formatEffort(block.effort)}` : ''}`;
const numericCommand = /^(?:[+-]?\d|[.,]\d)/;
const unitlessCommand = /^[+-]?(?:\d+(?:[.,]\d+)?|[.,]\d+)(?:[a-z'"′’″]*)$/i;

/** Prose may accompany a workout; doses without a duration may not disappear. */
function timedStep(block, { line, raw = '', legacy = false } = {}) {
  const seconds = block.duration_seconds;
  if (!(typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0 && seconds <= 1e6)) {
    if (block.distance_m > 0 || block.repetitions > 0) fail('Cette étape contient une distance ou un nombre de mouvements sans durée. Ajoute une durée avant de la lancer dans le timer.', line);
    if (seconds != null && seconds !== '') fail('Chaque étape du timer doit avoir une durée positive (maximum 1 000 000 secondes).', line);
    const content = raw.trim().replace(/^-\s*/, '');
    if (block.type !== 'other' || unitlessCommand.test(content) || legacy && unitlessCommand.test(String(block.title || '')) || block.effort || block.zone) fail('Cette étape n’a pas de durée. Ajoute une durée explicite, par exemple 30s.', line);
    return null;
  }
  if (block.effort?.kind === 'custom' && normalize(block.effort.label) === 'preparation') {
    if (!Number.isInteger(seconds) || seconds > 60) fail('La préparation doit durer de 1 à 60 secondes entières.', line);
    return { seconds, effort: null, kind: 'prepare' };
  }
  const effort = timerEffort(block, line);
  return { seconds, effort, kind: effort?.kind === 'recovery' && normalize(effort.label) === 'repos' ? 'rest' : 'work' };
}

function readText(text, sport = 'other', { sourceDocument = false } = {}) {
  if (typeof text !== 'string') fail('Le programme du timer doit être du texte.');
  if (text.length > TRAINING_TEXT_LIMIT) fail(`Le programme ne peut pas dépasser ${TRAINING_TEXT_LIMIT.toLocaleString('fr-CA')} caractères.`);
  // Hide comment contents without changing offsets or introducing blank lines
  // (which would end a repeat). A note such as « # 3x » is never a loop.
  const source = text.replace(/^[ \t]*(?:#|\/\/).*$/gm, line => `#${' '.repeat(line.length - 1)}`);
  const parsed = parseTrainingText(source, { sport });
  if (parsed.errors.length) fail(lineError(parsed.errors));
  const locations = new Map();
  for (const line of parsed.lines) {
    const raw = text.slice(line.start, line.end), trimmed = raw.trim();
    if (line.blockId) locations.set(line.blockId, { line: line.line, raw });
    // Calendar prose is never executable. In a hand-written timer, diagnose a
    // missing dash on doses while still allowing notes such as « 3 conseils ».
    if (!sourceDocument && line.kind === 'text' && numericCommand.test(trimmed) && !/^\d+\s*:\s*[a-zà-ÿ]/i.test(trimmed)) {
      const probe = parseTrainingText(`- ${trimmed}`), dose = probe.blocks[0];
      if (probe.errors.length || unitlessCommand.test(trimmed) || dose?.duration_seconds != null || dose?.distance_m != null || dose?.repetitions != null) {
        fail('Commande non reconnue. Précède une étape de « - » et indique sa durée, ou écris un groupe comme « 3x ».', line.line);
      }
    }
  }
  const groups = [];
  for (const block of parsed.blocks) {
    const location = locations.get(block.id);
    if (block.kind === 'repeat') {
      const children = block.children.map(child => timedStep(child, locations.get(child.id))).filter(Boolean);
      if (!children.length) fail('Cette répétition ne contient aucune étape chronométrable.', location?.line);
      if (children.some(child => child.kind === 'prepare')) fail('La préparation doit être une étape seule au début, hors des répétitions.', location?.line);
      groups.push({ repeat: block.repeat_count, rounds: block.repeat_unit === 'rounds', children });
    } else {
      const step = timedStep(block, location);
      if (step?.kind === 'prepare' && groups.length) fail('La préparation doit être une seule étape au début du programme.', location?.line);
      if (step) groups.push({ repeat: 1, rounds: false, children: [step], single: true });
    }
  }
  if (!groups.length) fail('Ajoute au moins une étape avec une durée, par exemple « - 1m @ Z3 ».');
  return groups;
}

function serializeGroups(groups) {
  const output = [];
  for (const group of groups) {
    if (output.length && (!group.single || output.at(-1) !== '')) output.push('');
    if (!group.single) output.push(`${group.repeat}${group.rounds ? ' rounds' : 'x'}`);
    output.push(...group.children.map(command));
  }
  const text = output.join('\n');
  if (text.length > TRAINING_TEXT_LIMIT) fail('La copie du timer est trop volumineuse. Choisis une séance plus courte.');
  return text;
}

/** Explicit steps are repeated exactly, including a final rest when written. */
export function compileTimerText(text, { preparation = 0 } = {}) {
  if (!Number.isInteger(preparation) || preparation < 0 || preparation > 60) fail('La préparation doit durer de 0 à 60 secondes.');
  const groups = readText(text), phases = [];
  const explicitPreparation = groups[0]?.children[0]?.kind === 'prepare' ? groups[0] : null;
  if (explicitPreparation && preparation) fail('La préparation est déjà écrite dans les commandes. Ne la définis pas deux fois.');
  const activeGroups = explicitPreparation ? groups.slice(1) : groups;
  if (!activeGroups.length) fail('Ajoute au moins une étape de travail ou de repos après la préparation.');
  const steps = activeGroups.reduce((total, group) => total + group.repeat * group.children.length, 0);
  if (steps > WORKOUT_LIMITS.segments) fail(`Le timer ne peut pas dépasser ${WORKOUT_LIMITS.segments.toLocaleString('fr-CA')} étapes.`);
  if (preparation) phases.push({ kind: 'prepare', seconds: preparation, warning: false, round: 1, series: 1, ...timerEffortAppearance({ kind: 'prepare' }) });
  if (explicitPreparation) phases.push({ kind: 'prepare', seconds: explicitPreparation.children[0].seconds, warning: false, round: 1, series: 1, ...timerEffortAppearance({ kind: 'prepare' }) });
  let index = 0;
  for (const [groupIndex, group] of activeGroups.entries()) {
    for (let iteration = 1; iteration <= group.repeat; iteration++) {
      for (const [stepIndex, step] of group.children.entries()) {
        const appearance = timerEffortAppearance(step);
        phases.push({ ...step, ...appearance, warning: false, index: ++index, stepTotal: steps,
          group: groupIndex + 1, groupStep: stepIndex + 1, groupSteps: group.children.length,
          round: iteration, rounds: group.repeat, series: iteration, seriesTotal: group.repeat,
          label: appearance.label });
      }
    }
  }
  return { phases, commands: serializeGroups(groups), steps, totalSeconds: phases.reduce((total, phase) => total + phase.seconds, 0) };
}

/** Copies only timer commands; neither source documents nor stored blocks mutate. */
export function timerTextFromSession(session) {
  if (!session || typeof session !== 'object') fail('Choisis une séance du calendrier.');
  if (session.workout_document != null) {
    if (typeof session.workout_document.text !== 'string') fail('Le document de cette séance est invalide.');
    // Source text is authoritative: stale block caches must not restore old doses.
    return serializeGroups(readText(session.workout_document.text, session.sport, { sourceDocument: true }));
  }
  const blocks = session.blocks || [];
  // The domain validates and bounds expansion before legacy conversion.
  flattenBlocks(blocks);
  const originals = new Map(); let identity = 0;
  const indexed = list => list.map(block => {
    const copy = { ...block, id: `timer-copy-${++identity}`, children: block.kind === 'repeat' ? indexed(block.children) : [] };
    originals.set(copy.id, copy); return copy;
  });
  const copied = indexed(blocks);
  const legacySteps = list => flattenBlocks(list).map(block => {
    const original = originals.get(block.id);
    const restored = block.phase === 'step' && !block.duration_seconds && original?.duration_seconds == null
      ? { ...block, duration_seconds: null } : block;
    return timedStep(restored, { legacy: true });
  }).filter(Boolean);
  const groups = [];
  for (const block of copied) {
    if (block.kind === 'repeat') {
      const children = legacySteps(block.children);
      if (!children.length) fail('Cette répétition ne contient aucune étape chronométrable.');
      groups.push({ repeat: block.repeat_count, rounds: block.repeat_unit === 'rounds', children });
    } else {
      const children = legacySteps([block]);
      if (children.length) groups.push({ repeat: 1, rounds: false, children, single: true });
    }
  }
  if (!groups.length) fail('Cette séance ne contient aucune étape chronométrable.');
  const commands = serializeGroups(groups);
  // Reparse before exposing the copy so the timer never accepts a partial import.
  compileTimerText(commands);
  return commands;
}
