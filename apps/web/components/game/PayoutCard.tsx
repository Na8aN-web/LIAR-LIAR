'use client';

import { useGame, usePlayerName } from '@/lib/store';
import { ScoreList } from './ScoresPanel';

export function PayoutCard() {
  const game = useGame((s) => s.view!.game!);
  const nameOf = usePlayerName();
  const r = game.myRounds[game.myRounds.length - 1];
  if (!r || r.poster !== game.posterIndex) return null;

  let headline: string;
  let tone: 'good' | 'bad' | 'neutral';
  if (r.wasWanted) {
    headline = r.escaped ? `Nobody found you. You escaped! +${r.payout}` : 'They caught you. No bounty for you.';
    tone = r.escaped ? 'good' : 'bad';
  } else if (r.correct) {
    headline = `You were right. It was ${nameOf(r.wantedId)}. +${r.payout}`;
    tone = 'good';
  } else if (r.votedFor) {
    headline = `Wrong guess. It wasn't ${nameOf(r.votedFor)}.`;
    tone = 'bad';
  } else {
    headline = "You didn't vote.";
    tone = 'neutral';
  }

  return (
    <div className="center-card">
      <div className={`card payout ${tone}`}>
        <h2>{headline}</h2>
        <ScoreList compact />
      </div>
    </div>
  );
}
