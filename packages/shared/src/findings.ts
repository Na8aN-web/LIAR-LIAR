import type { ColorId } from './palette';
import type { GameView, InspectLogEntry, PlayerId } from './types';

// What a player's own findings (their searches, and ones they bought) say about someone.
//
// Every search result contains the color the server shows for that player this poster (their
// real color, or a stand-in while they've covered their tracks). That color can only change
// between posters (color changes and covers happen at the payout), so results from the SAME
// poster can always be combined: what's in all of them is still possible. Results from
// different posters can't: after a secret color change or a cover, old and new results usually
// still share a decoy or two, and combining them would point at a color they're not wearing.
// So the newest poster's results decide; older ones are shown as history.

export interface Findings {
  /** Your own and bought results about this player, newest first. */
  entries: InspectLogEntry[];
  /** Colors that fit every result from the newest poster you have results from (null: none). */
  possible: ColorId[] | null;
  /** How many results (newest first) are from that poster; older ones are history. */
  agreeing: number;
  /** That poster (0-based), or null. */
  poster: number | null;
  /** True when that poster is the current one (so the verdict is about now). */
  current: boolean;
}

type FindingsView = Pick<GameView, 'log' | 'myResults' | 'posterIndex'> & Partial<Pick<GameView, 'myNarrowed'>>;

export function findingsAbout(game: FindingsView, targetId: PlayerId): Findings {
  // The log is in the order things happened; newest last.
  const entries = game.log.filter((e) => e.targetId === targetId && game.myResults[e.id]).reverse();
  if (!entries.length) return { entries, possible: null, agreeing: 0, poster: null, current: false };
  const poster = entries[0].poster;
  // That poster's results (newest first; the log is in order, so they're the first ones).
  const group = entries.filter((e) => e.poster === poster);
  // Your own newest search in that poster carries the server's narrowing (which already counts
  // your earlier searches, from earlier posters too while their color hasn't changed).
  const ownNewest = game.myNarrowed ? group.find((e) => game.myNarrowed![e.id]) : undefined;
  let possible = (ownNewest ? game.myNarrowed![ownNewest.id] : game.myResults[group[0].id]).slice();
  for (const e of group) {
    const next = possible.filter((c) => game.myResults[e.id].includes(c));
    // Same poster, nothing in common: only possible for a stand-in's own wearer who bought a
    // covered player's result (they're shown a different stand-in). Keep what we had.
    if (!next.length) continue;
    possible = next;
  }
  return { entries, possible, agreeing: group.length, poster, current: poster === game.posterIndex };
}

export type Suspicion = 'ruledOut' | 'possible';

/**
 * Whether this poster's findings rule a suspect out for the poster color ("Looks clear"), or
 * leave it possible. Only this poster's findings count: older ones may predate a color change or
 * a cover. Nothing searched this poster: null.
 */
export function suspicion(game: FindingsView & Pick<GameView, 'posterColor'>, targetId: PlayerId): Suspicion | null {
  const f = findingsAbout(game, targetId);
  if (!f.possible || !f.current) return null;
  return f.possible.includes(game.posterColor) ? 'possible' : 'ruledOut';
}
