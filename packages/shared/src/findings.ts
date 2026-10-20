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

type FindingsView = Pick<GameView, 'log' | 'myResults' | 'posterIndex'>;

export function findingsAbout(game: FindingsView, targetId: PlayerId): Findings {
  // The log is in the order things happened; newest last.
  const entries = game.log.filter((e) => e.targetId === targetId && game.myResults[e.id]).reverse();
  if (!entries.length) return { entries, possible: null, agreeing: 0, poster: null, current: false };
  const poster = entries[0].poster;
  let possible = game.myResults[entries[0].id].slice();
  let agreeing = 1;
  for (; agreeing < entries.length && entries[agreeing].poster === poster; agreeing++) {
    const next = possible.filter((c) => game.myResults[entries[agreeing].id].includes(c));
    // Same poster, nothing in common: only possible for a stand-in's own wearer who bought a
    // covered player's result (they're shown a different stand-in). Keep what we had.
    if (!next.length) break;
    possible = next;
  }
  return { entries, possible, agreeing, poster, current: poster === game.posterIndex };
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
