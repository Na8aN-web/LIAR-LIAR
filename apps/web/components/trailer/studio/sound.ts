'use client';

import { audio } from '@/lib/audio/engine';
import { SFX_LEVEL, SFX_PLAYERS, burst, envelope, pluck, tone, type Sfx } from '@/lib/audio/sfx';
import type { Cue, MusicSpec } from './script';

// Trailer sound: the game's own synthesized effects plus a few trailer-only hits (impact,
// whoosh, pop, typewriter keys...). The same functions play live in preview and render offline
// into the finished soundtrack, so what you hear while previewing is what ends up in the file.

type Ctx = BaseAudioContext;
type Player = (ctx: Ctx, out: AudioNode, t: number) => void;

const C = (ctx: Ctx) => ctx as unknown as AudioContext;

const TRAILER: Record<string, Player> = {
  // Big trailer hit: sub drop, body thump and a crack of noise.
  impact: (ctx, out, t) => {
    tone(C(ctx), out, t, { type: 'sine', freq: 70, to: 32, glide: 0.6, peak: 0.9, attack: 0.004, decay: 0.9 });
    tone(C(ctx), out, t, { type: 'triangle', freq: 140, to: 60, glide: 0.15, peak: 0.45, decay: 0.25 });
    burst(C(ctx), out, t, { type: 'lowpass', freq: 1800, peak: 0.55, decay: 0.35 });
    burst(C(ctx), out, t, { type: 'highpass', freq: 3500, peak: 0.12, decay: 0.08 });
  },
  thud: (ctx, out, t) => {
    tone(C(ctx), out, t, { type: 'sine', freq: 90, to: 45, glide: 0.2, peak: 0.6, decay: 0.3 });
    burst(C(ctx), out, t, { type: 'lowpass', freq: 600, peak: 0.4, decay: 0.15 });
  },
  hit: (ctx, out, t) => {
    burst(C(ctx), out, t, { type: 'highpass', freq: 1200, peak: 0.35, decay: 0.25 });
    tone(C(ctx), out, t, { type: 'sine', freq: 60, to: 35, peak: 0.6, decay: 0.5 });
  },
  // Air rushing past: band-passed noise sweeping up.
  whoosh: (ctx, out, t) => {
    const src = ctx.createBufferSource();
    src.buffer = noise(ctx);
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 1.2;
    f.frequency.setValueAtTime(400, t);
    f.frequency.exponentialRampToValueAtTime(3200, t + 0.32);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.5, t + 0.2);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.42);
    src.connect(f).connect(g).connect(out);
    src.start(t);
    src.stop(t + 0.5);
  },
  // A bright little pop (a chip or a bubble appearing).
  pop: (ctx, out, t) => {
    tone(C(ctx), out, t, { type: 'sine', freq: 520, to: 980, glide: 0.06, peak: 0.28, decay: 0.09 });
    burst(C(ctx), out, t, { type: 'bandpass', freq: 2500, q: 3, peak: 0.08, decay: 0.03 });
  },
  // The real color showing up again: a rising shimmer.
  reveal: (ctx, out, t) => {
    [659.3, 830.6, 987.8, 1318.5].forEach((f, i) => tone(C(ctx), out, t + i * 0.06, { type: 'triangle', freq: f, peak: 0.12, decay: 0.7 }));
  },
  sparkle: (ctx, out, t) => {
    for (let i = 0; i < 7; i++) tone(C(ctx), out, t + i * 0.035, { type: 'sine', freq: 1800 + i * 260, peak: 0.07, decay: 0.25 });
  },
  typekey: (ctx, out, t) => {
    burst(C(ctx), out, t, { type: 'bandpass', freq: 3000, q: 4, peak: 0.5, decay: 0.018 });
    burst(C(ctx), out, t + 0.012, { type: 'lowpass', freq: 900, peak: 0.25, decay: 0.03 });
  },
  // Paper catching fire: crackles over a soft roar.
  burn: (ctx, out, t) => {
    burst(C(ctx), out, t, { type: 'lowpass', freq: 900, peak: 0.25, decay: 0.7, attack: 0.15 });
    for (let i = 0; i < 14; i++) burst(C(ctx), out, t + i * 0.045 + (i % 3) * 0.01, { type: 'highpass', freq: 2500, peak: 0.2, decay: 0.012 });
  },
  // Freeze frame: a tape-stop drop and a click.
  freeze: (ctx, out, t) => {
    tone(C(ctx), out, t, { type: 'sawtooth', freq: 420, to: 60, glide: 0.35, peak: 0.12, decay: 0.38 });
    burst(C(ctx), out, t, { type: 'bandpass', freq: 1800, q: 2, peak: 0.3, decay: 0.03 });
  },
  unfreeze: (ctx, out, t) => tone(C(ctx), out, t, { type: 'sawtooth', freq: 80, to: 400, glide: 0.18, peak: 0.08, decay: 0.2 }),
  chaching: (ctx, out, t) => {
    burst(C(ctx), out, t, { type: 'bandpass', freq: 1800, q: 4, peak: 0.4, decay: 0.03 });
    [2093, 2637, 3136].forEach((f) => tone(C(ctx), out, t + 0.08, { type: 'sine', freq: f, peak: 0.12, decay: 0.9 }));
    pluck(C(ctx), out, t + 0.08, 523.3, 0.1, 0.6);
  },
  wind: (ctx, out, t) => {
    const src = ctx.createBufferSource();
    src.buffer = noise(ctx);
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 3;
    f.frequency.setValueAtTime(500, t);
    f.frequency.linearRampToValueAtTime(900, t + 0.8);
    f.frequency.linearRampToValueAtTime(400, t + 2);
    src.connect(f).connect(envelope(C(ctx), out, t, 0.35, 0.6, 1.2, 0.4));
    src.start(t);
    src.stop(t + 2.4);
  },
};

let noiseBuf: AudioBuffer | null = null;
function noise(ctx: Ctx): AudioBuffer {
  if (noiseBuf && noiseBuf.sampleRate === ctx.sampleRate) return noiseBuf;
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return noiseBuf;
}

export const TRAILER_SFX = [...Object.keys(TRAILER), ...Object.keys(SFX_PLAYERS)];

function player(name: string): { play: Player; level: number } | null {
  if (TRAILER[name]) return { play: TRAILER[name], level: 1 };
  const game = (SFX_PLAYERS as Record<string, Player | undefined>)[name];
  return game ? { play: game, level: SFX_LEVEL[name as Sfx] ?? 1 } : null;
}

/** Plays a cue now (preview). Silently does nothing before the first click unlocks audio. */
export function playCue(name: string, gain = 1, volume = 1) {
  const e = audio();
  const p = player(name);
  if (!e || !p) return;
  const out = e.ctx.createGain();
  out.gain.value = p.level * gain * volume;
  out.connect(e.buses.effects);
  p.play(e.ctx, out, e.ctx.currentTime + 0.005);
  setTimeout(() => out.disconnect(), 5000);
}

// ---------------------------------------------------------------- offline soundtrack

export const RATE = 48000;

async function decode(ctx: Ctx, url: string): Promise<AudioBuffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Couldn't load ${url} (${res.status})`);
  return ctx.decodeAudioData(await res.arrayBuffer());
}

export function musicUrl(file: string): string {
  if (/^https?:/.test(file) || file.startsWith('/')) return file;
  return `/dev/trailer/api/file?path=${encodeURIComponent(file)}`;
}

/**
 * Renders the soundtrack offline: every cue, the campfire bed and (optionally) the music,
 * mixed to stereo at 48 kHz. Returns WAV bytes.
 */
export async function renderSoundtrack(opts: {
  duration: number;
  cues: Cue[];
  music: MusicSpec | null;
  withMusic: boolean;
  sfxVolume: number;
  ambience: number;
}): Promise<Uint8Array> {
  const len = Math.ceil(opts.duration * RATE);
  const ctx = new OfflineAudioContext(2, len, RATE);
  const master = ctx.createDynamicsCompressor();
  master.threshold.value = -8;
  master.knee.value = 6;
  master.ratio.value = 4;
  master.attack.value = 0.003;
  master.release.value = 0.2;
  master.connect(ctx.destination);
  // End of the trailer: everything fades in the last moments.
  const fadeAll = ctx.createGain();
  fadeAll.connect(master);

  const fx = ctx.createGain();
  fx.gain.value = opts.sfxVolume;
  fx.connect(fadeAll);
  for (const c of opts.cues) {
    const p = player(c.name);
    if (!p || c.t >= opts.duration) continue;
    const g = ctx.createGain();
    g.gain.value = p.level * c.gain;
    g.connect(fx);
    p.play(ctx, g, Math.max(0, c.t));
  }

  if (opts.ambience > 0) {
    try {
      const fire = await decode(ctx, '/audio/fire-fire.mp3');
      const src = ctx.createBufferSource();
      src.buffer = fire;
      src.loop = true;
      const g = ctx.createGain();
      g.gain.value = opts.ambience;
      src.connect(g).connect(fadeAll);
      src.start(0);
    } catch {
      /* no bed */
    }
  }

  if (opts.withMusic && opts.music?.file) {
    const m = opts.music;
    const buf = await decode(ctx, musicUrl(m.file));
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain();
    const vol = m.volume ?? 0.8;
    g.gain.setValueAtTime(vol, 0);
    const fade = Math.min(m.fadeOut ?? 1.5, opts.duration);
    g.gain.setValueAtTime(vol, Math.max(0, opts.duration - fade));
    g.gain.linearRampToValueAtTime(0.0001, opts.duration);
    src.connect(g).connect(fadeAll);
    src.start(0, Math.max(0, m.start ?? 0));
  }
  fadeAll.gain.setValueAtTime(1, Math.max(0, opts.duration - 0.08));
  fadeAll.gain.linearRampToValueAtTime(0, opts.duration);

  const out = await ctx.startRendering();
  return wav(out);
}

/** 16-bit PCM WAV. */
function wav(buf: AudioBuffer): Uint8Array {
  const ch = buf.numberOfChannels;
  const n = buf.length;
  const bytes = new Uint8Array(44 + n * ch * 2);
  const v = new DataView(bytes.buffer);
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  v.setUint32(4, 36 + n * ch * 2, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, ch, true);
  v.setUint32(24, buf.sampleRate, true);
  v.setUint32(28, buf.sampleRate * ch * 2, true);
  v.setUint16(32, ch * 2, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, n * ch * 2, true);
  const data = Array.from({ length: ch }, (_, c) => buf.getChannelData(c));
  let o = 44;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < ch; c++) {
      const s = Math.max(-1, Math.min(1, data[c][i]));
      v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      o += 2;
    }
  }
  return bytes;
}

// ---------------------------------------------------------------- music analysis (timeline)

export interface MusicInfo {
  peaks: Float32Array;
  seconds: number;
  /** Estimated if the script gives none. */
  bpm: number;
  offset: number;
}

/** Waveform peaks (per 10 ms) and a tempo estimate, for the timeline. */
export async function analyseMusic(file: string): Promise<MusicInfo> {
  const ctx = new OfflineAudioContext(1, 1, 22050);
  const buf = await decode(ctx, musicUrl(file));
  const x = buf.getChannelData(0);
  const rate = buf.sampleRate;
  const step = Math.round(rate / 100);
  const peaks = new Float32Array(Math.ceil(x.length / step));
  for (let i = 0; i < peaks.length; i++) {
    let m = 0;
    for (let j = i * step; j < Math.min(x.length, (i + 1) * step); j++) m = Math.max(m, Math.abs(x[j]));
    peaks[i] = m;
  }
  // Onset strength (rise in log energy per 10 ms), then autocorrelation over 70–180 BPM.
  const env = new Float32Array(peaks.length);
  for (let i = 0; i < peaks.length; i++) {
    let s = 0;
    for (let j = i * step; j < Math.min(x.length, (i + 1) * step); j++) s += x[j] * x[j];
    env[i] = Math.log(1e-6 + s);
  }
  const onset = env.map((v, i) => (i ? Math.max(0, v - env[i - 1]) : 0));
  let best = { bpm: 120, score: -1 };
  for (let bpm = 70; bpm <= 180; bpm += 0.25) {
    const lag = 6000 / bpm;
    const l = Math.round(lag);
    let s = 0;
    for (let i = 0; i + 4 * l < onset.length; i++) s += onset[i] * (onset[i + l] + 0.5 * onset[i + 2 * l] + 0.25 * onset[i + 4 * l]);
    if (s > best.score) best = { bpm, score: s };
  }
  const period = 6000 / best.bpm;
  let phase = { off: 0, s: -1 };
  for (let o = 0; o < period; o += 0.5) {
    let s = 0;
    for (let k = o; k < onset.length; k += period) s += onset[Math.round(k)] ?? 0;
    if (s > phase.s) phase = { off: o, s };
  }
  return { peaks, seconds: x.length / rate, bpm: best.bpm, offset: phase.off / 100 };
}
