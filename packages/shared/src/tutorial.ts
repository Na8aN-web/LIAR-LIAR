import type { Phase } from './types';

// The first-game tutorial's unlock schedule (the prompts and storage live in the web app):
//   stage 1, poster 1: searching, chat and voting
//   stage 2, poster 2: the Searches and Notebook tabs
//   stage 3, poster 3: buying findings, extra looks, the worth snapshot (and the Rankings tab)
//   stage 4, the payout after poster 3: dirty tricks
// Shorter games squeeze it so everything is unlocked by the final payout.

export type TutorialFeature = 'tabs' | 'buying' | 'tricks';

/** When each stage unlocks (0-based poster index). */
export function tutorialSchedule(posterCount: number) {
  const last = Math.max(0, posterCount - 1);
  return {
    tabs: Math.min(1, last),
    buying: Math.min(2, last),
    // Tricks unlock at a payout with another poster still to come.
    tricksAfter: Math.max(0, Math.min(2, posterCount - 2)),
  };
}

/** Features unlocked at this point of the game. */
export function tutorialUnlocked(posterIndex: number, posterCount: number, phase: Phase): Record<TutorialFeature, boolean> {
  const s = tutorialSchedule(posterCount);
  return {
    tabs: posterIndex >= s.tabs,
    buying: posterIndex >= s.buying,
    tricks: posterIndex > s.tricksAfter || (posterIndex === s.tricksAfter && (phase === 'payout' || phase === 'ended')),
  };
}

/** Stage reached (1-4), for the admin funnel. */
export function tutorialStage(u: Record<TutorialFeature, boolean>): 1 | 2 | 3 | 4 {
  return u.tricks && u.buying ? 4 : u.buying ? 3 : u.tabs ? 2 : 1;
}
