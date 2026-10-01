/** Elapsed time comes from timestamps, never from the number of timer callbacks. */
export function makePhases({ rounds = 3, work = 180, rest = 60, preparation = 10, warning = false, infinite = false, series = 1, seriesRest = 60 } = {}) {
  if (![rounds, work, rest, preparation, series, seriesRest].every(Number.isInteger) || rounds < 1 || rounds > 99 || work < 1 || work > 3600 || rest < 0 || rest > 3600 || preparation < 0 || preparation > 60 || series < 1 || series > 99 || seriesRest < 0 || seriesRest > 3600 || typeof infinite !== 'boolean' || (infinite && series !== 1)) throw new RangeError('Vérifie les durées, les rounds et les séries.');
  const phases = [];
  if (preparation) phases.push({ kind: 'prepare', seconds: preparation, round: 1, series: 1, warning: false });
  if (infinite) {
    Object.defineProperties(phases, { repeatFrom: { value: phases.length }, repeatRoundStep: { value: 1 } });
    phases.push({ kind: 'work', seconds: work, round: 1, series: 1, warning: Boolean(warning && work > 30) });
    if (rest) phases.push({ kind: 'rest', seconds: rest, round: 1, series: 1, warning: false });
    return phases;
  }
  for (let currentSeries = 1; currentSeries <= series; currentSeries++) {
    for (let round = 1; round <= rounds; round++) {
      phases.push({ kind: 'work', seconds: work, round, series: currentSeries, warning: Boolean(warning && work > 30) });
      if (round < rounds && rest) phases.push({ kind: 'rest', seconds: rest, round, series: currentSeries, warning: false });
    }
    if (currentSeries < series && seriesRest) phases.push({ kind: 'rest', seconds: seriesRest, round: rounds, series: currentSeries, seriesRest: true, warning: false });
  }
  return phases;
}

export class RoundTimer {
  constructor(phases, now = () => performance.now()) {
    this.now = now;
    this.configure(phases);
  }
  configure(phases) {
    if (!Array.isArray(phases) || !phases.length || phases.length > 20000 || Array.from(phases).some(p => !p || !Number.isFinite(p.seconds) || p.seconds <= 0)) throw new RangeError('Une durée positive est nécessaire (20 000 étapes maximum).');
    const repeatFrom = phases.repeatFrom ?? null;
    const repeatRoundStep = phases.repeatRoundStep ?? 1;
    if (repeatFrom !== null && (!Number.isInteger(repeatFrom) || repeatFrom < 0 || repeatFrom >= phases.length || !Number.isInteger(repeatRoundStep) || repeatRoundStep < 1)) throw new RangeError('Le cycle du timer est invalide.');
    let start = 0;
    const timeline = phases.map(phase => {
      const next = { ...phase, start, end: start + phase.seconds * 1000 };
      if (!Number.isFinite(next.end) || next.end > Number.MAX_SAFE_INTEGER || next.end <= start) throw new RangeError('La durée totale du timer est trop grande.');
      start = next.end;
      return next;
    });
    this.phases = timeline;
    this.repeatFrom = repeatFrom;
    this.repeatRoundStep = repeatRoundStep;
    this.repeatStart = repeatFrom === null ? null : timeline[repeatFrom].start;
    this.cycleDuration = repeatFrom === null ? null : start - this.repeatStart;
    this.total = repeatFrom === null ? start : Infinity;
    this.reset();
  }
  reset() { this.elapsed = 0; this.startedAt = null; this.status = 'idle'; return this.snapshot(); }
  start() {
    if (this.status === 'done') this.reset();
    if (this.status !== 'running') { this.startedAt = this.now(); this.status = 'running'; }
    return this.snapshot();
  }
  pause() {
    const state = this.snapshot();
    if (this.status === 'running') { this.elapsed = state.elapsed; this.startedAt = null; this.status = 'paused'; }
    return this.snapshot();
  }
  phaseAt(elapsed) {
    let position = elapsed, cycle = 0;
    if (this.repeatFrom !== null && elapsed >= this.repeatStart) {
      cycle = Math.floor((elapsed - this.repeatStart) / this.cycleDuration);
      position = this.repeatStart + (elapsed - this.repeatStart) % this.cycleDuration;
    }
    // Binary search also keeps long, user-authored workouts cheap to display.
    let low = 0, high = this.phases.length - 1;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (position < this.phases[middle].end) high = middle;
      else low = middle + 1;
    }
    const base = this.phases[low];
    const shift = cycle * (this.cycleDuration || 0);
    const phase = cycle ? { ...base, start: base.start + shift, end: base.end + shift, ...(Number.isFinite(base.round) ? { round: base.round + cycle * this.repeatRoundStep } : {}) } : base;
    return { phase, index: low + (this.repeatFrom === null ? 0 : cycle * (this.phases.length - this.repeatFrom)) };
  }
  snapshot() {
    const elapsed = Math.min(this.total, this.elapsed + (this.status === 'running' ? Math.max(0, this.now() - this.startedAt) : 0));
    if (elapsed >= this.total) { this.elapsed = this.total; this.startedAt = null; this.status = 'done'; }
    const { index, phase } = this.phaseAt(elapsed);
    const nextPhase = this.status === 'done' || phase.end >= this.total ? null : this.phaseAt(phase.end).phase;
    return { status: this.status, elapsed, total: this.total, index, phase, nextPhase, remaining: Math.max(0, phase.end - elapsed), progress: Math.min(1, Math.max(0, (elapsed - phase.start) / (phase.end - phase.start))) };
  }
}

/** Only cue the current event after throttling; never replay missed bells in a burst. */
export function timerCue(previous, current) {
  if (!previous || previous.status !== 'running') return null;
  if (current.status === 'done') return 'finish';
  if (current.index !== previous.index) return 'phase';
  if (current.phase.warning && previous.remaining > 30000 && current.remaining <= 30000 && current.remaining > 28500) return 'warning';
  return null;
}

export function formatTime(milliseconds) {
  if (milliseconds === Infinity) return '∞';
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

export class StepCounter {
  constructor(now = () => performance.now()) { this.now = now; this.reset(); }
  reset() { this.count = 0; this.first = null; this.last = null; }
  tap() { const at = this.now(); if (!this.count) this.first = at; this.last = at; this.count++; return this.snapshot(); }
  snapshot() {
    const elapsed = this.count > 1 ? Math.max(0, this.last - this.first) : 0;
    // The first tap marks the start: n taps contain n−1 step intervals.
    return { count: this.count, elapsed, cadence: elapsed > 0 ? Math.round((this.count - 1) * 60000 / elapsed) : null };
  }
}
