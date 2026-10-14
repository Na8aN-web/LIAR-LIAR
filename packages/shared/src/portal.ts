import { ROOM_CODE_LENGTH } from './constants';
import type { Phase } from './types';

// Game portals (CrazyGames now; Vatar/Lagos Life and Poki later) run the same game, server and
// lobbies as the website. Their pages live under /play/<portal>, with headers that let the
// portal frame them; the website's own pages are unchanged. This file is the pure, tested part
// of the adapter layer (the browser side is apps/web/lib/portal).

export type PortalId = 'web' | 'crazygames';

/** Portals with their own pages (the website is 'web', at the root). */
export const PORTALS: Exclude<PortalId, 'web'>[] = ['crazygames'];

export const PORTAL_BASE = '/play';

/** The portal a page belongs to, from its path: /play/crazygames/... is CrazyGames, the rest is the website. */
export function portalFromPath(pathname: string): PortalId {
  const m = /^\/play\/([a-z]+)(?:\/|$)/.exec(pathname);
  return m && (PORTALS as string[]).includes(m[1]) ? (m[1] as PortalId) : 'web';
}

/** Base path of a portal's pages: '' for the website. */
export function portalBase(portal: PortalId): string {
  return portal === 'web' ? '' : `${PORTAL_BASE}/${portal}`;
}

/** A room's page on a portal (the website's is /r/CODE). */
export function portalRoomPath(portal: PortalId, code: string): string {
  return `${portalBase(portal)}/r/${code}`;
}

const CODE_RE = new RegExp(`^[A-HJKMNP-Z2-9]{${ROOM_CODE_LENGTH}}$`);

/** The room an invite points at (a portal's invite parameters: { room: CODE }), or null. */
export function roomFromInvite(params: Record<string, unknown> | null | undefined): string | null {
  const raw = params?.room;
  if (typeof raw !== 'string') return null;
  const code = raw.trim().toUpperCase();
  return CODE_RE.test(code) ? code : null;
}

/** What a portal's friends features (Join, Invite) are told about the room you're in. */
export interface RoomPresence {
  roomId: string;
  /** Friends can join now: the room is in the lobby, not full and not locked. */
  isJoinable: boolean;
  inviteParams: { room: string };
}

/**
 * Join/Invite state for the room a player is in. Not joinable once a game starts (latecomers
 * would only watch), when full, or when the host locked it.
 */
export function roomPresence(v: { code: string; phase: Phase; players: unknown[]; maxPlayers: number; locked: boolean; practice: boolean }): RoomPresence {
  return {
    roomId: v.code,
    isJoinable: v.phase === 'lobby' && !v.locked && !v.practice && v.players.length < v.maxPlayers,
    inviteParams: { room: v.code },
  };
}

const GUEST_NAMES = ['Drifter', 'Stranger', 'Tumbleweed', 'Rattler', 'Coyote', 'Maverick', 'Wrangler', 'Prospector', 'Bandit', 'Outrider'];

/** A name for a portal guest (not logged in): "Coyote 4821". */
export function guestName(rand: () => number): string {
  return `${GUEST_NAMES[Math.floor(rand() * GUEST_NAMES.length)]} ${1000 + Math.floor(rand() * 9000)}`;
}
