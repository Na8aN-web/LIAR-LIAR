'use client';

import type { ColorId } from '@wtc/shared';
import { useGame } from '@/lib/store';
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

  // First poster of the current era: the latest poster that had color changes before it.
  let eraStart = 0;
  game.colorChanges.forEach((n, poster) => {
    if (n > 0 && poster <= game.posterIndex) eraStart = poster;
  });

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
    }));

  if (!rows.length) {
    return <p className="muted pad">Inspect someone and your findings collect here. Colors that repeat are real.</p>;
  }

  return (
    <>
      {eraStart > 0 && (
        <p className="hint log-hint">
          Players changed color before poster {eraStart + 1}. Only results since then are combined.
        </p>
      )}
      <ul className="notes">
        {rows.map(({ p, fresh, possible, stale }) => (
          <li key={p.id}>
            <div className="notes-head">
              <b>{p.name}</b>
              {possible && possible.length === 1 ? (
                <span className="known">
                  is <ColorChip color={possible[0]} strong />
                </span>
              ) : possible ? (
                <span className="muted">
                  {possible.length} possible · {fresh!.length} inspect{fresh!.length > 1 ? 's' : ''}
                </span>
              ) : (
                <span className="muted">no look since the color changes</span>
              )}
            </div>
            {possible && possible.length > 1 && (
              <div className="chip-row tight">
                {possible.map((c) => (
                  <ColorChip key={c} color={c} strong={c === game.posterColor} />
                ))}
              </div>
            )}
            {stale && (
              <div className="notes-stale muted">
                Before poster {eraStart + 1} (may be stale, last seen poster {stale.lastPoster + 1}):
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
    </>
  );
}
