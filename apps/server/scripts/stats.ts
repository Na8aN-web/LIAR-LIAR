// Summarise real games from the server's stats log.
//   pnpm stats                  reads logs/games.jsonl (in apps/server)
//   pnpm stats -- path/to/games.jsonl
//   pnpm stats -- --all         include bot-only games and playtest:check games
import { readFileSync } from 'node:fs';
import type { GameSummary, PlayerStats } from '../src/game/summary';
import { report } from './report';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('-')) ?? 'logs/games.jsonl';
let games: GameSummary[];
try {
  games = readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));
} catch {
  console.log(`No game log at ${file} yet. Finish a game first.`);
  process.exit(0);
}
// Bot-only games and the simulated players of `pnpm playtest:check` aren't real playtest data.
const shown = args.includes('--all') ? games : games.filter((g) => g.bots < g.players && !g.check);
console.log(`${games.length} games in ${file}${shown.length < games.length ? ` (showing the ${shown.length} played by people; --all for every game)` : ''}`);
if (!shown.length) process.exit(0);

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const f1 = (n: number) => n.toFixed(1);
const pad = (s: string | number, n: number) => String(s).padStart(n);
const humans = (g: GameSummary) => (g.perPlayer ?? []).filter((p) => !p.bot);
const searchTimes = (ps: PlayerStats[]) => ps.flatMap((p) => p.firstSearchSec.filter((x): x is number => x !== null));

// ---------------------------------------------------------------- each game
for (const [i, g] of shown.entries()) {
  const when = new Date(g.endedAt).toLocaleString();
  const r = g.settings.rules;
  console.log(`\n=== Game ${i + 1}  ${when}  ${(g.durationMs / 60000).toFixed(1)} min`);
  console.log(`    ${g.players} players (${g.bots} bots), ${g.posters.length} posters, ${g.inspectLimit} searches/round, ${r.decoys} fakes, ${g.swapLimit} color changes allowed`);
  if (g.accusations) {
    console.log('    Poster   right  wrong  no vote   outlaw');
    for (const a of g.accusations) {
      const p = g.posters.find((x) => x.poster === a.poster);
      console.log(`    ${pad(a.poster + 1, 6)}  ${pad(a.correct, 5)}  ${pad(a.wrong, 5)}  ${pad(a.none, 7)}   ${p?.escaped ? 'escaped' : 'caught'}`);
    }
  }
  const ps = humans(g);
  if (ps.length) {
    console.log('    Player  1st search (median s)  searches  bought  extra  colors  drops/back  finished  how to play');
    for (const p of ps) {
      const t = p.firstSearchSec.filter((x): x is number => x !== null);
      console.log(
        `    ${pad('#' + (p.player + 1), 6)}  ${pad(t.length ? f1(median(t)) : '–', 21)}  ${pad(p.searches, 8)}  ${pad(p.findingsBought, 6)}  ${pad(p.extraLooks, 5)}  ${pad(p.colorChanges, 6)}  ${pad(`${p.disconnects}/${p.reconnects}`, 10)}  ${pad(p.finished ? 'yes' : 'no', 8)}  ${p.howto ?? '?'}`,
      );
    }
  } else {
    console.log('    (per-player stats start with games played on this version)');
  }
}

// ---------------------------------------------------------------- across games
const all = shown.flatMap(humans);
console.log(`\n=== Across ${shown.length} game${shown.length === 1 ? '' : 's'} (${all.length} player-games)`);
if (all.length) {
  const times = searchTimes(all);
  console.log(`    first search after a poster appears   median ${f1(median(times))} s, average ${f1(mean(times))} s`);
  console.log(`    per player per game                   ${f1(mean(all.map((p) => p.searches)))} searches, ${f1(mean(all.map((p) => p.findingsBought)))} findings bought, ${f1(mean(all.map((p) => p.extraLooks)))} extra searches, ${f1(mean(all.map((p) => p.colorChanges)))} color changes`);
  const never = all.filter((p) => p.findingsBought === 0 && p.extraLooks === 0).length;
  console.log(`    never bought anything                 ${never} of ${all.length}`);
  const dropped = all.filter((p) => p.disconnects > 0);
  console.log(`    lost connection at least once         ${dropped.length} of ${all.length} (${dropped.reduce((a, p) => a + p.reconnects, 0)} reconnects in total)`);
  console.log(`    finished the game                     ${all.filter((p) => p.finished).length} of ${all.length}`);
  const how = (s: string) => all.filter((p) => p.howto === s).length;
  console.log(`    How to Play                           ${how('finished')} finished, ${how('skipped')} skipped, ${how('never')} never opened${all.some((p) => !p.howto) ? `, ${all.filter((p) => !p.howto).length} unknown` : ''}`);
}
const acc = shown.flatMap((g) => g.accusations ?? []);
if (acc.length) {
  const votes = acc.reduce((a, x) => a + x.correct + x.wrong + x.none, 0) || 1;
  const sum = (k: 'correct' | 'wrong' | 'none') => acc.reduce((a, x) => a + x[k], 0);
  console.log(`    accusations                           ${Math.round((100 * sum('correct')) / votes)}% right, ${Math.round((100 * sum('wrong')) / votes)}% wrong, ${Math.round((100 * sum('none')) / votes)}% no vote (${acc.length} rounds)`);
}

// Balance view, grouped by the settings that matter (as before).
const groups = new Map<string, GameSummary[]>();
for (const g of shown) {
  const r = g.settings.rules;
  const key = `${g.settings.posterMode}, ${g.players}p, ${g.inspectLimit} searches, ${r.decoys} fakes, ${g.swapLimit ?? 0} color changes, pot ${r.basePot}, escape ${r.escapeBonus}, buy ${r.buyPrice}/${r.extraInspectPrice}, cap ${r.purchaseCap}`;
  groups.set(key, [...(groups.get(key) ?? []), g]);
}
for (const [key, gs] of groups) {
  report(`Balance: ${key}  (${gs.length} games)`, gs);
  console.log(`  length           ${f1(mean(gs.map((g) => g.durationMs / 60000)))} min avg`);
}
