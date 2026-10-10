'use client';

import { useEffect, useState } from 'react';
import { create } from 'zustand';
import type { ChatMessage, PlayerId, PlayerView } from '@wtc/shared';

interface GameStore {
  view: PlayerView | null;
  /** serverTime - localTime, from the latest view. */
  clockOffset: number;
  chat: ChatMessage[];
  connected: boolean;
  selectedId: PlayerId | null;
  toast: { id: number; text: string } | null;
  setView: (v: PlayerView) => void;
  setChat: (m: ChatMessage[]) => void;
  addChat: (m: ChatMessage) => void;
  setConnected: (c: boolean) => void;
  select: (id: PlayerId | null) => void;
  showToast: (text: string) => void;
  reset: () => void;
}

export const useGame = create<GameStore>((set) => ({
  view: null,
  clockOffset: 0,
  chat: [],
  connected: false,
  selectedId: null,
  toast: null,
  setView: (v) =>
    set((s) => ({
      view: v,
      clockOffset: v.serverNow - Date.now(),
      // Drop the selection when the phase changes.
      selectedId: s.view?.phase === v.phase ? s.selectedId : null,
    })),
  setChat: (chat) => set({ chat }),
  addChat: (m) => set((s) => ({ chat: [...s.chat.slice(-199), m] })),
  setConnected: (connected) => set({ connected }),
  select: (selectedId) => set({ selectedId }),
  showToast: (text) => set({ toast: { id: Date.now(), text } }),
  reset: () => set({ view: null, chat: [], selectedId: null, toast: null }),
}));

/** Whole seconds left in the current phase, ticking. */
export function useSecondsLeft(): number | null {
  const endsAt = useGame((s) => s.view?.phaseEndsAt ?? null);
  const offset = useGame((s) => s.clockOffset);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!endsAt) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [endsAt]);
  if (!endsAt) return null;
  return Math.max(0, Math.ceil((endsAt - (now + offset)) / 1000));
}

export function usePlayerName() {
  const players = useGame((s) => s.view?.players);
  const me = useGame((s) => s.view?.you.id);
  return (id: PlayerId | null | undefined, youLabel = 'you') => {
    if (!id) return '—';
    if (id === me) return youLabel;
    return players?.find((p) => p.id === id)?.name ?? 'Unknown';
  };
}
