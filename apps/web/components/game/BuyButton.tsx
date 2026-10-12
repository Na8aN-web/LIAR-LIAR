'use client';

import type { InspectLogEntry } from '@wtc/shared';
import { buyState, canBuyNow } from '@/lib/inspections';
import { call } from '@/lib/socket';
import { useGame, usePlayerName } from '@/lib/store';

/**
 * Buy control for one log entry: a button, a status tag, or nothing (own inspects, inspects of you).
 * `label` tells repeat searches apart ("Search 2") when one player searched the same target twice.
 */
export function BuyButton({ entry, label }: { entry: InspectLogEntry; label?: string }) {
  const view = useGame((s) => s.view)!;
  const game = view.game!;
  const toast = useGame((s) => s.showToast);
  const { buyPrice, purchaseCap } = view.settings.rules;
  const state = buyState(game, view.you.id, entry);
  const nameOf = usePlayerName();

  if (state === 'mine' || state === 'aboutMe') return null;
  const prefix = label ? `${label}: ` : '';
  if (state === 'bought') return <span className="tag bought">{prefix}bought from {nameOf(entry.inspectorId)}</span>;
  if (state === 'pending') return <span className="tag">{prefix}offer wired</span>;
  if (state === 'refused') return <span className="tag">{prefix}turned down</span>;
  if (view.phase !== 'investigation') return null;

  const enabled = canBuyNow(game, view.phase, buyPrice, purchaseCap);
  return (
    <button
      className="btn small"
      disabled={!enabled}
      title={enabled ? undefined : game.myScore < buyPrice ? 'Not enough in your purse' : 'No deals left this round'}
      onClick={async () => {
        const res = await call('buy:offer', { entryId: entry.id });
        if (!res.ok) toast(res.error);
      }}
    >
      {label ? `${label} · $${buyPrice}` : `$${buyPrice} for their findings`}
    </button>
  );
}
