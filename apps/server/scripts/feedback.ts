// Prints every end-of-game feedback answer.
//   pnpm feedback                 reads logs/feedback.jsonl (in apps/server)
//   pnpm feedback -- path/to/feedback.jsonl
import { readFileSync } from 'node:fs';
import { FEEDBACK_QUESTIONS, PLAY_AGAIN } from '@wtc/shared';
import type { FeedbackEntry } from '../src/room';

const file = process.argv.slice(2).find((a) => !a.startsWith('-')) ?? 'logs/feedback.jsonl';
let entries: FeedbackEntry[];
try {
  entries = readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l))
    // Made-up answers from `pnpm admin:seed` only with --all.
    .filter((e: FeedbackEntry) => process.argv.includes('--all') || !e.seed);
} catch {
  console.log(`No feedback at ${file} yet. It appears after players send the form at the end of a game.`);
  process.exit(0);
}

console.log(`${entries.length} answer${entries.length === 1 ? '' : 's'} in ${file}`);

// Grouped by game, in order.
const games = new Map<string, FeedbackEntry[]>();
for (const e of entries) games.set(e.gameId, [...(games.get(e.gameId) ?? []), e]);
let n = 0;
for (const [gameId, es] of games) {
  n++;
  console.log(`\n=== Game ${n}  ${new Date(es[0].at).toLocaleString()}  (id ${gameId})`);
  for (const e of es) {
    console.log(`\n  ${e.name}${e.answers.playAgain ? `  ·  play again: ${e.answers.playAgain}` : ''}`);
    for (const q of FEEDBACK_QUESTIONS) {
      const a = e.answers[q.key];
      if (a) console.log(`    ${q.label}\n      ${a.replace(/\n/g, '\n      ')}`);
    }
  }
}

const tally = PLAY_AGAIN.map((v) => `${v} ${entries.filter((e) => e.answers.playAgain === v).length}`).join(', ');
const blank = entries.filter((e) => !e.answers.playAgain).length;
console.log(`\nWould play again: ${tally}${blank ? `, no answer ${blank}` : ''}`);
