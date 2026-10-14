'use client';

import { useState } from 'react';
import { colorInfo } from '@wtc/shared';
import { call } from '@/lib/socket';
import { useGame } from '@/lib/store';
import { useStreamerMode } from '@/lib/streamer';
import { Modal } from '../Modal';

/**
 * Payout screen: one big brass button that opens the two secret tricks for the next round.
 * One trick per round, paid privately (to the next bounty), and nobody is ever told.
 */
export function DirtyTricks() {
  const view = useGame((s) => s.view)!;
  const game = view.game!;
  const toast = useGame((s) => s.showToast);
  const streamer = useStreamerMode();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const { swapPrice, coverPrice } = view.settings.rules;

  if (game.posterIndex + 1 >= game.posterCount) return <p className="hint trick-note">Last poster: no more dirty tricks.</p>;

  if (game.trickThisPayout) {
    const color = streamer ? 'a new color' : colorInfo(view.you.color).name;
    return (
      <p className="trick-done">
        {game.trickThisPayout === 'swap' ? <>Done: you&rsquo;ll wear <b>{color}</b> next poster.</> : <>Done: your tracks are covered next poster.</>}{' '}
        <span className="muted">Nobody knows.</span>
      </p>
    );
  }

  const swapsLeft = game.swapLimit - game.swapsUsed;
  const use = async (event: 'swap:color' | 'trick:cover') => {
    setBusy(true);
    const r = await call(event);
    setBusy(false);
    if (!r.ok) return toast(r.error);
    setOpen(false);
    toast(event === 'swap:color' ? 'Color changed. Nobody was told.' : 'Tracks covered for the next poster. Nobody was told.');
  };

  return (
    <>
      <button className="btn dirty-trick" data-tut="trick" onClick={() => setOpen(true)}>
        Use a dirty trick
      </button>
      {open && (
        <Modal title="Dirty tricks" onClose={() => setOpen(false)} className="trick-sheet">
          <p className="hint">Secret, one per round, for the next poster. The money goes to the next bounty, and nobody is ever told.</p>
          <div className="tricks">
            <div className="trick">
              <div className="trick-head">
                <b>Change your color</b>
                <span className="trick-price">${swapPrice}</span>
              </div>
              <p>You get a random free color. Everything people found out about you stops being true.</p>
              <p className="muted">{swapsLeft > 0 ? `${swapsLeft} ${swapsLeft === 1 ? 'change' : 'changes'} left this game.` : 'No changes left this game.'}</p>
              <button className="btn primary" disabled={busy || swapsLeft <= 0 || game.myScore < swapPrice} onClick={() => use('swap:color')}>
                Change color · ${swapPrice}
              </button>
            </div>
            <div className="trick">
              <div className="trick-head">
                <b>Cover your tracks</b>
                <span className="trick-price">${coverPrice}</span>
              </div>
              <p>Searches on you next round show false results: a color that isn&rsquo;t yours keeps coming up, as if it were.</p>
              <button className="btn primary" disabled={busy || game.myScore < coverPrice} onClick={() => use('trick:cover')}>
                Cover tracks · ${coverPrice}
              </button>
            </div>
          </div>
          <p className="hint">Your purse: ${game.myScore}</p>
        </Modal>
      )}
    </>
  );
}
