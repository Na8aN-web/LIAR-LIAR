import { describe, expect, it } from 'vitest';
import { tutorialSchedule, tutorialStage, tutorialUnlocked, type Phase } from '@wtc/shared';

// The first-game tutorial's unlock stages (the web app hides what isn't unlocked yet).

const at = (poster: number, count: number, phase: Phase = 'investigation') => tutorialUnlocked(poster, count, phase);

describe('first-game tutorial unlocks', () => {
  it('in a normal game: search and vote, then tabs, then buying, then dirty tricks after poster 3', () => {
    expect(at(0, 10)).toEqual({ tabs: false, buying: false, tricks: false });
    expect(at(1, 10)).toEqual({ tabs: true, buying: false, tricks: false });
    expect(at(2, 10)).toEqual({ tabs: true, buying: true, tricks: false });
    expect(at(2, 10, 'payout')).toEqual({ tabs: true, buying: true, tricks: true });
    expect(at(3, 10)).toEqual({ tabs: true, buying: true, tricks: true });
    expect([0, 1, 2].map((p) => tutorialStage(at(p, 10)))).toEqual([1, 2, 3]);
    expect(tutorialStage(at(2, 10, 'payout'))).toBe(4);
  });

  it('squeezes short games so everything is unlocked by the final payout, while a trick is still useful', () => {
    for (const count of [3, 4, 5, 8, 20]) {
      const s = tutorialSchedule(count);
      // Tricks unlock at a payout that has another poster after it.
      expect(s.tricksAfter).toBeLessThan(count - 1);
      const last = at(count - 1, count, 'payout');
      expect(last).toEqual({ tabs: true, buying: true, tricks: true });
    }
    // Three posters (practice): tabs on poster 2, tricks at its payout, buying on poster 3.
    expect(tutorialSchedule(3)).toEqual({ tabs: 1, buying: 2, tricksAfter: 1 });
    expect(at(1, 3, 'payout').tricks).toBe(true);
  });

  it('only moves forward', () => {
    for (const count of [3, 6, 10]) {
      let prev = 0;
      for (let p = 0; p < count; p++) {
        for (const phase of ['poster', 'investigation', 'vote', 'payout'] as Phase[]) {
          const stage = tutorialStage(at(p, count, phase));
          expect(stage).toBeGreaterThanOrEqual(prev);
          prev = stage;
        }
      }
    }
  });
});
