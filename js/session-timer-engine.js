/** Timestamp-based playback. A manual step is a hard boundary, even after throttling. */
export class SessionTimer {
  constructor(phases, now = () => performance.now()) {
    if (!Array.isArray(phases) || !phases.length || phases.length > 10000 || phases.some(p => !p || (p.manual !== true && !(Number.isFinite(p.seconds) && p.seconds > 0)) || p.manual === true && p.seconds !== null)) throw new Error('Les étapes du timer sont invalides.');
    this.phases = phases.map(p => ({ ...p }));
    this.now = now;
    this.timedTotal = phases.reduce((sum, p) => sum + (p.seconds || 0) * 1000, 0);
    this.reset();
  }
  reset() { this.index = 0; this.elapsed = 0; this.phaseElapsed = 0; this.at = null; this.status = 'idle'; return this.snapshot(); }
  sync() {
    if (this.status !== 'running') return;
    const at = this.now();
    let delta = Math.max(0, at - this.at); this.at = at;
    while (this.status === 'running') {
      const phase = this.phases[this.index];
      if (phase.manual) { this.phaseElapsed += delta; this.elapsed += delta; break; }
      const consumed = Math.min(delta, Math.max(0, phase.seconds * 1000 - this.phaseElapsed));
      this.phaseElapsed += consumed; this.elapsed += consumed; delta -= consumed;
      if (this.phaseElapsed < phase.seconds * 1000) break;
      if (this.index === this.phases.length - 1) { this.status = 'done'; this.at = null; break; }
      this.index++; this.phaseElapsed = 0;
    }
  }
  start() {
    if (this.status === 'done') this.reset();
    if (this.status !== 'running') { this.at = this.now(); this.status = 'running'; }
    return this.snapshot();
  }
  pause() { this.sync(); if (this.status === 'running') { this.status = 'paused'; this.at = null; } return this.snapshot(); }
  advance() {
    this.sync();
    if (this.status !== 'running' || !this.phases[this.index].manual) return this.snapshot();
    if (this.index === this.phases.length - 1) { this.status = 'done'; this.at = null; }
    else { this.index++; this.phaseElapsed = 0; this.at = this.now(); }
    return this.snapshot();
  }
  snapshot() {
    this.sync();
    const phase = this.phases[this.index];
    return { status: this.status, index: this.index, phase, elapsed: this.elapsed, phaseElapsed: this.phaseElapsed,
      nextPhase: this.status === 'done' ? null : this.phases[this.index + 1] || null,
      remaining: phase.manual ? null : Math.max(0, phase.seconds * 1000 - this.phaseElapsed),
      progress: phase.manual ? 0 : Math.min(1, this.phaseElapsed / (phase.seconds * 1000)) };
  }
}
