'use client';

import { useState } from 'react';
import { colorInfo } from '@wtc/shared';
import { call } from '@/lib/socket';
import { useGame } from '@/lib/store';

/**
 * Change your own color between posters (payout phase only). The server picks a
 * random free color; nobody ever sees which colors are free. One change per payout,
 * final, so the button asks for confirmation first.
 */
export function SwapPicker() {
  const view = useGame((s) => s.view)!;
  const game = view.game!;
  const toast = useGame((s) => s.showToast);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  if (game.swapLimit <= 0) return null;
  if (game.posterIndex + 1 >= game.posterCount) {
    return <p className="hint swap-note">Last poster. No more changing colors.</p>;
  }
  const left = game.swapLimit - game.swapsUsed;
  const mine = colorInfo(view.you.color);

  const swap = async () => {
    setBusy(true);
    const res = await call('swap:color');
    setBusy(false);
    setConfirming(false);
    toast(res.ok ? `You're now ${colorInfo(res.color).name}.` : res.error);
  };

  return (
    <div className="swap">
      <div className="swap-row">
        <span className="swatch lg" style={{ background: mine.hex }} />
        <span className="grow">
          {game.swappedThisPayout ? (
            <>
              You&apos;ll be <b>{mine.name}</b> next poster.
            </>
          ) : (
            <>
              You&apos;re wearing <b>{mine.name}</b>.
            </>
          )}
          <span className="muted">
            {' '}
            {left} of {game.swapLimit} {game.swapLimit === 1 ? 'change' : 'changes'} left
          </span>
        </span>
        {!game.swappedThisPayout && left > 0 && !confirming && (
          <button className="btn small" onClick={() => setConfirming(true)}>
            Change colors
          </button>
        )}
      </div>
      {confirming && (
        <div className="swap-row swap-confirm">
          <span className="grow">
            Spend 1 of your {left} {left === 1 ? 'change' : 'changes'} on a random new color? No take-backs.
          </span>
          <button className="btn small primary" disabled={busy} onClick={swap}>
            Change
          </button>
          <button className="btn small ghost" disabled={busy} onClick={() => setConfirming(false)}>
            Keep mine
          </button>
        </div>
      )}
      <p className="hint swap-note">
        {game.swappedThisPayout
          ? 'One change per payout. Try again after the next poster.'
          : 'You get a random free color. Folks only hear how many changed, never who.'}
      </p>
    </div>
  );
}
