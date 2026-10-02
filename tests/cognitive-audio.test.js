import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { createCognitiveAudio } from '../js/cognitive-audio.js';
import { mountCognitiveGames } from '../js/cognitive-games.js';

const settle = () => new Promise(resolve => setImmediate(resolve));
function mockAudio({ state = 'running', resume } = {}) {
  const contexts = [], nodes = [];
  const param = () => ({ value: 1, events: [], setValueAtTime(value, at) { this.events.push({ kind: 'set', value, at }); }, exponentialRampToValueAtTime(value, at) { this.events.push({ kind: 'ramp', value, at }); } });
  const node = kind => {
    const value = { kind, frequency: param(), gain: param(), connections: [], starts: [], stops: [], disconnected: false,
      connect(target) { this.connections.push(target); }, disconnect() { this.disconnected = true; }, start(at) { this.starts.push(at); }, stop(at) { this.stops.push(at); },
    };
    nodes.push(value); return value;
  };
  class AudioContext {
    constructor() { this.state = state; this.currentTime = 12; this.sampleRate = 48000; this.destination = {}; this.closeCalls = 0; contexts.push(this); }
    createOscillator() { return node('oscillator'); }
    createGain() { return node('gain'); }
    createBiquadFilter() { return node('filter'); }
    createBufferSource() { return node('noise'); }
    createBuffer(channels, length, rate) { const samples = new Float32Array(length); return { samples, duration: length / rate, getChannelData: () => samples }; }
    async resume() { if (resume) await resume(); this.state = 'running'; }
    async close() { this.closeCalls++; this.state = 'closed'; }
  }
  return { AudioContext, contexts, nodes, sources: () => nodes.filter(node => ['oscillator', 'noise'].includes(node.kind)) };
}

test('the eight tiles produce eight distinct pitched notes with quiet finite attack and decay', async () => {
  const mock = mockAudio(), audio = createCognitiveAudio(mock);
  try {
    audio.play(0); assert.equal(mock.contexts.length, 0, 'audio remains lazy before a user unlock');
    assert.equal(await audio.unlock(), true);
    const pitches = [];
    for (let index = 0; index < 8; index++) {
      audio.play(index);
      const active = mock.sources().filter(source => !source.disconnected);
      assert.equal(active.length, 1); assert.equal(active[0].kind, 'oscillator'); assert.equal(active[0].type, 'sine');
      const source = active[0], envelope = source.connections[0].gain.events;
      pitches.push(source.frequency.events[0].value);
      assert.ok(envelope[0].value < .001);
      assert.ok(envelope[1].value > 0 && envelope[1].value <= .15 && envelope[1].at > envelope[0].at);
      assert.ok(envelope.at(-1).value < .001 && envelope.at(-1).at > envelope[1].at);
      assert.ok(source.stops[0] > envelope.at(-1).at && source.stops[0] < mock.contexts[0].currentTime + 1);
    }
    assert.equal(new Set(pitches).size, 8); assert.ok(pitches.every((pitch, index) => index === 0 || pitch > pitches[index - 1]));
    assert.ok(mock.sources().slice(0, -1).every(source => source.disconnected && source.stops.length === 2), 'a new cue cancels the previous voice');
  } finally { audio.destroy(); }
});

test('bag hits combine a lower falling impact with a short damped low-pass noise transient', async () => {
  const mock = mockAudio(), audio = createCognitiveAudio(mock);
  try {
    await audio.unlock(); audio.play(0); const tileFrequency = mock.sources()[0].frequency.events[0].value;
    for (const index of [0, 5]) {
      audio.play(index, 'bag');
      const active = mock.sources().filter(source => !source.disconnected);
      assert.equal(active.length, 2);
      const impact = active.find(source => source.kind === 'oscillator'), noise = active.find(source => source.kind === 'noise');
      assert.ok(impact.frequency.events[0].value < tileFrequency);
      assert.ok(impact.frequency.events[1].value < impact.frequency.events[0].value);
      assert.ok(impact.frequency.events[1].at > impact.frequency.events[0].at);
      const envelope = impact.connections[0].gain.events;
      assert.ok(envelope[1].value <= .3 && envelope.at(-1).value < .001);
      assert.ok(envelope.at(-1).at - envelope[0].at < .25);
      const filter = noise.connections[0]; assert.equal(filter.kind, 'filter'); assert.equal(filter.type, 'lowpass');
      assert.ok(filter.frequency.value <= 1000); assert.ok(filter.connections[0].gain.value <= .35);
      assert.ok(noise.buffer.duration <= .12); assert.ok(noise.stops[0] - mock.contexts[0].currentTime <= .13);
      const samples = noise.buffer.samples;
      assert.ok(samples.some(sample => sample !== 0));
      assert.ok(Math.max(...samples.slice(-50).map(Math.abs)) < .002, 'the noise impact decays to silence');
      for (const source of active) source.onended();
      assert.ok(active.every(source => source.disconnected && source.connections[0].disconnected));
      assert.equal(filter.connections[0].disconnected, true, 'ended noise also releases its output gain');
    }
  } finally { audio.destroy(); }
});

test('stop and destroy cancel all voices; destroyed audio cannot resume or create sounds', async () => {
  const mock = mockAudio(), audio = createCognitiveAudio(mock);
  await audio.unlock(); audio.play(3, 'bag'); audio.stop();
  assert.ok(mock.sources().every(source => source.disconnected && source.stops.length === 2));
  audio.play(1, 'bag'); audio.destroy();
  assert.ok(mock.sources().every(source => source.disconnected && source.stops.length === 2));
  const count = mock.nodes.length;
  assert.equal(mock.contexts[0].closeCalls, 1); assert.equal(await audio.unlock(), false);
  audio.play(0); audio.destroy(); assert.equal(mock.nodes.length, count); assert.equal(mock.contexts[0].closeCalls, 1);
});

test('missing, refused or suspended audio remains optional and does not queue invalid or stale sounds', async () => {
  let unavailable = 0;
  const absent = createCognitiveAudio({}, () => unavailable++);
  assert.equal(await absent.unlock(), false); assert.equal(unavailable, 1); assert.doesNotThrow(() => absent.play(0)); absent.destroy();
  const rejected = mockAudio({ state: 'suspended', resume: async () => { throw new Error('Audio blocked'); } });
  const refused = createCognitiveAudio(rejected, () => unavailable++);
  assert.equal(await refused.unlock(), false); refused.play(0); assert.equal(rejected.sources().length, 0); assert.equal(unavailable, 2); refused.destroy();
  const mock = mockAudio(), audio = createCognitiveAudio(mock);
  await audio.unlock();
  for (const index of [-1, 8, 1.5, null, NaN, '1']) audio.play(index);
  assert.equal(mock.sources().length, 0);
  mock.contexts[0].state = 'suspended'; audio.play(0, 'bag'); assert.equal(mock.sources().length, 0);
  assert.equal(await audio.unlock(), true); audio.play(0); assert.equal(mock.sources().length, 1); audio.destroy();
});

test('destroy during a delayed unlock leaves no playing voices and no reopening', async () => {
  let complete;
  const gate = new Promise(resolve => { complete = resolve; });
  const mock = mockAudio({ state: 'suspended', resume: () => gate }), audio = createCognitiveAudio(mock);
  const unlocking = audio.unlock(); audio.play(1); audio.destroy(); complete();
  assert.equal(await unlocking, false); audio.play(1);
  assert.equal(mock.sources().length, 0); assert.equal(mock.contexts[0].closeCalls, 1); assert.equal(await audio.unlock(), false);
});

test('muting the real cognitive game immediately stops a note and suppresses further note and hit sounds', async () => {
  const window = new Window({ url: 'https://example.test/tools.html', settings: { disableJavaScriptEvaluation: true, disableCSSFileLoading: true } });
  const mock = mockAudio(); window.AudioContext = mock.AudioContext;
  const host = window.document.createElement('div'); window.document.body.append(host);
  let time = 0;
  const ui = mountCognitiveGames(host, { now: () => time, random: () => 0, autoTick: false, store: { demo: true, async listRecords() { return []; }, async saveRecord(mode, score) { return { mode, score }; } } });
  const $ = id => host.querySelector(`#${id}`);
  try {
    await settle(); $('cognitiveStart').click(); await settle(); time = 550; ui.tick();
    assert.equal(mock.sources().length, 1); assert.equal(mock.sources()[0].disconnected, false);
    $('cognitiveSound').checked = false; $('cognitiveSound').dispatchEvent(new window.Event('change'));
    assert.ok(mock.sources().every(source => source.disconnected));
    time = 1170; ui.tick(); time = 1450; ui.tick();
    host.querySelector('[data-index="0"]').click();
    assert.equal(mock.sources().length, 1, 'muted correct hits do not create any new sound');
  } finally { ui.destroy(); await window.happyDOM.abort(); }
});
