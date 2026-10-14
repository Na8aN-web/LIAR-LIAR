import type { HowtoStatus, RoomSettings, TutorialProgress } from '@wtc/shared';
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
    /**
     * Herding: did the most-searched player (alone at the top) also get the most votes, and was
     * that player actually the outlaw? null when nobody was searched most.
     */
    herd?: { topSearchedMostVoted: boolean | null; topSearchedWasWanted: boolean | null };
    /** Players who had covered their tracks this poster, and whether the outlaw was one. */
    covered?: number;
    coveredWanted?: boolean;
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

  // ---- playtest fields (anonymous: players are numbered by seat, never named) ----
  /** Links this line to the feedback form answers from the same game. */
  gameId?: string;
  /** A game played by `pnpm playtest:check` (simulated players): left out of `pnpm stats`. */
  check?: boolean;
  /** Made up by `pnpm admin:seed` (imported playtest files and bot games). */
  seed?: true;
  /** At least one seat was a bot (stats and the dashboard can filter to human-only games). */
  withBots?: true;
  /** Accusations per round, among the players who weren't the outlaw. */
  accusations?: { poster: number; correct: number; wrong: number; none: number }[];
  /** One entry per player, in seat order. */
  perPlayer?: PlayerStats[];
}

export interface PlayerStats {
  /** Seat number (0 = first to join). */
  player: number;
  bot: boolean;
  /** Seconds from each poster appearing to this player's first search on it (null = didn't search). */
  firstSearchSec: (number | null)[];
  searches: number;
  /** Other players' findings bought (accepted offers) and extra searches bought. */
  findingsBought: number;
  extraLooks: number;
  colorChanges: number;
  disconnects: number;
  reconnects: number;
  /** Still connected at the end (not away). */
  finished: boolean;
  /** What they did with How to Play before playing (null = unknown, e.g. bots). */
  howto: HowtoStatus | null;
  /** First-game tutorial: stage reached (1-4) or 'skipped'; null when it wasn't their first game. */
  tutorial?: TutorialProgress | null;
  /** Anonymous per-browser id (null for bots), linking games to visits for the dashboard. */
  anon?: string | null;
}

export function summarize(
  s: GameState,
  meta: {
    startedAt: number;
    settings: RoomSettings;
    isBot: (id: string) => boolean;
    gameId?: string;
    check?: boolean;
    /** When each poster appeared (ms since epoch), by poster index. */
    posterStarts?: number[];
    seat?: (id: string) => { disconnects: number; reconnects: number; howto: HowtoStatus | null; tutorial?: TutorialProgress | null; away: boolean; anon?: string | null };
  },
): GameSummary {
  const count = (status: string) => s.offers.filter((o) => o.status === status).length;
  const potExtra = s.pots.reduce((a, b) => a + b, 0) - s.rules.basePot * s.pots.length;
  const finalScores = s.playerIds.map((p) => s.scores[p]).sort((a, b) => b - a);
  const top = s.playerIds.find((p) => s.scores[p] === finalScores[0])!;
  return {
    ...(meta.check ? { check: true } : {}),
    ...(s.playerIds.some(meta.isBot) ? { withBots: true as const } : {}),
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
      herd: herding(s, h.poster, h.votes, h.wantedId),
      covered: (s.coveredByPoster[h.poster] ?? []).length,
      coveredWanted: (s.coveredByPoster[h.poster] ?? []).includes(h.wantedId),
    })),
    inspects: s.log.length,
    offers: { made: s.offers.length, accepted: count('accepted'), declined: count('declined'), expired: count('expired') },
    extraInspects: s.rules.extraInspectPrice ? Math.round(potExtra / s.rules.extraInspectPrice) : 0,
    finalScores,
    winnerCorrectVotes: s.correctVotes[top],
    swapLimit: s.swapLimit,
    totalSwaps: Object.values(s.swapsUsed).reduce((a, b) => a + b, 0),
    colorChanges: s.colorChanges.slice(),
    gameId: meta.gameId,
    accusations: s.history.map((h) => {
      const voters = s.playerIds.filter((p) => p !== h.wantedId);
      const correct = voters.filter((p) => h.votes[p] === h.wantedId).length;
      const none = voters.filter((p) => !h.votes[p]).length;
      return { poster: h.poster, correct, wrong: voters.length - correct - none, none };
    }),
    perPlayer: s.playerIds.map((id, player) => {
      const info = meta.seat?.(id);
      return {
        player,
        bot: meta.isBot(id),
        firstSearchSec: s.history.map((h) => {
          const first = s.log.find((e) => e.poster === h.poster && e.inspectorId === id);
          const start = meta.posterStarts?.[h.poster];
          return first && start ? Math.round((first.at - start) / 100) / 10 : null;
        }),
        searches: s.log.filter((e) => e.inspectorId === id).length,
        findingsBought: s.offers.filter((o) => o.buyerId === id && o.status === 'accepted').length,
        extraLooks: s.extraInspectsTotal[id] ?? 0,
        colorChanges: s.swapsUsed[id] ?? 0,
        disconnects: info?.disconnects ?? 0,
        reconnects: info?.reconnects ?? 0,
        finished: info ? !info.away : true,
        howto: info?.howto ?? null,
        tutorial: info?.tutorial ?? null,
        anon: info?.anon ?? null,
      };
    }),
  };
}

/** The single player with the most of something, or null on a tie or nothing at all. */
function soleTop(counts: Map<string, number>): string | null {
  let best: string | null = null;
  let max = 0;
  let tie = false;
  for (const [id, n] of counts) {
    if (n > max) [best, max, tie] = [id, n, false];
    else if (n === max) tie = true;
  }
  return max > 0 && !tie ? best : null;
}

/** Herding on one poster: most-searched vs most-voted vs the actual outlaw. */
export function herding(s: GameState, poster: number, votes: Record<string, string | null>, wantedId: string) {
  const searched = new Map<string, number>();
  for (const e of s.log) if (e.poster === poster) searched.set(e.targetId, (searched.get(e.targetId) ?? 0) + 1);
  const voted = new Map<string, number>();
  for (const v of Object.values(votes)) if (v) voted.set(v, (voted.get(v) ?? 0) + 1);
  const top = soleTop(searched);
  if (!top) return { topSearchedMostVoted: null, topSearchedWasWanted: null };
  return { topSearchedMostVoted: soleTop(voted) === top, topSearchedWasWanted: top === wantedId };
}
