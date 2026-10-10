import { describe, expect, it } from 'vitest';
import { COLOR_IDS, DEFAULT_SETTINGS, type PlayerView } from '@wtc/shared';
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
    players: g.playerIds.map((id, seat) => ({ id, name: `Name${id}`, item: 'poncho', seat, isHost: false, isBot: true, connected: true, away: false })),
    settings: { ...DEFAULT_SETTINGS, posterMode },
    phase: 'investigation',
    phaseEndsAt: null,
    game: engine.gameViewFor(g, me),
    replay: null,
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
    const g = engine.createGame(players(8), { inspectLimit: 5, posterMode: 'everyoneOnce' }, secureRng);
    // Inspect p1 until resolved.
    for (let i = 0; i < 5; i++) engine.inspect(g, 'p0', 'p1', secureRng);
    const k = brain.know(viewOf(g, 'p0'));
    expect(k.possible.get('p1')).toEqual([g.colors.p1]);
  });

  it('votes for a resolved Wanted player and rules out past Wanted in everyoneOnce mode', () => {
    const g = engine.createGame(players(6), { inspectLimit: 6, posterMode: 'everyoneOnce' }, secureRng);
    const wanted = engine.wantedId(g);
    const voter = g.playerIds.find((p) => p !== wanted)!;
    for (let i = 0; i < 6; i++) engine.inspect(g, voter, wanted, secureRng);
    const v = viewOf(g, voter);
    expect(brain.chooseVote(v, brain.know(v), [], secureRng)).toBe(wanted);

    engine.castVote(g, voter, wanted);
    engine.resolvePoster(g);
    engine.advancePoster(g);
    const k = brain.know(viewOf(g, voter));
    expect(k.pastWanted.has(wanted)).toBe(true);
    expect(brain.suspects(k)).not.toContain(wanted);
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
