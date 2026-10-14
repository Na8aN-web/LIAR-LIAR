'use client';

import type { InspectLogEntry } from '@wtc/shared';
import { byPosterDesc } from '@/lib/inspections';
import { useGame, usePlayerName } from '@/lib/store';
import { ColorChip } from '../Chip';
import { BuyButton } from './BuyButton';

/**
 * The public search log as plain sentences: "Mae searched Dolly", with a button to buy what
 * Mae found. Grouped by poster, newest first; older posters fold away. Results you own or
 * bought show under the line.
 */
export function LogPanel() {
  const view = useGame((s) => s.view)!;
  const game = view.game!;
  const select = useGame((s) => s.select);
  const nameOf = usePlayerName();
  const me = view.you.id;

  if (!game.log.length) return <p className="muted pad">Nobody&apos;s been searched yet.</p>;

  const { buyPrice, purchaseCap } = view.settings.rules;
  const pending = game.offersOut.filter((o) => o.status === 'pending').length;
  const buysLeft = Math.max(0, purchaseCap - game.purchasesUsed - pending);
  const selectable = view.phase === 'investigation' || view.phase === 'vote';

  const who = (id: string, cap: boolean) => (id === me ? (cap ? 'You' : 'you') : nameOf(id));
  const line = (e: InspectLogEntry) => {
    const colors = game.myResults[e.id];
    return (
      <li key={e.id} className={`log-line${e.targetId === me ? ' about-me' : ''}`}>
        <span className="log-sentence">
          <b>{who(e.inspectorId, true)}</b> searched{' '}
          {selectable && e.targetId !== me ? (
            <button className="link-btn" onClick={() => select(e.targetId)}>
              {nameOf(e.targetId)}
            </button>
          ) : (
            <b>{who(e.targetId, false)}</b>
          )}
        </span>
        <BuyButton entry={e} />
        {colors && (
          <span className="chip-row tight log-colors">
            {colors.map((c) => (
              <ColorChip key={c} color={c} />
            ))}
          </span>
        )}
      </li>
    );
  };

  return (
    <>
      {view.phase === 'investigation' && (
        <p className="hint log-hint">
          Only the searcher saw the colors. Buy what they found for ${buyPrice}; they can say no. You can buy {buysLeft} more this round.
        </p>
      )}
      {byPosterDesc(game.log).map(([poster, entries]) => {
        const now = poster === game.posterIndex;
        const list = <ul className="log-lines">{entries.map(line)}</ul>;
        return now ? (
          <section key={poster} className="log-poster-group">
            <h4 className="log-poster-head">This poster</h4>
            {list}
          </section>
        ) : (
          <details key={poster} className="log-poster-group">
            <summary className="log-poster-head">Poster {poster + 1}</summary>
            {list}
          </details>
        );
      })}
    </>
  );
}
