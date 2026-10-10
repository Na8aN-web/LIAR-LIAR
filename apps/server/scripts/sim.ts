// Headless balance simulator: bot-only games with short timers, run in parallel.
//   pnpm sim                      10 players, 30 games per poster mode
//   pnpm sim -- --players 15 --games 50 --mode randomRepeats --inspects 2 --decoys 3 --cap 0
// Bots only use their own view, so this measures the rules, not bot cheating.
import { DEFAULT_SETTINGS, POSTER_MODES, type PosterMode, type RoomSettings } from '@wtc/shared';
import type { GameSummary } from '../src/game/summary';
import { secureRng } from '../src/rng';
import { Room } from '../src/room';
import { report } from './report';

const NAMES = ['Hank', 'Dolly', 'Clem', 'Ezra', 'Mae', 'Silas', 'Ruby', 'Jeb', 'Pearl', 'Wyatt', 'Etta', 'Boone', 'Nell', 'Cody', 'June'];

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}
const players = Number(arg('players', '10'));
const games = Number(arg('games', '30'));
const modeArg = arg('mode', 'both');
const modes: PosterMode[] = modeArg === 'both' ? POSTER_MODES : [modeArg as PosterMode];
const inspects = arg('inspects', 'auto');
const rules = {
  ...DEFAULT_SETTINGS.rules,
  decoys: Number(arg('decoys', String(DEFAULT_SETTINGS.rules.decoys))),
  purchaseCap: Number(arg('cap', String(DEFAULT_SETTINGS.rules.purchaseCap))),
};

// Seconds. Bots scale their timing to the phase, so short phases are fine.
const timers = { poster: 0.05, investigation: 3, vote: 1, payout: 0.05 };

function runGame(mode: PosterMode): Promise<GameSummary> {
  return new Promise((resolve) => {
    const room = new Room('SIM00', {
      send: () => {},
      rng: secureRng,
      devMode: true,
      minPlayers: 2,
      onGameEnd: (s) => {
        room.dispose();
        resolve(s);
      },
    });
    for (let i = 0; i < players; i++) room.addPlayer(NAMES[i], null, true);
    const host = [...room.seats.values()][0];
    room.hostId = host.id;
    const settings: RoomSettings = {
      ...structuredClone(DEFAULT_SETTINGS),
      posterMode: mode,
      timers,
      rules,
      inspectsPerRound: inspects === 'auto' ? 'auto' : Number(inspects),
    };
    room.settings = settings;
    const res = room.start(host.id);
    if (!res.ok) throw new Error(res.error);
  });
}

const started = Date.now();
console.log(`Simulating ${games} games per mode with ${players} bots, inspects ${inspects}, decoys ${rules.decoys}, purchase cap ${rules.purchaseCap}…`);
const all = await Promise.all(modes.map(async (m) => [m, await Promise.all(Array.from({ length: games }, () => runGame(m)))] as const));
for (const [m, r] of all) report(`${m}  (${r.length} games, ${players} players)`, r);
console.log(`\ndone in ${((Date.now() - started) / 1000).toFixed(0)}s`);
process.exit(0);
