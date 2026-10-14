import { describe, expect, it } from 'vitest';
import { COLOR_IDS, DEFAULT_RULES, searchedThisPoster, type InspectLogEntry } from '@wtc/shared';
import * as engine from '../src/game/engine';
import { secureRng } from '../src/rng';

// The eye badge over a scarecrow (and on its card) is a plain yes/no: searched this poster or
// not. No counts, so players don't just pile onto the most-searched player.

const entry = (poster: number, inspectorId: string, targetId: string) => ({ poster, inspectorId, targetId }) as InspectLogEntry;

describe('eye badges', () => {
  it('mark who was searched this poster, without a count', () => {
    const log = [entry(0, 'a', 'b'), entry(1, 'a', 'c'), entry(1, 'd', 'c'), entry(1, 'e', 'c'), entry(1, 'a', 'd')];
    const eyes = searchedThisPoster(log, 1);
    expect([...eyes].sort()).toEqual(['c', 'd']);
    // Three searches or one: the same badge.
    expect(eyes.has('c')).toBe(true);
    expect(eyes.has('d')).toBe(true);
    // Last poster's searches don't count.
    expect(eyes.has('b')).toBe(false);
  });

  it('work from what every player already gets in their view', () => {
    const players = Array.from({ length: 6 }, (_, i) => ({ id: `p${i}`, color: COLOR_IDS[i] }));
    const g = engine.createGame(players, { inspectLimit: 3, posterCount: 6, swapLimit: 1, rules: { ...DEFAULT_RULES } }, secureRng);
    expect(engine.inspect(g, 'p1', 'p3', secureRng).ok).toBe(true);
    expect(engine.inspect(g, 'p2', 'p3', secureRng).ok).toBe(true);
    for (const viewer of g.playerIds) {
      const v = engine.gameViewFor(g, viewer);
      expect([...searchedThisPoster(v.log, v.posterIndex)]).toEqual(['p3']);
    }
  });
});
