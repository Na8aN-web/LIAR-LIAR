'use client';

import { useState } from 'react';
import { useGame, useGameCountdown } from '@/lib/store';

// Practice games only: one short hint bubble at a time, for whatever the player should try
// next (searching, chat, buying, accusing). Each can be dismissed; the next one follows the game.

type Place = 'top' | 'bottom' | 'side';
interface Hint {
  id: string;
  text: string;
  place: Place;
}

function nextHint(v: NonNullable<ReturnType<typeof useGame.getState>['view']>, selected: string | null, saidSomething: boolean): Hint | null {
  const g = v.game;
  if (!g) return null;
  const r = v.settings.rules;
  const left = g.inspectLimit + g.extraInspects - g.inspectsUsed;
  switch (v.phase) {
    case 'poster':
      return g.posterIndex === 0
        ? { id: 'poster-0', place: 'top', text: 'A new Wanted poster: whoever wears this color is the outlaw.' }
        : { id: `poster-${g.posterIndex}`, place: 'side', text: 'The Rankings tab shows who has the most money so far. Most money after the last poster wins.' };
    case 'investigation':
      if (g.inspectsUsed === 0)
        return selected
          ? { id: 'press-search', place: 'bottom', text: `Press Search. You’ll see ${r.decoys + 1} colors: one is their real color, the rest are fakes.` }
          : { id: 'tap', place: 'bottom', text: 'Tap a scarecrow to search them. Stuck? Press Hints.' };
      if (g.inspectsUsed === 1 && left > 0)
        return { id: 'again', place: 'bottom', text: 'Search the same scarecrow again: one fewer color is left in the running each time. The one that keeps showing up is their real color.' };
      if (!saidSomething) return { id: 'talk', place: 'side', text: 'Open Chat to share a clue, or a lie. Anyone can lie, so trust your own searches.' };
      return {
        id: 'buy',
        place: 'bottom',
        text: `Want more clues? Tap a scarecrow and buy someone’s search for $${r.buyPrice}, or, once you’re out, ${r.extraInspectCount} more searches for $${r.extraInspectPrice}.`,
      };
    case 'vote':
      return g.myVote
        ? { id: 'voted', place: 'bottom', text: 'Your accusation is sealed. Everyone who picked right splits the reward.' }
        : { id: 'accuse', place: 'bottom', text: 'Time’s up. Tap who you think is the outlaw, then press Accuse.' };
    case 'payout':
      return {
        id: `payout-${g.posterIndex}`,
        place: 'top',
        text: 'Reward paid: the Rankings tab shows everyone’s money and rank. You can change your color now if too many people know it, or keep it.',
      };
    default:
      return null;
  }
}

export function PracticeHints() {
  const view = useGame((s) => s.view);
  const selected = useGame((s) => s.selectedId);
  const chat = useGame((s) => s.chat);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const countdown = useGameCountdown();
  if (!view?.practice || countdown > 0) return null;
  const said = chat.some((m) => m.playerId === view.you.id);
  const hint = nextHint(view, selected, said || dismissed.has('talk'));
  if (!hint || dismissed.has(hint.id)) return null;
  return (
    <div className={`practice-hint at-${hint.place}`} role="status">
      <span className="practice-tag">Practice</span>
      <p>{hint.text}</p>
      <button className="icon-btn" aria-label="Dismiss hint" onClick={() => setDismissed((d) => new Set(d).add(hint.id))}>
        ✕
      </button>
    </div>
  );
}
