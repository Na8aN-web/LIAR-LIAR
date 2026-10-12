import { describe, expect, it } from 'vitest';
import { COLOR_IDS, DEFAULT_COSMETICS, DEFAULT_SETTINGS, type PlayerView } from '@wtc/shared';
import * as engine from '../src/game/engine';
import * as brain from '../src/bots/brain';
import { secureRng, type Rng } from '../src/rng';

const players = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, color: COLOR_IDS[i] }));

function viewOf(g: engine.GameState, me: string, posterMode = DEFAULT_SETTINGS.posterMode): PlayerView {
  return {
    code: 'TEST1',
    serverNow: Date.now(),
    devMode: true,
    minPlayers: 2,
    maxPlayers: 15,
    you: { id: me, name: me, color: g.colors[me], item: 'poncho', isHost: false },
    players: g.playerIds.map((id, seat) => ({ id, name: `Name${id}`, item: 'poncho', cosmetics: DEFAULT_COSMETICS, seat, isHost: false, isBot: true, connected: true, away: false })),
    settings: { ...DEFAULT_SETTINGS, posterMode },
    phase: 'investigation',
    phaseEndsAt: null,
    game: engine.gameViewFor(g, me),
    replay: null,
    practice: false,
    locked: false,
    room: { name: 'Test', visibility: 'private', autoFill: { enabled: false, afterSec: 120 }, fillOfferAt: null },
  };
}

/** Deterministic rng that always picks index 0 / chance 0. */
const firstRng: Rng = { int: () => 0 };

describe('bot knowledge', () => {
  it('only uses the bot’s own and bought results', () => {
    const g = engine.createGame(players(6), { inspectLimit: 3, posterMode: 'everyoneOnce' }, secureRng);
    engine.inspect(g, 'p1', 'p2', secureRng); // someone else's inspect
    const k = brain.know(viewOf(g, 'p0'));
    expect(k.possible.size).toBe(0);
  });

  it('intersects repeated inspects and propagates resolved colors', () => {
    const g = engine.createGame(players(8), { inspectLimit: 20, posterMode: 'everyoneOnce' }, secureRng);
    // Inspect p1 until resolved (random decoys, so this takes a few looks).
    let k = brain.know(viewOf(g, 'p0'));
    for (let i = 0; i < 20 && k.possible.get('p1')?.length !== 1; i++) {
      engine.inspect(g, 'p0', 'p1', secureRng);
      k = brain.know(viewOf(g, 'p0'));
    }
    expect(k.possible.get('p1')).toEqual([g.colors.p1]);
  });

  it('votes for a resolved Wanted player and rules out past Wanted in everyoneOnce mode', () => {
    const g = engine.createGame(players(6), { inspectLimit: 40, posterMode: 'everyoneOnce' }, secureRng);
    const wanted = engine.wantedId(g);
    const voter = g.playerIds.find((p) => p !== wanted)!;
    // Inspect until the color resolves (decoys are random, so the number of looks varies).
    let v = viewOf(g, voter);
    for (let i = 0; i < 40 && brain.know(v).possible.get(wanted)?.length !== 1; i++) {
      engine.inspect(g, voter, wanted, secureRng);
      v = viewOf(g, voter);
    }
    expect(brain.chooseVote(v, brain.know(v), [], secureRng)).toBe(wanted);

    engine.castVote(g, voter, wanted);
    engine.resolvePoster(g);
    engine.advancePoster(g);
    const k = brain.know(viewOf(g, voter));
    expect(k.pastWanted.has(wanted)).toBe(true);
    expect(brain.suspects(k)).not.toContain(wanted);
  });

  it('treats results from before a swap round as stale, discounted by the public count', () => {
    const g = engine.createGame(players(6), { inspectLimit: 3, posterMode: 'everyoneOnce', swapLimit: 2 }, secureRng);
    engine.inspect(g, 'p0', 'p1', secureRng);
    engine.resolvePoster(g);
    expect(engine.swapColor(g, 'p2', secureRng).ok).toBe(true);
    engine.advancePoster(g);
    expect(g.colorChanges[1]).toBe(1);
    const k = brain.know(viewOf(g, 'p0'));
    expect(k.possible.has('p1')).toBe(false);
    expect(k.stale.get('p1')?.reliability).toBeCloseTo(1 - 1 / 5);
  });

  it('swap policy fires once exposure reaches the threshold', () => {
    const g = engine.createGame(players(6), { inspectLimit: 3, posterMode: 'everyoneOnce', swapLimit: 1 }, secureRng);
    for (const p of ['p1', 'p2', 'p3']) engine.inspect(g, p, 'p0', secureRng);
    const v = viewOf(g, 'p0');
    expect(brain.exposure(v, [])).toBe(3);
    expect(brain.shouldSwap(v, [], 3)).toBe(true);
    expect(brain.shouldSwap(v, [], 4)).toBe(false);
  });

  it('spreads first-poster inspects evenly instead of favouring seat 0 (the host)', () => {
    const g = engine.createGame(players(10), { inspectLimit: 3, posterMode: 'randomRepeats' }, secureRng);
    const hits = new Map<string, number>();
    const tries = 4000;
    for (let i = 0; i < tries; i++) {
      const bot = g.playerIds[1 + (i % 9)];
      const v = viewOf(g, bot);
      if (v.game!.youAreWanted) continue;
      const t = brain.chooseInspect(v, brain.know(v), secureRng)!;
      hits.set(t, (hits.get(t) ?? 0) + 1);
    }
    const total = [...hits.values()].reduce((a, b) => a + b, 0);
    // Each bot has 9 equally unknown candidates: about 11% each. Seat 0 must not stand out.
    expect((hits.get('p0') ?? 0) / total).toBeLessThan(0.16);
    for (const id of g.playerIds) expect((hits.get(id) ?? 0) / total).toBeGreaterThan(0.06);
  });

  it('counts accusations from chat, ignoring denials and the bot itself', () => {
    const g = engine.createGame(players(6), { inspectLimit: 3, posterMode: 'everyoneOnce' }, secureRng);
    const me = g.playerIds.find((p) => p !== engine.wantedId(g))!;
    const v = viewOf(g, me);
    const color = v.game!.posterColor;
    const target = g.playerIds.find((p) => p !== me)!;
    const msg = (from: string, text: string) => ({ id: text, playerId: from, name: from, text, poster: 0, at: 0 });
    const colorName = color[0].toUpperCase() + color.slice(1);
    const other = g.playerIds.find((p) => p !== me && p !== target)!;
    const acc = brain.accusations(v, [
      msg(other, `It's Name${target}.`),
      msg(other, `Name${target} is ${colorName}`),
      msg(other, `Name${target} is not ${colorName}`),
      msg(me, `It's Name${target}.`),
    ]);
    expect(acc.get(target)).toBe(2);
  });

  it('Wanted bots never accuse themselves or tell the truth about their color', () => {
    const g = engine.createGame(players(6), { inspectLimit: 3, posterMode: 'everyoneOnce' }, secureRng);
    const wanted = engine.wantedId(g);
    const v = viewOf(g, wanted);
    const mind = brain.newMind(firstRng);
    for (let i = 0; i < 30; i++) {
      const line = brain.composeClaim(v, brain.know(v), mind, secureRng)!;
      expect(line).not.toContain(`Name${wanted}`);
      expect(line.toLowerCase()).not.toContain(`i'm ${g.colors[wanted]}`);
    }
    expect(brain.composeDenial(v, mind, secureRng).toLowerCase()).not.toContain(`i'm ${g.colors[wanted]}`);
  });
});
