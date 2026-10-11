'use client';

import { getAudioSettings, subscribeAudioSettings } from './settings';

// One AudioContext for the whole app, with a bus per slider: music, effects, ambience.
// Browsers only allow sound after a user gesture, so the context is created on the first
// tap or key press; nothing plays before that.

export type Bus = 'music' | 'effects' | 'ambience';

interface Engine {
  ctx: AudioContext;
  master: GainNode;
  buses: Record<Bus, GainNode>;
}

let engine: Engine | null = null;
const unlockListeners = new Set<(e: Engine) => void>();

function applySettings() {
  if (!engine) return;
  const s = getAudioSettings();
  const t = engine.ctx.currentTime;
  engine.master.gain.setTargetAtTime(s.muted ? 0 : 1, t, 0.05);
  // Square the slider so the low end stays usable (hearing is roughly logarithmic).
  for (const b of ['music', 'effects', 'ambience'] as const) engine.buses[b].gain.setTargetAtTime(s[b] * s[b], t, 0.05);
}

function create(): Engine | null {
  try {
    const ctx = new AudioContext();
    const master = ctx.createGain();
    // A gentle limiter so stacked effects never clip.
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -6;
    limiter.ratio.value = 8;
    master.connect(limiter).connect(ctx.destination);
    const bus = () => {
      const g = ctx.createGain();
      g.connect(master);
      return g;
    };
    return { ctx, master, buses: { music: bus(), effects: bus(), ambience: bus() } };
  } catch {
    return null;
  }
}

function unlock() {
  if (!engine) {
    engine = create();
    if (!engine) return;
    applySettings();
    subscribeAudioSettings(applySettings);
  }
  if (engine.ctx.state === 'suspended') void engine.ctx.resume();
  if (engine.ctx.state !== 'closed') {
    const e = engine;
    unlockListeners.forEach((l) => l(e));
    unlockListeners.clear();
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('pointerdown', unlock, { passive: true });
  window.addEventListener('keydown', unlock);
}

/** The running engine, or null before the first user gesture. */
export function audio(): Engine | null {
  return engine && engine.ctx.state === 'running' ? engine : null;
}

/** Runs once audio is allowed (right away if it already is). */
export function whenUnlocked(fn: (e: Engine) => void) {
  if (engine && engine.ctx.state !== 'closed') fn(engine);
  else unlockListeners.add(fn);
}
