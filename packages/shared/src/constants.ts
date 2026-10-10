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
  decoys: 2,
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
  posterMode: 'everyoneOnce',
  timers: DEFAULT_TIMERS,
  rules: DEFAULT_RULES,
};
