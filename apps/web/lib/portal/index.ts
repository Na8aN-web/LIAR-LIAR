'use client';

import { useSyncExternalStore } from 'react';
import { portalBase, portalRoomPath, type PortalId } from '@wtc/shared';
import { setForcedMute } from '../audio/forceMute';
import { crazyGamesPortal } from './crazygames';
import { setStorageBackend } from './storage';
import type { PortalAdapter, PortalSettings } from './types';
import { webPortal } from './web';

// Which portal this page runs on, decided by its path (/play/<portal>/..., see @wtc/shared
// portal.ts) and set once by <PortalBoot>. Everything else asks portal() / usePortal().

const ADAPTERS: Record<PortalId, PortalAdapter> = { web: webPortal, crazygames: crazyGamesPortal };

let current: PortalAdapter = webPortal;
/** Trailer studio: the current page, with another portal's look (see previewPortalLook). */
let preview: PortalAdapter | null = null;
let ready = true;
let version = 0;
const listeners = new Set<() => void>();
const notify = () => {
  version++;
  listeners.forEach((l) => l());
};

export function portal(): PortalAdapter {
  return preview ?? current;
}

/**
 * Trailer studio only: render the game as it looks on a portal (its features: town signs, no
 * handle...), without loading that portal's SDK. null goes back to normal.
 */
export function previewPortalLook(id: PortalId | null) {
  preview = id && id !== current.id ? { ...current, features: ADAPTERS[id].features } : null;
  notify();
}

/** Starts a portal: its SDK, then its save as the storage for progress and settings. */
let booting: Promise<void> | null = null;
export function bootPortal(id: PortalId): Promise<void> {
  // Once per page load (effects can run twice in development).
  if (booting) return booting;
  if (id === 'web') return (booting = Promise.resolve());
  current = ADAPTERS[id];
  ready = false;
  notify();
  booting = (async () => {
    await current.init();
    setStorageBackend(current.storage);
    // The portal's mute setting wins over the game's own sound settings.
    const applyMute = () => setForcedMute('portal', current.settings().muted);
    applyMute();
    current.onSettings(() => {
      applyMute();
      notify();
    });
    ready = true;
    notify();
  })();
  return booting;
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** The current portal (re-renders when it starts or its settings change). */
export function usePortal(): PortalAdapter {
  useSyncExternalStore(subscribe, () => version, () => 0);
  return preview ?? current;
}

export function usePortalReady(): boolean {
  return useSyncExternalStore(subscribe, () => ready, () => true);
}

export function usePortalSettings(): PortalSettings {
  useSyncExternalStore(subscribe, () => version, () => 0);
  return current.settings();
}

/** Where a room's page is on this portal (/r/CODE on the website). */
export function roomHref(code: string): string {
  return portalRoomPath(current.id, code);
}

/** This portal's home page ('/' on the website). */
export function homeHref(): string {
  return portalBase(current.id) || '/';
}

export type { PortalAdapter, PortalSettings, PortalUser } from './types';
