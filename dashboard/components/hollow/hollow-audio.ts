/**
 * Tiny Web Audio drone. Created synchronously from the toggle click so the
 * browser still counts it as a user gesture. Stays suspended until that
 * gesture, and suspends again when the tab is hidden.
 */

let ctx: AudioContext | null = null;
let creakTimer = 0;
let nodes: AudioNode[] = [];
let releaseTimer = 0;

export function startHollowSound(): void {
  if (typeof window === "undefined") return;
  window.clearTimeout(releaseTimer);
  releaseTimer = 0;
  if (ctx) {
    void ctx.resume();
    return;
  }
  ctx = new AudioContext();
  const master = ctx.createGain();
  master.gain.value = 0.04;
  master.connect(ctx.destination);

  const lowpass = ctx.createBiquadFilter();
  lowpass.type = "lowpass";
  lowpass.frequency.value = 160;
  lowpass.connect(master);

  const drone = ctx.createOscillator();
  drone.type = "sawtooth";
  drone.frequency.value = 47;
  const g1 = ctx.createGain();
  g1.gain.value = 0.22;
  drone.connect(g1);
  g1.connect(lowpass);
  drone.start();

  const detune = ctx.createOscillator();
  detune.type = "sawtooth";
  detune.frequency.value = 47.65;
  const g2 = ctx.createGain();
  g2.gain.value = 0.16;
  detune.connect(g2);
  g2.connect(lowpass);
  detune.start();

  const under = ctx.createOscillator();
  under.type = "triangle";
  under.frequency.value = 31.2;
  const g3 = ctx.createGain();
  g3.gain.value = 0.2;
  under.connect(g3);
  g3.connect(lowpass);
  under.start();

  const windSeconds = 2;
  const windBuffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * windSeconds), ctx.sampleRate);
  const windData = windBuffer.getChannelData(0);
  for (let i = 0; i < windData.length; i++) windData[i] = Math.random() * 2 - 1;
  const wind = ctx.createBufferSource();
  wind.buffer = windBuffer;
  wind.loop = true;
  const windFilter = ctx.createBiquadFilter();
  windFilter.type = "bandpass";
  windFilter.frequency.value = 520;
  windFilter.Q.value = 0.6;
  const windGain = ctx.createGain();
  windGain.gain.value = 0.045;
  wind.connect(windFilter);
  windFilter.connect(windGain);
  windGain.connect(master);
  wind.start();

  nodes = [drone, detune, under, wind, g1, g2, g3, windGain, lowpass, master];

  const creak = () => {
    if (!ctx) return;
    const dur = 0.28;
    const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 180 + Math.random() * 90;
    filter.Q.value = 4;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.08, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    src.start();
    creakTimer = window.setTimeout(creak, 16000 + Math.random() * 24000);
  };
  creakTimer = window.setTimeout(creak, 8000 + Math.random() * 10000);
  void ctx.resume();
}

export function suspendHollowSound(): void {
  void ctx?.suspend();
}

export function resumeHollowSound(): void {
  if (ctx && ctx.state === "suspended") void ctx.resume();
}

export function stopHollowSound(): void {
  window.clearTimeout(creakTimer);
  creakTimer = 0;
  for (const node of nodes) {
    if (node instanceof OscillatorNode) {
      try {
        node.stop();
      } catch {
        // already stopped
      }
    }
  }
  nodes = [];
  void ctx?.close();
  ctx = null;
}

/** Defer so a Strict Mode remount can cancel the stop and keep a gesture-started drone. */
export function scheduleStopHollowSound(): void {
  window.clearTimeout(releaseTimer);
  releaseTimer = window.setTimeout(() => {
    releaseTimer = 0;
    stopHollowSound();
  }, 0);
}

export function cancelScheduledHollowStop(): void {
  window.clearTimeout(releaseTimer);
  releaseTimer = 0;
}
