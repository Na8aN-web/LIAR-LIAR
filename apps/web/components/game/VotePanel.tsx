'use client';

import { useState } from 'react';
import { call } from '@/lib/socket';
import { eyeCounts, suspicion } from '@/lib/inspections';
import { useGame, useSecondsLeft } from '@/lib/store';
import { CosmeticIcon } from '../ui/CosmeticIcon';
import { EyeIcon } from '../ui/EyeIcon';

/** Seconds left at which an unvoted player gets the "vote now" warning. */
const URGENT_AT = 5;

/**
 * The vote: slides up over the scene when the search ends. Everyone but you as cards (name,
 * hat, times searched this poster, and what YOUR notebook says), pick one, then ACCUSE. Your
 * accusation is stamped; then a count of how many have voted (never who). Closes at the payout.
 */
export function VotePanel() {
  const view = useGame((s) => s.view)!;
  const game = view.game!;
  const selectedId = useGame((s) => s.selectedId);
  const select = useGame((s) => s.select);
  const toast = useGame((s) => s.showToast);
  const left = useSecondsLeft();
  const [busy, setBusy] = useState(false);

  const others = view.players.filter((p) => p.id !== view.you.id);
  const eyes = eyeCounts(game);
  const voted = game.myVote;
  const urgent = !voted && left !== null && left <= URGENT_AT && left > 0;
  // Who can still vote: everyone at the fire (bots included), not players who left.
  const canVote = view.players.filter((p) => p.connected && !p.away).length;
  const chosen = others.find((p) => p.id === selectedId);

  const accuse = async () => {
    if (!chosen) return;
    setBusy(true);
    const res = await call('game:vote', { targetId: chosen.id });
    setBusy(false);
    if (!res.ok) toast(res.error);
  };

  const clock = left === null ? '–' : `0:${String(left).padStart(2, '0')}`;
  return (
    <section className={`vote-panel${urgent ? ' urgent' : ''}`} aria-label="Name the outlaw">
      <header className="vote-head">
        <h2>Name the outlaw</h2>
        <div className={`vote-clock${left !== null && left <= 10 ? ' low' : ''}`} aria-label={`${left ?? 0} seconds left`}>
          {clock}
        </div>
        {urgent ? (
          <p className="vote-warning" role="alert">
            Vote now or your chance is gone!
          </p>
        ) : (
          <p className="vote-sub">{voted ? 'Your accusation is sealed.' : 'Pick who you think wears the poster’s color. Nobody sees your vote.'}</p>
        )}
      </header>

      <ul className="vote-grid">
        {others.map((p) => {
          const tag = suspicion(game, p.id);
          const isVote = voted === p.id;
          const gone = !p.connected || p.away;
          return (
            <li key={p.id}>
              <button
                className={`vote-card${selectedId === p.id && !voted ? ' on' : ''}${isVote ? ' accused' : ''}${gone ? ' gone' : ''}`}
                disabled={!!voted}
                aria-pressed={selectedId === p.id}
                onClick={() => select(selectedId === p.id ? null : p.id)}
              >
                <CosmeticIcon cosmetics={p.cosmetics} />
                <span className="vote-card-body">
                  <b className="vote-name">{p.name}</b>
                  <span className="vote-meta">
                    {(eyes.get(p.id) ?? 0) > 0 && (
                      <span className="eye-plate small" title="Times searched this poster">
                        <EyeIcon />
                        {eyes.get(p.id)}
                      </span>
                    )}
                    {tag === 'ruledOut' && <span className="vote-tag out">Ruled out</span>}
                    {tag === 'possible' && <span className="vote-tag maybe">Possible</span>}
                  </span>
                </span>
                {isVote && <span className="accused-stamp">Accused</span>}
              </button>
            </li>
          );
        })}
      </ul>

      <footer className="vote-foot">
        {voted ? (
          <p className="vote-locked">
            Vote locked. Waiting for the town…{' '}
            <b>
              {game.votesCast}/{canVote}
            </b>{' '}
            have voted
          </p>
        ) : (
          <button className="btn primary vote-accuse" disabled={!chosen || busy} onClick={accuse}>
            {chosen ? `Accuse ${chosen.name}` : 'Pick a suspect'}
          </button>
        )}
      </footer>
    </section>
  );
}
