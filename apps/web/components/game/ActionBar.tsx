'use client';

import { useState } from 'react';
import { call } from '@/lib/socket';
import { useFeature } from '@/lib/tutorial';
import { useGame } from '@/lib/store';
import { HintsSheet } from './HintsSheet';
import { TargetCard } from './TargetCard';

/**
 * Contextual panel above the side panel. Nothing selected: a Hints button (players are picked
 * by tapping their scarecrow). A scarecrow selected: the target card with Search, and once
 * you're out of searches, a button to buy more beside it.
 */
export function ActionBar() {
  const view = useGame((s) => s.view)!;
  const game = view.game!;
  const selectedId = useGame((s) => s.selectedId);
  const select = useGame((s) => s.select);
  const toast = useGame((s) => s.showToast);
  const [busy, setBusy] = useState(false);
  const [hints, setHints] = useState(false);
  const buying = useFeature('buying');

  const left = game.inspectLimit + game.extraInspects - game.inspectsUsed;
  const { extraInspectPrice, extraInspectCount, purchaseCap } = view.settings.rules;
  const purchasesLeft = purchaseCap - game.purchasesUsed - game.offersOut.filter((o) => o.status === 'pending').length;

  // The vote has its own full panel (VotePanel).
  if (view.phase !== 'investigation') return null;

  const inspect = async () => {
    if (!selectedId) return;
    setBusy(true);
    const res = await call('game:inspect', { targetId: selectedId });
    setBusy(false);
    if (!res.ok) toast(res.error);
  };
  const buyMore = async () => {
    setBusy(true);
    const res = await call('buy:extraInspect');
    setBusy(false);
    toast(res.ok ? `${extraInspectCount} more ${extraInspectCount === 1 ? 'search' : 'searches'}. $${extraInspectPrice} goes to the next bounty.` : res.error);
  };
  const cantBuy = purchasesLeft <= 0 ? 'No deals left this round' : game.myScore < extraInspectPrice ? 'Not enough in your purse' : null;

  if (selectedId) {
    return (
      <div className="action-bar">
        <TargetCard
          targetId={selectedId}
          onClose={() => select(null)}
          primary={
            <span className="target-actions">
              <button className="btn primary" disabled={busy || left <= 0} onClick={inspect}>
                {left > 0 ? `Search · ${left} left` : 'No searches left'}
              </button>
              {left <= 0 && buying && (
                <button className="btn buy-more" data-tut="extra" disabled={busy || !!cantBuy} onClick={buyMore} title={cantBuy ?? undefined}>
                  Buy {extraInspectCount} more · ${extraInspectPrice}
                </button>
              )}
            </span>
          }
        />
      </div>
    );
  }

  return (
    <>
      <div className="action-bar hints-bar">
        <button className="btn hints-btn" onClick={() => setHints(true)}>
          Hints
        </button>
      </div>
      {hints && <HintsSheet onClose={() => setHints(false)} />}
    </>
  );
}
