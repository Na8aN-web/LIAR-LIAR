// Grid search over color swaps x decoys (and optionally bot swap threshold).
//   pnpm sweep                                   10 players, 30 games per cell, swaps 0-3 x decoys 2-3
//   pnpm sweep -- --players 6 --swaps 2,3 --decoys 3 --thresholds 3,4,5
// Prints % of voters who were right by game third, plus swaps used per player.
import { DEFAULT_SETTINGS } from '@wtc/shared';
import { DEFAULT_BOT_CONFIG } from '../src/bots/driver';
import { accuracy, runMany } from './simlib';

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}
const list = (s: string) => s.split(',').map(Number);
const players = Number(arg('players', '10'));
const games = Number(arg('games', '30'));
const swaps = list(arg('swaps', '0,1,2,3'));
const decoys = list(arg('decoys', '2,3'));
const thresholds = list(arg('thresholds', String(DEFAULT_BOT_CONFIG.swapThreshold)));
const posters = Number(arg('posters', String(DEFAULT_SETTINGS.posters)));

const pct = (x: number) => `${Math.round(x * 100)}%`.padStart(6);
const started = Date.now();
console.log(`${players} players, ${games} games per cell, ${posters} posters, default inspects/buying\n`);
console.log('swaps  decoys  threshold |  early    mid   late  final | swaps used/player');
console.log('------------------------ + -------------------------- + -----------------');
for (const d of decoys) {
  for (const s of swaps) {
    for (const t of s === 0 ? [thresholds[0]] : thresholds) {
      const r = accuracy(
        await runMany(games, {
          players,
          posters,
          inspects: 'auto',
          colorSwaps: s,
          rules: { decoys: d },
          bots: { swapThreshold: t },
        }),
      );
      const th = s === 0 ? '-' : String(t);
      console.log(
        `${String(s).padStart(5)}  ${String(d).padStart(6)}  ${th.padStart(9)} | ${pct(r.early)} ${pct(r.mid)} ${pct(r.late)} ${pct(r.final)} | ${r.swapsPerPlayer.toFixed(2).padStart(6)}`,
      );
    }
  }
}
console.log(`\ndone in ${((Date.now() - started) / 1000).toFixed(0)}s`);
process.exit(0);
