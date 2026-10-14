// Headless balance simulator: bot-only games with short timers, run in parallel.
//   pnpm sim                      10 players, 30 games, default settings (10 posters, swaps auto)
//   pnpm sim -- --players 15 --games 50 --posters 12 --inspects 2 --decoys 3 --cap 0 --swaps 2 --threshold 4 --cover 0.15
// Bots only use their own view, so this measures the rules, not bot cheating.
// For a grid of settings, see sweep.ts.
import { DEFAULT_SETTINGS } from '@wtc/shared';
import { DEFAULT_BOT_CONFIG } from '../src/bots/driver';
import { report } from './report';
import { runMany, type SimOptions } from './simlib';

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}
const players = Number(arg('players', '10'));
const games = Number(arg('games', '30'));
const inspectsArg = arg('inspects', 'auto');
const base: SimOptions = {
  players,
  posters: Number(arg('posters', String(DEFAULT_SETTINGS.posters))),
  inspects: inspectsArg === 'auto' ? 'auto' : Number(inspectsArg),
  colorSwaps: ((v) => (v === 'auto' ? 'auto' : Number(v)))(arg('swaps', String(DEFAULT_SETTINGS.colorSwaps))),
  rules: {
    decoys: Number(arg('decoys', String(DEFAULT_SETTINGS.rules.decoys))),
    purchaseCap: Number(arg('cap', String(DEFAULT_SETTINGS.rules.purchaseCap))),
  },
  bots: {
    swapThreshold: Number(arg('threshold', String(DEFAULT_BOT_CONFIG.swapThreshold))),
    coverChance: Number(arg('cover', String(DEFAULT_BOT_CONFIG.coverChance))),
  },
};

const started = Date.now();
console.log(
  `Simulating ${games} games with ${players} bots, ${base.posters} posters, inspects ${inspectsArg}, decoys ${base.rules.decoys}, ` +
    `purchase cap ${base.rules.purchaseCap}, swaps ${base.colorSwaps}, bot swap threshold ${base.bots.swapThreshold}…`,
);
report(`${base.posters} posters (${games} games, ${players} players)`, await runMany(games, base));
console.log(`\ndone in ${((Date.now() - started) / 1000).toFixed(0)}s`);
process.exit(0);
