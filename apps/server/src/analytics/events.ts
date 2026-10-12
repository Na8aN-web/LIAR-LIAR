import { createHash } from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';
import type { ClientStep, Source, VisitPage } from '@wtc/shared';

// Analytics events. Never a name, a token or an IP address: a player is `anon`, a one-way hash
// of the random id their browser made up (see anonId). Countries come from Cloudflare's header,
// devices from the user agent; neither the IP nor the user agent is kept.

/** Funnel steps: the How to Play ones come from the browser, the rest from the server. */
export type Step = ClientStep | 'lobby' | 'game_start' | 'game_finish';
export type Device = 'mobile' | 'desktop';
export type LobbyAction = 'create_public' | 'create_private' | 'quick_join' | 'quick_create' | 'list_join' | 'code_join';
export type SafetyKind = 'report' | 'kick' | 'mute' | 'ban' | 'unban' | 'rate_limit';

interface Base {
  at: string;
  /** Anonymous per-browser id, or null when unknown. */
  anon: string | null;
  /** Made up by `pnpm admin:seed` (bot data), not real players. */
  seed?: true;
}

export type AnalyticsEvent =
  | (Base & { type: 'visit'; page: VisitPage; src: Source; device: Device; country: string | null })
  | (Base & { type: 'step'; step: Step; gameId?: string })
  | (Base & { type: 'billboard'; slot: string })
  /** Sampled once a minute while anyone is online. */
  | (Base & { type: 'concurrency'; players: number; sockets: number; rooms: number; publicWaiting?: number })
  /** A game that ended without finishing (everyone left, or the admins closed it). */
  | (Base & { type: 'abandoned'; gameId: string; humans: number; players: number; poster: number; posters: number })
  /** How people got into rooms: created public/private, Quick Play, the list, a code or invite link. */
  | (Base & { type: 'lobby'; action: LobbyAction })
  | (Base & {
      type: 'safety';
      kind: SafetyKind;
      /** Who did it: a host (kick), the admins (ban), a player (report, mute), the server (rate limit). */
      by?: 'host' | 'admin' | 'player' | 'server';
      /** The anonymous id it was about. */
      target?: string | null;
      reason?: string;
      /** Reports only: the reported message and a few before it. Chat is stored nowhere else. */
      chat?: { text: string; reported: boolean; fromReported: boolean }[];
      /** Rate-limit hits, counted per minute per limit. */
      limit?: string;
      count?: number;
    });

export type EventType = AnalyticsEvent['type'];

/** The anonymous analytics id for a browser: a hash, so the stored value can't be used to act as that browser. */
export function anonId(browserId: string | null | undefined): string | null {
  return browserId ? createHash('sha256').update(`wtc-anon:${browserId}`).digest('base64url').slice(0, 16) : null;
}

export const isAnonId = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{16}$/.test(v);

/** Phone/tablet or computer, from the user agent (which isn't kept). */
export function deviceOf(headers: IncomingHttpHeaders): Device {
  const ua = String(headers['user-agent'] ?? '');
  return /Mobi|Android|iPhone|iPad|iPod|Tablet|Silk|Kindle/i.test(ua) ? 'mobile' : 'desktop';
}

/** Two-letter country from Cloudflare (only behind a proxy we trust); XX/T1 (unknown, Tor) become null. */
export function countryOf(headers: IncomingHttpHeaders, trustProxy: boolean): string | null {
  if (!trustProxy) return null;
  const c = String(headers['cf-ipcountry'] ?? '').toUpperCase();
  return /^[A-Z]{2}$/.test(c) && c !== 'XX' && c !== 'T1' ? c : null;
}
