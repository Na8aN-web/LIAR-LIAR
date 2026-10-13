// How long rooms and players may sit idle. Every value can be changed with an environment
// variable (minutes unless it says otherwise); tests pass their own (tiny) values.
//
// "Activity" always means deliberate input from a player: searching, chatting, voting, buying,
// changing settings or looks, starting, adding bots... Never a page load, a reconnect, a
// background tab, or the analytics and How-to-Play reports the page sends by itself.

export interface RoomTimeouts {
  /** Lobby (or end screen) with no activity this long: warn ("going cold") and drop it from Find a Lobby. */
  lobbyIdleMs: number;
  /** After that warning: close the room unless someone does something. Also how early the lobby's hard limit warns. */
  lobbyIdleGraceMs: number;
  /** Public lobby: a host this inactive, while others wait, hands the room to the most active player. */
  hostAfkMs: number;
  /** In a game: this many posters in a row with no input marks a player away (shown to everyone). */
  awayAfterPosters: number;
  /** ...and this many removes them from the room. */
  removeAfterPosters: number;
  /** A room in the lobby closes this long after it opened (or went back to the lobby), whatever happens. */
  lobbyMaxMs: number;
  /** A game running longer than its expected length × this factor... */
  gameOvertimeFactor: number;
  /** ...plus this much, is closed. */
  gameOvertimeExtraMs: number;
  /** No player connected at all for this long: close. */
  emptyRoomMs: number;
  /** How often rooms are checked. */
  sweepMs: number;
}

const MIN = 60_000;

export const DEFAULT_TIMEOUTS: RoomTimeouts = {
  lobbyIdleMs: 10 * MIN,
  lobbyIdleGraceMs: 5 * MIN,
  hostAfkMs: 5 * MIN,
  awayAfterPosters: 2,
  removeAfterPosters: 3,
  lobbyMaxMs: 60 * MIN,
  gameOvertimeFactor: 2,
  gameOvertimeExtraMs: 10 * MIN,
  emptyRoomMs: 10 * MIN,
  sweepMs: 15_000,
};

/** Environment variable for each setting, and whether it's in minutes. */
export const TIMEOUT_ENV: Record<keyof RoomTimeouts, { name: string; minutes: boolean }> = {
  lobbyIdleMs: { name: 'ROOM_LOBBY_IDLE_MIN', minutes: true },
  lobbyIdleGraceMs: { name: 'ROOM_LOBBY_IDLE_GRACE_MIN', minutes: true },
  hostAfkMs: { name: 'ROOM_HOST_AFK_MIN', minutes: true },
  awayAfterPosters: { name: 'ROOM_AWAY_AFTER_POSTERS', minutes: false },
  removeAfterPosters: { name: 'ROOM_REMOVE_AFTER_POSTERS', minutes: false },
  lobbyMaxMs: { name: 'ROOM_LOBBY_MAX_MIN', minutes: true },
  gameOvertimeFactor: { name: 'ROOM_GAME_OVERTIME_FACTOR', minutes: false },
  gameOvertimeExtraMs: { name: 'ROOM_GAME_OVERTIME_EXTRA_MIN', minutes: true },
  emptyRoomMs: { name: 'ROOM_EMPTY_MIN', minutes: true },
  sweepMs: { name: 'ROOM_SWEEP_SECONDS', minutes: false },
};

/** Defaults, overridden by any valid environment variables. */
export function timeoutsFromEnv(env: NodeJS.ProcessEnv = process.env): RoomTimeouts {
  const out = { ...DEFAULT_TIMEOUTS };
  for (const key of Object.keys(TIMEOUT_ENV) as (keyof RoomTimeouts)[]) {
    const { name, minutes } = TIMEOUT_ENV[key];
    const raw = env[name];
    if (raw === undefined || raw === '') continue;
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) {
      console.warn(`Ignoring ${name}=${raw}: needs a positive number`);
      continue;
    }
    out[key] = key === 'sweepMs' ? n * 1000 : minutes ? n * MIN : n;
  }
  if (out.removeAfterPosters < out.awayAfterPosters) out.removeAfterPosters = out.awayAfterPosters;
  return out;
}
