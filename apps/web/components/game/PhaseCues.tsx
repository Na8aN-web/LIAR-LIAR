'use client';

import { useEffect, useRef, useState } from 'react';
import type { Phase } from '@wtc/shared';
import { useGame, useSecondsLeft } from '@/lib/store';

// Making every phase change impossible to miss: a tracker in the top bar, a short banner as each
// phase starts (its sound plays in useGameAudio), and a heads-up before the vote.

const STEPS = [
  { id: 'search', label: 'Search', phases: ['poster', 'investigation'] as Phase[] },
  { id: 'vote', label: 'Vote', phases: ['vote'] as Phase[] },
  { id: 'payout', label: 'Payout', phases: ['payout'] as Phase[] },
];

/** SEARCH → VOTE → PAYOUT, with the current one lit. The poster counts as the start of the search. */
export function PhaseTracker({ phase }: { phase: Phase }) {
  const current = STEPS.findIndex((s) => s.phases.includes(phase));
  return (
    <ol className="phase-tracker" aria-label="Round">
      {STEPS.map((s, i) => (
        <li key={s.id} className={i === current ? 'on' : i < current ? 'done' : ''} aria-current={i === current ? 'step' : undefined}>
          {s.label}
        </li>
      ))}
    </ol>
  );
}

const BANNER: Partial<Record<Phase, { text: string; tone: string }>> = {
  investigation: { text: 'Search for clues', tone: 'search' },
  vote: { text: 'Name the outlaw', tone: 'vote' },
  payout: { text: 'Bounty paid', tone: 'payout' },
};
const BANNER_MS = 1900;

/** A short banner as a phase starts. Not on joining mid-phase. */
export function PhaseBanner({ phase, poster }: { phase: Phase; poster: number }) {
  const [shown, setShown] = useState<{ key: string; text: string; tone: string } | null>(null);
  const last = useRef<string | null>(null);
  useEffect(() => {
    const key = `${poster}:${phase}`;
    const first = last.current === null;
    if (last.current === key) return;
    last.current = key;
    const b = BANNER[phase];
    if (first || !b) return;
    setShown({ key, ...b });
    const t = setTimeout(() => setShown(null), BANNER_MS);
    return () => clearTimeout(t);
  }, [phase, poster]);
  if (!shown) return null;
  return (
    <div key={shown.key} className={`phase-banner ${shown.tone}`} role="status" aria-live="assertive">
      <span>{shown.text}</span>
    </div>
  );
}

/** The last ten seconds of the search: a gentle heads-up that the vote is coming. */
export function VoteSoon() {
  const left = useSecondsLeft();
  const phase = useGame((s) => s.view?.phase);
  if (phase !== 'investigation' || left === null || left > 10 || left <= 0) return null;
  return (
    <div className="vote-soon" role="status">
      Voting starts in <b>{left}</b>…
    </div>
  );
}

/**
 * Streamer mode's stand-in for the outlaw banner: a small badge icon flashes in a corner for two
 * seconds as the poster goes up. No text, no color: viewers can't read anything into it.
 */
export function OutlawFlash({ poster }: { poster: number }) {
  const [on, setOn] = useState(true);
  useEffect(() => {
    setOn(true);
    const t = setTimeout(() => setOn(false), 2000);
    return () => clearTimeout(t);
  }, [poster]);
  if (!on) return null;
  return (
    <div className="outlaw-flash" aria-label="You're the outlaw this round">
      <svg viewBox="0 0 24 24" width="30" height="30" aria-hidden>
        <path d="M12 2l2.6 6.2 6.7.5-5.1 4.4 1.6 6.5L12 16.1 6.2 19.6l1.6-6.5L2.7 8.7l6.7-.5z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
        <circle cx="12" cy="12" r="2.2" fill="currentColor" />
      </svg>
    </div>
  );
}
