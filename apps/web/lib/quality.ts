'use client';

import { useSyncExternalStore } from 'react';

// Graphics quality for the 3D scene. Per device, in localStorage.
//   auto:   decide from the device, and drop to "smooth" if the frame rate sags during play.
//   smooth: for cheap phones. Lower resolution, no antialiasing, fewer lights, 30 fps, plain panels.
//   pretty: full quality.
export type QualitySetting = 'auto' | 'smooth' | 'pretty';
export type Quality = 'smooth' | 'pretty';

const KEY = 'wtc:quality';
/** Set when "auto" saw the frame rate sag, so the next visit starts smooth straight away. */
const SAGGED_KEY = 'wtc:quality-sagged';

let setting: QualitySetting = 'auto';
let sagged = false;
let loaded = false;
const listeners = new Set<() => void>();

function load() {
  if (loaded || typeof window === 'undefined') return;
  loaded = true;
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'auto' || v === 'smooth' || v === 'pretty') setting = v;
    sagged = localStorage.getItem(SAGGED_KEY) === '1';
  } catch {
    /* ignore */
  }
}

/** A guess from the hardware: low memory or few cores means a cheap phone. */
function looksLowEnd(): boolean {
  if (typeof navigator === 'undefined') return false;
  const nav = navigator as Navigator & { deviceMemory?: number };
  // iPhones and iPads report neither reliably, and their GPUs cope; the frame-rate check still applies.
  if (/iPhone|iPad|iPod/.test(nav.userAgent)) return false;
  if (nav.deviceMemory !== undefined && nav.deviceMemory <= 4) return true;
  return (nav.hardwareConcurrency ?? 8) <= 4;
}

function current(): Quality {
  load();
  if (setting !== 'auto') return setting;
  return sagged || looksLowEnd() ? 'smooth' : 'pretty';
}

function notify() {
  const q = current();
  if (typeof document !== 'undefined') document.documentElement.classList.toggle('smooth', q === 'smooth');
  listeners.forEach((l) => l());
}

export function setQualitySetting(v: QualitySetting) {
  load();
  setting = v;
  try {
    localStorage.setItem(KEY, v);
    // Choosing again starts the automatic check afresh.
    localStorage.removeItem(SAGGED_KEY);
  } catch {
    /* ignore */
  }
  sagged = false;
  notify();
}

/** The frame rate stayed low: on "auto", switch to smooth (and start smooth next time). */
export function reportSag() {
  load();
  if (setting !== 'auto' || sagged) return;
  sagged = true;
  try {
    localStorage.setItem(SAGGED_KEY, '1');
  } catch {
    /* ignore */
  }
  notify();
}

/** Applies the page-wide class (plain panels on smooth). Call once on startup. */
export function applyQualityClass() {
  if (typeof document !== 'undefined') document.documentElement.classList.toggle('smooth', current() === 'smooth');
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function useQuality(): Quality {
  return useSyncExternalStore(subscribe, current, () => 'pretty');
}

export function useQualitySetting(): QualitySetting {
  return useSyncExternalStore(
    subscribe,
    () => {
      load();
      return setting;
    },
    () => 'auto',
  );
}
