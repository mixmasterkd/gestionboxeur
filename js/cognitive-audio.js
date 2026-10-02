const notes = [261.63, 329.63, 392, 523.25, 659.25, 783.99, 880, 1046.5];
/** Quiet synthesised notes / damped impacts; visual gameplay never depends on audio. */
export function createCognitiveAudio(view, onUnavailable = () => {}) {
  let context, destroyed = false;
  const voices = new Set();
  function stop() {
    for (const voice of [...voices]) { try { voice.source.stop(); } catch {} voice.clean(); }
  }
  function voice(source, gain, extra, duration) {
    const entry = { source, clean() { source.onended = null; source.disconnect(); gain.disconnect(); extra?.disconnect(); voices.delete(entry); } };
    voices.add(entry); source.onended = entry.clean;
    if (extra) { source.connect(extra); extra.connect(gain); } else source.connect(gain);
    gain.connect(context.destination); source.start(); source.stop(context.currentTime + duration);
  }
  return {
    async unlock() {
      if (destroyed) return false;
      try {
        const Audio = view.AudioContext || view.webkitAudioContext;
        if (!Audio) throw new Error('Audio indisponible');
        context ||= new Audio(); if (context.state !== 'running') await context.resume();
        return !destroyed && context.state === 'running';
      } catch { if (!destroyed) onUnavailable(); return false; }
    },
    play(index, kind = 'tiles') {
      if (destroyed || context?.state !== 'running' || !Number.isInteger(index) || index < 0 || index > 7) return;
      try {
        stop(); const at = context.currentTime;
        const source = context.createOscillator(), gain = context.createGain();
        source.type = 'sine'; source.frequency.setValueAtTime(kind === 'bag' ? 125 + index * 4 : notes[index], at);
        if (kind === 'bag') source.frequency.exponentialRampToValueAtTime(45, at + .14);
        gain.gain.setValueAtTime(.0001, at); gain.gain.exponentialRampToValueAtTime(kind === 'bag' ? .3 : .12, at + .008);
        gain.gain.exponentialRampToValueAtTime(.0001, at + (kind === 'bag' ? .19 : .32));
        voice(source, gain, null, .35);
        if (kind === 'bag') {
          const length = Math.ceil(context.sampleRate * .11), buffer = context.createBuffer(1, length, context.sampleRate);
          const samples = buffer.getChannelData(0); for (let i = 0; i < length; i++) samples[i] = (Math.random() * 2 - 1) * Math.exp(-7 * i / length);
          const noise = context.createBufferSource(), envelope = context.createGain(), filter = context.createBiquadFilter();
          noise.buffer = buffer; envelope.gain.value = .35; filter.type = 'lowpass'; filter.frequency.value = 800;
          voice(noise, envelope, filter, .12);
        }
      } catch { stop(); onUnavailable(); }
    },
    stop,
    destroy() { destroyed = true; stop(); if (context && context.state !== 'closed') { try { Promise.resolve(context.close()).catch(() => {}); } catch {} } },
  };
}
