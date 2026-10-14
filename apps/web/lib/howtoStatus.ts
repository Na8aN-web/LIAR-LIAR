'use client';

import { kv } from '@/lib/portal/storage';

import type { HowtoStatus } from '@wtc/shared';
import { call } from './socket';

// What this player did with How to Play, for playtest stats: never opened it, skipped it, or
// went through to the last slide. Kept in this browser and reported to the room when it changes
// and whenever the player takes a seat. The server only ever moves it forward.

const KEY = 'wtc:howto-status';
const RANK: HowtoStatus[] = ['never', 'skipped', 'finished'];

export function getHowtoStatus(): HowtoStatus {
  try {
    const v = kv.get(KEY) as HowtoStatus | null;
    if (v && RANK.includes(v)) return v;
    // Older builds only remembered that the walkthrough had been seen.
    return kv.get('wtc:howto-seen') === '1' ? 'skipped' : 'never';
  } catch {
    return 'never';
  }
}

export function setHowtoStatus(status: HowtoStatus) {
  if (RANK.indexOf(status) <= RANK.indexOf(getHowtoStatus())) return;
  try {
    kv.set(KEY, status);
  } catch {
    /* ignore */
  }
  reportHowtoStatus();
}

/** Tells the current room (if any). Harmless when not seated: the server just says so. */
export function reportHowtoStatus() {
  void call('client:howto', { status: getHowtoStatus() });
}
