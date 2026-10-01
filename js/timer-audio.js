// Cloche de ring et bips d'intervalle synthétisés localement, sans piste à télécharger.
const modes = [
  [1, 1, 1.65], [1.505, .57, 1.28], [2.08, .38, 1.02],
  [2.69, .24, .75], [3.95, .13, .48], [5.42, .07, .29],
];
const cues = {
  phase: { strikes: [0, .34, .68], strength: 1, tail: 1, pitch: 1 },
  finish: { strikes: [0, .34, .68], strength: 1, tail: 1, pitch: 1 },
  warning: { strikes: [0], strength: .44, tail: .42, pitch: 1.35 },
  prepare: { strikes: [0], strength: .3, tail: .42, pitch: 1 },
};
const beepCues = {
  phase: { strikes: [0, .26, .52], strength: .17, duration: .14, frequency: 880 },
  finish: { strikes: [0, .26, .52], strength: .17, duration: .14, frequency: 880 },
  warning: { strikes: [0], strength: .12, duration: .1, frequency: 1040 },
  prepare: { strikes: [0], strength: .12, duration: .09, frequency: 740 },
};

/** Unlock from a user gesture; stop cancels even strikes scheduled in the future. */
export function createTimerSignals(view, onUnavailable = () => {}) {
  let context, output, hammer, unlocked = false, destroyed = false, reported = false;
  const voices = new Set();
  const unavailable = () => { if (!destroyed && !reported) { reported = true; onUnavailable(); } };

  function graph() {
    const Audio = view.AudioContext || view.webkitAudioContext;
    if (!Audio) throw new Error('Audio indisponible');
    context = new Audio();
    output = context.createGain();
    output.gain.value = .7;
    output.connect(context.destination);
    hammer = context.createBuffer(1, Math.ceil(context.sampleRate * .022), context.sampleRate);
    const samples = hammer.getChannelData(0);
    // A tiny damped impact gives the resonances a hammer attack instead of a beep.
    for (let i = 0; i < samples.length; i++) {
      const envelope = Math.exp(-8 * i / samples.length);
      samples[i] = (Math.random() * 2 - 1) * envelope;
    }
  }

  function voice(source, gain, at, duration) {
    const entry = { source, gain };
    entry.clean = () => {
      source.onended = null;
      source.disconnect(); gain.disconnect(); voices.delete(entry);
    };
    voices.add(entry);
    source.onended = entry.clean;
    source.connect(gain); gain.connect(output);
    source.start(at); source.stop(at + duration);
  }

  function strike(at, cue) {
    // Inharmonic, independently damped modes produce the metallic bell body.
    // Conservative gains leave headroom even while all three strikes overlap.
    for (const [ratio, weight, decay] of modes) {
      const oscillator = context.createOscillator(), gain = context.createGain();
      const duration = decay * cue.tail;
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(620 * ratio * cue.pitch, at);
      gain.gain.setValueAtTime(.00001, at);
      gain.gain.exponentialRampToValueAtTime(.14 * weight * cue.strength, at + .002);
      gain.gain.exponentialRampToValueAtTime(.00001, at + duration);
      voice(oscillator, gain, at, duration + .025);
    }
    const impact = context.createBufferSource(), impactGain = context.createGain();
    impact.buffer = hammer;
    impactGain.gain.setValueAtTime(.06 * cue.strength, at);
    voice(impact, impactGain, at, hammer.duration);
  }

  function beep(at, cue) {
    const oscillator = context.createOscillator(), gain = context.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(cue.frequency, at);
    // A soft attack and short release avoid clicks; the gaps keep each beep distinct.
    gain.gain.setValueAtTime(.00001, at);
    gain.gain.exponentialRampToValueAtTime(cue.strength, at + .012);
    gain.gain.setValueAtTime(cue.strength, at + cue.duration * .55);
    gain.gain.exponentialRampToValueAtTime(.00001, at + cue.duration);
    voice(oscillator, gain, at, cue.duration + .01);
  }

  function stop() {
    for (const entry of [...voices]) {
      try { entry.source.stop(); } catch { /* A source may already have ended. */ }
      entry.clean();
    }
  }

  return {
    async unlock() {
      if (destroyed) return false;
      try {
        if (!context || context.state === 'closed') graph();
        if (context.state !== 'running') await context.resume();
        if (destroyed) return false;
        if (context.state !== 'running') throw new Error('Audio suspendu');
        unlocked = true; reported = false;
        return true;
      } catch { unlocked = false; unavailable(); return false; }
    },
    play(name, sound = 'bell') {
      if (destroyed || !unlocked || context?.state !== 'running' || !Object.hasOwn(cues, name) || !['bell', 'beep'].includes(sound)) return false;
      try {
        stop();
        const cue = (sound === 'beep' ? beepCues : cues)[name], start = context.currentTime + .008;
        const emit = sound === 'beep' ? beep : strike;
        for (const offset of cue.strikes) emit(start + offset, cue);
        return true;
      } catch { stop(); unavailable(); return false; }
    },
    stop,
    destroy() {
      if (destroyed) return;
      destroyed = true; unlocked = false;
      stop(); output?.disconnect();
      if (context && context.state !== 'closed') {
        try { Promise.resolve(context.close()).catch(() => {}); } catch { /* Already unavailable. */ }
      }
      hammer = null;
    },
  };
}
