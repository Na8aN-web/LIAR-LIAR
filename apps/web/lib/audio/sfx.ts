'use client';

import { audio } from './engine';

// Every UI sound is synthesized here with Web Audio: no files, nothing to license.
// Western-flavored and short: wood, telegraph keys, a bell, plucked strings, coins.

export type Sfx =
  | 'click'
  | 'telegram'
  | 'offer'
  | 'crow'
  | 'poster'
  | 'tick'
  | 'tock'
  | 'stamp'
  | 'coins'
  | 'victory'
  | 'despair'
  | 'rustle'
  | 'gameEnd'
  | 'townBell';

type Ctx = AudioContext;

let noise: AudioBuffer | null = null;
function noiseBuffer(ctx: Ctx): AudioBuffer {
  if (noise && noise.sampleRate === ctx.sampleRate) return noise;
  noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const d = noise.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return noise;
}

/** Gain node with a quick attack and exponential decay. */
export function envelope(ctx: Ctx, out: AudioNode, at: number, peak: number, attack: number, decay: number, hold = 0): GainNode {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), at + attack);
  if (hold) g.gain.setValueAtTime(Math.max(peak, 0.0002), at + attack + hold);
  g.gain.exponentialRampToValueAtTime(0.0001, at + attack + hold + decay);
  g.connect(out);
  return g;
}

/** A burst of filtered noise. */
export function burst(ctx: Ctx, out: AudioNode, at: number, o: { type: BiquadFilterType; freq: number; q?: number; peak: number; decay: number; attack?: number }) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx);
  const f = ctx.createBiquadFilter();
  f.type = o.type;
  f.frequency.value = o.freq;
  f.Q.value = o.q ?? 1;
  src.connect(f).connect(envelope(ctx, out, at, o.peak, o.attack ?? 0.002, o.decay));
  src.start(at, Math.random() * 0.5);
  src.stop(at + (o.attack ?? 0.002) + o.decay + 0.05);
}

/** A tone with an optional pitch glide. */
export function tone(ctx: Ctx, out: AudioNode, at: number, o: { type: OscillatorType; freq: number; to?: number; glide?: number; peak: number; attack?: number; decay: number; hold?: number }) {
  const osc = ctx.createOscillator();
  osc.type = o.type;
  osc.frequency.setValueAtTime(o.freq, at);
  if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, at + (o.glide ?? o.decay));
  osc.connect(envelope(ctx, out, at, o.peak, o.attack ?? 0.004, o.decay, o.hold));
  osc.start(at);
  osc.stop(at + (o.attack ?? 0.004) + (o.hold ?? 0) + o.decay + 0.05);
}

/** A plucked string (a twangy guitar note): bright saw, closing filter, slight bend into pitch. */
export function pluck(ctx: Ctx, out: AudioNode, at: number, freq: number, peak: number, decay = 0.9) {
  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(freq * 1.015, at);
  osc.frequency.exponentialRampToValueAtTime(freq, at + 0.06);
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass';
  f.Q.value = 2;
  f.frequency.setValueAtTime(3200, at);
  f.frequency.exponentialRampToValueAtTime(500, at + decay * 0.7);
  osc.connect(f).connect(envelope(ctx, out, at, peak, 0.003, decay));
  osc.start(at);
  osc.stop(at + decay + 0.1);
}

/** A small bell: a few inharmonic partials ringing out. */
export function bell(ctx: Ctx, out: AudioNode, at: number, freq: number, peak: number) {
  [
    [1, 1],
    [2.0, 0.45],
    [2.76, 0.4],
    [5.4, 0.15],
  ].forEach(([ratio, g]) => tone(ctx, out, at, { type: 'sine', freq: freq * ratio, peak: peak * g, decay: 1.4 / Math.sqrt(ratio) }));
}

/**
 * One stroke of a big town bell: church-bell partials (hum, prime, minor third, fifth,
 * nominal), long ring-out, and the iron clapper's strike. Much lower and longer than the small
 * offer bell, so it can't be mistaken for anything else.
 */
function townBellStroke(ctx: Ctx, out: AudioNode, at: number, freq: number, peak: number) {
  burst(ctx, out, at, { type: 'bandpass', freq: 2600, q: 3, peak: peak * 0.35, decay: 0.05 });
  [
    [0.5, 0.55, 3.2],
    [1, 1, 2.4],
    [1.19, 0.5, 2.0],
    [1.5, 0.3, 1.6],
    [2, 0.4, 1.3],
    [2.51, 0.16, 0.9],
    [3.0, 0.1, 0.7],
  ].forEach(([ratio, g, decay]) => tone(ctx, out, at, { type: 'sine', freq: freq * ratio, peak: peak * g, attack: 0.003, decay }));
}

/** Telegraph sounder: "click" on key down, softer "clack" on key up. */
function telegraph(ctx: Ctx, out: AudioNode, at: number, pattern: string) {
  let t = at;
  for (const ch of pattern) {
    if (ch === ' ') {
      t += 0.12;
      continue;
    }
    const hold = ch === '-' ? 0.17 : 0.06;
    burst(ctx, out, t, { type: 'bandpass', freq: 2400, q: 6, peak: 0.9, decay: 0.012 });
    burst(ctx, out, t + hold, { type: 'bandpass', freq: 1500, q: 6, peak: 0.55, decay: 0.012 });
    t += hold + 0.07;
  }
  return t;
}

const NOTE = { A2: 110, E3: 164.8, A3: 220, C4: 261.6, D4: 293.7, E4: 329.6, Gs4: 415.3, A4: 440, B4: 493.9, E5: 659.3 };

export const SFX_PLAYERS: Record<Sfx, (ctx: Ctx, out: AudioNode, t: number) => void> = {
  // A soft knock on wood.
  click: (ctx, out, t) => {
    tone(ctx, out, t, { type: 'sine', freq: 210, to: 120, glide: 0.05, peak: 0.22, decay: 0.07 });
    burst(ctx, out, t, { type: 'bandpass', freq: 1700, q: 2, peak: 0.08, decay: 0.025 });
  },
  telegram: (ctx, out, t) => void telegraph(ctx, out, t, '-.-'),
  // Telegraph, then a bell: someone wants to buy.
  offer: (ctx, out, t) => {
    const end = telegraph(ctx, out, t, '.-.');
    bell(ctx, out, end + 0.05, 1318, 0.16);
  },
  // Two rasping caws: someone searched you.
  crow: (ctx, out, t) => {
    for (const [dt, f0] of [
      [0, 560],
      [0.36, 500],
    ]) {
      const at = t + dt;
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(f0, at);
      osc.frequency.linearRampToValueAtTime(f0 * 0.78, at + 0.26);
      const vib = ctx.createOscillator();
      vib.frequency.value = 38;
      const vibGain = ctx.createGain();
      vibGain.gain.value = 18;
      vib.connect(vibGain).connect(osc.frequency);
      const formant = ctx.createBiquadFilter();
      formant.type = 'bandpass';
      formant.frequency.value = 1250;
      formant.Q.value = 2.2;
      osc.connect(formant).connect(envelope(ctx, out, at, 0.32, 0.02, 0.12, 0.16));
      burst(ctx, out, at, { type: 'bandpass', freq: 1900, q: 1.5, peak: 0.08, decay: 0.12, attack: 0.02 });
      osc.start(at);
      vib.start(at);
      osc.stop(at + 0.4);
      vib.stop(at + 0.4);
    }
  },
  // Paper slapped onto a post, then a short twang.
  poster: (ctx, out, t) => {
    burst(ctx, out, t, { type: 'highpass', freq: 900, peak: 0.5, decay: 0.07 });
    tone(ctx, out, t, { type: 'sine', freq: 150, to: 80, peak: 0.25, decay: 0.08 });
    pluck(ctx, out, t + 0.14, NOTE.D4, 0.16, 0.5);
    pluck(ctx, out, t + 0.32, NOTE.A3, 0.18, 1.1);
  },
  // The town bell tolls twice: voting is open.
  townBell: (ctx, out, t) => {
    townBellStroke(ctx, out, t, 196, 0.32);
    townBellStroke(ctx, out, t + 0.85, 196, 0.26);
  },
  // Pocket-watch ticks for the last seconds.
  tick: (ctx, out, t) => burst(ctx, out, t, { type: 'bandpass', freq: 4200, q: 5, peak: 1, decay: 0.02 }),
  tock: (ctx, out, t) => burst(ctx, out, t, { type: 'bandpass', freq: 2700, q: 5, peak: 1, decay: 0.024 }),
  // A rubber stamp coming down: your vote is in.
  stamp: (ctx, out, t) => {
    tone(ctx, out, t, { type: 'sine', freq: 95, to: 48, peak: 0.6, decay: 0.24 });
    burst(ctx, out, t, { type: 'lowpass', freq: 700, peak: 0.35, decay: 0.1 });
    burst(ctx, out, t, { type: 'bandpass', freq: 3000, q: 1, peak: 0.08, decay: 0.02 });
  },
  // A few coins landing.
  coins: (ctx, out, t) => {
    for (let i = 0; i < 6; i++) {
      const at = t + Math.random() * 0.4;
      const f = 3000 + Math.random() * 2400;
      tone(ctx, out, at, { type: 'sine', freq: f, peak: 0.07, decay: 0.25 + Math.random() * 0.15 });
      tone(ctx, out, at, { type: 'sine', freq: f * 1.52, peak: 0.035, decay: 0.18 });
    }
    burst(ctx, out, t, { type: 'highpass', freq: 6000, peak: 0.05, decay: 0.2 });
  },
  // Rising major plucks.
  victory: (ctx, out, t) => {
    [NOTE.E4, NOTE.Gs4, NOTE.B4, NOTE.E5].forEach((f, i) => pluck(ctx, out, t + i * 0.11, f, 0.14, i === 3 ? 1.3 : 0.6));
    [NOTE.E4, NOTE.Gs4, NOTE.B4].forEach((f) => tone(ctx, out, t + 0.33, { type: 'triangle', freq: f, peak: 0.03, attack: 0.08, decay: 0.9 }));
  },
  // A sagging harmonica-like wail.
  despair: (ctx, out, t) => {
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(NOTE.D4, t);
    osc.frequency.exponentialRampToValueAtTime(NOTE.A3, t + 0.9);
    const vib = ctx.createOscillator();
    vib.frequency.value = 5.5;
    const depth = ctx.createGain();
    depth.gain.value = 4;
    vib.connect(depth).connect(osc.frequency);
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 3;
    f.frequency.setValueAtTime(1400, t);
    f.frequency.exponentialRampToValueAtTime(500, t + 1);
    osc.connect(f).connect(envelope(ctx, out, t, 0.16, 0.08, 0.5, 0.5));
    osc.start(t);
    vib.start(t);
    osc.stop(t + 1.2);
    vib.stop(t + 1.2);
    pluck(ctx, out, t, NOTE.A2, 0.1, 1);
  },
  // Cloth rustle: noise that flutters.
  rustle: (ctx, out, t) => {
    for (let i = 0; i < 9; i++) {
      burst(ctx, out, t + i * 0.05 + Math.random() * 0.02, { type: 'bandpass', freq: 2200 + Math.random() * 1500, q: 0.9, peak: 0.15 + Math.random() * 0.12, decay: 0.07, attack: 0.01 });
    }
  },
  // The end of the game: a longer phrase over a low drone.
  gameEnd: (ctx, out, t) => {
    tone(ctx, out, t, { type: 'triangle', freq: NOTE.A2, peak: 0.08, attack: 0.3, hold: 1.4, decay: 1 });
    [NOTE.A3, NOTE.C4, NOTE.E4].forEach((f, i) => pluck(ctx, out, t + i * 0.22, f, 0.14, 0.8));
    pluck(ctx, out, t + 0.75, NOTE.A4, 0.16, 2);
    pluck(ctx, out, t + 0.75, NOTE.E4, 0.08, 2);
  },
};

/** Volume per sound on top of the effects slider, so the UI stays subtle. */
export const SFX_LEVEL: Partial<Record<Sfx, number>> = { click: 0.5, tick: 0.6, tock: 0.6, rustle: 0.8 };

/** Plays a sound effect (silently skipped before the first tap, or when muted). */
export function playSfx(name: Sfx, delay = 0, gain = 1) {
  const e = audio();
  if (!e) return;
  const out = e.ctx.createGain();
  out.gain.value = (SFX_LEVEL[name] ?? 1) * gain;
  out.connect(e.buses.effects);
  SFX_PLAYERS[name](e.ctx, out, e.ctx.currentTime + 0.01 + delay);
  setTimeout(() => out.disconnect(), (delay + 5) * 1000);
}

export const SFX_NAMES = Object.keys(SFX_PLAYERS) as Sfx[];

/** Renders one effect offline and measures it (dev page /dev/sounds): peak, loudness, length. */
export async function measureSfx(name: Sfx): Promise<{ peak: number; rmsDb: number; seconds: number }> {
  const rate = 44100;
  const ctx = new OfflineAudioContext(1, rate * 4, rate);
  const out = ctx.createGain();
  out.gain.value = SFX_LEVEL[name] ?? 1;
  out.connect(ctx.destination);
  SFX_PLAYERS[name](ctx as unknown as AudioContext, out, 0.01);
  const data = (await ctx.startRendering()).getChannelData(0);
  let peak = 0;
  let sum = 0;
  let last = 0;
  for (let i = 0; i < data.length; i++) {
    const a = Math.abs(data[i]);
    peak = Math.max(peak, a);
    sum += data[i] * data[i];
    if (a > 0.001) last = i;
  }
  const rms = Math.sqrt(sum / Math.max(1, last));
  return { peak, rmsDb: 20 * Math.log10(rms || 1e-9), seconds: last / rate };
}
