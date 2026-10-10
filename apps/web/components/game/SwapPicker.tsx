'use client';

import { useState } from 'react';
import { colorInfo } from '@wtc/shared';
import { call } from '@/lib/socket';
import { useGame } from '@/lib/store';

/**
 * Change your own color between posters (payout phase only). The server picks a
 * random free color; nobody ever sees which colors are free. One change per payout,
 * which you can undo while your old color is still free.
 */
export function SwapPicker() {
  const view = useGame((s) => s.view)!;
  const game = view.game!;
  const toast = useGame((s) => s.showToast);
  const [busy, setBusy] = useState(false);

  if (game.swapLimit <= 0) return null;
  if (game.posterIndex + 1 >= game.posterCount) {
    return <p className="hint swap-note">Last poster: no more color changes.</p>;
  }
  const left = game.swapLimit - game.swapsUsed;
  const pending = game.swapUndoColor;
  const mine = colorInfo(view.you.color);

  const act = async (event: 'swap:color' | 'swap:undo') => {
    setBusy(true);
    const res = await call(event);
    setBusy(false);
    if (!res.ok) toast(res.error);
    else toast(event === 'swap:color' ? `You're now ${colorInfo(res.color).name}.` : `Back to ${colorInfo(res.color).name}.`);
  };

  return (
    <div className="swap">
      <div className="swap-row">
        <span className="swatch lg" style={{ background: mine.hex }} />
        <span className="grow">
          {pending ? (
            <>
              You&apos;ll be <b>{mine.name}</b> next poster.
            </>
          ) : (
            <>
              You&apos;re <b>{mine.name}</b>.
            </>
          )}
          <span className="muted">
            {' '}
            {left} of {game.swapLimit} color change{game.swapLimit === 1 ? '' : 's'} left
          </span>
        </span>
        {pending ? (
          <button className="btn small ghost" disabled={busy} onClick={() => act('swap:undo')}>
            Undo
          </button>
        ) : (
          !game.swapLockedThisPayout &&
          left > 0 && (
            <button className="btn small" disabled={busy} onClick={() => act('swap:color')}>
              Change color
            </button>
          )
        )}
      </div>
      <p className="hint swap-note">
        {game.swapLockedThisPayout && !pending
          ? 'One change per payout. You can change again after the next poster.'
          : "You get a random free color. Nobody is told who changed, only how many."}
      </p>
    </div>
  );
}
