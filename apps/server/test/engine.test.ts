import { describe, expect, it } from 'vitest';
import { BASE_POT, BUY_INSPECT_PRICE, COLOR_IDS, ESCAPE_BONUS, EXTRA_INSPECT_PRICE, STARTING_POINTS, type ColorId } from '@wtc/shared';
import * as engine from '../src/game/engine';
import { inspectResult } from '../src/game/decoys';
import { posterOrders } from '../src/game/posterOrder';
import { secureRng } from '../src/rng';

const players = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, color: COLOR_IDS[i] }));
const newGame = (n = 6, posterMode: 'everyoneOnce' | 'randomRepeats' = 'everyoneOnce') =>
  engine.createGame(players(n), { inspectLimit: 3, posterMode }, secureRng);

describe('decoys', () => {
  it('returns the real color plus 2 decoys, never the inspector color', () => {
    const colors = players(8).map((p) => p.color);
    for (let i = 0; i < 500; i++) {
      const r = inspectResult(colors, 'red', 'orange', secureRng);
      expect(r).toHaveLength(3);
      expect(new Set(r).size).toBe(3);
      expect(r).toContain('red');
      expect(r).not.toContain('orange');
      for (const c of r) expect(colors).toContain(c);
    }
  });

  it('tops up from the palette in tiny dev games', () => {
    const r = inspectResult(['red', 'orange'] as ColorId[], 'red', 'orange', secureRng);
    expect(r).toHaveLength(3);
    expect(r).toContain('red');
    expect(r).not.toContain('orange');
  });
});

describe('poster order', () => {
  it('everyoneOnce makes everyone Wanted exactly once', () => {
    const ids = players(10).map((p) => p.id);
    expect(posterOrders.everyoneOnce(ids, secureRng).slice().sort()).toEqual(ids.slice().sort());
  });

  it('randomRepeats keeps game length and only uses players', () => {
    const ids = players(10).map((p) => p.id);
    const order = posterOrders.randomRepeats(ids, secureRng);
    expect(order).toHaveLength(10);
    for (const id of order) expect(ids).toContain(id);
  });
});

describe('inspect', () => {
  it('enforces the limit and blocks self-inspects', () => {
    const g = newGame();
    expect(engine.inspect(g, 'p0', 'p0', secureRng).ok).toBe(false);
    for (let i = 0; i < 3; i++) expect(engine.inspect(g, 'p0', 'p1', secureRng).ok).toBe(true);
    expect(engine.inspect(g, 'p0', 'p1', secureRng).ok).toBe(false);
    expect(g.log).toHaveLength(3);
  });

  it('resets inspects each poster', () => {
    const g = newGame();
    for (let i = 0; i < 3; i++) engine.inspect(g, 'p0', 'p1', secureRng);
    engine.resolvePoster(g);
    engine.advancePoster(g);
    expect(engine.inspectsLeft(g, 'p0')).toBe(3);
  });
});

describe('payout', () => {
  it('splits the pot, rounding down, and ignores the Wanted vote', () => {
    const g = newGame();
    const wanted = engine.wantedId(g);
    const others = g.playerIds.filter((p) => p !== wanted);
    // 3 correct voters, Wanted votes for someone else.
    for (const p of others.slice(0, 3)) engine.castVote(g, p, wanted);
    engine.castVote(g, wanted, others[0]);
    const rec = engine.resolvePoster(g);
    expect(rec.correctIds).toHaveLength(3);
    expect(rec.payoutEach).toBe(Math.floor(BASE_POT / 3));
    expect(g.scores[others[0]]).toBe(STARTING_POINTS + 33);
    expect(g.scores[wanted]).toBe(STARTING_POINTS);
    expect(g.correctVotes[others[0]]).toBe(1);
  });

  it('holds the escape bonus until the end, so the public ledger never shows it', () => {
    const g = newGame();
    const wanted = engine.wantedId(g);
    const rec = engine.resolvePoster(g);
    expect(rec.escaped).toBe(true);
    // Nothing public moves: no delta, no public score change.
    expect(g.scoreDeltas).toEqual({});
    for (const p of g.playerIds) expect(engine.gameViewFor(g, p).scores[wanted]).toBe(STARTING_POINTS);
    // Only the earner sees it, privately.
    expect(engine.gameViewFor(g, wanted).myHeldEscapeBonus).toBe(ESCAPE_BONUS);
    expect(engine.gameViewFor(g, g.playerIds.find((p) => p !== wanted)!).myHeldEscapeBonus).toBe(0);
    expect(g.rounds[wanted][0].payout).toBe(ESCAPE_BONUS);

    // Paid at the end, once, and counted for the winner.
    const replay = engine.buildReplay(g);
    expect(replay.escapeBonuses[wanted]).toBe(ESCAPE_BONUS);
    expect(replay.finalScores[wanted]).toBe(STARTING_POINTS + ESCAPE_BONUS);
    expect(replay.winners).toEqual([wanted]);
    engine.finishGame(g);
    expect(g.scores[wanted]).toBe(STARTING_POINTS + ESCAPE_BONUS);
  });

  it('rejects self-votes and double votes', () => {
    const g = newGame();
    expect(engine.castVote(g, 'p0', 'p0').ok).toBe(false);
    expect(engine.castVote(g, 'p0', 'p1').ok).toBe(true);
    expect(engine.castVote(g, 'p0', 'p2').ok).toBe(false);
  });
});

describe('winners', () => {
  it('breaks ties on correct votes, then shares', () => {
    const g = newGame();
    g.scores = { p0: 200, p1: 200, p2: 200, p3: 10, p4: 10, p5: 10 };
    g.correctVotes = { p0: 3, p1: 3, p2: 1, p3: 0, p4: 0, p5: 0 };
    expect(engine.winners(g).sort()).toEqual(['p0', 'p1']);
  });
});

describe('views do not leak secrets', () => {
  it("never include another player's color or the Wanted id", () => {
    const g = newGame(8);
    for (const p of g.playerIds) engine.inspect(g, p, p === 'p0' ? 'p1' : 'p0', secureRng);
    const wanted = engine.wantedId(g);
    for (const me of g.playerIds) {
      const v = engine.gameViewFor(g, me);
      // Only own inspect results.
      for (const id of Object.keys(v.myResults)) expect(g.log.find((e) => e.id === id)!.inspectorId).toBe(me);
      expect(v.youAreWanted).toBe(me === wanted);
      const json = JSON.stringify(v);
      expect(json).not.toContain('"votes"');
      expect(json).not.toContain('"colors"');
    }
  });
});

describe('buying', () => {
  const withEntry = () => {
    const g = newGame();
    const r = engine.inspect(g, 'p1', 'p2', secureRng);
    if (!r.ok) throw new Error(r.error);
    return { g, entryId: r.entry.id };
  };

  it('escrows the price, pays the seller on accept and reveals the stored result', () => {
    const { g, entryId } = withEntry();
    const o = engine.makeOffer(g, 'p0', entryId);
    if (!o.ok) throw new Error(o.error);
    expect(o.offer.sellerId).toBe('p1');
    expect(g.scores.p0).toBe(STARTING_POINTS - BUY_INSPECT_PRICE);
    expect(engine.gameViewFor(g, 'p0').myResults[entryId]).toBeUndefined();
    expect(engine.respondOffer(g, 'p1', o.offer.id, true).ok).toBe(true);
    expect(g.scores.p1).toBe(STARTING_POINTS + BUY_INSPECT_PRICE);
    const v = engine.gameViewFor(g, 'p0');
    expect(v.myResults[entryId]).toEqual(g.results[entryId]);
    expect(v.boughtEntryIds).toEqual([entryId]);
    expect(v.purchasesUsed).toBe(1);
  });

  it('refunds on decline and on expiry', () => {
    const { g, entryId } = withEntry();
    const o = engine.makeOffer(g, 'p0', entryId);
    if (!o.ok) throw new Error(o.error);
    expect(engine.respondOffer(g, 'p1', o.offer.id, false).ok).toBe(true);
    expect(g.scores.p0).toBe(STARTING_POINTS);
    // No re-offering a refused result in the same round.
    expect(engine.makeOffer(g, 'p0', entryId).ok).toBe(false);
    const other = engine.inspect(g, 'p1', 'p3', secureRng);
    if (!other.ok) throw new Error(other.error);
    expect(engine.makeOffer(g, 'p0', other.entry.id).ok).toBe(true);
    engine.expireOffers(g);
    expect(g.scores.p0).toBe(STARTING_POINTS);
    expect(g.purchases.p0).toBe(0);
  });

  it('only the seller can answer, once', () => {
    const { g, entryId } = withEntry();
    const o = engine.makeOffer(g, 'p0', entryId);
    if (!o.ok) throw new Error(o.error);
    expect(engine.respondOffer(g, 'p3', o.offer.id, true).ok).toBe(false);
    expect(engine.respondOffer(g, 'p1', o.offer.id, true).ok).toBe(true);
    expect(engine.respondOffer(g, 'p1', o.offer.id, true).ok).toBe(false);
  });

  it('blocks buying your own, duplicate or already-bought results', () => {
    const { g, entryId } = withEntry();
    expect(engine.makeOffer(g, 'p1', entryId).ok).toBe(false);
    expect(engine.makeOffer(g, 'p0', entryId).ok).toBe(true);
    expect(engine.makeOffer(g, 'p0', entryId).ok).toBe(false);
  });

  it('caps purchases at 3 per round, counting pending offers', () => {
    const g = newGame();
    const ids: string[] = [];
    for (const t of ['p2', 'p3', 'p4', 'p5']) {
      const r = engine.inspect(g, 'p1', t, secureRng);
      if (r.ok) ids.push(r.entry.id);
    }
    // p1 has 3 inspects; add a 4th entry from someone else.
    const extra = engine.inspect(g, 'p2', 'p3', secureRng);
    if (extra.ok) ids.push(extra.entry.id);
    expect(engine.buyExtraInspect(g, 'p0').ok).toBe(true);
    expect(engine.makeOffer(g, 'p0', ids[0]).ok).toBe(true);
    expect(engine.makeOffer(g, 'p0', ids[1]).ok).toBe(true);
    expect(engine.makeOffer(g, 'p0', ids[2]).ok).toBe(false);
    expect(engine.buyExtraInspect(g, 'p0').ok).toBe(false);
  });

  it('never lets scores go below 0', () => {
    const { g, entryId } = withEntry();
    g.scores.p0 = BUY_INSPECT_PRICE - 1;
    expect(engine.makeOffer(g, 'p0', entryId).ok).toBe(false);
    expect(engine.buyExtraInspect(g, 'p0').ok).toBe(false);
    expect(g.scores.p0).toBe(BUY_INSPECT_PRICE - 1);
  });

  it('extra inspects add an inspect and fund the next pot (current pot on the last poster)', () => {
    const g = newGame();
    expect(engine.buyExtraInspect(g, 'p0').ok).toBe(true);
    expect(engine.inspectsLeft(g, 'p0')).toBe(4);
    expect(g.pots[1]).toBe(BASE_POT + EXTRA_INSPECT_PRICE);
    expect(engine.gameViewFor(g, 'p3').pot).toBe(BASE_POT);
    engine.resolvePoster(g);
    engine.advancePoster(g);
    expect(engine.gameViewFor(g, 'p3').pot).toBe(BASE_POT + EXTRA_INSPECT_PRICE);
    expect(engine.inspectsLeft(g, 'p0')).toBe(3);

    while (engine.hasNextPoster(g)) { engine.resolvePoster(g); engine.advancePoster(g); }
    const last = g.posterIndex;
    expect(engine.buyExtraInspect(g, 'p0').ok).toBe(true);
    expect(g.pots[last]).toBe(BASE_POT + EXTRA_INSPECT_PRICE);
    // Shown pot is frozen during the round, real pot is paid out.
    expect(engine.gameViewFor(g, 'p3').pot).toBe(BASE_POT);
    expect(engine.resolvePoster(g).pot).toBe(BASE_POT + EXTRA_INSPECT_PRICE);
  });

  it('keeps offers private to buyer and seller', () => {
    const { g, entryId } = withEntry();
    engine.makeOffer(g, 'p0', entryId);
    expect(engine.gameViewFor(g, 'p0').offersOut).toHaveLength(1);
    expect(engine.gameViewFor(g, 'p1').offersIn).toHaveLength(1);
    for (const p of ['p2', 'p3', 'p4', 'p5']) {
      const v = engine.gameViewFor(g, p);
      expect(v.offersOut.length + v.offersIn.length).toBe(0);
    }
  });
});
