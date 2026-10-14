'use client';

import { useGame, usePlayerName } from '@/lib/store';
import { useFeature } from '@/lib/tutorial';
import { DirtyTricks } from './DirtyTricks';
import { BountyEarnings } from './ScoresPanel';

export function PayoutCard() {
  const game = useGame((s) => s.view!.game!);
  const nameOf = usePlayerName();
  const tricks = useFeature('tricks');
  const r = game.myRounds[game.myRounds.length - 1];
  if (!r || r.poster !== game.posterIndex) return null;

  let headline: string;
  let tone: 'good' | 'bad' | 'neutral';
  if (r.wasWanted) {
    headline = r.escaped
      ? `Nobody caught you. Your $${r.payout} escape reward is paid at the end of the game.`
      : 'They caught you. No reward this time.';
    tone = r.escaped ? 'good' : 'bad';
  } else if (r.correct) {
    headline = `Right on the money. It was ${nameOf(r.wantedId)}. +$${r.payout}`;
    tone = 'good';
  } else if (r.votedFor) {
    headline = `Wrong outlaw. It wasn't ${nameOf(r.votedFor)}.`;
    tone = 'bad';
  } else {
    headline = "You didn't accuse anyone.";
    tone = 'neutral';
  }

  return (
    <div className="center-card">
      <div className={`card payout ${tone}`}>
        <h2>{headline}</h2>
        <BountyEarnings />
        {tricks && <DirtyTricks />}
      </div>
    </div>
  );
}
