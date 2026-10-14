'use client';

import { kv } from './portal/storage';

// Storage can throw (private mode, blocked site data), so every access is guarded.
// Dev uses sessionStorage for tokens so each tab can be a different player.

function tokenStore(): Storage | null {
  try {
    return process.env.NODE_ENV === 'development' ? sessionStorage : localStorage;
  } catch {
    return null;
  }
}

function get(store: () => Storage | null, key: string): string | null {
  try {
    return store()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function set(store: () => Storage | null, key: string, value: string | null) {
  try {
    if (value === null) store()?.removeItem(key);
    else store()?.setItem(key, value);
  } catch {
    /* ignore */
  }
}

export const session = {
  getToken: (code: string) => get(tokenStore, `wtc:token:${code}`),
  setToken: (code: string, token: string | null) => set(tokenStore, `wtc:token:${code}`, token),
  // The name is progress (on a portal it follows the player's account): see lib/portal/storage.
  getName: () => kv.get('wtc:name') ?? '',
  setName: (name: string) => kv.set('wtc:name', name),
};
