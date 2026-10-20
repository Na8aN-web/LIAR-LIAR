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

// Combining findings lives in @wtc/shared (findings.ts), where it's tested.
export { findingsAbout, suspicion, type Findings, type Suspicion } from '@wtc/shared';
