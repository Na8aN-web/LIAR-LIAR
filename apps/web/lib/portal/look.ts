'use client';

import { useEffect, useRef } from 'react';
import { ITEM_TYPES, parseCosmetics, type Cosmetics, type ItemType } from '@wtc/shared';
import { call } from '../socket';
import { useGame } from '../store';
import { portal } from './index';
import { kv } from './storage';

// Portals: the player's garment and hat/face follow them from game to game (and, logged in,
// device to device: the portal's save). The website keeps its random look per room.
// The color isn't remembered: it's picked per room, and may be taken.

const KEY = 'wtc:look';

interface SavedLook {
  item?: ItemType;
  cosmetics?: Partial<Cosmetics>;
}

function read(): SavedLook {
  try {
    const raw = JSON.parse(kv.get(KEY) ?? 'null') as SavedLook | null;
    if (!raw || typeof raw !== 'object') return {};
    const out: SavedLook = {};
    if (raw.item && ITEM_TYPES.includes(raw.item)) out.item = raw.item;
    const c = raw.cosmetics ? parseCosmetics(raw.cosmetics) : null;
    if (c && Object.keys(c).length) out.cosmetics = c;
    return out;
  } catch {
    return {};
  }
}

/** The player changed their look in the lobby: remember it (portals only). */
export function rememberLook(patch: SavedLook) {
  if (!portal().features.rememberLook) return;
  const prev = read();
  kv.set(KEY, JSON.stringify({ item: patch.item ?? prev.item, cosmetics: { ...prev.cosmetics, ...patch.cosmetics } }));
}

/** On taking a seat in a lobby: put the remembered look on (portals only). Once per room. */
export function useRememberedLook() {
  const code = useGame((s) => (s.view?.phase === 'lobby' && !s.view.spectating ? s.view.code : null));
  const done = useRef<string | null>(null);
  useEffect(() => {
    if (!code || done.current === code || !portal().features.rememberLook) return;
    done.current = code;
    const saved = read();
    if (saved.item || saved.cosmetics) void call('lobby:setLook', saved);
  }, [code]);
}
