import type { GameSummary } from '../src/game/summary';

// Shared by sim.ts and stats.ts.

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const pct = (x: number) => `${Math.round(x * 100)}%`.padStart(5);

export function report(title: string, results: GameSummary[]) {
  const thirds = [[], [], []] as number[][];
  const escapes = [[], [], []] as number[][];
  const finals: number[] = [];
  const finalEscapes: number[] = [];
  for (const g of results) {
    const n = g.posters.length;
    for (const p of g.posters) {
      const t = Math.min(2, Math.floor((p.poster / n) * 3));
      const acc = p.voters ? p.correct / p.voters : 0;
      thirds[t].push(acc);
      escapes[t].push(p.escaped ? 1 : 0);
      if (p.poster === n - 1) {
        finals.push(acc);
        finalEscapes.push(p.escaped ? 1 : 0);
      }
    }
  }
  const top = results.map((g) => g.finalScores[0]);
  const bottom = results.map((g) => g.finalScores[g.finalScores.length - 1]);
  const median = results.map((g) => g.finalScores[Math.floor(g.finalScores.length / 2)]);
  console.log(`\n${title}`);
  console.log('  correct voters   early ' + pct(mean(thirds[0])) + '   mid ' + pct(mean(thirds[1])) + '   late ' + pct(mean(thirds[2])) + '   final poster ' + pct(mean(finals)));
  console.log('  escapes          early ' + pct(mean(escapes[0])) + '   mid ' + pct(mean(escapes[1])) + '   late ' + pct(mean(escapes[2])) + '   final poster ' + pct(mean(finalEscapes)));
  console.log(`  final scores     top ${mean(top).toFixed(0)}   median ${mean(median).toFixed(0)}   bottom ${mean(bottom).toFixed(0)}`);
  console.log(
    `  per game         ${mean(results.map((g) => g.inspects)).toFixed(0)} inspects, ` +
      `${mean(results.map((g) => g.offers.made)).toFixed(1)} offers (${mean(results.map((g) => g.offers.accepted)).toFixed(1)} sold), ` +
      `${mean(results.map((g) => g.extraInspects)).toFixed(1)} extra inspects`,
  );
}

