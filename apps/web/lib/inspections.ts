import type { GameView, InspectLogEntry, PlayerId } from '@wtc/shared';

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

/**
 * The first poster whose findings still hold: the latest poster that had color changes before
 * it (anyone might have changed, so older findings could be stale). Same rule as the Notebook.
 */
export function freshFrom(game: GameView): number {
  let start = 0;
  game.colorChanges.forEach((n, poster) => {
    if (n > 0 && poster <= game.posterIndex) start = poster;
  });
  return start;
}

export type Suspicion = 'ruledOut' | 'possible';

/**
 * What this player's own findings (their searches and ones they bought) say about one suspect
 * and the current poster color. Every search result includes the real color, so a result
 * without the poster color rules them out; if every result has it, they're possible. Nothing
 * searched since colors last changed: null. Uses only this client's own results.
 */
export function suspicion(game: GameView, targetId: PlayerId): Suspicion | null {
  const start = freshFrom(game);
  const results = game.log.filter((e) => e.targetId === targetId && e.poster >= start && game.myResults[e.id]).map((e) => game.myResults[e.id]);
  if (!results.length) return null;
  return results.every((r) => r.includes(game.posterColor)) ? 'possible' : 'ruledOut';
}
