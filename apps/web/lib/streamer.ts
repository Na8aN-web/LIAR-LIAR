'use client';

import { kv, onStorageReset } from '@/lib/portal/storage';

import { useSyncExternalStore } from 'react';

// Streamer mode (Settings): hides what viewers mustn't see when you stream the game. Your own
// color (the top-bar badge, your glow, your item's real color, color-change telegrams, the swap
// panel) and the room code. Kept in lib/portal/storage.
const KEY = 'wtc:streamer';

let on = read();
const listeners = new Set<() => void>();

function read(): boolean {
  try {
    return kv.get(KEY) === '1';
  } catch {
    return false;
  }
}

onStorageReset(() => {
  on = read();
  listeners.forEach((l) => l());
});

export function setStreamerMode(v: boolean) {
  on = v;
  try {
    kv.set(KEY, v ? '1' : '0');
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l());
}

export function useStreamerMode(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => on,
    () => false,
  );
}
