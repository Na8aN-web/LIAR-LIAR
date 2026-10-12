'use client';

import { useEffect } from 'react';
import { whenUnlocked, type Bus } from './engine';

// Music and ambience from public/audio (built by `pnpm audio` from assets/source/audio).
// Loops crossfade at the seam. A mood sets how loud each layer is: music low in the lobby,
// quieter while searching, and a synthesized tension layer for the last 20 seconds and the vote.
// If a file is missing, that layer simply stays silent.

export type Mood = 'menu' | 'lobby' | 'investigation' | 'tension' | 'payout' | 'ended';

interface Levels {
  music: number;
  tension: number;
  fire: number;
  wind: number;
}

const MOODS: Record<Mood, Levels> = {
  menu: { music: 0.55, tension: 0, fire: 0.8, wind: 0.35 },
  lobby: { music: 0.4, tension: 0, fire: 0.8, wind: 0.35 },
  investigation: { music: 0.2, tension: 0, fire: 0.7, wind: 0.4 },
  tension: { music: 0.32, tension: 1, fire: 0.6, wind: 0.5 },
  payout: { music: 0.3, tension: 0, fire: 0.7, wind: 0.35 },
  ended: { music: 0.45, tension: 0, fire: 0.7, wind: 0.3 },
};
/** Seconds to move between moods. */
const RAMP = 1.5;
const XFADE = 2.5;

interface Manifest {
  music: { file: string; seconds: number }[];
  /** Played once, quietly, when a game ends. */
  victory?: { file: string; seconds: number } | null;
  ambience: Partial<Record<'fire' | 'wind' | 'crows', { file: string; seconds: number }>>;
}

/** A buffer that loops forever, crossfading its end into its start. */
class Loop {
  readonly level: GainNode;
  private next = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  constructor(
    private ctx: AudioContext,
    private buffer: AudioBuffer,
    out: AudioNode,
  ) {
    this.level = ctx.createGain();
    this.level.gain.value = 0;
    this.level.connect(out);
    this.next = ctx.currentTime + 0.05;
    this.schedule(true);
  }
  private schedule(first = false) {
    const { ctx, buffer } = this;
    const xf = Math.min(XFADE, buffer.duration / 4);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const g = ctx.createGain();
    const t = this.next;
    g.gain.setValueAtTime(first ? 1 : 0, t);
    if (!first) g.gain.linearRampToValueAtTime(1, t + xf);
    g.gain.setValueAtTime(1, t + buffer.duration - xf);
    g.gain.linearRampToValueAtTime(0, t + buffer.duration);
    src.connect(g).connect(this.level);
    src.start(t);
    src.stop(t + buffer.duration + 0.05);
    this.next = t + buffer.duration - xf;
    this.timer = setTimeout(() => this.schedule(), Math.max(0, (this.next - ctx.currentTime - 1) * 1000));
  }
  stop() {
    if (this.timer) clearTimeout(this.timer);
    this.level.disconnect();
  }
}

/** Synthesized tension: a low, uneasy drone with a slow heartbeat thump. */
function tensionLayer(ctx: AudioContext, out: AudioNode): GainNode {
  const level = ctx.createGain();
  level.gain.value = 0;
  level.connect(out);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 260;
  lp.connect(level);
  for (const detune of [-8, 7]) {
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = 55;
    o.detune.value = detune;
    const g = ctx.createGain();
    g.gain.value = 0.12;
    o.connect(g).connect(lp);
    o.start();
  }
  // Heartbeat: a sine "lub-dub" every 0.85 s, scheduled ahead.
  let next = ctx.currentTime + 0.1;
  const beat = () => {
    while (next < ctx.currentTime + 2) {
      for (const [dt, peak] of [
        [0, 0.5],
        [0.16, 0.32],
      ]) {
        const o = ctx.createOscillator();
        o.frequency.setValueAtTime(70, next + dt);
        o.frequency.exponentialRampToValueAtTime(42, next + dt + 0.12);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, next + dt);
        g.gain.exponentialRampToValueAtTime(peak, next + dt + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, next + dt + 0.18);
        o.connect(g).connect(level);
        o.start(next + dt);
        o.stop(next + dt + 0.2);
      }
      next += 0.85;
    }
  };
  setInterval(beat, 500);
  return level;
}

let mood: Mood = 'menu';
let started = false;
let manifestUrl: { victory: string | null } = { victory: null };
/** The end-of-game song while it plays (the music loop steps aside for it). */
let victory: { src: AudioBufferSourceNode; gain: GainNode } | null = null;
let victoryBuffer: AudioBuffer | null = null;
/** How loud the victory song is, under the Music slider: low, a cue that the game is over. */
const VICTORY_LEVEL = 0.32;
let layers: Partial<Record<keyof Levels, GainNode>> = {};
let ctxRef: AudioContext | null = null;

function apply() {
  if (!ctxRef) return;
  const t = ctxRef.currentTime;
  const l = { ...MOODS[mood] };
  if (victory) l.music = 0;
  for (const k of Object.keys(l) as (keyof Levels)[]) layers[k]?.gain.setTargetAtTime(l[k], t, RAMP / 3);
}

async function load(ctx: AudioContext, url: string): Promise<AudioBuffer | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return await ctx.decodeAudioData(await res.arrayBuffer());
  } catch {
    return null;
  }
}

function start() {
  if (started) return;
  started = true;
  whenUnlocked(async ({ ctx, buses }) => {
    ctxRef = ctx;
    layers.tension = tensionLayer(ctx, buses.music);
    apply();
    let manifest: Manifest | null = null;
    try {
      const res = await fetch('/audio/manifest.json');
      manifest = res.ok ? await res.json() : null;
    } catch {
      manifest = null;
    }
    if (!manifest) return;
    manifestUrl = { victory: manifest.victory?.file ?? null };
    const loop = async (key: keyof Levels, url: string | undefined, bus: Bus) => {
      if (!url) return;
      const buf = await load(ctx, url);
      if (!buf) return;
      layers[key] = new Loop(ctx, buf, buses[bus]).level;
      apply();
    };
    // Ambience first (small), then music.
    await Promise.all([loop('fire', manifest.ambience.fire?.file, 'ambience'), loop('wind', manifest.ambience.wind?.file, 'ambience')]);
    await loop('music', manifest.music[0]?.file, 'music');
    // Crows: now and then, somewhere off in the dark.
    const crowFile = manifest.ambience.crows?.file;
    const crows = crowFile ? await load(ctx, crowFile) : null;
    if (crows) {
      const caw = () => {
        const src = ctx.createBufferSource();
        src.buffer = crows;
        const g = ctx.createGain();
        g.gain.value = 0.45 * (mood === 'tension' ? 0.5 : 1);
        const pan = ctx.createStereoPanner();
        pan.pan.value = Math.random() * 1.6 - 0.8;
        src.connect(g).connect(pan).connect(buses.ambience);
        // A random few seconds of the recording.
        const offset = Math.random() * Math.max(0, crows.duration - 4);
        src.start(ctx.currentTime, offset, 3 + Math.random() * 2);
        setTimeout(caw, 25000 + Math.random() * 45000);
      };
      setTimeout(caw, 8000 + Math.random() * 10000);
    }
  });
}

/**
 * The victory song: once, quietly, when a game ends (the music loop fades out under it and comes
 * back when it's over). Skipped silently if the file is missing or sound is still locked.
 */
export function playVictory() {
  start();
  whenUnlocked(async ({ ctx, buses }) => {
    if (victory || !manifestUrl.victory) {
      // The manifest may still be loading on a very early end: try once more shortly.
      if (!victory && !manifestUrl.victory) setTimeout(() => manifestUrl.victory && playVictory(), 1500);
      return;
    }
    victoryBuffer ??= await load(ctx, manifestUrl.victory);
    if (!victoryBuffer || victory) return;
    const src = ctx.createBufferSource();
    src.buffer = victoryBuffer;
    const gain = ctx.createGain();
    const t = ctx.currentTime + 0.4;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(VICTORY_LEVEL, t + 1.2);
    src.connect(gain).connect(buses.music);
    src.start(t);
    const mine = { src, gain };
    victory = mine;
    src.onended = () => {
      if (victory === mine) {
        victory = null;
        apply();
      }
      gain.disconnect();
    };
    apply();
  });
}

/** Fades the victory song out (leaving the end screen). */
export function stopVictory() {
  const v = victory;
  if (!v || !ctxRef) return;
  victory = null;
  const t = ctxRef.currentTime;
  v.gain.gain.cancelScheduledValues(t);
  v.gain.gain.setTargetAtTime(0.0001, t, 0.4);
  v.src.stop(t + 2);
  apply();
}

/** Sets the soundscape for the current screen. Starts it on the first user gesture. */
export function setMood(next: Mood) {
  mood = next;
  start();
  apply();
}

export function useMood(next: Mood) {
  useEffect(() => setMood(next), [next]);
}
