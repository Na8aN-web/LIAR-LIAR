'use client';

import type { InspectLogEntry } from '@wtc/shared';
import { byInspector, byPosterDesc } from '@/lib/inspections';
import { useGame, usePlayerName } from '@/lib/store';
import { ColorChip } from '../Chip';
import { BuyButton } from './BuyButton';

/**
 * The public inspect log, grouped by who was inspected: one row per player listing
 * who inspected them, newest poster first, older posters collapsed. Results you own
 * or bought show inline.
 */
export function LogPanel() {
  const view = useGame((s) => s.view)!;
  const game = view.game!;
  const select = useGame((s) => s.select);
  const nameOf = usePlayerName();
  const me = view.you.id;

  if (!game.log.length) return <p className="muted pad">Nobody&apos;s been searched yet.</p>;

  // One row per inspected player, most recently inspected first.
  const byTarget = new Map<string, InspectLogEntry[]>();
  for (const e of game.log) byTarget.set(e.targetId, [...(byTarget.get(e.targetId) ?? []), e]);
  // "You" first, then by most recent inspect.
  const rows = [...byTarget.entries()].sort(
    (a, b) =>
      Number(b[0] === me) - Number(a[0] === me) ||
      Math.max(...b[1].map((e) => e.at)) - Math.max(...a[1].map((e) => e.at)),
  );
  const { buyPrice, purchaseCap } = view.settings.rules;
  const pending = game.offersOut.filter((o) => o.status === 'pending').length;
  const selectable = view.phase === 'investigation' || view.phase === 'vote';

  return (
    <>
      {view.phase === 'investigation' && (
        <p className="hint log-hint">
          Pay ${buyPrice} for someone&apos;s findings, if they&apos;ll sell · {Math.max(0, purchaseCap - game.purchasesUsed - pending)} of{' '}
          {purchaseCap} deals left
        </p>
      )}
      <ul className="log-groups">
        {rows.map(([targetId, entries]) => {
          const isMe = targetId === me;
          const thisPoster = entries.filter((e) => e.poster === game.posterIndex).length;
          const posters = byPosterDesc(entries);
          return (
            <li key={targetId} className={`log-target${isMe ? ' about-me' : ''}`}>
              <div className="log-target-head">
                {selectable && !isMe ? (
                  <button className="link-btn" onClick={() => select(targetId)}>
                    {nameOf(targetId, 'You')}
                  </button>
                ) : (
                  <b>{nameOf(targetId, 'You')}</b>
                )}
                <span className="muted small-text">
                  {thisPoster > 0 && `searched ${thisPoster}× this poster · `}
                  {entries.length} in all
                </span>
              </div>
              {posters.map(([poster, list], i) => {
                const swaps = game.colorChanges[poster] ?? 0;
                return (
                  <details key={poster} className="log-poster-group" open={i === 0}>
                    <summary>
                      Poster {poster + 1} · {list.length} {list.length === 1 ? 'search' : 'searches'}
                      {swaps > 0 && <span className="muted"> · {swaps} changed colors before</span>}
                    </summary>
                    {isMe ? (
                      // Nothing to buy about yourself: one wrapped line of names.
                      <p className="name-line">
                        {byInspector(list)
                          .map(({ inspectorId, entries: es }) => `${nameOf(inspectorId)}${es.length > 1 ? ` ×${es.length}` : ''}`)
                          .join(', ')}
                      </p>
                    ) : (
                      byInspector(list).map(({ inspectorId, entries: es }) => (
                      <div key={inspectorId} className="inspector-row">
                        <span className="grow">
                          {nameOf(inspectorId, 'You')}
                          {es.length > 1 && <span className="muted"> ×{es.length}</span>}
                          {es
                            .filter((e) => game.myResults[e.id])
                            .map((e) => (
                              <span key={e.id} className="chip-row tight inline">
                                {game.myResults[e.id].map((c) => (
                                  <ColorChip key={c} color={c} />
                                ))}
                              </span>
                            ))}
                        </span>
                        <span className="buy-group">
                          {es.map((e, i) => (
                            <BuyButton key={e.id} entry={e} label={es.length > 1 ? `Search ${i + 1}` : undefined} />
                          ))}
                        </span>
                      </div>
                      ))
                    )}
                  </details>
                );
              })}
            </li>
          );
        })}
      </ul>
    </>
  );
}
