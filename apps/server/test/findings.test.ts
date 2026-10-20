import { describe, expect, it } from 'vitest';
import { COLOR_IDS, DEFAULT_RULES, findingsAbout, suspicion, type ColorId, type GameView } from '@wtc/shared';
import * as engine from '../src/game/engine';
import { secureRng } from '../src/rng';

// What a player's findings add up to (packages/shared/src/findings.ts). Bug found in playtests:
// combining results across posters pointed at the wrong color after a secret color change or a
// cover, because old and new results still shared a decoy. Only one poster's results combine.

const players = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, color: COLOR_IDS[i] }));
const game = () => engine.createGame(players(8), { inspectLimit: 30, posterCount: 10, swapLimit: 5, rules: { ...DEFAULT_RULES } }, secureRng);
const nextPoster = (g: engine.GameState) => {
  engine.resolvePoster(g);
  engine.advancePoster(g, secureRng);
};
const viewOf = (g: engine.GameState, id: string) => engine.gameViewFor(g, id) as GameView;

/** The old rule: intersect newest first across every poster, stop only when nothing is in common. */
function oldPossible(v: GameView, target: string): ColorId[] | null {
  const entries = v.log.filter((e) => e.targetId === target && v.myResults[e.id]).reverse();
  if (!entries.length) return null;
  let possible = v.myResults[entries[0].id].slice();
  for (const e of entries.slice(1)) {
    const next = possible.filter((c) => v.myResults[e.id].includes(c));
    if (!next.length) break;
    possible = next;
  }
  return possible;
}

describe('combining findings', () => {
  it('after a secret color change, the old rule could point at the wrong color; the new one never does', () => {
    let oldWrong = 0;
    for (let trial = 0; trial < 300; trial++) {
      const g = game();
      for (let i = 0; i < 3; i++) engine.inspect(g, 'p0', 'p1', secureRng);
      engine.swapColor(g, 'p1', secureRng);
      nextPoster(g);
      engine.inspect(g, 'p0', 'p1', secureRng);
      const v = viewOf(g, 'p0');
      const real = g.colors.p1;
      const old = oldPossible(v, 'p1');
      if (old && !old.includes(real)) oldWrong++;
      const f = findingsAbout(v, 'p1');
      expect(f.current).toBe(true);
      expect(f.possible, `trial ${trial}`).toContain(real);
    }
    // The bug was real, and common: with 8 players decoys keep overlapping.
    expect(oldWrong).toBeGreaterThan(30);
  });

  it('after a covered poster, the next poster’s findings are read on their own', () => {
    for (let trial = 0; trial < 200; trial++) {
      const g = game();
      engine.coverTracks(g, 'p1');
      nextPoster(g); // p1 is covered this poster: searches show a stand-in
      for (let i = 0; i < 2; i++) engine.inspect(g, 'p0', 'p1', secureRng);
      nextPoster(g); // cover over
      engine.inspect(g, 'p0', 'p1', secureRng);
      const f = findingsAbout(viewOf(g, 'p0'), 'p1');
      expect(f.possible).toContain(g.colors.p1);
      expect(f.agreeing).toBe(1);
    }
  });

  it('within one poster, your searches and the ones you bought always keep the color they show', () => {
    for (let trial = 0; trial < 200; trial++) {
      const g = game();
      for (let i = 0; i < 2; i++) engine.inspect(g, 'p0', 'p2', secureRng);
      const bought = engine.inspect(g, 'p3', 'p2', secureRng);
      if (!bought.ok) throw new Error(bought.error);
      g.bought.p0 = [...(g.bought.p0 ?? []), bought.entry.id];
      const f = findingsAbout(viewOf(g, 'p0'), 'p2');
      expect(f.agreeing).toBe(3);
      expect(f.possible).toContain(g.colors.p2);
    }
  });

  it('only this poster’s findings say "looks clear"; older ones only say "search again"', () => {
    const g = game();
    const target = g.playerIds.find((p) => p !== 'p0' && p !== engine.wantedId(g))!;
    for (let i = 0; i < 4; i++) engine.inspect(g, 'p0', target, secureRng);
    const now = viewOf(g, 'p0');
    expect(findingsAbout(now, target).possible).toEqual([g.colors[target]]);
    expect(suspicion(now, target)).toBe(now.posterColor === g.colors[target] ? 'possible' : 'ruledOut');
    nextPoster(g);
    const later = viewOf(g, 'p0');
    const f = findingsAbout(later, target);
    expect(f.current).toBe(false);
    expect(f.poster).toBe(0);
    expect(suspicion(later, target)).toBeNull();
  });
});
