'use client';

import { useState } from 'react';
import { colorInfo } from '@wtc/shared';
import { byInspector, byPosterDesc, eyeCounts, findingsAbout } from '@/lib/inspections';
import { useGame, usePlayerName } from '@/lib/store';
import { ColorChip } from '../Chip';
import { EyeIcon } from '../ui/EyeIcon';
import { Rope } from '../ui/western';
import { BuyButton } from './BuyButton';
import { isDesktopNow } from '@/lib/useIsDesktop';

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
  const others = aboutTarget.filter((e) => e.inspectorId !== me);
  const eyes = eyeCounts(game).get(targetId) ?? 0;

  const f = findingsAbout(game, targetId);
  const cleared = f.possible !== null && !f.possible.includes(game.posterColor);

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
        {f.possible && (
          <div className="target-section">
            {f.possible.length === 1 ? (
              <p className="known small-text">
                They wear <ColorChip color={f.possible[0]} strong />
              </p>
            ) : (
              <p className="small-text muted">
                {cleared
                  ? `Not ${colorInfo(game.posterColor).name}: cleared this poster.`
                  : `${f.possible.length} colors possible. Search again to narrow it down.`}
              </p>
            )}
            {f.entries.map((e, i) => (
              <div key={e.id} className={`result-row${i >= f.agreeing ? ' stale' : ''}`}>
                <span className="log-poster-tag">P{e.poster + 1}</span>
                {e.inspectorId !== me && <span className="tag">bought</span>}
                <span className="chip-row tight">
                  {game.myResults[e.id].map((c) => (
                    <ColorChip key={c} color={c} strong={c === game.posterColor} dim={i >= f.agreeing} />
                  ))}
                </span>
              </div>
            ))}
            {f.agreeing < f.entries.length && <p className="hint">Faded findings don&rsquo;t match the newer ones: they probably changed color.</p>}
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
