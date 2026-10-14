// Dirty tricks and herding, measured with bot-only games.
//   pnpm --filter @wtc/server sim:tricks -- --games 200 --players 8
// Compares the rules before this change (no Cover your tracks, $30 color change, one poster per
// player) with Cover your tracks at $30, $40 and $50 ($25 color change, 10 posters), escape $100.
// Bots decide from their own view only; they don't see eye counts or read the vote panel, so
// the herding numbers here describe the search patterns, not human crowd behaviour.
import { DEFAULT_SETTINGS } from '@wtc/shared';
import type { GameState } from '../src/game/engine';
import { runManyFull, type SimOptions } from './simlib';

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}
const games = Number(arg('games', '200'));
const players = Number(arg('players', '8'));
const coverChance = Number(arg('chance', '0.15'));
const prices = arg('prices', '30,40,50').split(',').map(Number);
const withBefore = arg('before', 'yes') !== 'no';

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const pct = (x: number) => (Number.isFinite(x) ? `${(x * 100).toFixed(1)}%` : '–');
const money = (x: number) => (Number.isFinite(x) ? `${x >= 0 ? '+' : '-'}$${Math.abs(x).toFixed(1)}` : '–');

function measure(results: { game: GameState; summary: { posters: { herd?: { topSearchedMostVoted: boolean | null; topSearchedWasWanted: boolean | null }; voters: number; correct: number; escaped: boolean }[] } }[], coverPrice: number) {
  const coveredEsc: number[] = [];
  const plainEsc: number[] = [];
  const innocentNet: number[] = [];
  const innocentBase: number[] = [];
  const innocentVotesOn: number[] = [];
  const othersVotesOn: number[] = [];
  const herdVoted: number[] = [];
  const herdWanted: number[] = [];
  const accuracy: number[] = [];
  let covers = 0;
  for (const { game: g, summary } of results) {
    for (const h of g.history) {
      const covered = g.coveredByPoster[h.poster] ?? [];
      covers += covered.length;
      (covered.includes(h.wantedId) ? coveredEsc : plainEsc).push(h.escaped ? 1 : 0);
      const votesOn = (id: string) => Object.values(h.votes).filter((v) => v === id).length;
      const innocents = g.playerIds.filter((p) => p !== h.wantedId);
      for (const p of innocents) {
        const payout = g.rounds[p][h.poster]?.payout ?? 0;
        if (covered.includes(p)) {
          innocentNet.push(payout - coverPrice);
          innocentVotesOn.push(votesOn(p));
        } else {
          innocentBase.push(payout);
          othersVotesOn.push(votesOn(p));
        }
      }
    }
    for (const p of summary.posters) {
      if (p.voters) accuracy.push(p.correct / p.voters);
      if (p.herd && p.herd.topSearchedMostVoted !== null) {
        herdVoted.push(p.herd.topSearchedMostVoted ? 1 : 0);
        herdWanted.push(p.herd.topSearchedWasWanted ? 1 : 0);
      }
    }
  }
  const posters = results.reduce((a, r) => a + r.game.history.length, 0);
  return {
    posters,
    coversPerPoster: covers / Math.max(1, posters),
    coveredOutlawPosters: coveredEsc.length,
    coveredEscape: mean(coveredEsc),
    plainEscape: mean(plainEsc),
    innocentCovers: innocentNet.length,
    innocentNet: mean(innocentNet),
    innocentBase: mean(innocentBase),
    votesOnCoveredInnocent: mean(innocentVotesOn),
    votesOnOtherInnocent: mean(othersVotesOn),
    herdMostVoted: mean(herdVoted),
    herdWasOutlaw: mean(herdWanted),
    accuracy: mean(accuracy),
  };
}

const base: SimOptions = { players, inspects: 'auto', colorSwaps: 'auto', rules: { escapeBonus: 100 }, bots: {} };
const configs: { name: string; o: SimOptions; coverPrice: number }[] = [
  ...(withBefore ? [{ name: 'Before (no cover, color change $30, 1 poster/player)', o: { ...base, posters: players, rules: { ...base.rules, swapPrice: 30 }, bots: { coverChance: 0 } }, coverPrice: 0 }] : []),
  ...prices.map((price) => ({
    name: `Cover your tracks $${price} (color change $25, 10 posters)`,
    o: { ...base, posters: DEFAULT_SETTINGS.posters, rules: { ...base.rules, swapPrice: 25, coverPrice: price }, bots: { coverChance } },
    coverPrice: price,
  })),
];

const started = Date.now();
console.log(`${games} games per setting, ${players} bots, bots cover with chance ${coverChance} when watched and flush.\n`);
const rows: [string, ReturnType<typeof measure>][] = [];
for (const c of configs) {
  const t = Date.now();
  const r = measure(await runManyFull(games, c.o), c.coverPrice);
  rows.push([c.name, r]);
  console.log(`${c.name}  (${((Date.now() - t) / 1000).toFixed(0)}s)`);
  console.log(`  posters ${r.posters}, covers per poster ${r.coversPerPoster.toFixed(2)}`);
  console.log(`  outlaw escapes: covered ${pct(r.coveredEscape)} (n=${r.coveredOutlawPosters}), not covered ${pct(r.plainEscape)}`);
  console.log(`  innocent coverers: net ${money(r.innocentNet)} per cover vs ${money(r.innocentBase)} for innocents who didn't (n=${r.innocentCovers}); votes against them ${r.votesOnCoveredInnocent.toFixed(2)} vs ${r.votesOnOtherInnocent.toFixed(2)}`);
  console.log(`  herding: most-searched got most votes ${pct(r.herdMostVoted)}, and was the outlaw ${pct(r.herdWasOutlaw)}; voter accuracy ${pct(r.accuracy)}\n`);
}
console.log(`done in ${((Date.now() - started) / 1000).toFixed(0)}s`);
console.log(`JSON ${JSON.stringify(rows)}`);
process.exit(0);
