import type { GameRules, ItemType, PhaseTimers, RoomSettings } from './types';

export const MIN_PLAYERS = 6;
export const MAX_PLAYERS = 15;

export const STARTING_POINTS = 100;
export const BASE_POT = 100;
export const ESCAPE_BONUS = 100;
export const BUY_INSPECT_PRICE = 20;
export const EXTRA_INSPECT_PRICE = 50;
/** Searches per extra-search purchase. 2 keeps a search ($25) dearer than buying someone's findings ($20). */
export const EXTRA_INSPECT_COUNT = 2;
export const PURCHASE_CAP = 3;
/** Dirty tricks (bought during a payout, secret, money to the next bounty). */
export const SWAP_PRICE = 25;
export const COVER_PRICE = 50;
/** A private look at everyone's money. */
export const WORTH_PRICE = 20;

/** Seconds of "First poster coming up in 5, 4…" before the first poster of a game. */
export const GAME_COUNTDOWN_SECONDS = 5;

export const SEAT_HOLD_MS = 90_000;
export const HOST_GRACE_MS = 20_000;

export const ROOM_CODE_LENGTH = 5;
// No look-alikes: drops O/0, I/1/L.
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** Display names: 20 fits every CrazyGames username (6-20 characters). */
export const NAME_MAX = 20;
export const CHAT_MAX = 200;

export const ITEM_TYPES: ItemType[] = ['poncho', 'cloak', 'bandana'];
/** Posters per game: a host setting, independent of the number of players. */
export const POSTER_RANGE = { min: 3, max: 20, default: 10 } as const;

export const INSPECT_RANGE = { min: 2, max: 5 } as const;
export const SWAP_RANGE = { min: 0, max: 5 } as const;

/** 'auto' color changes: no limit beyond one per payout (each costs SWAP_PRICE). */
export function defaultSwaps(posterCount: number): number {
  return Math.max(0, posterCount - 1);
}

export function defaultInspects(playerCount: number): number {
  return playerCount >= 12 ? 4 : 3;
}

/** Seconds. [min, max] per phase. */
export const TIMER_LIMITS: Record<keyof PhaseTimers, [number, number]> = {
  poster: [3, 15],
  investigation: [30, 300],
  vote: [10, 60],
  payout: [5, 30],
};

/**
 * Practice with bots (from How to Play): a short game, one human and bots, slower timers so
 * there's time to read the hints. Normal games never use these.
 */
export const PRACTICE = {
  bots: 7,
  posters: 3,
  timers: { poster: 8, investigation: 210, vote: 45, payout: 20 } satisfies PhaseTimers,
};

export const DEFAULT_TIMERS: PhaseTimers = {
  poster: 5,
  investigation: 120,
  vote: 20,
  // Long enough to choose a dirty trick.
  payout: 15,
};

export const DEFAULT_RULES: GameRules = {
  startingPoints: STARTING_POINTS,
  basePot: BASE_POT,
  escapeBonus: ESCAPE_BONUS,
  buyPrice: BUY_INSPECT_PRICE,
  extraInspectPrice: EXTRA_INSPECT_PRICE,
  extraInspectCount: EXTRA_INSPECT_COUNT,
  purchaseCap: PURCHASE_CAP,
  swapPrice: SWAP_PRICE,
  coverPrice: COVER_PRICE,
  worthPrice: WORTH_PRICE,
  // Playtest default (spec: 2). The simulator found 3 keeps mid/late posters from being solved outright.
  decoys: 3,
};

/** [min, max] per balance number. */
export const RULE_LIMITS: Record<keyof GameRules, [number, number]> = {
  startingPoints: [0, 500],
  basePot: [10, 500],
  escapeBonus: [0, 300],
  buyPrice: [0, 200],
  extraInspectPrice: [0, 300],
  extraInspectCount: [1, 5],
  purchaseCap: [0, 6],
  swapPrice: [0, 300],
  coverPrice: [0, 300],
  worthPrice: [0, 200],
  decoys: [1, 4],
};

/** Roughly how long a game takes, in seconds: every poster's phases plus the countdown. */
export function estimatedGameSeconds(posters: number, timers: PhaseTimers): number {
  return posters * (timers.poster + timers.investigation + timers.vote + timers.payout) + GAME_COUNTDOWN_SECONDS;
}

export const DEFAULT_SETTINGS: RoomSettings = {
  inspectsPerRound: 'auto',
  colorSwaps: 'auto',
  posters: POSTER_RANGE.default,
  timers: DEFAULT_TIMERS,
  rules: DEFAULT_RULES,
};
