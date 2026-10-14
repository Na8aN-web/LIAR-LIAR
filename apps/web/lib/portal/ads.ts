'use client';

import { useSyncExternalStore } from 'react';
import { setForcedMute } from '../audio/forceMute';
import { portal } from './index';

// Ad breaks (portals only; the website has none). Only ever between games, never during a
// round. From the request until the ad is over the game is locked (an overlay blocks input,
// the 3D scene pauses), as portals require; audio is muted only once an ad actually starts.

let active = false;
const listeners = new Set<() => void>();
const set = (v: boolean) => {
  active = v;
  listeners.forEach((l) => l());
};

/** Offers the portal a midgame ad break. Resolves when it's over (at once if there's none). */
export async function adBreak(): Promise<void> {
  if (active || portal().id === 'web') return;
  set(true);
  try {
    await portal().midgameAd(() => setForcedMute('ad', true));
  } finally {
    setForcedMute('ad', false);
    set(false);
  }
}

export function useAdBreak(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => active,
    () => false,
  );
}
