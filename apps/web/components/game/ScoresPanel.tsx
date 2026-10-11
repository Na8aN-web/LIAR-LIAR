'use client';

import { call } from '@/lib/socket';
import { useGame } from '@/lib/store';

export function ScoreList({ compact = false }: { compact?: boolean }) {
  const view = useGame((s) => s.view)!;
  const game = view.game!;
  const rows = view.players
    .map((p) => ({ p, score: game.scores[p.id] ?? 0, delta: game.scoreDeltas[p.id] ?? 0 }))
    .sort((a, b) => b.score - a.score);
  const top = rows[0]?.score;
  const toast = useGame((s) => s.showToast);
  // Host only, in the Ledger tab: remove a troublemaker. Their seat stays in the game (still
  // counted, can't act), they're disconnected and can't come back from that browser.
  const kick = async (id: string, name: string) => {
    if (!window.confirm(`Remove ${name} from the game? They won't be able to rejoin.`)) return;
    const r = await call('lobby:kick', { playerId: id });
    if (!r.ok) toast(r.error);
  };

  return (
    <>
    {!compact && <div className="ledger-title">Bounty Ledger</div>}
    <ol className={`scores${compact ? ' compact' : ''}`}>
      {rows.map(({ p, score, delta }) => (
        <li key={p.id} className={p.id === view.you.id ? 'me' : ''}>
          <span className="grow">
            {score === top && '★ '}
            {p.name}
            {p.id === view.you.id && <span className="muted"> (you)</span>}
          </span>
          {delta > 0 && <span className="delta">+${delta}</span>}
          <span className="score">${score}</span>
          {!compact && view.you.isHost && !p.isBot && p.id !== view.you.id && !p.away && (
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
