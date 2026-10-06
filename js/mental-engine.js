const boundedRandom = (random, size) => Math.max(0, Math.min(size - 1, Math.floor((Number(random()) || 0) * size)));
function shuffle(values, random) {
  for (let i = values.length - 1; i > 0; i--) { const j = boundedRandom(random, i + 1); [values[i], values[j]] = [values[j], values[i]]; }
  return values;
}
export const MEMORY_MAX_LEVEL = 30;
export function memoryDifficulty(level) {
  return { count: Math.min(16, 3 + Math.floor((level - 1) / 2)), exposure: Math.max(800, 2800 - (level - 1) * 100) };
}

export class VisualMemoryGame {
  constructor({ now = () => performance.now(), random = Math.random } = {}) { this.now = now; this.random = random; this.reset(); }
  get active() { return ['showing', 'input', 'success'].includes(this.status); }
  reset() { this.status = 'idle'; this.level = 1; this.maxLevel = 0; this.lives = 3; this.errors = 0; this.pattern = []; this.found = new Set(); this.wrong = new Set(); this.nextAt = 0; }
  round() {
    const difficulty = memoryDifficulty(this.level);
    this.pattern = shuffle(Array.from({ length: 36 }, (_, i) => i), this.random).slice(0, difficulty.count);
    this.found.clear(); this.wrong.clear(); this.status = 'showing'; this.nextAt = this.now() + difficulty.exposure;
  }
  start() { this.reset(); this.round(); return this.snapshot(); }
  tick() {
    if (this.status === 'showing' && this.now() >= this.nextAt) {
      if (this.now() - this.nextAt > 1500) return this.interrupt();
      this.status = 'input';
    } else if (this.status === 'success' && this.now() >= this.nextAt) { this.level++; this.round(); }
    return this.snapshot();
  }
  hit(index) {
    this.tick();
    if (this.status !== 'input' || !Number.isInteger(index) || index < 0 || index > 35 || this.found.has(index) || this.wrong.has(index)) return { accepted: false, ...this.snapshot() };
    const correct = this.pattern.includes(index);
    if (correct) {
      this.found.add(index);
      if (this.found.size === this.pattern.length) {
        this.maxLevel = this.level;
        this.status = this.level === MEMORY_MAX_LEVEL ? 'done' : 'success'; this.nextAt = this.now() + 700;
      }
    } else { this.wrong.add(index); this.errors++; if (--this.lives === 0) this.status = 'done'; }
    return { accepted: true, correct, ...this.snapshot() };
  }
  interrupt() { if (this.active) this.status = 'interrupted'; return this.snapshot(); }
  result(date = new Date().toISOString()) { return { levelReached: this.level, maxLevel: this.maxLevel, errors: this.errors, date }; }
  snapshot() { return { status: this.status, active: this.active, level: this.level, maxLevel: this.maxLevel, lives: this.lives, errors: this.errors, pattern: [...this.pattern], found: [...this.found], wrong: [...this.wrong], ...memoryDifficulty(this.level) }; }
}

export const DUAL_STIMULI = 30;
export function countingPrecision(count, answer) { return Math.max(0, Math.round(100 * (1 - Math.abs(count - answer) / Math.max(1, count)))); }
export function dualScore({ points, targetsMissed, inhibitionErrors, triangleError }) { return Math.max(0, points - targetsMissed * 10 - inhibitionErrors * 15 - triangleError * 10); }
export class DualTaskGame {
  constructor({ now = () => performance.now(), random = Math.random } = {}) { this.now = now; this.random = random; this.reset(); }
  get active() { return ['waiting', 'stimulus', 'gap', 'answer'].includes(this.status); }
  reset() {
    this.status = 'idle'; this.index = 0; this.types = []; this.stimulus = null; this.reactions = [];
    this.targetsMissed = 0; this.inhibitionErrors = 0; this.triangleCount = 0; this.triangleAnswer = null;
    this.points = 0; this.nextAt = 0; this.flash = ''; this.responded = false;
  }
  start() {
    this.reset(); const triangles = 8 + boundedRandom(this.random, 5);
    this.types = shuffle(Array.from({ length: DUAL_STIMULI }, (_, i) => i < triangles ? 'triangle' : 'circle'), this.random);
    this.status = 'waiting'; this.nextAt = this.now() + 600; return this.snapshot();
  }
  reveal() {
    if (this.status !== 'waiting' || this.now() < this.nextAt) return this.snapshot();
    this.stimulus = { type: this.types[this.index], x: 10 + boundedRandom(this.random, 81), y: 12 + boundedRandom(this.random, 77) };
    if (this.stimulus.type === 'triangle') this.triangleCount++;
    this.index++; this.responded = false; this.flash = ''; this.revealedAt = this.now();
    this.nextAt = this.revealedAt + 750 + boundedRandom(this.random, 401); this.status = 'stimulus'; return this.snapshot();
  }
  tick() {
    const time = this.now();
    if (['waiting', 'stimulus', 'gap'].includes(this.status) && time - this.nextAt > 1500) return this.interrupt();
    if (this.status === 'stimulus' && time >= this.nextAt) {
      if (this.stimulus.type === 'circle' && !this.responded) this.targetsMissed++;
      this.stimulus = null; this.flash = ''; this.status = 'gap'; this.nextAt = time + 220 + boundedRandom(this.random, 381);
    } else if (this.status === 'gap' && time >= this.nextAt) {
      this.status = this.index === DUAL_STIMULI ? 'answer' : 'waiting'; this.nextAt = time;
    }
    return this.snapshot();
  }
  hit() {
    this.tick();
    if (this.status !== 'stimulus' || this.responded) return { accepted: false, ...this.snapshot() };
    this.responded = true;
    if (this.stimulus.type === 'circle') {
      const ms = Math.max(1, Math.round(this.now() - this.revealedAt)); this.reactions.push(ms);
      this.points += 10 + Math.round(10 * Math.max(0, 1 - ms / 1000)); this.flash = 'correct';
    } else { this.inhibitionErrors++; this.flash = 'wrong'; }
    return { accepted: true, ...this.snapshot() };
  }
  answer(value) {
    if (this.status !== 'answer' || !Number.isInteger(value) || value < 0 || value > DUAL_STIMULI) return false;
    this.triangleAnswer = value; this.status = 'done'; return true;
  }
  interrupt() { if (this.active) { this.status = 'interrupted'; this.stimulus = null; } return this.snapshot(); }
  result(date = new Date().toISOString()) {
    const triangleError = this.triangleAnswer === null ? null : Math.abs(this.triangleCount - this.triangleAnswer);
    return { score: dualScore({ ...this, triangleError: triangleError || 0 }), averageReactionTime: this.reactions.length ? Math.round(this.reactions.reduce((a, b) => a + b, 0) / this.reactions.length) : null,
      bestReactionTime: this.reactions.length ? Math.min(...this.reactions) : null, targetsHit: this.reactions.length, targetsMissed: this.targetsMissed,
      inhibitionErrors: this.inhibitionErrors, triangleCount: this.triangleCount, triangleAnswer: this.triangleAnswer, triangleError,
      precision: this.triangleAnswer === null ? null : countingPrecision(this.triangleCount, this.triangleAnswer), date };
  }
  snapshot() { return { status: this.status, active: this.active, index: this.index, total: DUAL_STIMULI, stimulus: this.stimulus ? { ...this.stimulus } : null, responded: this.responded, flash: this.flash, ready: this.status === 'waiting' && this.now() >= this.nextAt }; }
}
