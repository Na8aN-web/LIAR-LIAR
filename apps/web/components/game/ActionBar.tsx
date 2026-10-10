'use client';

import { useState } from 'react';
import type { ColorId } from '@wtc/shared';
import { call } from '@/lib/socket';
import { useGame, usePlayerName } from '@/lib/store';
import { ColorChip } from '../Chip';

/** Contextual actions above the side panel: inspect during investigation, vote during vote. */
export function ActionBar() {
  const view = useGame((s) => s.view)!;
  const game = view.game!;
  const selectedId = useGame((s) => s.selectedId);
  const select = useGame((s) => s.select);
  const toast = useGame((s) => s.showToast);
  const nameOf = usePlayerName();
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<{ target: string; result: ColorId[] } | null>(null);

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
      if (!res.ok) return toast(res.error);
      setLast({ target: selectedId, result: res.result });
    };
    const buyExtra = async () => {
      setBusy(true);
      const res = await call('buy:extraInspect');
      setBusy(false);
      toast(res.ok ? `+1 inspect. ${extraInspectPrice} added to the next bounty.` : res.error);
    };
    const extraButton = (
      <button
        className="btn small"
        disabled={busy || purchasesLeft <= 0 || game.myScore < extraInspectPrice}
        onClick={buyExtra}
        title={`Buy one more inspect this round. ${purchasesLeft} of ${purchaseCap} purchases left.`}
      >
        +1 inspect · {extraInspectPrice}
      </button>
    );
    return (
      <div className="action-bar">
        {last && (
          <div className="result-line">
            <span>{nameOf(last.target)}:</span>
            {last.result.map((c) => (
              <ColorChip key={c} color={c} />
            ))}
          </div>
        )}
        {selectedId ? (
          <div className="row wrap">
            <span className="grow target-name">{nameOf(selectedId)}</span>
            <button className="btn primary" disabled={busy || left <= 0} onClick={inspect}>
              {left > 0 ? `Inspect (${left} left)` : 'No inspects left'}
            </button>
            {left <= 0 && extraButton}
            <button className="icon-btn" onClick={() => select(null)} aria-label="Clear selection">
              ✕
            </button>
          </div>
        ) : (
          playerChips(left > 0 ? `Tap a scarecrow to inspect · ${left} left` : 'No inspects left. Buy one, or talk it out.', extraButton)
        )}
      </div>
    );
  }

  if (view.phase === 'vote') {
    if (game.myVote) {
      return (
        <div className="action-bar">
          <div className="locked">
            Vote locked: <b>{nameOf(game.myVote)}</b>
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
    return (
      <div className="action-bar vote">
        {playerChips('Who is Wanted? Your vote is secret.')}
        {selectedId && (
          <button className="btn primary wide" disabled={busy} onClick={vote}>
            Vote for {nameOf(selectedId)}
          </button>
        )}
      </div>
    );
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
