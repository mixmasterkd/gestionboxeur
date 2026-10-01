import { makePhases } from './tools-engine.js';
import { compileTimerText } from './timer-program.js';

const invalidDuration = () => { throw new RangeError('Indique une durée valide en secondes entières (M = minutes, S = secondes).'); };

function durationUnit(unit) {
  const normalized = typeof unit === 'string' ? unit.toUpperCase() : '';
  if (normalized !== 'M' && normalized !== 'S') invalidDuration();
  return normalized;
}

/** Keep the stored duration in whole seconds, independently of its display unit. */
export function readDuration(value, unit, { min = 0, max = 3600 } = {}) {
  const selected = durationUnit(unit);
  if (!Number.isInteger(min) || !Number.isInteger(max) || min < 0 || max < min) invalidDuration();
  if (typeof value !== 'number' && (typeof value !== 'string' || !/^(?:\d+(?:[.,]\d*)?|[.,]\d+)$/.test(value.trim()))) invalidDuration();
  const amount = typeof value === 'number' ? value : Number(value.trim().replace(',', '.'));
  if (!Number.isFinite(amount) || amount < 0) invalidDuration();
  const seconds = selected === 'M' ? amount * 60 : amount, whole = Math.round(seconds);
  // Twelve-decimal minute displays (e.g. 7 s) introduce a tiny round-off only.
  if (selected === 'S' ? !Number.isInteger(seconds) : Math.abs(seconds - whole) > 1e-8) invalidDuration();
  if (whole < min || whole > max) throw new RangeError(`La durée doit être comprise entre ${min} et ${max} secondes.`);
  return whole;
}

export function displayDuration(seconds, unit) {
  const selected = durationUnit(unit);
  if (!Number.isSafeInteger(seconds) || seconds < 0) invalidDuration();
  return selected === 'M' ? String(Number((seconds / 60).toFixed(12))) : String(seconds);
}

const durationText = seconds => `${Math.floor(seconds / 60) ? `${Math.floor(seconds / 60)}m` : ''}${seconds % 60 ? `${seconds % 60}s` : ''}`;
const command = (seconds, target = '') => `- ${durationText(seconds)}${target ? ` @ ${target}` : ''}`;
const group = (count, steps) => `${count > 1 ? `${count}x\n` : ''}${steps.join('\n')}`;

/**
 * A base session has no last rest: series rest replaces the last ordinary rest.
 * The workout grammar is flat, so choose a compact representation that fits it.
 * Conversion failure must only block Advanced; the base engine has wider limits.
 */
export function basicTimerText(config = {}) {
  const resolved = { rounds: 3, work: 180, rest: 60, preparation: 10, series: 1, seriesRest: 60, ...config, infinite: false, warning: false };
  const phases = makePhases(resolved);
  const { rounds, work, rest, preparation, series, seriesRest } = resolved;
  const prefix = preparation ? [command(preparation, 'Préparation')] : [];
  const workCommand = command(work), restCommand = rest ? command(rest, 'Repos') : '', seriesRestCommand = seriesRest ? command(seriesRest, 'Repos') : '';
  const candidates = [];

  // Repeat work/rest within each series, without nesting its surrounding series.
  const byRounds = [...prefix];
  for (let index = 0; index < series; index++) {
    if (rounds > 1) byRounds.push(group(rounds - 1, [workCommand, ...(rest ? [restCommand] : [])]));
    byRounds.push(workCommand);
    if (index < series - 1 && seriesRest) byRounds.push(seriesRestCommand);
  }
  candidates.push(byRounds.join('\n\n'));

  // Repeat a flat, complete series; spell the final series without its last rest.
  const seriesSteps = [];
  for (let round = 0; round < rounds; round++) {
    seriesSteps.push(workCommand);
    if (round < rounds - 1 && rest) seriesSteps.push(restCommand);
  }
  const bySeries = [...prefix];
  if (series > 1) bySeries.push(group(series - 1, [...seriesSteps, ...(seriesRest ? [seriesRestCommand] : [])]));
  bySeries.push(group(1, seriesSteps));
  candidates.push(bySeries.join('\n\n'));

  // When both rests match, all repetitions form one regular sequence.
  if (rest === seriesRest || series === 1) {
    const regular = [...prefix];
    let remaining = rounds * series - 1;
    while (remaining) {
      const count = Math.min(100, remaining);
      regular.push(group(count, [workCommand, ...(rest ? [restCommand] : [])]));
      remaining -= count;
    }
    regular.push(workCommand);
    candidates.push(regular.join('\n\n'));
  }

  for (const text of [...new Set(candidates)].sort((a, b) => a.length - b.length)) {
    try {
      const compiled = compileTimerText(text);
      // Generation must never silently shorten a session at a parser boundary.
      if (compiled.phases.length === phases.length && compiled.phases.every((phase, index) => phase.kind === phases[index].kind && phase.seconds === phases[index].seconds)) return text;
    } catch { /* Try the other flat representation before reporting a limit. */ }
  }
  throw new RangeError('Ces réglages sont trop volumineux pour être convertis en commandes avancées. Réduis les répétitions ou les séries, ou utilise le mode Base qui conserve tous tes réglages.');
}
