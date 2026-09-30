/** Elapsed time comes from timestamps, never from the number of timer callbacks. */
export function makePhases({ rounds = 3, work = 180, rest = 60, preparation = 10, warning = false } = {}) {
  if (![rounds, work, rest, preparation].every(Number.isInteger) || rounds < 1 || rounds > 99 || work < 1 || work > 3600 || rest < 0 || rest > 3600 || preparation < 0 || preparation > 60) throw new RangeError('Vérifie les durées et le nombre de rounds.');
  const phases = [];
  if (preparation) phases.push({ kind: 'prepare', seconds: preparation, round: 1, warning: false });
  for (let round = 1; round <= rounds; round++) {
    phases.push({ kind: 'work', seconds: work, round, warning: Boolean(warning && work > 30) });
    if (round < rounds && rest) phases.push({ kind: 'rest', seconds: rest, round, warning: false });
  }
  return phases;
}

export class RoundTimer {
  constructor(phases, now = () => performance.now()) {
    this.now = now;
    this.configure(phases);
  }
  configure(phases) {
    if (!phases?.length || phases.some(p => !Number.isFinite(p.seconds) || p.seconds <= 0)) throw new RangeError('Une durée positive est nécessaire.');
    let start = 0;
    this.phases = phases.map(phase => { const next = { ...phase, start, end: start + phase.seconds * 1000 }; start = next.end; return next; });
    this.total = start;
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
  snapshot() {
    const elapsed = Math.min(this.total, this.elapsed + (this.status === 'running' ? Math.max(0, this.now() - this.startedAt) : 0));
    if (elapsed >= this.total) { this.elapsed = this.total; this.startedAt = null; this.status = 'done'; }
    const index = this.status === 'done' ? this.phases.length - 1 : this.phases.findIndex(phase => elapsed < phase.end);
    const phase = this.phases[index];
    return { status: this.status, elapsed, total: this.total, index, phase, remaining: Math.max(0, phase.end - elapsed), progress: Math.min(1, Math.max(0, (elapsed - phase.start) / (phase.end - phase.start))) };
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
