'use client';

import { useEffect, useState } from 'react';
import { colorInfo, type InspectLogEntry } from '@wtc/shared';
import { findingsAbout, type Findings } from '@/lib/inspections';
import { useGame, usePlayerName } from '@/lib/store';
import { ColorChip } from '../Chip';

/**
 * Your findings as a feed, newest first: "You searched Hank. The colors were …". The newest
 * finding about each player also says what it all adds up to (what they could be wearing, and
 * whether that clears them for this poster). Bought findings are in the feed too.
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

  // Newest first (the log is in the order things happened).
  const feed = game.log.filter((e) => game.myResults[e.id] && e.targetId !== view.you.id).reverse();
  if (!feed.length) {
    return (
      <p className="muted pad">
        Tap a player to search them. Every search lands here, newest first. A color that shows up every time you search someone is their real one.
      </p>
    );
  }

  const about = new Map<string, Findings>();
  const findings = (id: string) => {
    if (!about.has(id)) about.set(id, findingsAbout(game, id));
    return about.get(id)!;
  };
  const poster = colorInfo(game.posterColor);

  const title = (e: InspectLogEntry) =>
    e.inspectorId === view.you.id ? (
      <>
        You searched <b>{nameOf(e.targetId)}</b>
      </>
    ) : (
      <>
        Bought: {nameOf(e.inspectorId)}&rsquo;s search of <b>{nameOf(e.targetId)}</b>
      </>
    );

  return (
    <div className="notebook">
      <p className="hint log-hint">Newest first. A color that shows up in every search of someone this poster is their color.</p>
      <ul className="feed">
        {feed.map((e) => {
          const f = findings(e.targetId);
          const index = f.entries.findIndex((x) => x.id === e.id);
          const newest = index === 0;
          // Older posters' findings are history: a color change or a cover may have come since.
          const stale = index >= f.agreeing || !f.current;
          const name = nameOf(e.targetId);
          return (
            <li
              key={e.id}
              id={`finding-${e.id}`}
              className={`feed-item${highlight === e.id ? ' focus' : ''}${e.inspectorId === view.you.id ? '' : ' bought'}${stale ? ' stale' : ''}`}
            >
              <div className="feed-head">
                <span>{title(e)}</span>
                <span className="feed-when">poster {e.poster + 1}</span>
              </div>
              <div className="feed-colors">
                <span className="muted">The colors were</span>
                <span className="chip-row tight">
                  {game.myResults[e.id].map((c) => (
                    <ColorChip key={c} color={c} strong={c === game.posterColor} dim={stale} />
                  ))}
                </span>
              </div>
              {newest && f.possible && !f.current && (
                <div className="feed-sum">
                  <p className="muted">
                    From poster {(f.poster ?? 0) + 1}. {name} may have changed color or covered their tracks since: search them again this poster.
                  </p>
                </div>
              )}
              {newest && f.possible && f.current && (
                <div className="feed-sum">
                  {f.possible.length === 1 ? (
                    <p>
                      <b>{name}</b> wears <ColorChip color={f.possible[0]} strong />
                      {f.possible[0] === game.posterColor ? <span className="feed-alert"> That&rsquo;s the poster color!</span> : null}
                    </p>
                  ) : (
                    <p>
                      <b>{name}</b> could be wearing{' '}
                      <span className="chip-row inline">
                        {f.possible.map((c) => (
                          <ColorChip key={c} color={c} strong={c === game.posterColor} />
                        ))}
                      </span>{' '}
                      <span className="muted">
                        ({f.possible.length} left{f.agreeing > 1 ? ` after ${f.agreeing} searches this poster` : ''})
                      </span>
                    </p>
                  )}
                  {f.possible.length > 1 &&
                    (f.possible.includes(game.posterColor) ? (
                      <p className="muted">{poster.name} looks possible. Search them again to narrow it down.</p>
                    ) : (
                      <p className="feed-clear">Not {poster.name}: {name} looks clear this poster.</p>
                    ))}
                  {f.agreeing < f.entries.length && (
                    <p className="muted">Older findings about {name} are from earlier posters, so they&rsquo;re faded: a color change or a cover may have come since.</p>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
