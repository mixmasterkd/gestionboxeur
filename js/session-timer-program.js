import { blockName, flattenBlocks, validateBlocks, WORKOUT_LIMITS } from './domain.js';
import { parseTrainingText, TRAINING_TEXT_LIMIT } from './workout-document.js';
import { timerEffortAppearance } from './timer-program.js';

/** A private playback copy: source text wins over cached blocks, and no dose disappears. */
export function compileSessionTimer(session) {
  if (!session || typeof session !== 'object') throw new Error('Choisis un entraînement.');
  let blocks = session.blocks || [], instructions = [session.description, session.notes].filter(Boolean).join('\n\n');
  if (session.workout_document != null) {
    const text = session.workout_document.text;
    if (typeof text !== 'string' || text.length > TRAINING_TEXT_LIMIT) throw new Error('Le texte de cet entraînement est invalide.');
    const parsed = parseTrainingText(text, { sport: session.sport });
    if (parsed.errors.length) throw new Error(`Corrige la programmation avant de lancer le timer : ${parsed.errors.map(e => `ligne ${e.line} : ${e.message}`).join(' ')}`);
    blocks = parsed.blocks;
    instructions = text;
  }
  const errors = validateBlocks(blocks);
  if (errors.length) throw new Error(errors.join(' '));
  // Validate expansion before traversing, including older compact rounds.
  flattenBlocks(blocks);
  const phases = [];
  function append(block, trail = []) {
    if (phases.length >= WORKOUT_LIMITS.segments) throw new Error('Cet entraînement contient trop d’étapes.');
    const rest = block.phase === 'rest';
    const seconds = block.duration_seconds > 0 ? block.duration_seconds : null;
    const effort = rest ? { kind: 'recovery', label: 'Repos' }
      : block.effort || (block.zone ? { kind: 'zone', min: block.zone, max: block.zone } : null)
      || ({ recovery: { kind: 'recovery', label: 'Repos' }, active_recovery: { kind: 'recovery', label: 'Repos actif' }, walk: { kind: 'recovery', label: 'Marche' } }[block.type]) || null;
    const kind = rest || effort?.kind === 'recovery' && effort.label?.toLocaleLowerCase('fr') === 'repos' ? 'rest' : 'work';
    const appearance = timerEffortAppearance({ kind, effort });
    const name = rest ? 'Repos' : block.title || blockName(block);
    const objective = [!rest && block.repetitions ? `${block.repetitions} répétitions` : '', !rest && block.distance_m > 0 ? `${block.distance_m.toLocaleString('fr-CA')} m` : ''].filter(Boolean).join(' · ');
    phases.push({ ...appearance, kind, seconds, manual: seconds === null, name, objective,
      instruction: rest ? '' : [block.description, block.notes].filter(Boolean).join('\n'),
      repetition: trail.join(' · '), sourceBlockId: block.id || null, warning: false });
  }
  function walk(list, trail = []) {
    for (const block of list) {
      if (block.kind === 'repeat') {
        for (let round = 1; round <= block.repeat_count; round++) walk(block.children, [...trail, `${block.repeat_unit === 'rounds' ? 'Round' : 'Passage'} ${round}/${block.repeat_count}`]);
      } else if (block.rounds && block.work_seconds > 0) {
        for (const part of flattenBlocks([block])) append(part, [...trail, `Round ${part.round}/${block.rounds}`]);
      } else if (block.rounds && !block.duration_seconds) {
        for (let round = 1; round <= block.rounds; round++) {
          const repetition = [...trail, `Round ${round}/${block.rounds}`];
          append(block, repetition);
          if (round < block.rounds && block.rest_seconds > 0) append({ ...block, phase: 'rest', duration_seconds: block.rest_seconds }, repetition);
        }
      } else append(block, trail);
    }
  }
  walk(blocks);
  const freeform = phases.length === 0;
  if (!phases.length) append({ title: session.title || 'Entraînement libre', description: instructions, type: 'other' });
  return {
    title: session.title || 'Entraînement', instructions, phases, freeform,
    timedSeconds: phases.reduce((sum, phase) => sum + (phase.seconds || 0), 0),
    manualSteps: phases.filter(phase => phase.manual).length,
  };
}

/** Add user-chosen timing to an untimed playback copy, never to the saved workout. */
export function configureSessionIntervals(program, { workSeconds, restSeconds, rounds = 1 } = {}) {
  if (!program?.phases?.length || program.phases.some(phase => !phase.manual || phase.seconds !== null)) {
    throw new Error('Cette option est réservée aux séances sans durée programmée.');
  }
  if (!Number.isInteger(workSeconds) || workSeconds < 1 || workSeconds > 3600) throw new RangeError('Effort : indique de 1 à 3 600 secondes.');
  if (!Number.isInteger(restSeconds) || restSeconds < 0 || restSeconds > 3600) throw new RangeError('Repos : indique de 0 à 3 600 secondes.');
  if (program.freeform && (!Number.isInteger(rounds) || rounds < 1 || rounds > WORKOUT_LIMITS.repeat)) throw new RangeError(`Choisis de 1 à ${WORKOUT_LIMITS.repeat} intervalles.`);
  const source = program.freeform
    ? Array.from({ length: rounds }, (_, index) => ({ ...program.phases[0], repetition: `Intervalle ${index + 1}/${rounds}` }))
    : program.phases;
  const phases = [];
  const push = phase => {
    if (phases.length >= WORKOUT_LIMITS.segments) throw new RangeError('Ces réglages créent trop d’étapes. Réduis les rounds ou retire les repos ajoutés.');
    phases.push(phase);
  };
  for (let index = 0; index < source.length; index++) {
    const phase = source[index], seconds = phase.kind === 'rest' ? restSeconds : workSeconds;
    if (seconds) push({ ...phase, seconds, manual: false });
    // Keep explicit rests in place; only add recovery between adjacent efforts.
    if (restSeconds && phase.kind === 'work' && source[index + 1]?.kind === 'work') {
      push({ ...timerEffortAppearance({ kind: 'rest' }), kind: 'rest', seconds: restSeconds, manual: false,
        objective: '', instruction: '', repetition: phase.repetition, sourceBlockId: null, warning: false });
    }
  }
  if (!phases.length) throw new Error('Choisis une durée de repos supérieure à zéro pour cette séance.');
  return { ...program, phases, timedSeconds: phases.reduce((sum, phase) => sum + phase.seconds, 0), manualSteps: 0 };
}
