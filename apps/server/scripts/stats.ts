// Summarise real games from the server's stats log.
//   pnpm stats                  reads logs/games.jsonl
//   pnpm stats -- path/to/games.jsonl
import { readFileSync } from 'node:fs';
import type { GameSummary } from '../src/game/summary';
import { report } from './report';

const file = process.argv.slice(2).find((a) => !a.startsWith('-')) ?? 'logs/games.jsonl';
let games: GameSummary[];
try {
  games = readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
} catch {
  console.log(`No game log at ${file} yet. Finish a game first.`);
  process.exit(0);
}
const humanGames = games.filter((g) => g.bots < g.players);
console.log(`${games.length} games in ${file} (${humanGames.length} with at least one human)`);

// Group by the settings that matter for balance so different configs don't blur together.
const groups = new Map<string, GameSummary[]>();
for (const g of humanGames.length ? humanGames : games) {
  const r = g.settings.rules;
  const key = `${g.settings.posterMode}, ${g.players}p, ${g.inspectLimit} inspects, ${r.decoys} decoys, pot ${r.basePot}, escape ${r.escapeBonus}, buy ${r.buyPrice}/${r.extraInspectPrice}, cap ${r.purchaseCap}`;
  groups.set(key, [...(groups.get(key) ?? []), g]);
}
for (const [key, gs] of groups) {
  report(`${key}  (${gs.length} games)`, gs);
  const mins = gs.map((g) => g.durationMs / 60000);
  console.log(`  length           ${(mins.reduce((a, b) => a + b, 0) / mins.length).toFixed(1)} min avg`);
}
