'use client';

import { call } from '@/lib/socket';
import { useGame, usePlayerName } from '@/lib/store';
import { ColorChip } from '../Chip';

/** Public inspect log, newest first. Results you own or bought show inline; others can be bought. */
export function LogPanel() {
  const view = useGame((s) => s.view)!;
  const game = view.game!;
  const toast = useGame((s) => s.showToast);
  const nameOf = usePlayerName();
  const me = view.you.id;
  const entries = game.log.slice().reverse();

  if (!entries.length) return <p className="muted pad">No inspects yet.</p>;

  const { buyPrice, purchaseCap } = view.settings.rules;
  const canBuyNow = view.phase === 'investigation';
  const pendingOut = game.offersOut.filter((o) => o.status === 'pending');
  const purchasesLeft = purchaseCap - game.purchasesUsed - pendingOut.length;
  const affordable = game.myScore >= buyPrice;

  const buy = async (entryId: string) => {
    const res = await call('buy:offer', { entryId });
    if (!res.ok) toast(res.error);
  };

  let lastPoster = -1;
  return (
    <>
      {canBuyNow && (
        <p className="hint log-hint">
          Buy a result for {buyPrice} if the inspector agrees · {Math.max(0, purchasesLeft)}/{purchaseCap} purchases left
        </p>
      )}
      <ul className="log">
        {entries.map((e) => {
          const header = e.poster !== lastPoster;
          lastPoster = e.poster;
          const result = game.myResults[e.id];
          const bought = game.boughtEntryIds.includes(e.id);
          const offers = game.offersOut.filter((o) => o.entryId === e.id);
          const pending = offers.some((o) => o.status === 'pending');
          const refusedNow = offers.some((o) => o.status === 'declined' && o.poster === game.posterIndex);
          const buyable = canBuyNow && !result && !pending && !refusedNow && e.inspectorId !== me;
          return (
            <li key={e.id} className={e.targetId === me ? 'about-me' : ''}>
              {header && <div className="log-poster">Poster {e.poster + 1}</div>}
              <div className="log-row">
                <span className="grow">
                  <b>{nameOf(e.inspectorId, 'You')}</b> inspected <b>{nameOf(e.targetId)}</b>
                </span>
                {bought && <span className="tag">bought</span>}
                {pending && <span className="tag">offer sent</span>}
                {refusedNow && <span className="tag">refused</span>}
                {buyable && (
                  <button
                    className="btn small"
                    disabled={purchasesLeft <= 0 || !affordable}
                    onClick={() => buy(e.id)}
                    title={!affordable ? 'Not enough points' : purchasesLeft <= 0 ? 'Purchase limit reached' : undefined}
                  >
                    Buy · {buyPrice}
                  </button>
                )}
              </div>
              {result && (
                <div className="chip-row tight">
                  {result.map((c) => (
                    <ColorChip key={c} color={c} />
                  ))}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}
