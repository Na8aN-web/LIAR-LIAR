'use client';

import { useEffect, useRef, useState } from 'react';
import type { OfferStatus } from '@wtc/shared';
import { call } from '@/lib/socket';
import { useGame, usePlayerName } from '@/lib/store';

/** Incoming offers to buy your inspect results. Only you and the buyer know about them. */
export function OfferPrompts() {
  const view = useGame((s) => s.view)!;
  const game = view.game!;
  const toast = useGame((s) => s.showToast);
  const nameOf = usePlayerName();
  const [busy, setBusy] = useState<string | null>(null);

  if (view.phase !== 'investigation') return null;
  const pending = game.offersIn.filter((o) => o.status === 'pending');
  if (!pending.length) return null;

  const respond = async (offerId: string, accept: boolean, price: number) => {
    setBusy(offerId);
    const res = await call('buy:respond', { offerId, accept });
    setBusy(null);
    if (!res.ok) toast(res.error);
    else if (accept) toast(`Sold for ${price} points`);
  };

  return (
    <div className="offers">
      {pending.map((o) => {
        const entry = game.log.find((e) => e.id === o.entryId);
        return (
          <div key={o.id} className="offer-card">
            <div className="grow">
              <b>{nameOf(o.buyerId)}</b> wants to buy your inspect of <b>{nameOf(entry?.targetId)}</b>
              {entry && entry.poster !== game.posterIndex && <span className="muted"> (poster {entry.poster + 1})</span>} for{' '}
              <b>{o.price}</b>
            </div>
            <div className="row">
              <button className="btn small primary" disabled={busy === o.id} onClick={() => respond(o.id, true, o.price)}>
                Sell
              </button>
              <button className="btn small" disabled={busy === o.id} onClick={() => respond(o.id, false, o.price)}>
                Refuse
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Toasts the buyer when one of their offers is answered or expires. */
export function useOfferNotices() {
  const offers = useGame((s) => s.view?.game?.offersOut);
  const toast = useGame((s) => s.showToast);
  const nameOf = usePlayerName();
  const seen = useRef<Map<string, OfferStatus> | null>(null);

  useEffect(() => {
    if (!offers) return;
    const prev = seen.current;
    seen.current = new Map(offers.map((o) => [o.id, o.status]));
    if (!prev) return; // first view after (re)join: don't replay old news
    for (const o of offers) {
      const was = prev.get(o.id);
      if (was !== 'pending' || o.status === 'pending') continue;
      if (o.status === 'accepted') toast(`${nameOf(o.sellerId)} sold you their result. Check the log.`);
      else if (o.status === 'declined') toast(`${nameOf(o.sellerId)} refused. ${o.price} refunded.`);
      else toast(`Offer to ${nameOf(o.sellerId)} expired. ${o.price} refunded.`);
    }
  }, [offers]); // eslint-disable-line react-hooks/exhaustive-deps
}
