'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { call } from '@/lib/socket';
import { session } from '@/lib/session';
import { useGame } from '@/lib/store';
import { ColorChip } from '../Chip';

type Tab = 'results' | 'rounds' | 'log';

/** End-of-game reveal: everyone's true color, who was Wanted, votes and every inspect result. */
export function Replay() {
  const view = useGame((s) => s.view)!;
  const replay = view.replay!;
  const toast = useGame((s) => s.showToast);
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('results');
  const name = (id: string | null) => (id ? view.players.find((p) => p.id === id)?.name ?? '?' : 'no vote');

  const ranked = view.players
    .map((p) => ({
      p,
      score: replay.finalScores[p.id] ?? 0,
      correct: replay.correctVotes[p.id] ?? 0,
      escape: replay.escapeBonuses?.[p.id] ?? 0,
    }))
    .sort((a, b) => b.score - a.score || b.correct - a.correct);
  const winnerNames = replay.winners.map(name).join(' & ');

  return (
    <div className="replay">
      <div className="replay-inner">
        <header className="replay-head">
          <div className="label">The dust settles</div>
          <h1>
            {replay.winners.includes(view.you.id) ? 'You win the bounty!' : `${winnerNames} ${replay.winners.length > 1 ? 'share the win' : 'wins'}`}
          </h1>
        </header>

        <nav className="tabs replay-tabs wood">
          {(['results', 'rounds', 'log'] as Tab[]).map((t) => (
            <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
              {t === 'results' ? 'True colors' : t === 'rounds' ? 'Posters' : 'Every search'}
            </button>
          ))}
        </nav>

        {tab === 'results' && (
          <ol className="scores">
            {ranked.map(({ p, score, correct, escape }) => (
              <li key={p.id} className={`replay-player${p.id === view.you.id ? ' me' : ''}`}>
                <div className="row">
                  <span className="grow">
                    {replay.winners.includes(p.id) && '★ '}
                    {p.name}
                  </span>
                  {escape > 0 && (
                    <span className="tag escape-tag" title="Escape rewards, paid at the end of the game">
                      +${escape} escapes
                    </span>
                  )}
                  <span className="muted">{correct}✓</span>
                  <span className="score">${score}</span>
                </div>
                <div className="history">
                  {(replay.colorHistory[p.id] ?? [{ color: replay.colors[p.id], afterPoster: null }]).map((h, i) => (
                    <span key={i} className="history">
                      {i > 0 && <span className="arrow">→ after poster {h.afterPoster! + 1}</span>}
                      <ColorChip color={h.color} />
                    </span>
                  ))}
                </div>
              </li>
            ))}
          </ol>
        )}

        {tab === 'rounds' && (
          <ul className="rounds">
            {replay.posters.map((r) => (
              <li key={r.poster}>
                <div className="round-head">
                  <span>Poster {r.poster + 1}</span>
                  <ColorChip color={r.color} />
                  <span>
                    → <b>{name(r.wantedId)}</b>
                  </span>
                  <span className="muted">bounty ${r.pot}</span>
                </div>
                <div className="round-outcome">
                  {r.escaped
                    ? `${name(r.wantedId)} escaped · +$${view.settings.rules.escapeBonus}, paid at the end`
                    : `Caught by ${r.correctIds.map(name).join(', ')} · +$${r.payoutEach} each`}
                </div>
                <div className="votes">
                  {Object.entries(r.votes).map(([voter, target]) => (
                    <span key={voter} className={target === r.wantedId && voter !== r.wantedId ? 'right' : ''}>
                      {name(voter)} → {name(target)}
                    </span>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}

        {tab === 'log' && (
          <ul className="log">
            {replay.log.map((e) => (
              <li key={e.id}>
                <div>
                  <span className="log-poster-tag">Poster {e.poster + 1}:</span> <b>{name(e.inspectorId)}</b> searched{' '}
                  <b>{name(e.targetId)}</b>
                </div>
                <div className="chip-row tight">
                  {e.result.map((c) => (
                    <ColorChip key={c} color={c} strong={c === e.real} dim={c !== e.real} />
                  ))}
                </div>
              </li>
            ))}
            {!replay.log.length && <li className="muted">Nobody searched anybody.</li>}
          </ul>
        )}

        <div className="row replay-actions">
          {view.you.isHost && (
            <button
              className="btn primary grow"
              onClick={async () => {
                const r = await call('game:backToLobby');
                if (!r.ok) toast(r.error);
              }}
            >
              Back to the saloon
            </button>
          )}
          <button
            className="btn ghost"
            onClick={() => {
              call('room:leave');
              session.setToken(view.code, null);
              router.push('/');
            }}
          >
            Leave
          </button>
        </div>
      </div>
    </div>
  );
}
