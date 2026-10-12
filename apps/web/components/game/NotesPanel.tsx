'use client';

import { useEffect, useState } from 'react';
import type { ColorId, InspectLogEntry } from '@wtc/shared';
import { freshFrom } from '@/lib/inspections';
import { useGame, usePlayerName } from '@/lib/store';
import { ColorChip } from '../Chip';

const intersect = (results: ColorId[][]) => results.reduce((acc, r) => acc.filter((c) => r.includes(c)));

/**
 * What you've learned about each player from your own and bought inspects.
 * Results only combine since the last round of color changes; anything older
 * is shown separately as possibly stale, because anyone might have changed.
 */
export function NotesPanel() {
  const view = useGame((s) => s.view)!;
  const game = view.game!;
  const nameOf = usePlayerName();
  const focusEntry = useGame((s) => s.notebookEntry);
  const openNotebook = useGame((s) => s.openNotebook);
  const [highlight, setHighlight] = useState<string | null>(null);

  // Opened from a telegram: scroll to that finding and flash it.
  useEffect(() => {
    if (!focusEntry) return;
    setHighlight(focusEntry);
    openNotebook(null);
    const raf = requestAnimationFrame(() => document.getElementById(`finding-${focusEntry}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }));
    const t = setTimeout(() => setHighlight(null), 3500);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(t);
    };
  }, [focusEntry, openNotebook]);

  /** Where a finding came from: your own search, or bought from whoever searched. */
  const source = (e: InspectLogEntry) => (e.inspectorId === view.you.id ? 'Your search' : `Bought from ${nameOf(e.inspectorId)}`);

  // First poster of the current era: the latest poster that had color changes before it.
  const eraStart = freshFrom(game);

  const fresh = new Map<string, ColorId[][]>();
  const stale = new Map<string, { results: ColorId[][]; lastPoster: number }>();
  for (const e of game.log) {
    const r = game.myResults[e.id];
    if (!r) continue;
    if (e.poster >= eraStart) fresh.set(e.targetId, [...(fresh.get(e.targetId) ?? []), r]);
    else {
      const prev = stale.get(e.targetId);
      stale.set(e.targetId, { results: [...(prev?.results ?? []), r], lastPoster: e.poster });
    }
  }

  const rows = view.players
    .filter((p) => p.id !== view.you.id && (fresh.has(p.id) || stale.has(p.id)))
    .map((p) => ({
      p,
      fresh: fresh.get(p.id),
      possible: fresh.has(p.id) ? intersect(fresh.get(p.id)!) : null,
      stale: stale.get(p.id),
      findings: game.log.filter((e) => e.targetId === p.id && game.myResults[e.id]).sort((a, b) => b.at - a.at),
    }));

  if (!rows.length) {
    return <p className="muted pad">Search someone and your findings land here. A color that shows up every time is the real one.</p>;
  }

  return (
    <div className="notebook">
      {eraStart > 0 && (
        <p className="hint log-hint">
          Folks changed colors before poster {eraStart + 1}. Only findings since then are combined.
        </p>
      )}
      <ul className="notes">
        {rows.map(({ p, fresh, possible, stale, findings }) => (
          <li key={p.id}>
            <div className="notes-head">
              <b>{p.name}</b>
              {possible && possible.length === 1 ? (
                <span className="known">
                  wears <ColorChip color={possible[0]} strong />
                </span>
              ) : possible ? (
                <span className="muted">
                  {possible.length} possible · {fresh!.length} {fresh!.length > 1 ? 'searches' : 'search'}
                </span>
              ) : (
                <span className="muted">not searched since colors changed</span>
              )}
            </div>
            {possible && possible.length > 1 && (
              <div className="chip-row tight">
                {possible.map((c) => (
                  <ColorChip key={c} color={c} strong={c === game.posterColor} />
                ))}
              </div>
            )}
            <ul className="findings">
              {findings.map((e) => (
                <li key={e.id} id={`finding-${e.id}`} className={`${highlight === e.id ? 'focus' : ''}${e.inspectorId === view.you.id ? '' : ' bought'}`}>
                  <span className="finding-src">
                    {source(e)} · poster {e.poster + 1}
                  </span>
                  <span className="chip-row tight">
                    {game.myResults[e.id].map((c) => (
                      <ColorChip key={c} color={c} dim={e.poster < eraStart} />
                    ))}
                  </span>
                </li>
              ))}
            </ul>
            {stale && (
              <div className="notes-stale muted">
                Before poster {eraStart + 1} (may be stale, last seen on poster {stale.lastPoster + 1}):
                <div className="chip-row tight">
                  {intersect(stale.results).map((c) => (
                    <ColorChip key={c} color={c} dim />
                  ))}
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
