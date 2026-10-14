'use client';

import { useState } from 'react';
import { call } from '@/lib/socket';
import { useGame } from '@/lib/store';

const ordinal = (n: number) => {
  const tens = n % 100;
  const suffix = tens >= 11 && tens <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th');
  return `${n}${suffix}`;
};

/**
 * Rankings tab. During a game everyone's money is hidden: you see your own purse, and can pay
 * for a private snapshot of everyone's totals (as of the last payout). Nobody is told you
 * looked. The end-of-game screen shows everything.
 */
export function ScoreList() {
  const view = useGame((s) => s.view)!;
  const game = view.game!;
  const toast = useGame((s) => s.showToast);
  const [busy, setBusy] = useState(false);
  const price = view.settings.rules.worthPrice;
  const worth = game.myWorth;
  // How many posters old the snapshot is (0: bought this poster).
  const age = worth ? game.posterIndex - worth.poster : 0;
  // Host only: remove a troublemaker. Their seat stays in the game (still counted, can't act),
  // they're disconnected and can't come back from that browser.
  const kick = async (id: string, name: string) => {
    if (!window.confirm(`Remove ${name} from the game? They won't be able to rejoin.`)) return;
    const r = await call('lobby:kick', { playerId: id });
    if (!r.ok) toast(r.error);
  };
  const look = async () => {
    setBusy(true);
    const r = await call('buy:worth');
    setBusy(false);
    if (!r.ok) toast(r.error);
  };

  const rows = view.players
    .map((p) => ({ p, score: worth ? (worth.scores[p.id] ?? 0) : null }))
    .sort((a, b) => (worth ? (b.score ?? 0) - (a.score ?? 0) : a.p.seat - b.p.seat));
  const rankOf = (score: number) => 1 + rows.filter((r) => (r.score ?? 0) > score).length;

  return (
    <>
      <div className="ledger-title">Bounty Ledger</div>
      <p className="hint worth-note">
        Everyone&rsquo;s money is hidden until the last poster.{!view.spectating && <> Your purse: <b>${game.myScore}</b></>}
      </p>
      <div className="worth-buy" hidden={view.spectating}>
        <button className="btn small" data-tut="worth" disabled={busy || game.worthBoughtThisPoster || game.myScore < price} onClick={look}>
          {game.worthBoughtThisPoster ? 'Looked this poster' : worth ? `Get a fresh look · $${price}` : `See everyone's worth · $${price}`}
        </button>
        <span className="hint">Private: nobody is told you looked. The money goes to the next bounty.</span>
      </div>
      {worth && (
        <div className={`worth-stamp${age > 0 ? ' old' : ''}`} role="note">
          <b>{age > 0 ? `Old: from poster ${worth.poster + 1}` : `From poster ${worth.poster + 1} (this one)`}</b>
          <span>
            {age > 0
              ? `It's poster ${game.posterIndex + 1} now. This is everyone's money at the start of poster ${worth.poster + 1}, ${age} ${age === 1 ? 'poster' : 'posters'} ago. It has changed since.`
              : `Everyone's money at the start of this poster.`}
          </span>
        </div>
      )}
      <ol className={`scores${age > 0 ? ' worth-old' : ''}`}>
        {rows.map(({ p, score }) => (
          <li key={p.id} className={p.id === view.you.id ? 'me' : ''}>
            {score !== null && <span className="rank">{ordinal(rankOf(score))}</span>}
            <span className="grow">
              {p.name}
              {p.id === view.you.id && <span className="muted"> (you)</span>}
              {p.away && <span className="muted"> · away</span>}
            </span>
            {score !== null && <span className="score">${score}</span>}
            {view.you.isHost && !p.isBot && p.id !== view.you.id && !p.away && (
              <button className="icon-btn kick-x" aria-label={`Remove ${p.name} from the game`} onClick={() => kick(p.id, p.name)}>
                ✕
              </button>
            )}
          </li>
        ))}
      </ol>
    </>
  );
}

/** Payout screen: what each player earned from this bounty (totals stay hidden). */
export function BountyEarnings() {
  const view = useGame((s) => s.view)!;
  const game = view.game!;
  const paid = view.players.filter((p) => (game.scoreDeltas[p.id] ?? 0) > 0);
  if (!paid.length) return <p className="hint earnings-none">Nobody collected this bounty.</p>;
  return (
    <div className="earnings">
      <div className="label">This bounty</div>
      <ul>
        {paid.map((p) => (
          <li key={p.id} className={p.id === view.you.id ? 'me' : ''}>
            <span>
              {p.name}
              {p.id === view.you.id && <span className="muted"> (you)</span>}
            </span>
            <span className="delta">+${game.scoreDeltas[p.id]}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
