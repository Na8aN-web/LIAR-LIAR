'use client';

import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { GAME_COUNTDOWN_SECONDS, type ChatMessage, type PlayerId, type PlayerView } from '@wtc/shared';

interface GameStore {
  view: PlayerView | null;
  /** serverTime - localTime, from the latest view. */
  clockOffset: number;
  chat: ChatMessage[];
  /** Players this person muted: their chat is hidden here (only here). */
  muted: PlayerId[];
  connected: boolean;
  selectedId: PlayerId | null;
  /** A finding to show in the Notebook (from a telegram's "Open in Notebook"). */
  notebookEntry: string | null;
  toast: { id: number; text: string } | null;
  setView: (v: PlayerView) => void;
  setChat: (m: ChatMessage[]) => void;
  addChat: (m: ChatMessage) => void;
  mute: (id: PlayerId) => void;
  setConnected: (c: boolean) => void;
  select: (id: PlayerId | null) => void;
  openNotebook: (entryId: string | null) => void;
  showToast: (text: string) => void;
  reset: () => void;
}

export const useGame = create<GameStore>((set) => ({
  view: null,
  clockOffset: 0,
  chat: [],
  muted: [],
  connected: false,
  selectedId: null,
  notebookEntry: null,
  toast: null,
  setView: (v) =>
    set((s) => ({
      view: v,
      clockOffset: v.serverNow - Date.now(),
      // Drop the selection when the phase changes.
      selectedId: s.view?.phase === v.phase ? s.selectedId : null,
    })),
  setChat: (chat) => set((s) => ({ chat: chat.filter((m) => !s.muted.includes(m.playerId)) })),
  addChat: (m) => set((s) => (s.muted.includes(m.playerId) ? s : { chat: [...s.chat.slice(-199), m] })),
  mute: (id) => set((s) => ({ muted: [...s.muted, id], chat: s.chat.filter((m) => m.playerId !== id) })),
  setConnected: (connected) => set({ connected }),
  select: (selectedId) => set({ selectedId }),
  openNotebook: (notebookEntry) => set({ notebookEntry }),
  showToast: (text) => set({ toast: { id: Date.now(), text } }),
  reset: () => set({ view: null, chat: [], muted: [], selectedId: null, notebookEntry: null, toast: null }),
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

/**
 * Start-of-game countdown: seconds left before the first poster shows (0 = none). The first
 * poster's phase runs GAME_COUNTDOWN_SECONDS longer than its timer; this is that extra part.
 * Re-renders only when the number changes.
 */
export function useGameCountdown(): number {
  const endsAt = useGame((s) => s.view?.phaseEndsAt ?? null);
  const offset = useGame((s) => s.clockOffset);
  const first = useGame((s) => s.view?.phase === 'poster' && s.view.game?.posterIndex === 0);
  const posterMs = useGame((s) => (s.view?.settings.timers.poster ?? 0) * 1000);
  const calc = () => (first && endsAt ? Math.max(0, Math.min(GAME_COUNTDOWN_SECONDS, Math.ceil((endsAt - posterMs - (Date.now() + offset)) / 1000))) : 0);
  const [n, setN] = useState(calc);
  useEffect(() => {
    setN(calc());
    if (!first || !endsAt) return;
    const t = setInterval(() => setN(calc()), 200);
    return () => clearInterval(t);
  }, [first, endsAt, offset, posterMs]); // eslint-disable-line react-hooks/exhaustive-deps
  return n;
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
