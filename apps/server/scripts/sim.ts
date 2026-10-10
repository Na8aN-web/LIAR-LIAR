// Headless balance simulator: bot-only games with short timers, run in parallel.
//   pnpm sim                      10 players, 30 games per poster mode, default settings (swaps auto)
//   pnpm sim -- --players 15 --games 50 --mode randomRepeats --inspects 2 --decoys 3 --cap 0 --swaps 2 --threshold 4
// Bots only use their own view, so this measures the rules, not bot cheating.
// For a grid of settings, see sweep.ts.
import { DEFAULT_SETTINGS, POSTER_MODES, type PosterMode } from '@wtc/shared';
import { DEFAULT_BOT_CONFIG } from '../src/bots/driver';
import { report } from './report';
import { runMany, type SimOptions } from './simlib';

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}
const players = Number(arg('players', '10'));
const games = Number(arg('games', '30'));
const modeArg = arg('mode', 'both');
const modes: PosterMode[] = modeArg === 'both' ? POSTER_MODES : [modeArg as PosterMode];
const inspectsArg = arg('inspects', 'auto');
const base: Omit<SimOptions, 'posterMode'> = {
  players,
  inspects: inspectsArg === 'auto' ? 'auto' : Number(inspectsArg),
  colorSwaps: ((v) => (v === 'auto' ? 'auto' : Number(v)))(arg('swaps', String(DEFAULT_SETTINGS.colorSwaps))),
  rules: {
    decoys: Number(arg('decoys', String(DEFAULT_SETTINGS.rules.decoys))),
    purchaseCap: Number(arg('cap', String(DEFAULT_SETTINGS.rules.purchaseCap))),
  },
  bots: { swapThreshold: Number(arg('threshold', String(DEFAULT_BOT_CONFIG.swapThreshold))) },
};

const started = Date.now();
console.log(
  `Simulating ${games} games per mode with ${players} bots, inspects ${inspectsArg}, decoys ${base.rules.decoys}, ` +
    `purchase cap ${base.rules.purchaseCap}, swaps ${base.colorSwaps}, bot swap threshold ${base.bots.swapThreshold}…`,
);
for (const m of modes) report(`${m}  (${games} games, ${players} players)`, await runMany(games, { ...base, posterMode: m }));
console.log(`\ndone in ${((Date.now() - started) / 1000).toFixed(0)}s`);
process.exit(0);
