'use client';

import { useState } from 'react';
import { colorInfo } from '@wtc/shared';
import { call } from '@/lib/socket';
import { useGame } from '@/lib/store';
import { useStreamerMode } from '@/lib/streamer';

/**
 * Change your own color between posters (payout phase only), for a price. The server picks
 * a random free color; nobody ever sees which colors are free, and nobody is told anyone
 * changed. One change per payout, final, so the button asks for confirmation first.
 */
export function SwapPicker() {
  const view = useGame((s) => s.view)!;
  const game = view.game!;
  const toast = useGame((s) => s.showToast);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const streamer = useStreamerMode();

  if (game.swapLimit <= 0) return null;
  if (game.posterIndex + 1 >= game.posterCount) {
    return <p className="hint swap-note">Last poster. No more changing colors.</p>;
  }
  const left = game.swapLimit - game.swapsUsed;
  const price = view.settings.rules.swapPrice;
  const broke = game.myScore < price;
  const real = colorInfo(view.you.color);
  // Streamer mode: no swatch, no name on screen.
  const mine = streamer ? { name: 'your color', hex: 'transparent' } : real;

  const swap = async () => {
    setBusy(true);
    const res = await call('swap:color');
    setBusy(false);
    setConfirming(false);
    if (!res.ok) toast(res.error);
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

        </span>
        {!game.swappedThisPayout && left > 0 && !confirming && (
          <button className="btn small" disabled={broke} title={broke ? 'Not enough in your purse' : undefined} onClick={() => setConfirming(true)}>
            Change colors · ${price}
          </button>
        )}
      </div>
      {confirming && (
        <div className="swap-row swap-confirm">
          <span className="grow">
            Pay ${price} for a random new color? No take-backs.
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
          : `You get a random free color. Nobody is told you changed. The $${price} goes to the next bounty.`}
      </p>
    </div>
  );
}
