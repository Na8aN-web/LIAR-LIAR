'use client';

import { kv, onStorageReset } from '@/lib/portal/storage';

import { useSyncExternalStore } from 'react';

// Picture brightness for the 3D scene (tone-mapping exposure). Kept in lib/portal/storage.
export const BRIGHTNESS_MIN = 0.6;
export const BRIGHTNESS_MAX = 1.8;
export const BRIGHTNESS_DEFAULT = 1;
const KEY = 'wtc:brightness';

let value = read();
const listeners = new Set<() => void>();

function read(): number {
  try {
    const v = Number(kv.get(KEY));
    return v >= BRIGHTNESS_MIN && v <= BRIGHTNESS_MAX ? v : BRIGHTNESS_DEFAULT;
  } catch {
    return BRIGHTNESS_DEFAULT;
  }
}

onStorageReset(() => {
  value = read();
  listeners.forEach((l) => l());
});

export function setBrightness(v: number) {
  value = Math.min(BRIGHTNESS_MAX, Math.max(BRIGHTNESS_MIN, v));
  try {
    kv.set(KEY, String(value));
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l());
}

export function useBrightness(): number {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => value,
    () => BRIGHTNESS_DEFAULT,
  );
}
