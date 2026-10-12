import type { ColorId, GameView, InspectLogEntry, PlayerId } from '@wtc/shared';

// Client-side views over the public inspect log. Uses only data this client already has.

export type BuyState =
  /** Your own inspect: you have the result. */
  | 'mine'
  /** Someone inspected you: nothing to buy. */
  | 'aboutMe'
  | 'bought'
  | 'pending'
  | 'refused'
  | 'buyable';

export function buyState(game: GameView, me: PlayerId, e: InspectLogEntry): BuyState {
  if (e.inspectorId === me) return 'mine';
  if (e.targetId === me) return 'aboutMe';
  if (game.boughtEntryIds.includes(e.id)) return 'bought';
  const offers = game.offersOut.filter((o) => o.entryId === e.id);
  if (offers.some((o) => o.status === 'pending')) return 'pending';
  if (offers.some((o) => o.status === 'declined' && o.poster === game.posterIndex)) return 'refused';
  return 'buyable';
}

/** Whether a Buy button can be pressed right now (investigation, affordable, under the cap). */
export function canBuyNow(game: GameView, phase: string, buyPrice: number, purchaseCap: number): boolean {
  const pending = game.offersOut.filter((o) => o.status === 'pending').length;
  return phase === 'investigation' && game.myScore >= buyPrice && game.purchasesUsed + pending < purchaseCap;
}

/** Entries grouped by poster, newest poster first; entries newest first within a poster. */
export function byPosterDesc(entries: InspectLogEntry[]): [number, InspectLogEntry[]][] {
  const groups = new Map<number, InspectLogEntry[]>();
  for (const e of entries) groups.set(e.poster, [...(groups.get(e.poster) ?? []), e]);
  return [...groups.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([p, es]) => [p, es.slice().sort((x, y) => y.at - x.at)]);
}

/** Times each player was inspected this poster. */
export function eyeCounts(game: GameView): Map<PlayerId, number> {
  const counts = new Map<PlayerId, number>();
  for (const e of game.log) if (e.poster === game.posterIndex) counts.set(e.targetId, (counts.get(e.targetId) ?? 0) + 1);
  return counts;
}

/** Entries of one poster merged per inspector, keeping each entry (each is a separate purchase). */
export function byInspector(entries: InspectLogEntry[]): { inspectorId: PlayerId; entries: InspectLogEntry[] }[] {
  const groups = new Map<PlayerId, InspectLogEntry[]>();
  for (const e of entries) groups.set(e.inspectorId, [...(groups.get(e.inspectorId) ?? []), e]);
  return [...groups.entries()].map(([inspectorId, es]) => ({ inspectorId, entries: es }));
}

export interface Findings {
  /** Your own and bought results about this player, newest first. */
  entries: InspectLogEntry[];
  /** Colors that fit every finding in the newest run that agrees (null: no findings). */
  possible: ColorId[] | null;
  /** How many of the newest findings agree; older ones contradict them (a likely color change). */
  agreeing: number;
}

/**
 * What this player's own findings (their searches and ones they bought) say about one player.
 * Color changes are secret, so findings are read newest first: every result includes the real
 * color, so they keep combining while they agree. An older result that leaves nothing in common
 * means that player probably changed color since; it and anything older stop counting.
 */
export function findingsAbout(game: GameView, targetId: PlayerId): Findings {
  // The log is in the order things happened; newest last.
  const entries = game.log.filter((e) => e.targetId === targetId && game.myResults[e.id]).reverse();
  if (!entries.length) return { entries, possible: null, agreeing: 0 };
  let possible = game.myResults[entries[0].id].slice();
  let agreeing = 1;
  for (; agreeing < entries.length; agreeing++) {
    const next = possible.filter((c) => game.myResults[entries[agreeing].id].includes(c));
    if (!next.length) break;
    possible = next;
  }
  return { entries, possible, agreeing };
}

export type Suspicion = 'ruledOut' | 'possible';

/**
 * Whether this player's findings rule a suspect out for the current poster color: every search
 * result includes the real color, so a poster color missing from the agreeing findings rules
 * them out. Nothing searched: null.
 */
export function suspicion(game: GameView, targetId: PlayerId): Suspicion | null {
  const { possible } = findingsAbout(game, targetId);
  if (!possible) return null;
  return possible.includes(game.posterColor) ? 'possible' : 'ruledOut';
}
