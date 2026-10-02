// Personal memory/reaction games. No trademark, public ranking or medical claim.
export const TARGET_DURATION = 30000;
export const MAX_SEQUENCE = 100;
export function cognitiveModeKey({ variant = 'tiles', count = 6, mode = 'sequence', numbers = true } = {}) {
  if (variant === 'tiles' && [4, 6, 8].includes(count)) return `tiles-${count}`;
  if (variant === 'bag' && ['sequence', 'targets'].includes(mode)) return `bag-${mode}-${numbers ? 'visible' : 'hidden'}`;
  throw new Error('Mode de jeu invalide.');
}

export class CognitiveGame {
  constructor({ variant = 'tiles', count = 6, mode = 'sequence', numbers = true, random = Math.random, now = () => performance.now() } = {}) {
    this.config = { variant, count: variant === 'bag' ? 6 : count, mode: variant === 'tiles' ? 'sequence' : mode, numbers };
    this.key = cognitiveModeKey(this.config); this.random = random; this.now = now; this.reset();
  }
  get active() { return ['showing', 'input', 'success'].includes(this.status); }
  reset() {
    this.status = 'idle'; this.score = 0; this.hits = 0; this.misses = 0;
    this.sequence = []; this.cursor = 0; this.demoIndex = -1; this.lit = null;
    this.target = null; this.flash = null; this.flashUntil = 0; this.nextAt = 0; this.endAt = 0; this.reason = '';
    return this.snapshot();
  }
  pick(exclude = null) {
    const count = this.config.count, size = exclude === null ? count : count - 1;
    const value = Math.max(0, Math.min(size - 1, Math.floor(Number(this.random()) * size) || 0));
    return exclude !== null && value >= exclude ? value + 1 : value;
  }
  start() {
    this.reset();
    if (this.config.mode === 'targets') { this.status = 'input'; this.endAt = this.now() + TARGET_DURATION; this.target = this.pick(); }
    else { this.sequence.push(this.pick()); this.showSequence(); }
    return this.snapshot();
  }
  showSequence() { this.status = 'showing'; this.demoIndex = -1; this.cursor = 0; this.lit = null; this.flash = null; this.nextAt = this.now() + 550; }
  finish(reason = 'complete') { this.status = 'finished'; this.reason = reason; this.lit = null; this.target = null; return this.snapshot(); }
  interrupt() {
    if (this.active) { this.status = 'interrupted'; this.reason = 'hidden'; this.lit = null; this.target = null; this.flash = null; }
    return this.snapshot();
  }
  tick() {
    const time = this.now();
    if (this.flash && time >= this.flashUntil) this.flash = null;
    if (this.config.mode === 'targets' && this.active && time >= this.endAt) this.finish();
    if (this.status === 'success' && time >= this.nextAt) { this.sequence.push(this.pick()); this.showSequence(); }
    if (this.status === 'showing' && time >= this.nextAt) {
      // Never race through missed cues after a background tab or stalled frame.
      if (time - this.nextAt > 1500) return this.interrupt();
      if (this.lit !== null) { this.lit = null; this.nextAt = time + 280; }
      else {
        this.demoIndex++;
        if (this.demoIndex >= this.sequence.length) { this.status = 'input'; this.cursor = 0; }
        else { this.lit = this.sequence[this.demoIndex]; this.nextAt = time + 620; }
      }
    }
    return this.snapshot();
  }
  hit(index) {
    this.tick();
    if (this.status !== 'input' || !Number.isInteger(index) || index < 0 || index >= this.config.count) return { accepted: false, ...this.snapshot() };
    const correct = index === (this.config.mode === 'targets' ? this.target : this.sequence[this.cursor]);
    this.flash = { index, correct }; this.flashUntil = this.now() + 170;
    if (correct) this.hits++; else this.misses++;
    if (this.config.mode === 'targets') {
      this.score = Math.max(0, this.score + (correct ? 1 : -1));
      if (correct) this.target = this.pick(this.target);
    } else if (!correct) this.finish('mistake');
    else if (++this.cursor === this.sequence.length) {
      this.score = this.sequence.length;
      if (this.score >= MAX_SEQUENCE) this.finish();
      else { this.status = 'success'; this.nextAt = this.now() + 650; }
    }
    return { accepted: true, correct, ...this.snapshot() };
  }
  snapshot() {
    return { key: this.key, status: this.status, active: this.active, score: this.score, hits: this.hits, misses: this.misses,
      length: this.sequence.length, cursor: this.cursor, lit: this.lit, target: this.target, flash: this.flash ? { ...this.flash } : null,
      remaining: this.config.mode === 'targets' ? (this.status === 'idle' ? TARGET_DURATION : Math.max(0, this.endAt - this.now())) : null, reason: this.reason };
  }
}
