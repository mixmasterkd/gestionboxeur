// Timing starts when the UI reveals the signal, never at a scheduled deadline.
export const COLORS = Object.freeze([
  Object.freeze({ id: 'red', name: 'Rouge', hex: '#ef4444' }),
  Object.freeze({ id: 'blue', name: 'Bleu', hex: '#3b82f6' }),
  Object.freeze({ id: 'yellow', name: 'Jaune', hex: '#facc15' }),
  Object.freeze({ id: 'green', name: 'Vert', hex: '#22c55e' }),
]);

const INPUTS = new Set(['touch', 'mouse', 'keyboard']);
const RUNNING = new Set(['waiting', 'active', 'settling', 'feedback']);
const WAIT_MIN = 1500;
const WAIT_RANGE = 2501;
const RESPONSE_LIMIT = 10000;
const SETTLE_TIME = 100;
const FEEDBACK_TIME = 1100;

export class ReactionGame {
  constructor({ mode = 'simple', rounds = 5, now = () => performance.now(), random = Math.random } = {}) {
    if (!['simple', 'locate', 'choice'].includes(mode) || ![1, 5, 10].includes(rounds)) {
      throw new Error('Réglages du test de réactivité invalides.');
    }
    if (typeof now !== 'function' || typeof random !== 'function') throw new TypeError('Horloge ou hasard invalide.');
    this.mode = mode;
    this.rounds = rounds;
    this.now = now;
    this.random = random;
    this.count = mode === 'simple' ? 1 : 4;
    this.clockTime = -Infinity;
    this.previousWait = null;
    this.reset();
  }

  get active() { return RUNNING.has(this.status); }

  time() {
    const value = this.now();
    if (!Number.isFinite(value)) throw new TypeError('Horloge invalide.');
    // performance.now() is monotonic; also tolerate injected clocks going back.
    this.clockTime = Math.max(this.clockTime, value);
    return this.clockTime;
  }

  pick(count) {
    const value = Number(this.random());
    return Math.max(0, Math.min(count - 1, Math.floor((Number.isFinite(value) ? value : 0) * count)));
  }

  reset() {
    this.status = 'idle';
    this.trial = 0;
    this.target = null;
    this.colors = Array(this.count).fill(null);
    this.results = [];
    this.pending = null;
    this.nextAt = 0;
    this.revealedAt = 0;
  }

  prepare(time) {
    this.trial++;
    this.target = this.pick(COLORS.length);
    this.colors = Array(this.count).fill(null);
    let wait = WAIT_MIN + this.pick(WAIT_RANGE);
    // Even a deterministic random source cannot repeat consecutive delays.
    if (wait === this.previousWait) wait = WAIT_MIN + ((wait - WAIT_MIN + 1) % WAIT_RANGE);
    this.previousWait = wait;
    this.nextAt = time + wait;
    this.revealedAt = 0;
    this.pending = null;
    this.status = 'waiting';
  }

  start() {
    this.reset();
    this.prepare(this.time());
    return this.snapshot();
  }

  reveal() {
    const time = this.time();
    if (this.status !== 'waiting' || time < this.nextAt) return this.snapshot();
    if (this.mode === 'simple') this.colors = [this.target];
    else if (this.mode === 'locate') this.colors[this.pick(this.count)] = this.target;
    else {
      this.colors = COLORS.map((_, index) => index);
      for (let index = this.count - 1; index > 0; index--) {
        const other = this.pick(index + 1);
        [this.colors[index], this.colors[other]] = [this.colors[other], this.colors[index]];
      }
    }
    this.revealedAt = time;
    this.status = 'active';
    return this.snapshot();
  }

  commit(result, time) {
    this.results.push(result);
    this.pending = null;
    this.status = 'feedback';
    this.nextAt = time + FEEDBACK_TIME;
  }

  failure(error, input, time) {
    this.commit({ trial: this.trial, ms: null, error, input }, time);
  }

  tick() {
    const time = this.time();
    if (this.status === 'active' && time - this.revealedAt >= RESPONSE_LIMIT) {
      this.failure('timeout', null, time);
    } else if (this.status === 'settling' && time >= this.nextAt) {
      this.commit(this.pending, time);
    } else if (this.status === 'feedback' && time >= this.nextAt) {
      if (this.trial >= this.rounds) this.status = 'done';
      else this.prepare(time);
    }
    return this.snapshot();
  }

  hit(index, input) {
    this.tick();
    if (!Number.isInteger(index) || index < 0 || index >= this.count || !INPUTS.has(input)) {
      return { ...this.snapshot(), accepted: false, correct: false };
    }
    const time = this.time();
    if (this.status === 'settling') {
      // Touching several targets cannot produce a best time, even if one hit.
      this.pending.ms = null;
      this.pending.error = 'multiple';
      return { ...this.snapshot(), accepted: true, correct: false };
    }
    if (this.status === 'waiting') {
      this.failure('early', input, time);
      return { ...this.snapshot(), accepted: true, correct: false };
    }
    if (this.status !== 'active') return { ...this.snapshot(), accepted: false, correct: false };

    const elapsed = time - this.revealedAt;
    if (elapsed < 1) this.failure('early', input, time);
    else if (this.colors[index] !== this.target) this.failure('wrong', input, time);
    else {
      this.pending = { trial: this.trial, ms: Math.round(elapsed), error: null, input };
      this.status = 'settling';
      this.nextAt = time + SETTLE_TIME;
      return { ...this.snapshot(), accepted: true, correct: true };
    }
    return { ...this.snapshot(), accepted: true, correct: false };
  }

  interrupt() {
    if (this.active) {
      this.status = 'interrupted';
      this.pending = null;
      this.colors = Array(this.count).fill(null);
    }
    return this.snapshot();
  }

  snapshot() {
    const results = this.results.map(result => ({ ...result }));
    const valid = results.filter(result => result.error === null);
    return {
      status: this.status, active: this.active, mode: this.mode, rounds: this.rounds,
      trial: this.trial, target: this.target, colors: [...this.colors], results,
      last: this.pending ? { ...this.pending } : (results.at(-1) || null),
      ready: this.status === 'waiting' && this.time() >= this.nextAt,
      best: valid.length ? Math.min(...valid.map(result => result.ms)) : null,
      average: valid.length ? Math.round(valid.reduce((sum, result) => sum + result.ms, 0) / valid.length) : null,
      errors: results.length - valid.length,
    };
  }
}
