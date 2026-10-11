'use client';

import { useGame } from '@/lib/store';

export function ScoreList({ compact = false }: { compact?: boolean }) {
  const view = useGame((s) => s.view)!;
  const game = view.game!;
  const rows = view.players
    .map((p) => ({ p, score: game.scores[p.id] ?? 0, delta: game.scoreDeltas[p.id] ?? 0 }))
    .sort((a, b) => b.score - a.score);
  const top = rows[0]?.score;

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
        </li>
      ))}
    </ol>
    </>
  );
}
