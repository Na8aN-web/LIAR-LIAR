'use client';

import { useState } from 'react';
import { call } from '@/lib/socket';
import { useGame, usePlayerName } from '@/lib/store';
import { TargetCard } from './TargetCard';

/**
 * Contextual panel above the side panel. Nothing selected: player chips to pick from.
 * A scarecrow selected: the target card (what you know about them) with Inspect or Vote.
 */
export function ActionBar() {
  const view = useGame((s) => s.view)!;
  const game = view.game!;
  const selectedId = useGame((s) => s.selectedId);
  const select = useGame((s) => s.select);
  const toast = useGame((s) => s.showToast);
  const nameOf = usePlayerName();
  const [busy, setBusy] = useState(false);

  const others = view.players.filter((p) => p.id !== view.you.id);
  const left = game.inspectLimit + game.extraInspects - game.inspectsUsed;
  const { extraInspectPrice, purchaseCap } = view.settings.rules;
  const purchasesLeft = purchaseCap - game.purchasesUsed - game.offersOut.filter((o) => o.status === 'pending').length;


  if (view.phase === 'investigation') {
    const inspect = async () => {
      if (!selectedId) return;
      setBusy(true);
      const res = await call('game:inspect', { targetId: selectedId });
      setBusy(false);
      if (!res.ok) toast(res.error);
    };
    const buyExtra = async () => {
      setBusy(true);
      const res = await call('buy:extraInspect');
      setBusy(false);
      toast(res.ok ? `Extra look hired. $${extraInspectPrice} goes to the next bounty.` : res.error);
    };
    const extraButton = (
      <button
        className="btn small"
        disabled={busy || purchasesLeft <= 0 || game.myScore < extraInspectPrice}
        onClick={buyExtra}
        title={`One more look this round. ${purchasesLeft} of ${purchaseCap} deals left.`}
      >
        Hire an extra look · ${extraInspectPrice}
      </button>
    );
    if (selectedId) {
      return (
        <div className="action-bar">
          <TargetCard
            targetId={selectedId}
            onClose={() => select(null)}
            primary={
              <button className="btn primary" disabled={busy || left <= 0} onClick={inspect}>
                {left > 0 ? `Search · ${left} left` : 'Out of looks'}
              </button>
            }
            extra={left <= 0 ? <div className="row target-extra">{extraButton}</div> : undefined}
          />
        </div>
      );
    }
    return (
      <div className="action-bar">
        {playerChips(left > 0 ? `Pick a suspect · ${left} ${left === 1 ? 'look' : 'looks'} left` : 'Out of looks. Hire another, or talk it out.', extraButton)}
      </div>
    );
  }

  if (view.phase === 'vote') {
    if (game.myVote) {
      return (
        <div className="action-bar">
          <div className="locked">
            You accused <b>{nameOf(game.myVote)}</b>. Sealed.
          </div>
        </div>
      );
    }
    const vote = async () => {
      if (!selectedId) return;
      setBusy(true);
      const res = await call('game:vote', { targetId: selectedId });
      setBusy(false);
      if (!res.ok) toast(res.error);
    };
    if (selectedId) {
      return (
        <div className="action-bar vote">
          <TargetCard
            targetId={selectedId}
            onClose={() => select(null)}
            primary={
              <button className="btn primary" disabled={busy} onClick={vote}>
                Accuse
              </button>
            }
          />
        </div>
      );
    }
    return <div className="action-bar vote">{playerChips("Who's the outlaw? Your accusation stays sealed.")}</div>;
  }

  return null;

  function playerChips(label: string, extra?: React.ReactNode) {
    return (
      <div>
        <div className="row between">
          <div className="hint">{label}</div>
          {extra}
        </div>
        <div className="chip-row">
          {others.map((p) => (
            <button
              key={p.id}
              className={`player-chip${selectedId === p.id ? ' on' : ''}${p.connected && !p.away ? '' : ' faded'}`}
              onClick={() => select(p.id)}
            >
              {p.name}
            </button>
          ))}
        </div>
      </div>
    );
  }
}
