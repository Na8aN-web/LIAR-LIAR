import type { GameRules, ItemType, PhaseTimers, PosterMode, RoomSettings } from './types';

export const MIN_PLAYERS = 6;
export const MAX_PLAYERS = 15;

export const STARTING_POINTS = 100;
export const BASE_POT = 100;
export const ESCAPE_BONUS = 50;
export const BUY_INSPECT_PRICE = 20;
export const EXTRA_INSPECT_PRICE = 50;
export const PURCHASE_CAP = 3;

export const SEAT_HOLD_MS = 90_000;
export const HOST_GRACE_MS = 20_000;

export const ROOM_CODE_LENGTH = 5;
// No look-alikes: drops O/0, I/1/L.
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export const NAME_MAX = 16;
export const CHAT_MAX = 200;

export const ITEM_TYPES: ItemType[] = ['poncho', 'cloak', 'bandana'];
export const POSTER_MODES: PosterMode[] = ['everyoneOnce', 'randomRepeats'];

export const INSPECT_RANGE = { min: 2, max: 5 } as const;
export const SWAP_RANGE = { min: 0, max: 5 } as const;

/** 'auto' color swaps: about 1 per 4 posters (3 at 10 players, 4 at 15). */
export function defaultSwaps(posterCount: number): number {
  return Math.min(SWAP_RANGE.max, Math.ceil(posterCount / 4));
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

export const DEFAULT_TIMERS: PhaseTimers = {
  poster: 5,
  investigation: 120,
  vote: 20,
  payout: 10,
};

export const DEFAULT_RULES: GameRules = {
  startingPoints: STARTING_POINTS,
  basePot: BASE_POT,
  escapeBonus: ESCAPE_BONUS,
  buyPrice: BUY_INSPECT_PRICE,
  extraInspectPrice: EXTRA_INSPECT_PRICE,
  purchaseCap: PURCHASE_CAP,
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
  purchaseCap: [0, 6],
  decoys: [1, 4],
};

export const DEFAULT_SETTINGS: RoomSettings = {
  inspectsPerRound: 'auto',
  colorSwaps: 'auto',
  // Playtest default: "everyone once" lets late posters be solved by elimination.
  posterMode: 'randomRepeats',
  timers: DEFAULT_TIMERS,
  rules: DEFAULT_RULES,
};
