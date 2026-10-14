import {
  COLOR_IDS,
  DEFAULT_RULES,
  type ColorChange,
  type DirtyTrick,
  type ColorId,
  type GameRules,
  type GameView,
  type InspectLogEntry,
  type OfferView,
  type PlayerId,
  type Reaction,
  type ReactionsView,
  type ReplayPoster,
  type ReplayView,
  type RoundResult,
} from '@wtc/shared';
import { makeId, type Rng } from '../rng';
import { inspectResult, narrowedResult } from './decoys';
import { randomOrder } from './posterOrder';

// Pure game rules. No sockets, timers or rendering in here; the Room drives phases.

export interface GameState {
  rules: GameRules;
  playerIds: PlayerId[];
  /** Current colors. Change only through swapColor, during payouts. */
  colors: Record<PlayerId, ColorId>;
  colorHistory: Record<PlayerId, ColorChange[]>;
  /** Wanted player per poster. */
  order: PlayerId[];
  /** Poster color per poster, fixed when that poster starts (after swaps). */
  posterColors: ColorId[];
  swapLimit: number;
  swapsUsed: Record<PlayerId, number>;
  /** Players who changed color this payout (one each, final). Gives the public count. Cleared each poster. */
  /** Dirty tricks bought this payout (one each, final, secret). Cleared each poster. */
  trickThisPayout: Record<PlayerId, DirtyTrick>;
  /** Players who covered their tracks for the next poster (set at the payout, used from the next poster). */
  coverNext: Record<PlayerId, true>;
  /** This poster's covered players: the stand-in color every searcher sees instead of their real one.
   *  `alt` is for the stand-in color's own wearer (they'd see their own color otherwise). Server-only. */
  cover: Record<PlayerId, { standIn: ColorId; alt: ColorId }>;
  /** Worth snapshots bought, per player: the latest one, and the poster it was bought during. */
  worth: Record<PlayerId, { poster: number; scores: Record<PlayerId, number> }>;
  /** Who had covered tracks on each poster (stats only, never sent). */
  coveredByPoster: PlayerId[][];
  /** How many players changed color before each poster. Stats only: never sent to players. */
  colorChanges: number[];
  /** Colors still possible per searcher and target ("searcher|target"), from that searcher's own
   *  searches. Each repeat search narrows it by one. Server-only. */
  narrow: Record<string, ColorId[]>;
  /** Target's real color at the time of each inspect, by log entry id. Server-only. */
  realAt: Record<string, ColorId>;
  /** Escape bonuses earned but not paid yet. Paid at the end of the game, so the public
   *  ledger never shows a lone +$50 next to the outlaw. Only the earner sees their own. */
  heldEscapeBonus: Record<PlayerId, number>;
  /** Set once held bonuses have been added to scores. */
  finished: boolean;
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
  /** Extra inspects bought over the whole game (stats). */
  extraInspectsTotal: Record<PlayerId, number>;
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
  /** Current reactions. `shown` is what everyone sees; `own` is one player's true
   *  reaction, sent only to that player (the Wanted player after a payout). */
  reactions: { key: string; shown: Record<PlayerId, Reaction>; own: { id: PlayerId; reaction: Reaction } | null } | null;
}

export type Result<T = {}> = ({ ok: true } & T) | { ok: false; error: string };

export interface GameOptions {
  inspectLimit: number;
  /** Posters in the game (default: one per player). */
  posterCount?: number;
  rules?: GameRules;
  /** Color swaps per player per game. Default 0. */
  swapLimit?: number;
}

const perPlayer = <T>(ids: PlayerId[], value: () => T): Record<PlayerId, T> =>
  Object.fromEntries(ids.map((id) => [id, value()]));

export function createGame(
  players: { id: PlayerId; color: ColorId }[],
  opts: GameOptions,
  rng: Rng,
): GameState {
  const ids = players.map((p) => p.id);
  const order = randomOrder(ids, Math.max(1, opts.posterCount ?? ids.length), rng);
  const rules = { ...(opts.rules ?? DEFAULT_RULES) };
  const colors = Object.fromEntries(players.map((p) => [p.id, p.color]));
  return {
    rules,
    playerIds: ids,
    colors,
    colorHistory: Object.fromEntries(players.map((p) => [p.id, [{ color: p.color, afterPoster: null }]])),
    order,
    posterColors: [colors[order[0]]],
    swapLimit: opts.swapLimit ?? 0,
    swapsUsed: perPlayer(ids, () => 0),
    trickThisPayout: {},
    coverNext: {},
    cover: {},
    worth: {},
    coveredByPoster: [],
    colorChanges: [0],
    narrow: {},
    realAt: {},
    heldEscapeBonus: perPlayer(ids, () => 0),
    finished: false,
    pots: order.map(() => rules.basePot),
    shownPot: rules.basePot,
    posterIndex: 0,
    inspectLimit: opts.inspectLimit,
    inspectsUsed: perPlayer(ids, () => 0),
    extraInspects: perPlayer(ids, () => 0),
    extraInspectsTotal: perPlayer(ids, () => 0),
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
    reactions: null,
  };
}

export const wantedId = (s: GameState) => s.order[s.posterIndex];
export const posterColor = (s: GameState) => s.posterColors[s.posterIndex];
export const hasNextPoster = (s: GameState) => s.posterIndex + 1 < s.order.length;
/**
 * Whether an id (from a client: could be anything) is a player in this game. Checked against the
 * player list, never as an object key: ids like "constructor" or "__proto__" would otherwise
 * match built-in properties.
 */
const isPlayer = (s: GameState, id: unknown): id is PlayerId => typeof id === 'string' && s.playerIds.includes(id);

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

/** +rules.extraInspectCount inspects this round (one purchase). The money goes to the next poster's pot (the current one on the final poster). */
export function buyExtraInspect(s: GameState, id: PlayerId): Result {
  if (!isPlayer(s, id)) return { ok: false, error: 'Unknown player' };
  if (purchasesLeft(s, id) <= 0) return { ok: false, error: `Max ${s.rules.purchaseCap} purchases per round` };
  if (s.scores[id] < s.rules.extraInspectPrice) return { ok: false, error: 'Not enough points' };
  s.scores[id] -= s.rules.extraInspectPrice;
  const n = s.rules.extraInspectCount ?? 1;
  s.extraInspects[id] += n;
  s.extraInspectsTotal[id] += n;
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

  const real = s.colors[targetId];
  const mine = s.colors[inspectorId];
  // Covered tracks: this poster, every search of them shows a stand-in color as if it were real
  // (it repeats and narrows exactly like a real one), and never their true color.
  const cover = s.cover[targetId];
  const shown = cover ? (cover.standIn === mine ? cover.alt : cover.standIn) : real;
  const exclude = cover ? [real] : [];
  const key = cover ? `${inspectorId}|${targetId}|cover${s.posterIndex}` : `${inspectorId}|${targetId}`;
  // Earlier searches narrow this one, unless the target has since changed color (then start over).
  const before = s.narrow[key]?.includes(shown) ? s.narrow[key] : null;
  const result = before
    ? narrowedResult(Object.values(s.colors), shown, mine, before, rng, s.rules.decoys, exclude)
    : inspectResult(Object.values(s.colors), shown, mine, rng, s.rules.decoys, exclude);
  s.narrow[key] = before ? before.filter((c) => result.includes(c)) : result.slice();
  const entry: InspectLogEntry = { id: makeId(6), poster: s.posterIndex, inspectorId, targetId, at: now };
  s.inspectsUsed[inspectorId] += 1;
  s.log.push(entry);
  s.results[entry.id] = result;
  s.realAt[entry.id] = s.colors[targetId];
  return { ok: true, entry, result };
}

// ------------------------------------------------------------------ color swaps
// A player may change their own color, for rules.swapPrice, up to swapLimit times per game and
// only between posters (the Room allows it during payouts). Colors stay unique. Nobody is told:
// not who, not how many.

/** Palette colors no player holds right now. */
export function freeColors(s: GameState): ColorId[] {
  const held = new Set(Object.values(s.colors));
  return COLOR_IDS.filter((c) => !held.has(c));
}

export function swapsLeft(s: GameState, id: PlayerId): number {
  return s.swapLimit - (s.swapsUsed[id] ?? 0);
}

/** Dirty tricks are paid privately; the money goes to the next bounty. */
function payForTrick(s: GameState, id: PlayerId, trick: DirtyTrick, price: number) {
  s.trickThisPayout[id] = trick;
  s.scores[id] -= price;
  s.pots[Math.min(s.posterIndex + 1, s.pots.length - 1)] += price;
}

function trickCheck(s: GameState, id: PlayerId, price: number): string | null {
  if (!isPlayer(s, id)) return 'Unknown player';
  if (s.trickThisPayout[id]) return 'One dirty trick per round';
  if (s.scores[id] < price) return `That trick costs $${price}`;
  return null;
}

/**
 * Dirty trick: change a player's color to a random free one, chosen by the server. Players
 * never see the list of free colors: knowing which colors left the free pool would reveal who
 * changed. One trick per player per payout, and it's final.
 */
export function swapColor(s: GameState, id: PlayerId, rng: Rng): Result<{ color: ColorId }> {
  const price = s.rules.swapPrice ?? 0;
  const err = trickCheck(s, id, price);
  if (err) return { ok: false, error: err };
  if (s.swapLimit <= 0) return { ok: false, error: 'Color changes are off in this game' };
  if (swapsLeft(s, id) <= 0) return { ok: false, error: 'No color changes left this game' };
  const free = freeColors(s);
  if (!free.length) return { ok: false, error: 'No free colors right now' };
  const color = free[rng.int(free.length)];
  s.swapsUsed[id] += 1;
  payForTrick(s, id, 'swap', price);
  s.colors[id] = color;
  return { ok: true, color };
}

/**
 * Dirty trick: cover your tracks. During the next poster, every search of this player shows a
 * stand-in color (worn by someone else) in place of their real one; see inspect().
 */
export function coverTracks(s: GameState, id: PlayerId): Result {
  const price = s.rules.coverPrice ?? 0;
  const err = trickCheck(s, id, price);
  if (err) return { ok: false, error: err };
  s.coverNext[id] = true;
  payForTrick(s, id, 'cover', price);
  return { ok: true };
}

/**
 * The stand-in for a covered player this poster: a color someone else is wearing right now. A
 * covered outlaw's stand-in is never the poster color (that's their own, real color). `alt` is
 * a second color, shown only to the stand-in's own wearer, who would otherwise see their own
 * color come up.
 */
export function pickStandIn(s: GameState, id: PlayerId, rng: Rng): { standIn: ColorId; alt: ColorId } {
  const real = s.colors[id];
  const poster = posterColor(s);
  const ok = (c: ColorId) => c !== real && !(wantedId(s) === id && c === poster);
  const pool = s.playerIds.filter((p) => p !== id).map((p) => s.colors[p]).filter(ok);
  const standIn = pool[rng.int(pool.length)];
  const altPool = pool.filter((c) => c !== standIn);
  return { standIn, alt: altPool.length ? altPool[rng.int(altPool.length)] : standIn };
}

/** A private snapshot of everyone's money as of the last payout. Once per poster. */
export function buyWorth(s: GameState, id: PlayerId): Result {
  if (!isPlayer(s, id)) return { ok: false, error: 'Unknown player' };
  const price = s.rules.worthPrice ?? 0;
  if (s.worth[id]?.poster === s.posterIndex) return { ok: false, error: 'You already looked this poster' };
  if (s.scores[id] < price) return { ok: false, error: `A look costs $${price}` };
  s.scores[id] -= price;
  s.pots[Math.min(s.posterIndex + 1, s.pots.length - 1)] += price;
  s.worth[id] = { poster: s.posterIndex, scores: { ...s.publicScores } };
  return { ok: true };
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

  // Public score changes this poster. An escape bonus is held, not paid, so it never shows here.
  const deltas: Record<PlayerId, number> = {};
  if (escaped) {
    s.heldEscapeBonus[wanted] += s.rules.escapeBonus;
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
    color: posterColor(s),
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
      payout: wasWanted && escaped ? s.rules.escapeBonus : (deltas[p] ?? 0),
    });
  }

  s.scoreDeltas = deltas;
  s.publicScores = { ...s.scores };
  s.shownPot = pot;
  return record;
}

const despair = (rng: Rng): Reaction => (rng.int(2) === 0 ? 'despair-1' : 'despair-2');

/**
 * Payout reactions for the poster just resolved: correct voters cheer, everyone else
 * despairs. The Wanted player despairs in everyone else's view whether caught or not;
 * their true result (cheer if they escaped) goes only to them.
 */
export function setPosterReactions(s: GameState, rng: Rng): void {
  const rec = s.history[s.history.length - 1];
  if (!rec || rec.poster !== s.posterIndex) return;
  const shown: Record<PlayerId, Reaction> = {};
  for (const p of s.playerIds) shown[p] = rec.correctIds.includes(p) ? 'victory' : despair(rng);
  const wanted = rec.wantedId;
  shown[wanted] = despair(rng);
  s.reactions = {
    key: `poster-${rec.poster}`,
    shown,
    own: { id: wanted, reaction: rec.escaped ? 'victory' : shown[wanted] },
  };
}

/** End of game: winners cheer, everyone else despairs. Winners are public by then. */
export function setEndReactions(s: GameState, rng: Rng): void {
  const won = winners(s);
  const shown: Record<PlayerId, Reaction> = {};
  for (const p of s.playerIds) shown[p] = won.includes(p) ? 'victory' : despair(rng);
  s.reactions = { key: 'end', shown, own: null };
}

/** Applies this payout's tricks, then starts the next poster with the Wanted player's current color. */
export function advancePoster(s: GameState, rng: Rng): void {
  const swapped = Object.keys(s.trickThisPayout).filter((p) => s.trickThisPayout[p] === 'swap');
  for (const p of swapped) s.colorHistory[p].push({ color: s.colors[p], afterPoster: s.posterIndex });
  s.trickThisPayout = {};
  s.posterIndex += 1;
  s.colorChanges[s.posterIndex] = swapped.length;
  s.posterColors[s.posterIndex] = s.colors[s.order[s.posterIndex]];
  // Covered tracks apply to this poster only, with stand-ins drawn from today's colors.
  s.cover = {};
  for (const p of Object.keys(s.coverNext)) s.cover[p] = pickStandIn(s, p, rng);
  s.coveredByPoster[s.posterIndex] = Object.keys(s.cover);
  s.coverNext = {};
  s.shownPot = s.pots[s.posterIndex];
  s.reactions = null;
  s.inspectsUsed = perPlayer(s.playerIds, () => 0);
  s.extraInspects = perPlayer(s.playerIds, () => 0);
  s.purchases = perPlayer(s.playerIds, () => 0);
  s.votes = {};
}

/** End of game: pay the held escape bonuses. Idempotent. Call before winners/buildReplay. */
export function finishGame(s: GameState): void {
  if (s.finished) return;
  s.finished = true;
  for (const p of s.playerIds) s.scores[p] += s.heldEscapeBonus[p];
  s.publicScores = { ...s.scores };
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
  finishGame(s);
  return {
    escapeBonuses: { ...s.heldEscapeBonus },
    colors: { ...s.colors },
    colorHistory: structuredClone(s.colorHistory),
    posters: s.history.slice(),
    log: s.log.map((e) => ({ ...e, result: s.results[e.id], real: s.realAt[e.id] })),
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
    swapLimit: s.swapLimit,
    swapsUsed: s.swapsUsed[me] ?? 0,
    trickThisPayout: s.trickThisPayout[me] ?? null,
    coveredThisPoster: !!s.cover[me],
    myWorth: s.worth[me] ? structuredClone(s.worth[me]) : null,
    worthBoughtThisPoster: s.worth[me]?.poster === s.posterIndex,
    myColorHistory: structuredClone(s.colorHistory[me] ?? []),
    myVote: s.votes[me] ?? null,
    votesCast: Object.keys(s.votes).length,
    scoreDeltas: s.scoreDeltas,
    myScore: s.scores[me],
    myCorrectVotes: s.correctVotes[me],
    myHeldEscapeBonus: s.finished ? 0 : (s.heldEscapeBonus[me] ?? 0),
    myRounds: s.rounds[me] ?? [],
    reactions: reactionsFor(s, me),
  };
}

/**
 * A watcher's game view (joined mid-game): what every player sees, nothing of any one player's.
 * Same shape as a player's, with every private part empty.
 */
export function spectatorGameView(s: GameState): GameView {
  return { ...gameViewFor(s, ''), myScore: 0, myCorrectVotes: 0, myHeldEscapeBonus: 0, myRounds: [], myColorHistory: [], youAreWanted: false };
}

/** Everyone gets the shown reactions; only the owner of `own` gets their true one. */
function reactionsFor(s: GameState, me: PlayerId): ReactionsView | null {
  const r = s.reactions;
  if (!r) return null;
  const byPlayer = { ...r.shown };
  if (r.own && r.own.id === me) byPlayer[me] = r.own.reaction;
  return { key: r.key, byPlayer };
}
