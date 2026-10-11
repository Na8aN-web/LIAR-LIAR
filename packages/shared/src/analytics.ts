// Analytics and server status shared by the game client, the game server and the admin dashboard.
// Analytics never hold names, tokens or IP addresses: a player is an anonymous per-browser id.

/** Where a visitor came from: the `src` parameter on an incoming link (?src=youtube). */
export const SOURCES = ['youtube', 'tiktok', 'discord', 'x', 'instagram'] as const;
export type Source = (typeof SOURCES)[number] | 'other' | 'direct';

/** `?src=` value to a known source. Missing = direct; anything unrecognised = other. */
export function parseSource(raw: unknown): Source {
  if (typeof raw !== 'string' || !raw.trim()) return 'direct';
  const v = raw.trim().toLowerCase();
  if (v === 'twitter') return 'x';
  if (v === 'yt') return 'youtube';
  return (SOURCES as readonly string[]).includes(v) ? (v as Source) : v === 'direct' ? 'direct' : 'other';
}

/** Pages a visit can be counted on. */
export const VISIT_PAGES = ['home', 'room'] as const;
export type VisitPage = (typeof VISIT_PAGES)[number];

/** Funnel steps the browser reports (the server records lobby, game start and finish itself). */
export const CLIENT_STEPS = ['howto_open', 'howto_finish', 'howto_skip'] as const;
export type ClientStep = (typeof CLIENT_STEPS)[number];

/** Every ad slot in town (apps/web/config/adSlots.ts). The house slot is never sold or swapped. */
export const BILLBOARD_SLOTS = ['house-3042', 'roof-hotel', 'roof-dancehall', 'wall-bank', 'wall-assay', 'door-hotel', 'door-barber', 'door-livery'] as const;
export type BillboardSlot = (typeof BILLBOARD_SLOTS)[number];
export const HOUSE_SLOT: BillboardSlot = 'house-3042';
export const isBillboardSlot = (v: unknown): v is BillboardSlot => typeof v === 'string' && (BILLBOARD_SLOTS as readonly string[]).includes(v);

/** Server-wide state every client gets on connecting (and again whenever it changes). */
export interface ServerStatus {
  /** New rooms are refused while on; games already running carry on. */
  maintenance: { on: boolean; message: string };
  /** Replaced billboard images: slot -> version. The image is served at /billboards/<slot>?v=<version>. */
  billboards: Partial<Record<BillboardSlot, string>>;
}

/** A message from the admins to everyone online. */
export interface Announcement {
  id: string;
  text: string;
  at: number;
}

export const ANNOUNCEMENT_MAX = 200;
export const REPORT_REASON_MAX = 120;
