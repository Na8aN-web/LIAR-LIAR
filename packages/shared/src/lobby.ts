// Public and private rooms, and the Find a Lobby list.

export type Visibility = 'public' | 'private';
export const VISIBILITIES: Visibility[] = ['private', 'public'];

/** Room name length (characters). */
export const ROOM_NAME_MAX = 28;

/** "Ada's Campfire": the name a room gets when the host doesn't choose one. */
export function defaultRoomName(host: string): string {
  const n = host.trim() || 'A stranger';
  return `${n}${/s$/i.test(n) ? "'" : "'s"} Campfire`;
}

/** Public rooms: after this long with too few people, offer the host to fill the seats with bots. */
export const AUTO_FILL = { defaultSec: 120, minSec: 30, maxSec: 600 } as const;

export interface AutoFill {
  enabled: boolean;
  /** Seconds after the room opened (or went public) before the offer appears. */
  afterSec: number;
}

/**
 * One row of Find a Lobby. Only what the list shows: never the room code (joining goes through
 * the opaque `id`), never colors, never anything about a private room (they aren't listed at all).
 */
export interface LobbyListing {
  /** Opaque id for joining from the list. Not the room code. */
  id: string;
  name: string;
  host: string;
  /** Everyone seated, bots included. */
  players: number;
  bots: number;
  maxPlayers: number;
  /** Posters this game will have (a host setting). */
  posters: number;
  /** A quick-start lobby: it fills with bots and starts by itself (see RoomInfo.autoStartAt). */
  autoStart: boolean;
  /** Searches per round. */
  searches: number;
}

export interface LobbyListUpdate {
  rooms: LobbyListing[];
  /** People with the game open right now ("23 outlaws in town"). */
  online: number;
}

/** Room details every player in the room sees (the lobby header, the host's controls). */
export interface RoomInfo {
  name: string;
  visibility: Visibility;
  autoFill: AutoFill;
  /** Server time (ms) when the host is offered to fill empty seats with bots; null = not now. */
  fillOfferAt: number | null;
  /**
   * The room is about to close: server time (ms) it closes at, and why. 'idle': nothing has
   * happened for a while (any action keeps it open); 'maxAge': open too long without a game.
   */
  closing: { at: number; why: 'idle' | 'maxAge' } | null;
  /**
   * Quick-start lobby (one tap from a game portal): server time (ms) when it fills the empty
   * seats with bots and starts by itself; null for ordinary rooms, and once the game is on.
   */
  autoStartAt: number | null;
}

/** Quick-start lobbies start this long after they open (or go back to the lobby). */
export const AUTO_START_SEC = 30;
