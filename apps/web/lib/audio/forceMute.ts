'use client';

// Silence that wins over the player's own sound settings: a portal's mute setting, an ad break.
// While any reason is on, the master volume is 0 (and the in-game sound toggle can't undo it).

export type MuteReason = 'portal' | 'ad';

const reasons = new Set<MuteReason>();
const listeners = new Set<() => void>();

export function setForcedMute(reason: MuteReason, on: boolean) {
  const had = reasons.has(reason);
  if (on === had) return;
  if (on) reasons.add(reason);
  else reasons.delete(reason);
  listeners.forEach((l) => l());
}

export function isForcedMute(): boolean {
  return reasons.size > 0;
}

export function subscribeForcedMute(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}
