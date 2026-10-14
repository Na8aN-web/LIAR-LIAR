import { afterEach, describe, expect, it } from 'vitest';
import { COLOR_IDS, DEFAULT_RULES, POSTER_RANGE, estimatedGameSeconds, DEFAULT_TIMERS, type ColorId, type PlayerView } from '@wtc/shared';
import * as engine from '../src/game/engine';
import { Room } from '../src/room';
import { secureRng } from '../src/rng';

// Hidden wealth (the worth snapshot), Dirty Tricks (change color, cover your tracks), and the
// poster-count setting.

const players = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, color: COLOR_IDS[i] }));
const game = (n = 8, posterCount = 10) => engine.createGame(players(n), { inspectLimit: 30, posterCount, swapLimit: 5, rules: { ...DEFAULT_RULES } }, secureRng);

/** Finishes this poster with nobody voting, and starts the next one. */
function nextPoster(g: engine.GameState) {
  engine.resolvePoster(g);
  engine.advancePoster(g, secureRng);
}

describe('hidden wealth', () => {
  it("never sends other players' totals; only what each earned from the last bounty", () => {
    const g = game();
    const wanted = engine.wantedId(g);
    for (const p of g.playerIds.filter((x) => x !== wanted)) engine.castVote(g, p, wanted);
    engine.resolvePoster(g);
    for (const me of g.playerIds) {
      const v = engine.gameViewFor(g, me);
      expect(v).not.toHaveProperty('scores');
      expect(v.myWorth).toBeNull();
      // Earnings from this bounty are public; totals are not.
      expect(Object.keys(v.scoreDeltas).length).toBeGreaterThan(0);
      const json = JSON.stringify(v);
      for (const other of g.playerIds.filter((x) => x !== me)) expect(json).not.toContain(`"${other}":${g.scores[other]}`);
    }
  });

  it('a worth snapshot shows everyone the buyer paid for, privately, once a poster, money to the next bounty', () => {
    const g = game();
    nextPoster(g);
    const pot = g.pots[g.posterIndex + 1];
    const before = g.scores.p2;
    expect(engine.buyWorth(g, 'p2').ok).toBe(true);
    expect(g.scores.p2).toBe(before - DEFAULT_RULES.worthPrice);
    expect(g.pots[g.posterIndex + 1]).toBe(pot + DEFAULT_RULES.worthPrice);
    const mine = engine.gameViewFor(g, 'p2');
    expect(mine.myWorth?.poster).toBe(g.posterIndex);
    expect(Object.keys(mine.myWorth!.scores).sort()).toEqual(g.playerIds.slice().sort());
    expect(mine.worthBoughtThisPoster).toBe(true);
    // Nobody else learns anything: no snapshot, no flag.
    for (const other of g.playerIds.filter((p) => p !== 'p2')) {
      const v = engine.gameViewFor(g, other);
      expect(v.myWorth).toBeNull();
      expect(v.worthBoughtThisPoster).toBe(false);
    }
    expect(engine.buyWorth(g, 'p2').ok).toBe(false); // once per poster
  });
});

describe('dirty tricks', () => {
  it('one per player per payout, paid privately, money to the next bounty, nobody told', () => {
    const g = game();
    const pot = g.pots[1];
    expect(engine.coverTracks(g, 'p1').ok).toBe(true);
    const swap = engine.swapColor(g, 'p1', secureRng);
    expect(swap.ok).toBe(false);
    if (!swap.ok) expect(swap.error).toMatch(/One dirty trick/);
    expect(engine.swapColor(g, 'p2', secureRng).ok).toBe(true);
    expect(g.pots[1]).toBe(pot + DEFAULT_RULES.coverPrice + DEFAULT_RULES.swapPrice);
    for (const viewer of g.playerIds) {
      const v = engine.gameViewFor(g, viewer);
      expect(v.trickThisPayout).toBe(viewer === 'p1' ? 'cover' : viewer === 'p2' ? 'swap' : null);
    }
    engine.advancePoster(g, secureRng);
    for (const viewer of g.playerIds) expect(engine.gameViewFor(g, viewer).coveredThisPoster).toBe(viewer === 'p1');
  });

  it("don't count toward the search-phase purchase limit", () => {
    const g = game();
    expect(engine.coverTracks(g, 'p1').ok).toBe(true);
    expect(engine.purchasesLeft(g, 'p1')).toBe(DEFAULT_RULES.purchaseCap);
  });

  it('a covered player looks normal: one stand-in repeats like a real color and narrows, the real color never shows', () => {
    for (let k = 0; k < 100; k++) {
      const g = game(8);
      const target = g.playerIds[3];
      engine.coverTracks(g, target);
      nextPoster(g);
      const { standIn } = g.cover[target];
      const real = g.colors[target];
      expect(standIn).not.toBe(real);
      expect(Object.values(g.colors)).toContain(standIn); // worn by someone else
      for (const searcher of g.playerIds.filter((p) => p !== target)) {
        const expected = g.colors[searcher] === standIn ? g.cover[target].alt : standIn;
        let possible: ColorId[] | null = null;
        for (const want of [4, 3, 2, 1]) {
          const r = engine.inspect(g, searcher, target, secureRng);
          if (!r.ok) throw new Error(r.error);
          expect(r.result).toHaveLength(DEFAULT_RULES.decoys + 1);
          expect(r.result).not.toContain(real);
          expect(r.result).not.toContain(g.colors[searcher]);
          expect(r.result).toContain(expected);
          possible = possible ? possible.filter((c) => r.result.includes(c)) : r.result.slice();
          expect(possible).toHaveLength(want);
        }
        expect(possible).toEqual([expected]);
      }
    }
  });

  it("everyone but the stand-in's own wearer sees the same stand-in; bought findings are what the searcher saw", () => {
    const g = game(8);
    const target = 'p4';
    engine.coverTracks(g, target);
    nextPoster(g);
    const { standIn } = g.cover[target];
    const wearer = g.playerIds.find((p) => g.colors[p] === standIn)!;
    const seen = new Set<ColorId>();
    for (const s of g.playerIds.filter((p) => p !== target && p !== wearer)) {
      let poss: ColorId[] | null = null;
      for (let i = 0; i < 4; i++) {
        const r = engine.inspect(g, s, target, secureRng);
        if (!r.ok) throw new Error(r.error);
        poss = poss ? poss.filter((c) => r.result.includes(c)) : r.result;
      }
      seen.add(poss![0]);
    }
    expect([...seen]).toEqual([standIn]);
    // Buying a covered finding hands over exactly the stored result.
    const entry = g.log.find((e) => e.targetId === target && e.inspectorId !== 'p0')!;
    const offer = engine.makeOffer(g, 'p0', entry.id);
    if (!offer.ok) throw new Error(offer.error);
    engine.respondOffer(g, entry.inspectorId, offer.offer.id, true);
    expect(engine.gameViewFor(g, 'p0').myResults[entry.id]).toEqual(g.results[entry.id]);
  });

  it("a covered outlaw's stand-in is never the poster color", () => {
    for (let k = 0; k < 300; k++) {
      const g = game(6, 10);
      const nextWanted = g.order[1];
      engine.coverTracks(g, nextWanted);
      nextPoster(g);
      expect(engine.wantedId(g)).toBe(nextWanted);
      const poster = engine.posterColor(g);
      expect(g.cover[nextWanted].standIn).not.toBe(poster);
      expect(g.cover[nextWanted].alt).not.toBe(poster);
      for (const s of g.playerIds.filter((p) => p !== nextWanted)) {
        const r = engine.inspect(g, s, nextWanted, secureRng);
        if (!r.ok) throw new Error(r.error);
        expect(r.result).not.toContain(poster);
      }
    }
  });

  it('covering lasts one poster', () => {
    const g = game();
    engine.coverTracks(g, 'p1');
    nextPoster(g);
    expect(g.cover.p1).toBeTruthy();
    nextPoster(g);
    expect(g.cover.p1).toBeUndefined();
    const r = engine.inspect(g, 'p0', 'p1', secureRng);
    if (!r.ok) throw new Error(r.error);
    expect(r.result).toContain(g.colors.p1);
  });
});

describe('dirty tricks in a room', () => {
  let rooms: Room[] = [];
  afterEach(() => {
    rooms.forEach((r) => r.dispose());
    rooms = [];
  });

  it('only the buyer hears about it; nothing in anyone else’s views changes', () => {
    const sent: { socketId: string; event: string; payload: unknown }[] = [];
    const room = new Room('TRICK', { send: (socketId, event, ...a) => sent.push({ socketId, event, payload: a[0] }), rng: secureRng, devMode: true, minPlayers: 2 });
    rooms.push(room);
    const ids: string[] = [];
    for (let i = 0; i < 6; i++) {
      const r = room.addPlayer(`P${i}`, `sock${i}`);
      if (!r.ok) throw new Error(r.error);
      ids.push(r.seat.id);
    }
    expect(room.start(ids[0]).ok).toBe(true);
    for (let i = 0; i < 10 && room.phase !== 'payout'; i++) room.skipPhase(ids[0]);
    const from = sent.length;
    expect(room.coverTracks(ids[3]).ok).toBe(true);
    expect(room.coverTracks(ids[3]).ok).toBe(false);
    const after = sent.slice(from);
    expect(new Set(after.map((s) => s.socketId))).toEqual(new Set(['sock3']));
    room.skipPhase(ids[0]); // next poster
    for (const s of sent.slice(from)) {
      if (s.event !== 'view' || s.socketId === 'sock3') continue;
      const v = s.payload as PlayerView;
      expect(v.game!.coveredThisPoster).toBe(false);
      expect(v.game!.trickThisPayout).toBeNull();
    }
  });

  it('tricks are only for sale during a payout with another poster to come', () => {
    const room = new Room('TRICK', { send: () => {}, rng: secureRng, devMode: true, minPlayers: 2 });
    rooms.push(room);
    const ids = Array.from({ length: 6 }, (_, i) => {
      const r = room.addPlayer(`P${i}`, `sock${i}`);
      if (!r.ok) throw new Error(r.error);
      return r.seat.id;
    });
    room.updateSettings(ids[0], { posters: 3 });
    room.start(ids[0]);
    expect(room.coverTracks(ids[1]).ok).toBe(false); // poster phase
    while (!(room.phase === 'payout' && room.game!.posterIndex === 2)) room.skipPhase(ids[0]);
    const last = room.coverTracks(ids[1]);
    expect(last.ok).toBe(false);
    if (!last.ok) expect(last.error).toMatch(/No more posters/);
  });
});

describe('posters per game', () => {
  it('is a host setting from 3 to 20, independent of player count, default 10', () => {
    const room = new Room('POST1', { send: () => {}, rng: secureRng, devMode: true, minPlayers: 2 });
    const ids = Array.from({ length: 6 }, (_, i) => {
      const r = room.addPlayer(`P${i}`, `sock${i}`);
      if (!r.ok) throw new Error(r.error);
      return r.seat.id;
    });
    expect(room.settings.posters).toBe(POSTER_RANGE.default);
    expect(POSTER_RANGE.default).toBe(10);
    for (const bad of [2, 21, 7.5, 'many']) expect(room.updateSettings(ids[0], { posters: bad as number }).ok).toBe(false);
    expect(room.updateSettings(ids[1], { posters: 12 }).ok).toBe(false); // host only
    expect(room.updateSettings(ids[0], { posters: 12 }).ok).toBe(true);
    room.start(ids[0]);
    expect(room.game!.order).toHaveLength(12); // 6 players, 12 posters
    room.dispose();
  });

  it('has an estimated length', () => {
    expect(estimatedGameSeconds(10, DEFAULT_TIMERS)).toBe(10 * (5 + 120 + 20 + 15) + 5);
  });
});
