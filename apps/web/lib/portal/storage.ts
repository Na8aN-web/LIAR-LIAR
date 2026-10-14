'use client';

// Where this player's progress and settings are kept: tutorial, settings, How to Play, name,
// look. On the website that's the browser's localStorage, as before. On a portal it's the
// portal's own save (CrazyGames: the Data module, which follows a logged-in player to any
// device). Every access is guarded: storage can throw (private mode, blocked site data).
// Session tokens for rejoining a room are not progress: they stay in lib/session.ts.

export interface KeyValue {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const browser: KeyValue = {
  getItem: (k) => localStorage.getItem(k),
  setItem: (k, v) => localStorage.setItem(k, v),
  removeItem: (k) => localStorage.removeItem(k),
};

let backend: KeyValue = browser;
const resetListeners = new Set<() => void>();

export const kv = {
  get(key: string): string | null {
    try {
      return backend.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string) {
    try {
      backend.setItem(key, value);
    } catch {
      /* ignore */
    }
  },
  remove(key: string) {
    try {
      backend.removeItem(key);
    } catch {
      /* ignore */
    }
  },
};

/** A portal's save takes over; modules that cached values read them again. */
export function setStorageBackend(next: KeyValue) {
  backend = next;
  resetListeners.forEach((l) => l());
}

/** Called when the storage backend changes (a portal finished starting up). */
export function onStorageReset(l: () => void): () => void {
  resetListeners.add(l);
  return () => resetListeners.delete(l);
}
