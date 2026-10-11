'use client';

import { useSyncExternalStore } from 'react';

// Telegraph-click notification sounds made with WebAudio (no audio files). Browsers only allow
// sound after a user gesture, so the context is created/resumed on the first tap.

export type SoundKind = 'offer' | 'inspected' | 'poster';

let ctx: AudioContext | null = null;
let muted = readMuted();
const listeners = new Set<() => void>();

function readMuted(): boolean {
  try {
    return localStorage.getItem('wtc:muted') === '1';
  } catch {
    return false;
  }
}

function unlock() {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
  } catch {
    /* no audio */
  }
}
if (typeof window !== 'undefined') {
  window.addEventListener('pointerdown', unlock, { passive: true });
  window.addEventListener('keydown', unlock);
}

/** One telegraph-sounder click: a short burst of filtered noise. */
function click(at: number, pitch: number, gain: number) {
  if (!ctx) return;
  const len = Math.floor(ctx.sampleRate * 0.012);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const band = ctx.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = pitch;
  band.Q.value = 6;
  const amp = ctx.createGain();
  amp.gain.value = gain;
  src.connect(band).connect(amp).connect(ctx.destination);
  src.start(ctx.currentTime + at);
}

/** Morse-ish rhythm: each element is a "click" (key down) and a softer "clack" (key up). */
function telegraph(pattern: string) {
  let t = 0;
  for (const ch of pattern) {
    if (ch === ' ') {
      t += 0.12;
      continue;
    }
    const hold = ch === '-' ? 0.17 : 0.06;
    click(t, 2400, 0.9);
    click(t + hold, 1500, 0.55);
    t += hold + 0.07;
  }
}

export function playSound(kind: SoundKind) {
  if (muted || !ctx || ctx.state !== 'running') return;
  // Different rhythm per telegram so you can tell them apart without looking.
  if (kind === 'offer') telegraph('.-. .-.');
  else if (kind === 'inspected') telegraph('..');
  else telegraph('-.-');
}

export function setMuted(value: boolean) {
  muted = value;
  try {
    localStorage.setItem('wtc:muted', value ? '1' : '0');
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l());
}

export function useMuted(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => muted,
    () => false,
  );
}
