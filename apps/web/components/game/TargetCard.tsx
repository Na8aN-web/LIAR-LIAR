'use client';

import { useState } from 'react';
import { colorInfo, type ColorId } from '@wtc/shared';
import { byInspector, byPosterDesc, eyeCounts } from '@/lib/inspections';
import { useGame, usePlayerName } from '@/lib/store';
import { ColorChip } from '../Chip';
import { EyeIcon } from '../ui/EyeIcon';
import { Rope } from '../ui/western';
import { BuyButton } from './BuyButton';
import { isDesktopNow } from '@/lib/useIsDesktop';

const intersect = (results: ColorId[][]) => results.reduce((acc, r) => acc.filter((c) => r.includes(c)));

/**
 * Bottom sheet for the selected scarecrow. Compact by default on phones: one row with the
 * name and the phase's main button, plus a one-line summary. Expanded: your own (and bought)
 * findings, and everyone else who searched them this game, grouped by poster, with Buy buttons.
 */
export function TargetCard({
  targetId,
  primary,
  extra,
  onClose,
}: {
  targetId: string;
  /** The phase's main button (Search them / Accuse). */
  primary: React.ReactNode;
  /** Optional secondary control shown under the main row (e.g. hire an extra look). */
  extra?: React.ReactNode;
  onClose: () => void;
}) {
  const [expanded, setExpanded] = useState(isDesktopNow);
  const view = useGame((s) => s.view)!;
  const game = view.game!;
  const nameOf = usePlayerName();
  const me = view.you.id;

  const aboutTarget = game.log.filter((e) => e.targetId === targetId);
  const mine = aboutTarget.filter((e) => game.myResults[e.id]);
  const others = aboutTarget.filter((e) => e.inspectorId !== me);
  const eyes = eyeCounts(game).get(targetId) ?? 0;

  // Combine only results since the last round of color changes (anyone may have changed).
  let eraStart = 0;
  game.colorChanges.forEach((n, p) => {
    if (n > 0 && p <= game.posterIndex) eraStart = p;
  });
  const fresh = mine.filter((e) => e.poster >= eraStart).map((e) => game.myResults[e.id]);
  const possible = fresh.length ? intersect(fresh) : null;

  const othersCount = new Set(others.map((e) => e.inspectorId)).size;
  const summary = [
    possible && possible.length === 1
      ? `They wear ${colorInfo(possible[0]).name}`
      : mine.length
        ? `${possible?.length ?? 0} colors possible`
        : "You haven't searched them",
    othersCount ? `${othersCount} other${othersCount === 1 ? '' : 's'} did` : 'nobody else has',
  ].join(' · ');

  return (
    <div className={`target-card${expanded ? ' expanded' : ''}`}>
      <div className="target-head">
        <span className="target-name">
          {nameOf(targetId)}
          {eyes > 0 && (
            <span className="eye-plate" title={`Searched ${eyes} times this poster`}>
              <EyeIcon /> {eyes}
            </span>
          )}
        </span>
        {primary}
        <button
          className="icon-btn"
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded}
          aria-label={expanded ? 'Show less' : 'Show findings'}
        >
          {expanded ? '▾' : '▴'}
        </button>
        <button className="icon-btn" onClick={onClose} aria-label="Clear selection">
          ✕
        </button>
      </div>
      {extra}
      {!expanded && (
        <button className="target-summary" onClick={() => setExpanded(true)}>
          {summary} <span aria-hidden>›</span>
        </button>
      )}

      {expanded && <div className="target-body">
        <div className="target-section">
          <div className="label">Your findings</div>
          {!mine.length && <p className="muted small-text">You haven&apos;t searched them yet.</p>}
          {possible && possible.length === 1 && (
            <p className="known small-text">
              They wear <ColorChip color={possible[0]} strong />
            </p>
          )}
          {byPosterDesc(mine).map(([poster, entries]) =>
            entries.map((e) => (
              <div key={e.id} className={`result-row${e.poster < eraStart ? ' stale' : ''}`}>
                <span className="log-poster-tag">P{poster + 1}</span>
                {e.inspectorId !== me && <span className="tag">bought</span>}
                <span className="chip-row tight">
                  {game.myResults[e.id].map((c) => (
                    <ColorChip key={c} color={c} strong={c === game.posterColor} dim={e.poster < eraStart} />
                  ))}
                </span>
              </div>
            )),
          )}
          {eraStart > 0 && mine.some((e) => e.poster < eraStart) && (
            <p className="hint">Faded findings date from before folks changed colors.</p>
          )}
        </div>

        <div className="target-section">
          <Rope />
          <div className="label">Also searched by</div>
          {!others.length && <p className="muted small-text">Nobody else has searched them.</p>}
          {byPosterDesc(others).map(([poster, entries]) => (
            <div key={poster} className="inspector-group">
              <div className="log-poster">Poster {poster + 1}</div>
              {byInspector(entries).map(({ inspectorId, entries: es }) => (
                <div key={inspectorId} className="inspector-row">
                  <span className="grow">
                    {nameOf(inspectorId)}
                    {es.length > 1 && <span className="muted"> ×{es.length}</span>}
                  </span>
                  <span className="buy-group">
                    {es.map((e, i) => (
                      <BuyButton key={e.id} entry={e} label={es.length > 1 ? `Search ${i + 1}` : undefined} />
                    ))}
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>}
    </div>
  );
}
