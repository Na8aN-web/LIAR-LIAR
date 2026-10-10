import { DEFAULT_SETTINGS, type GameRules, type PosterMode, type RoomSettings } from '@wtc/shared';
import type { BotConfig } from '../src/bots/driver';
import type { GameSummary } from '../src/game/summary';
import { secureRng } from '../src/rng';
import { Room } from '../src/room';

// Shared by sim.ts and sweep.ts: run one bot-only game in fast time.

const NAMES = ['Hank', 'Dolly', 'Clem', 'Ezra', 'Mae', 'Silas', 'Ruby', 'Jeb', 'Pearl', 'Wyatt', 'Etta', 'Boone', 'Nell', 'Cody', 'June'];

// Seconds. Bots scale their timing to the phase, so short phases are fine.
// Payout needs a little room because bots swap colors during it.
export const SIM_TIMERS = { poster: 0.05, investigation: 3, vote: 1, payout: 0.3 };

export interface SimOptions {
  players: number;
  posterMode: PosterMode;
  inspects: number | 'auto';
  colorSwaps: number | 'auto';
  rules: Partial<GameRules>;
  bots: Partial<BotConfig>;
}

export function runGame(o: SimOptions): Promise<GameSummary> {
  return new Promise((resolve) => {
    const room = new Room('SIM00', {
      send: () => {},
      rng: secureRng,
      devMode: true,
      minPlayers: 2,
      bots: o.bots,
      onGameEnd: (s) => {
        room.dispose();
        resolve(s);
      },
    });
    for (let i = 0; i < o.players; i++) room.addPlayer(NAMES[i], null, true);
    const host = [...room.seats.values()][0];
    room.hostId = host.id;
    const settings: RoomSettings = {
      ...structuredClone(DEFAULT_SETTINGS),
      posterMode: o.posterMode,
      timers: SIM_TIMERS,
      rules: { ...DEFAULT_SETTINGS.rules, ...o.rules },
      inspectsPerRound: o.inspects,
      colorSwaps: o.colorSwaps,
    };
    room.settings = settings;
    const res = room.start(host.id);
    if (!res.ok) throw new Error(res.error);
  });
}

/** Run games with at most `parallel` in flight, so big sweeps don't starve the timers. */
export async function runMany(count: number, o: SimOptions, parallel = 40): Promise<GameSummary[]> {
  const out: GameSummary[] = [];
  let next = 0;
  const worker = async () => {
    while (next < count) {
      next++;
      out.push(await runGame(o));
    }
  };
  await Promise.all(Array.from({ length: Math.min(parallel, count) }, worker));
  return out;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/** Share of voters who were right, by game third and on the final poster. */
export function accuracy(results: GameSummary[]) {
  const thirds = [[], [], []] as number[][];
  const finals: number[] = [];
  for (const g of results) {
    const n = g.posters.length;
    for (const p of g.posters) {
      const acc = p.voters ? p.correct / p.voters : 0;
      thirds[Math.min(2, Math.floor((p.poster / n) * 3))].push(acc);
      if (p.poster === n - 1) finals.push(acc);
    }
  }
  return {
    early: mean(thirds[0]),
    mid: mean(thirds[1]),
    late: mean(thirds[2]),
    final: mean(finals),
    swapsPerPlayer: mean(results.map((g) => g.totalSwaps / g.players)),
  };
}
