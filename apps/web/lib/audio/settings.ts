'use client';

import { kv, onStorageReset } from '@/lib/portal/storage';

import { useSyncExternalStore } from 'react';

// Audio settings (lib/portal/storage: this browser, or the portal's save). Volumes are 0..1 per bus.
export interface AudioSettings {
  music: number;
  effects: number;
  ambience: number;
  muted: boolean;
}

export const AUDIO_DEFAULTS: AudioSettings = { music: 0.5, effects: 0.7, ambience: 0.5, muted: false };
const KEY = 'wtc:audio';

let settings = read();
const listeners = new Set<() => void>();

function read(): AudioSettings {
  try {
    const raw = kv.get(KEY);
    const s = raw ? { ...AUDIO_DEFAULTS, ...JSON.parse(raw) } : { ...AUDIO_DEFAULTS };
    // Older builds stored only a mute flag.
    if (!raw && kv.get('wtc:muted') === '1') s.muted = true;
    for (const k of ['music', 'effects', 'ambience'] as const) s[k] = Math.min(1, Math.max(0, Number(s[k]) || 0));
    s.muted = !!s.muted;
    return s;
  } catch {
    return { ...AUDIO_DEFAULTS };
  }
}

// A portal's save took over: read the settings from there.
onStorageReset(() => {
  settings = read();
  listeners.forEach((l) => l());
});

export function getAudioSettings(): AudioSettings {
  return settings;
}

export function setAudioSettings(patch: Partial<AudioSettings>) {
  settings = { ...settings, ...patch };
  try {
    kv.set(KEY, JSON.stringify(settings));
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l());
}

export function subscribeAudioSettings(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useAudioSettings(): AudioSettings {
  return useSyncExternalStore(subscribeAudioSettings, () => settings, () => AUDIO_DEFAULTS);
}
