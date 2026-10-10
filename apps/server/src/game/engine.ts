import {
  DEFAULT_RULES,
  type ColorId,
  type GameRules,
  type GameView,
  type InspectLogEntry,
  type OfferView,
  type PlayerId,
  type PosterMode,
  type ReplayPoster,
  type ReplayView,
  type RoundResult,
} from '@wtc/shared';
import { makeId, type Rng } from '../rng';
import { inspectResult } from './decoys';
import { posterOrders } from './posterOrder';

// Pure game rules. No sockets, timers or rendering in here; the Room drives phases.

export interface GameState {
  rules: GameRules;
  posterMode: PosterMode;
  playerIds: PlayerId[];
  colors: Record<PlayerId, ColorId>;
  /** Wanted player per poster. */
  order: PlayerId[];
  /** Real pot per poster. Extra-inspect money lands here. */
  pots: number[];
  /** Pot shown on the current poster, frozen at poster start so a mid-round
   *  purchase on the final poster can't be timed by watching the pot. */
  shownPot: number;
  posterIndex: number;
  inspectLimit: number;
  inspectsUsed: Record<PlayerId, number>;
  log: InspectLogEntry[];
  /** Inspect results by log entry id. Server-only. */
  results: Record<string, ColorId[]>;
  /** Extra inspects bought this round. */
  extraInspects: Record<PlayerId, number>;
  /** Completed purchases this round (accepted offers + extra inspects). */
  purchases: Record<PlayerId, number>;
  offers: OfferView[];
  /** Entry ids each player has bought. */
  bought: Record<PlayerId, string[]>;
  /** Current poster's votes. */
  votes: Record<PlayerId, PlayerId>;
  scores: Record<PlayerId, number>;
  publicScores: Record<PlayerId, number>;
  scoreDeltas: Record<PlayerId, number>;
  correctVotes: Record<PlayerId, number>;
  history: ReplayPoster[];
  rounds: Record<PlayerId, RoundResult[]>;
}

export type Result<T = {}> = ({ ok: true } & T) | { ok: false; error: string };

export interface GameOptions {
  inspectLimit: number;
  posterMode: PosterMode;
  rules?: GameRules;
}

const perPlayer = <T>(ids: PlayerId[], value: () => T): Record<PlayerId, T> =>
  Object.fromEntries(ids.map((id) => [id, value()]));

export function createGame(
  players: { id: PlayerId; color: ColorId }[],
  opts: GameOptions,
  rng: Rng,
): GameState {
  const ids = players.map((p) => p.id);
  const order = posterOrders[opts.posterMode](ids, rng);
  const rules = { ...(opts.rules ?? DEFAULT_RULES) };
  return {
    rules,
    posterMode: opts.posterMode,
    playerIds: ids,
    colors: Object.fromEntries(players.map((p) => [p.id, p.color])),
    order,
    pots: order.map(() => rules.basePot),
    shownPot: rules.basePot,
    posterIndex: 0,
    inspectLimit: opts.inspectLimit,
    inspectsUsed: perPlayer(ids, () => 0),
    extraInspects: perPlayer(ids, () => 0),
    purchases: perPlayer(ids, () => 0),
    offers: [],
    bought: perPlayer(ids, () => []),
    log: [],
    results: {},
    votes: {},
    scores: perPlayer(ids, () => rules.startingPoints),
    publicScores: perPlayer(ids, () => rules.startingPoints),
    scoreDeltas: {},
    correctVotes: perPlayer(ids, () => 0),
    history: [],
    rounds: perPlayer(ids, () => []),
  };
}

export const wantedId = (s: GameState) => s.order[s.posterIndex];
export const posterColor = (s: GameState) => s.colors[wantedId(s)];
export const hasNextPoster = (s: GameState) => s.posterIndex + 1 < s.order.length;
const isPlayer = (s: GameState, id: PlayerId) => s.colors[id] !== undefined;

export function inspectsLeft(s: GameState, id: PlayerId): number {
  return s.inspectLimit + (s.extraInspects[id] ?? 0) - (s.inspectsUsed[id] ?? 0);
}

// ------------------------------------------------------------------ buying
// Purchases are private. Offer money is held in escrow (deducted on offer,
// refunded on decline/expiry), so scores never go below 0.

const pendingOffers = (s: GameState, buyerId: PlayerId) =>
  s.offers.filter((o) => o.buyerId === buyerId && o.status === 'pending');

/** Purchases still available this round, counting pending offers as used. */
export function purchasesLeft(s: GameState, id: PlayerId): number {
  return s.rules.purchaseCap - (s.purchases[id] ?? 0) - pendingOffers(s, id).length;
}

/** Whether this player already has, or is waiting on, the result of an entry. */
export function hasOrAwaitsResult(s: GameState, id: PlayerId, entryId: string): boolean {
  const entry = s.log.find((e) => e.id === entryId);
  return (
    entry?.inspectorId === id ||
    s.bought[id]?.includes(entryId) ||
    pendingOffers(s, id).some((o) => o.entryId === entryId)
  );
}

export function makeOffer(
  s: GameState,
  buyerId: PlayerId,
  entryId: string,
  now = Date.now(),
): Result<{ offer: OfferView }> {
  if (!isPlayer(s, buyerId)) return { ok: false, error: 'Unknown player' };
  const entry = s.log.find((e) => e.id === entryId);
  if (!entry) return { ok: false, error: 'Unknown inspect' };
  if (hasOrAwaitsResult(s, buyerId, entryId)) return { ok: false, error: 'You already have or are buying that result' };
  if (s.offers.some((o) => o.buyerId === buyerId && o.entryId === entryId && o.status === 'declined' && o.poster === s.posterIndex)) {
    return { ok: false, error: 'They already refused that one this round' };
  }
  if (purchasesLeft(s, buyerId) <= 0) return { ok: false, error: `Max ${s.rules.purchaseCap} purchases per round` };
  if (s.scores[buyerId] < s.rules.buyPrice) return { ok: false, error: 'Not enough points' };

  s.scores[buyerId] -= s.rules.buyPrice;
  const offer: OfferView = {
    id: makeId(6),
    entryId,
    buyerId,
    sellerId: entry.inspectorId,
    price: s.rules.buyPrice,
    status: 'pending',
    poster: s.posterIndex,
    at: now,
  };
  s.offers.push(offer);
  return { ok: true, offer };
}

export function respondOffer(
  s: GameState,
  sellerId: PlayerId,
  offerId: string,
  accept: boolean,
): Result<{ offer: OfferView }> {
  const offer = s.offers.find((o) => o.id === offerId);
  if (!offer || offer.sellerId !== sellerId) return { ok: false, error: 'Unknown offer' };
  if (offer.status !== 'pending') return { ok: false, error: 'That offer is closed' };
  if (accept) {
    offer.status = 'accepted';
    s.scores[sellerId] += offer.price;
    s.purchases[offer.buyerId] += 1;
    s.bought[offer.buyerId].push(offer.entryId);
  } else {
    offer.status = 'declined';
    s.scores[offer.buyerId] += offer.price;
  }
  return { ok: true, offer };
}

/** Unanswered offers count as no when the investigation ends. Returns the offers that expired. */
export function expireOffers(s: GameState): OfferView[] {
  const expired = s.offers.filter((o) => o.status === 'pending');
  for (const o of expired) {
    o.status = 'expired';
    s.scores[o.buyerId] += o.price;
  }
  return expired;
}

/** +1 inspect this round. The money goes to the next poster's pot (the current one on the final poster). */
export function buyExtraInspect(s: GameState, id: PlayerId): Result {
  if (!isPlayer(s, id)) return { ok: false, error: 'Unknown player' };
  if (purchasesLeft(s, id) <= 0) return { ok: false, error: `Max ${s.rules.purchaseCap} purchases per round` };
  if (s.scores[id] < s.rules.extraInspectPrice) return { ok: false, error: 'Not enough points' };
  s.scores[id] -= s.rules.extraInspectPrice;
  s.extraInspects[id] += 1;
  s.purchases[id] += 1;
  s.pots[Math.min(s.posterIndex + 1, s.pots.length - 1)] += s.rules.extraInspectPrice;
  return { ok: true };
}

export function inspect(
  s: GameState,
  inspectorId: PlayerId,
  targetId: PlayerId,
  rng: Rng,
  now = Date.now(),
): Result<{ entry: InspectLogEntry; result: ColorId[] }> {
  if (!isPlayer(s, inspectorId) || !isPlayer(s, targetId)) return { ok: false, error: 'Unknown player' };
  if (inspectorId === targetId) return { ok: false, error: "You can't inspect yourself" };
  if (inspectsLeft(s, inspectorId) <= 0) return { ok: false, error: 'No inspects left this round' };

  const result = inspectResult(Object.values(s.colors), s.colors[targetId], s.colors[inspectorId], rng, s.rules.decoys);
  const entry: InspectLogEntry = { id: makeId(6), poster: s.posterIndex, inspectorId, targetId, at: now };
  s.inspectsUsed[inspectorId] += 1;
  s.log.push(entry);
  s.results[entry.id] = result;
  return { ok: true, entry, result };
}

export function castVote(s: GameState, voterId: PlayerId, targetId: PlayerId): Result {
  if (!isPlayer(s, voterId) || !isPlayer(s, targetId)) return { ok: false, error: 'Unknown player' };
  if (voterId === targetId) return { ok: false, error: "You can't vote for yourself" };
  if (s.votes[voterId]) return { ok: false, error: 'You already voted' };
  s.votes[voterId] = targetId;
  return { ok: true };
}

/** Pays out the current poster and records it. Call once, at the end of the vote phase. */
export function resolvePoster(s: GameState): ReplayPoster {
  const i = s.posterIndex;
  const wanted = wantedId(s);
  const pot = s.pots[i];
  // The Wanted player's own vote never counts.
  const correctIds = s.playerIds.filter((p) => p !== wanted && s.votes[p] === wanted);
  const escaped = correctIds.length === 0;
  const payoutEach = escaped ? 0 : Math.floor(pot / correctIds.length);

  const deltas: Record<PlayerId, number> = {};
  if (escaped) {
    deltas[wanted] = s.rules.escapeBonus;
  } else {
    for (const p of correctIds) {
      deltas[p] = payoutEach;
      s.correctVotes[p] += 1;
    }
  }
  for (const [p, d] of Object.entries(deltas)) s.scores[p] += d;

  const record: ReplayPoster = {
    poster: i,
    wantedId: wanted,
    color: s.colors[wanted],
    pot,
    votes: Object.fromEntries(s.playerIds.map((p) => [p, s.votes[p] ?? null])),
    correctIds,
    escaped,
    payoutEach,
  };
  s.history.push(record);

  for (const p of s.playerIds) {
    const wasWanted = p === wanted;
    const correct = correctIds.includes(p);
    s.rounds[p].push({
      poster: i,
      color: record.color,
      wasWanted,
      escaped: wasWanted && escaped,
      votedFor: s.votes[p] ?? null,
      correct,
      wantedId: wasWanted || correct ? wanted : null,
      payout: deltas[p] ?? 0,
    });
  }

  s.scoreDeltas = deltas;
  s.publicScores = { ...s.scores };
  s.shownPot = pot;
  return record;
}

export function advancePoster(s: GameState): void {
  s.posterIndex += 1;
  s.shownPot = s.pots[s.posterIndex];
  s.inspectsUsed = perPlayer(s.playerIds, () => 0);
  s.extraInspects = perPlayer(s.playerIds, () => 0);
  s.purchases = perPlayer(s.playerIds, () => 0);
  s.votes = {};
}

/** Most points; tie-break on most correct votes; still tied = shared win. */
export function winners(s: GameState): PlayerId[] {
  const rank = (p: PlayerId) => [s.scores[p], s.correctVotes[p]] as const;
  let best: PlayerId[] = [];
  for (const p of s.playerIds) {
    if (!best.length) { best = [p]; continue; }
    const [a1, a2] = rank(p);
    const [b1, b2] = rank(best[0]);
    if (a1 > b1 || (a1 === b1 && a2 > b2)) best = [p];
    else if (a1 === b1 && a2 === b2) best.push(p);
  }
  return best;
}

export function buildReplay(s: GameState): ReplayView {
  return {
    colors: { ...s.colors },
    posters: s.history.slice(),
    log: s.log.map((e) => ({ ...e, result: s.results[e.id] })),
    finalScores: { ...s.scores },
    correctVotes: { ...s.correctVotes },
    winners: winners(s),
  };
}

/** The slice of game state one player may see. */
export function gameViewFor(s: GameState, me: PlayerId): GameView {
  const myResults: Record<string, ColorId[]> = {};
  const bought = s.bought[me] ?? [];
  for (const e of s.log) if (e.inspectorId === me || bought.includes(e.id)) myResults[e.id] = s.results[e.id];
  return {
    posterIndex: s.posterIndex,
    posterCount: s.order.length,
    posterColor: posterColor(s),
    pot: s.shownPot,
    youAreWanted: wantedId(s) === me,
    inspectLimit: s.inspectLimit,
    extraInspects: s.extraInspects[me] ?? 0,
    inspectsUsed: s.inspectsUsed[me] ?? 0,
    purchasesUsed: s.purchases[me] ?? 0,
    log: s.log,
    myResults,
    boughtEntryIds: bought.slice(),
    offersOut: s.offers.filter((o) => o.buyerId === me),
    offersIn: s.offers.filter((o) => o.sellerId === me),
    myVote: s.votes[me] ?? null,
    scores: s.publicScores,
    scoreDeltas: s.scoreDeltas,
    myScore: s.scores[me],
    myCorrectVotes: s.correctVotes[me],
    myRounds: s.rounds[me] ?? [],
  };
}
