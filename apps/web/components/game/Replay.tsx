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
    .map((p) => ({ p, score: replay.finalScores[p.id] ?? 0, correct: replay.correctVotes[p.id] ?? 0 }))
    .sort((a, b) => b.score - a.score || b.correct - a.correct);
  const winnerNames = replay.winners.map(name).join(' & ');

  return (
    <div className="replay">
      <div className="replay-inner">
        <header className="replay-head">
          <div className="label">Game over</div>
          <h1>
            {replay.winners.includes(view.you.id) ? 'You win!' : `${winnerNames} ${replay.winners.length > 1 ? 'share the win' : 'wins'}`}
          </h1>
        </header>

        <nav className="tabs replay-tabs">
          {(['results', 'rounds', 'log'] as Tab[]).map((t) => (
            <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
              {t === 'results' ? 'True colors' : t === 'rounds' ? 'Posters' : 'Inspect log'}
            </button>
          ))}
        </nav>

        {tab === 'results' && (
          <ol className="scores">
            {ranked.map(({ p, score, correct }) => (
              <li key={p.id} className={p.id === view.you.id ? 'me' : ''}>
                <span className="grow">
                  {replay.winners.includes(p.id) && '★ '}
                  {p.name}
                </span>
                <ColorChip color={replay.colors[p.id]} />
                <span className="muted">{correct}✓</span>
                <span className="score">{score}</span>
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
                  <span className="muted">pot ${r.pot}</span>
                </div>
                <div className="round-outcome">
                  {r.escaped
                    ? `Escaped: +${view.settings.rules.escapeBonus} to ${name(r.wantedId)}`
                    : `Found by ${r.correctIds.map(name).join(', ')} (+${r.payoutEach} each)`}
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
                  <span className="muted">P{e.poster + 1}</span> <b>{name(e.inspectorId)}</b> inspected{' '}
                  <b>{name(e.targetId)}</b>
                </div>
                <div className="chip-row tight">
                  {e.result.map((c) => (
                    <ColorChip key={c} color={c} strong={c === replay.colors[e.targetId]} dim={c !== replay.colors[e.targetId]} />
                  ))}
                </div>
              </li>
            ))}
            {!replay.log.length && <li className="muted">Nobody inspected anyone.</li>}
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
              Back to lobby
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
