'use client';

import type { ColorId } from '@wtc/shared';
import { useGame } from '@/lib/store';
import { ColorChip } from '../Chip';

/** What you've learned about each player, from your own inspects (all posters). */
export function NotesPanel() {
  const view = useGame((s) => s.view)!;
  const game = view.game!;

  const byTarget = new Map<string, ColorId[][]>();
  for (const e of game.log) {
    const r = game.myResults[e.id];
    if (!r) continue;
    byTarget.set(e.targetId, [...(byTarget.get(e.targetId) ?? []), r]);
  }

  const rows = view.players
    .filter((p) => p.id !== view.you.id && byTarget.has(p.id))
    .map((p) => {
      const results = byTarget.get(p.id)!;
      const possible = results.reduce((acc, r) => acc.filter((c) => r.includes(c)));
      return { p, results, possible };
    });

  if (!rows.length) {
    return <p className="muted pad">Inspect someone and your findings collect here. Colors that repeat are real.</p>;
  }

  return (
    <ul className="notes">
      {rows.map(({ p, results, possible }) => (
        <li key={p.id}>
          <div className="notes-head">
            <b>{p.name}</b>
            {possible.length === 1 ? (
              <span className="known">
                is <ColorChip color={possible[0]} strong />
              </span>
            ) : (
              <span className="muted">
                {possible.length} possible · {results.length} inspect{results.length > 1 ? 's' : ''}
              </span>
            )}
          </div>
          {possible.length > 1 && (
            <div className="chip-row tight">
              {possible.map((c) => (
                <ColorChip key={c} color={c} strong={c === game.posterColor} />
              ))}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
