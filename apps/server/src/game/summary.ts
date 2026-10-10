import type { RoomSettings } from '@wtc/shared';
import type { GameState } from './engine';

/** Anonymous per-game stats for balance tuning. One JSON line per finished game. */
export interface GameSummary {
  endedAt: string;
  durationMs: number;
  players: number;
  bots: number;
  inspectLimit: number;
  settings: RoomSettings;
  posters: {
    poster: number;
    wantedIsBot: boolean;
    pot: number;
    /** Non-Wanted players who voted. */
    voters: number;
    correct: number;
    escaped: boolean;
    payoutEach: number;
  }[];
  inspects: number;
  offers: { made: number; accepted: number; declined: number; expired: number };
  extraInspects: number;
  /** Final scores, highest first. */
  finalScores: number[];
  winnerCorrectVotes: number;
  /** Swaps allowed per player, and swaps actually used across all players. */
  swapLimit: number;
  totalSwaps: number;
  /** Public swap count before each poster. */
  colorChanges: number[];
}

export function summarize(
  s: GameState,
  meta: { startedAt: number; settings: RoomSettings; isBot: (id: string) => boolean },
): GameSummary {
  const count = (status: string) => s.offers.filter((o) => o.status === status).length;
  const potExtra = s.pots.reduce((a, b) => a + b, 0) - s.rules.basePot * s.pots.length;
  const finalScores = s.playerIds.map((p) => s.scores[p]).sort((a, b) => b - a);
  const top = s.playerIds.find((p) => s.scores[p] === finalScores[0])!;
  return {
    endedAt: new Date().toISOString(),
    durationMs: Date.now() - meta.startedAt,
    players: s.playerIds.length,
    bots: s.playerIds.filter(meta.isBot).length,
    inspectLimit: s.inspectLimit,
    settings: meta.settings,
    posters: s.history.map((h) => ({
      poster: h.poster,
      wantedIsBot: meta.isBot(h.wantedId),
      pot: h.pot,
      voters: Object.entries(h.votes).filter(([p, v]) => p !== h.wantedId && v).length,
      correct: h.correctIds.length,
      escaped: h.escaped,
      payoutEach: h.payoutEach,
    })),
    inspects: s.log.length,
    offers: { made: s.offers.length, accepted: count('accepted'), declined: count('declined'), expired: count('expired') },
    extraInspects: s.rules.extraInspectPrice ? Math.round(potExtra / s.rules.extraInspectPrice) : 0,
    finalScores,
    winnerCorrectVotes: s.correctVotes[top],
    swapLimit: s.swapLimit,
    totalSwaps: Object.values(s.swapsUsed).reduce((a, b) => a + b, 0),
    colorChanges: s.colorChanges.slice(),
  };
}
