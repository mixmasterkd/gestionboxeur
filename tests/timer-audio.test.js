import test from 'node:test';
import assert from 'node:assert/strict';
import { createTimerSignals } from '../js/timer-audio.js';

function fixture({ state = 'suspended', resumeFails = false } = {}) {
  const nodes = [], contexts = [];
  const param = () => ({ value: 1, events: [], setValueAtTime(value, at) { this.events.push({ value, at }); }, exponentialRampToValueAtTime(value, at) { this.events.push({ value, at }); } });
  const node = type => {
    const result = { kind: type, frequency: param(), gain: param(), starts: [], stops: [], connections: [], disconnected: false,
      connect(target) { this.connections.push(target); }, disconnect() { this.disconnected = true; },
      start(at) { this.starts.push(at); }, stop(at) { this.stops.push(at); },
    };
    nodes.push(result); return result;
  };
  class AudioContext {
    constructor() { this.state = state; this.currentTime = 10; this.sampleRate = 48000; this.destination = {}; contexts.push(this); }
    createGain() { return node('gain'); }
    createOscillator() { return node('oscillator'); }
    createBufferSource() { return node('buffer'); }
    createBuffer(channels, length, rate) { return { duration: length / rate, getChannelData: () => new Float32Array(length) }; }
    async resume() { if (resumeFails) throw new Error('Blocked'); this.state = 'running'; }
    async close() { this.state = 'closed'; }
  }
  let unavailable = 0;
  const signals = createTimerSignals({ AudioContext }, () => unavailable++);
  return { signals, nodes, contexts, get unavailable() { return unavailable; }, sources: () => nodes.filter(n => n.kind !== 'gain') };
}

test('audio is lazy and must be unlocked; round and finish signals each strike three times', async () => {
  const app = fixture();
  assert.equal(app.signals.play('phase'), false);
  assert.equal(app.contexts.length, 0);
  assert.equal(await app.signals.unlock(), true);
  assert.equal(app.signals.play('phase'), true);
  const first = app.sources();
  const strikes = first.filter(n => n.kind === 'buffer').map(n => n.starts[0]);
  assert.equal(strikes.length, 3);
  assert.ok(Math.abs(strikes[1] - strikes[0] - .34) < 1e-8);
  assert.ok(Math.abs(strikes[2] - strikes[0] - .68) < 1e-8);
  assert.ok(first.every(n => n.stops[0] > n.starts[0] && n.stops[0] - n.starts[0] < 2));
  assert.equal(app.signals.play('finish'), true);
  assert.ok(first.every(n => n.disconnected), 'a new cue cancels any pending old cue');
  assert.equal(app.sources().filter(n => !n.disconnected && n.kind === 'buffer').length, 3);
  app.signals.destroy();
});

test('warning uses one shorter quieter strike, and cleanup stops future scheduled strikes', async () => {
  const app = fixture();
  await app.signals.unlock();
  app.signals.play('phase');
  const full = app.sources().find(n => n.kind === 'oscillator');
  const fullPeak = full.connections[0].gain.events[1].value;
  app.signals.play('warning');
  const current = app.sources().filter(n => !n.disconnected);
  assert.equal(current.filter(n => n.kind === 'buffer').length, 1);
  const warning = current.find(n => n.kind === 'oscillator');
  assert.ok(warning.connections[0].gain.events[1].value < fullPeak);
  assert.ok(warning.stops[0] - warning.starts[0] < .8);
  app.signals.stop();
  assert.ok(app.sources().every(n => n.disconnected && n.stops.length >= 2));
  app.signals.destroy();
  assert.equal(app.contexts[0].state, 'closed');
  assert.equal(await app.signals.unlock(), false);
  assert.equal(app.signals.play('phase'), false);
});

test('ended voices release their nodes and suspension never queues stale sounds', async () => {
  const app = fixture();
  await app.signals.unlock(); app.signals.play('prepare');
  const first = app.sources();
  for (const source of first) source.onended();
  assert.ok(first.every(n => n.disconnected && n.connections[0].disconnected));
  app.contexts[0].state = 'suspended';
  const count = app.nodes.length;
  assert.equal(app.signals.play('phase'), false);
  assert.equal(app.nodes.length, count);
  assert.equal(await app.signals.unlock(), true);
  assert.equal(app.signals.play('not-a-cue'), false);
  app.signals.destroy();
});

test('unsupported or blocked audio reports gracefully without making the timer throw', async () => {
  let reports = 0;
  const absent = createTimerSignals({}, () => reports++);
  assert.equal(await absent.unlock(), false);
  assert.equal(await absent.unlock(), false);
  assert.equal(reports, 1);
  assert.equal(absent.play('phase'), false); absent.destroy();
  const blocked = fixture({ resumeFails: true });
  assert.equal(await blocked.signals.unlock(), false);
  assert.equal(blocked.signals.play('phase'), false);
  assert.equal(blocked.unavailable, 1); blocked.signals.destroy();
});

test('interval phase and finish use three separate soft beeps without metallic impacts', async () => {
  const app = fixture();
  assert.equal(app.signals.play('phase', 'beep'), false);
  assert.equal(app.contexts.length, 0);
  await app.signals.unlock();
  for (const cue of ['phase', 'finish']) {
    assert.equal(app.signals.play(cue, 'beep'), true);
    const sources = app.sources().filter(n => !n.disconnected);
    assert.equal(sources.length, 3);
    assert.ok(sources.every(n => n.kind === 'oscillator' && n.type === 'sine'));
    assert.ok(sources.every(n => n.frequency.events[0].value === 880));
    assert.ok(Math.abs(sources[1].starts[0] - sources[0].starts[0] - .26) < 1e-8);
    assert.ok(Math.abs(sources[2].starts[0] - sources[0].starts[0] - .52) < 1e-8);
    for (let i = 0; i < sources.length; i++) {
      const source = sources[i], envelope = source.connections[0].gain.events;
      assert.equal(envelope[0].value, .00001);
      assert.ok(envelope[1].value <= .17 && envelope[1].at > source.starts[0]);
      assert.equal(envelope.at(-1).value, .00001);
      assert.ok(source.stops[0] > envelope.at(-1).at);
      if (i < sources.length - 1) assert.ok(source.stops[0] < sources[i + 1].starts[0], 'silence separates the beeps');
    }
  }
  app.signals.stop();
  assert.ok(app.sources().every(n => n.disconnected && n.stops.length >= 2));
  app.signals.destroy();
});

test('interval preparation is brief and switching voices preserves the original boxing bell', async () => {
  const app = fixture();
  await app.signals.unlock();
  app.signals.play('prepare', 'beep');
  const prep = app.sources();
  assert.equal(prep.length, 1);
  assert.ok(prep[0].stops[0] - prep[0].starts[0] <= .11);
  assert.equal(app.signals.play('phase', 'bell'), true);
  assert.ok(prep.every(n => n.disconnected));
  const bell = app.sources().filter(n => !n.disconnected);
  assert.equal(bell.filter(n => n.kind === 'oscillator').length, 18);
  assert.equal(bell.filter(n => n.kind === 'buffer').length, 3);
  assert.equal(bell.find(n => n.kind === 'oscillator').frequency.events[0].value, 620);
  assert.equal(app.signals.play('phase', 'beep'), true);
  assert.ok(bell.every(n => n.disconnected));
  const active = app.sources().filter(n => !n.disconnected);
  assert.equal(app.signals.play('phase', 'not-a-voice'), false);
  assert.equal(app.signals.play('not-a-cue', 'beep'), false);
  assert.ok(active.every(n => !n.disconnected), 'invalid sounds do not interrupt a valid cue');
  app.signals.destroy();
  assert.ok(active.every(n => n.disconnected));
  assert.equal(app.signals.play('finish', 'beep'), false);
});

test('interval beeps do not queue while audio is suspended and release ended nodes', async () => {
  const app = fixture();
  await app.signals.unlock();
  app.signals.play('phase', 'beep');
  for (const source of app.sources()) source.onended();
  assert.ok(app.sources().every(n => n.disconnected && n.connections[0].disconnected));
  app.contexts[0].state = 'suspended';
  const count = app.nodes.length;
  assert.equal(app.signals.play('phase', 'beep'), false);
  assert.equal(app.nodes.length, count);
  assert.equal(await app.signals.unlock(), true);
  assert.equal(app.signals.play('warning', 'beep'), true);
  assert.equal(app.sources().filter(n => !n.disconnected).length, 1);
  app.signals.destroy();
});
