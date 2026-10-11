'use client';

import { create } from 'zustand';
import type { Announcement, BillboardSlot, ServerStatus } from '@wtc/shared';

// Server-wide state pushed by the game server: maintenance mode, replaced billboard images,
// messages from the admins, and whether this browser has been banned.

interface StatusStore extends ServerStatus {
  announcements: Announcement[];
  banned: boolean;
  setStatus: (s: ServerStatus) => void;
  announce: (a: Announcement) => void;
  dismiss: (id: string) => void;
  setBanned: () => void;
}

export const useServerStatus = create<StatusStore>((set) => ({
  maintenance: { on: false, message: '' },
  billboards: {},
  announcements: [],
  banned: false,
  setStatus: (s) => set({ maintenance: s.maintenance, billboards: s.billboards }),
  announce: (a) => set((st) => ({ announcements: [...st.announcements.filter((x) => x.id !== a.id), a].slice(-3) })),
  dismiss: (id) => set((st) => ({ announcements: st.announcements.filter((x) => x.id !== id) })),
  setBanned: () => set({ banned: true }),
}));

/** The image for an ad slot: the admins' replacement when there is one, else the built-in art. */
export function useBillboardImage(slot: string, fallback: string): string {
  const version = useServerStatus((s) => s.billboards[slot as BillboardSlot]);
  return version ? `/billboards/${slot}?v=${version}` : fallback;
}
