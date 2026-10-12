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
 * Bottom sheet for the selected scarecrow. Your own (and bought) findings always show, so a
 * search's colors appear the moment it lands. Who else searched them (with Buy buttons) folds
 * behind a one-line summary on phones.
 */
export function TargetCard({
  targetId,
  primary,
  onClose,
}: {
  targetId: string;
  /** The phase's main controls (Search, and Buy more once out). */
  primary: React.ReactNode;
  onClose: () => void;
}) {
  const [othersOpen, setOthersOpen] = useState(isDesktopNow);
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
  const cleared = possible !== null && !possible.includes(game.posterColor);

  const othersCount = new Set(others.map((e) => e.inspectorId)).size;

  return (
    <div className="target-card">
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
        <button className="icon-btn" onClick={onClose} aria-label="Clear selection">
          ✕
        </button>
      </div>

      <div className="target-body">
        {mine.length > 0 && (
          <div className="target-section">
            {possible && possible.length === 1 ? (
              <p className="known small-text">
                They wear <ColorChip color={possible[0]} strong />
              </p>
            ) : (
              <p className="small-text muted">
                {cleared
                  ? `Not ${colorInfo(game.posterColor).name}: cleared this poster.`
                  : `${possible?.length ?? 0} colors possible.`}
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
        )}

        {othersCount === 0 ? (
          <p className="target-summary">Nobody else has searched them.</p>
        ) : !othersOpen ? (
          <button className="target-summary" onClick={() => setOthersOpen(true)}>
            {othersCount} other{othersCount === 1 ? '' : 's'} searched them. Buy their findings <span aria-hidden>›</span>
          </button>
        ) : (
          <div className="target-section">
            <Rope />
            <div className="label">Also searched by</div>
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
        )}
      </div>
    </div>
  );
}
