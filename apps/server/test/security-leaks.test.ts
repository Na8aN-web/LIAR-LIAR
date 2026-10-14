import { afterEach, describe, expect, it } from 'vitest';
import { COLOR_IDS, PALETTE, type PlayerView } from '@wtc/shared';
import type { GameState } from '../src/game/engine';
import { startServer, sleep, until, type Client } from './helpers/net';

// Plays full games over real sockets with six human clients (and two bots), doing everything a
// player can do: searching, buying, selling, chatting, voting, changing color. Then it scans
// EVERY message each client received for things that client must not know.

const envs: { close: () => Promise<void> }[] = [];
afterEach(async () => {
  for (const e of envs.splice(0)) await e.close();
});

const COLORS = new Set<string>(COLOR_IDS);
const COLOR_NAMES = PALETTE.map((c) => c.name.toLowerCase());

// Exactly the fields a client may receive. A new field anywhere fails this test until it's
// added here on purpose, so a secret can't slip out through a field nobody noticed.
const VIEW_KEYS = ['code', 'serverNow', 'devMode', 'minPlayers', 'maxPlayers', 'you', 'players', 'settings', 'phase', 'phaseEndsAt', 'game', 'replay', 'practice', 'locked', 'room'];
const ROOM_KEYS = ['name', 'visibility', 'autoFill', 'fillOfferAt', 'closing'];
const YOU_KEYS = ['id', 'name', 'color', 'item', 'isHost'];
const PLAYER_KEYS = ['id', 'name', 'item', 'cosmetics', 'seat', 'isHost', 'isBot', 'connected', 'away'];
const GAME_KEYS = [
  'posterIndex', 'posterCount', 'posterColor', 'pot', 'youAreWanted', 'inspectLimit', 'extraInspects', 'inspectsUsed', 'purchasesUsed',
  'log', 'myResults', 'boughtEntryIds', 'offersOut', 'offersIn', 'swapLimit', 'swapsUsed', 'trickThisPayout', 'coveredThisPoster',
  'myWorth', 'worthBoughtThisPoster',
  'myColorHistory', 'myVote', 'votesCast', 'scoreDeltas', 'myScore', 'myCorrectVotes', 'myHeldEscapeBonus', 'myRounds', 'reactions',
];
const LOG_KEYS = ['id', 'poster', 'inspectorId', 'targetId', 'at'];
const ROUND_KEYS = ['poster', 'color', 'wasWanted', 'escaped', 'votedFor', 'correct', 'wantedId', 'payout'];
const CHAT_KEYS = ['id', 'playerId', 'name', 'text', 'poster', 'at'];
const sameKeys = (o: object, keys: string[]) => expect(Object.keys(o).sort()).toEqual([...keys].sort());

/** Every (path, object) inside a value. */
function* walk(v: unknown, path = '$'): Generator<[string, Record<string, unknown>]> {
  if (!v || typeof v !== 'object') return;
  yield [path, v as Record<string, unknown>];
  for (const [k, x] of Object.entries(v)) yield* walk(x, `${path}.${k}`);
}

async function playGame(env: Awaited<ReturnType<typeof startServer>>) {
  const { connect, call } = env;
  const humans: Client[] = [];
  for (let i = 0; i < 6; i++) humans.push(await connect(`H${i}`));
  const [host] = humans;
  const created = await call(host, 'room:create', { name: 'Host' });
  expect(created.ok).toBe(true);
  const tokens = new Map<Client, string>([[host, created.token]]);
  for (const [i, c] of humans.slice(1).entries()) {
    const r = await call(c, 'room:join', { code: created.code, name: `P${i + 1}` });
    expect(r.ok).toBe(true);
    tokens.set(c, r.token);
  }
  // Lobby: everyone picks a color, some change items, a couple of bots join.
  for (const [i, c] of humans.entries()) {
    expect((await call(c, 'lobby:setLook', { color: COLOR_IDS[i * 2], item: ['poncho', 'cloak', 'bandana'][i % 3] })).ok).toBe(true);
  }
  await call(host, 'lobby:addBot');
  await call(host, 'lobby:addBot');
  await call(host, 'lobby:settings', { colorSwaps: 3 });
  expect((await call(host, 'game:start')).ok).toBe(true);
  const room = env.server.rooms.get(created.code)!;
  const g = () => room.game as GameState;

  for (let guard = 0; guard < 80 && room.phase !== 'ended'; guard++) {
    if (room.phase === 'poster') await call(host, 'dev:skipPhase');
    if (room.phase === 'investigation') {
      const ids = g().playerIds;
      for (const [i, c] of humans.entries()) {
        const me = c.latest!.you.id;
        const target = ids.filter((p) => p !== me)[(i + g().posterIndex) % (ids.length - 1)];
        await call(c, 'game:inspect', { targetId: target });
        await call(c, 'game:inspect', { targetId: target });
        await call(c, 'chat:send', { text: `I searched ${target.slice(0, 3)} and saw ${COLOR_NAMES[i]}` });
      }
      // Trading: everyone offers to buy one entry from someone else; sellers accept or refuse.
      for (const [i, c] of humans.entries()) {
        const e = g().log.find((x) => x.inspectorId !== c.latest!.you.id && humans.some((h) => h.latest!.you.id === x.inspectorId));
        if (e) await call(c, 'buy:offer', { entryId: e.id });
        if (i === 2) await call(c, 'buy:extraInspect');
      }
      await sleep(30);
      for (const [i, c] of humans.entries()) for (const o of c.latest!.game!.offersIn.filter((x) => x.status === 'pending')) await call(c, 'buy:respond', { offerId: o.id, accept: i % 2 === 0 });
      await call(host, 'dev:skipPhase');
    }
    if (room.phase === 'vote') {
      for (const [i, c] of humans.entries()) {
        const me = c.latest!.you.id;
        // Half vote for the real outlaw, half guess.
        const wanted = g().order[g().posterIndex];
        const pick = i % 2 === 0 && wanted !== me ? wanted : g().playerIds.find((p) => p !== me)!;
        await call(c, 'game:vote', { targetId: pick });
      }
      await call(host, 'dev:skipPhase');
    }
    if (room.phase === 'payout') {
      for (const [i, c] of humans.entries()) if (i % 3 === g().posterIndex % 3) await call(c, 'swap:color');
      await sleep(20);
      await call(host, 'dev:skipPhase');
    }
    await sleep(20);
  }
  expect(room.phase).toBe('ended');
  await sleep(100);
  return { humans, tokens, room, game: g() };
}

describe('nothing secret ever reaches a client', () => {
  it('scans every message from a full game for leaks', async () => {
    // The script plays far faster than people, so the per-connection action limits are lifted here
    // (forged-messages.test.ts covers the limits themselves).
    const env = await startServer({ limits: { events: { burst: 10_000, perSecond: 10_000 }, chat: { burst: 1000, perSecond: 1000 }, offers: { burst: 1000, perSecond: 1000 } } });
    envs.push(env);
    const { humans, tokens, game } = await playGame(env);
    const allIds = game.playerIds;
    let views = 0;

    for (const c of humans) {
      const me = c.latest!.you.id;
      const others = allIds.filter((id) => id !== me);
      const myToken = tokens.get(c)!;
      const otherSecrets = [...tokens.values()].filter((t) => t !== myToken).concat(humans.filter((h) => h !== c).map((h) => h.browserId));

      for (const { event, payload } of c.inbox) {
        const text = JSON.stringify(payload ?? null);
        // No other player's session token or browser id, ever, in anything.
        for (const s of otherSecrets) expect(text, `${c.label} ${event}`).not.toContain(s);
        // Not even our own token, except in the reply that handed it to us.
        if (!/^ack:room:(create|join|resume)$/.test(event)) expect(text).not.toContain(myToken);

        if (event === 'chat' || event === 'chatHistory') {
          for (const m of event === 'chat' ? [payload] : (payload as unknown[])) sameKeys(m as object, CHAT_KEYS);
          continue;
        }
        if (event.startsWith('ack:')) {
          const ack = payload as { ok: boolean; error?: string } | null;
          // Error messages never name a color (they could be used as a probe).
          if (ack && !ack.ok) for (const name of COLOR_NAMES) expect(ack.error!.toLowerCase(), `${event}: ${ack.error}`).not.toContain(name);
          continue;
        }
        if (event !== 'view') continue;
        views++;
        const v = payload as PlayerView;
        const ended = v.phase === 'ended';
        sameKeys(v, VIEW_KEYS);
        sameKeys(v.you, YOU_KEYS);
        sameKeys(v.room, ROOM_KEYS);
        for (const p of v.players) sameKeys(p, PLAYER_KEYS);
        if (!ended) expect(v.replay, `${c.label}: replay before the end`).toBeNull();
        if (!v.game) continue;
        sameKeys(v.game, GAME_KEYS);
        for (const e of v.game.log) sameKeys(e, LOG_KEYS);
        for (const r of v.game.myRounds) {
          sameKeys(r, ROUND_KEYS);
          if (!r.wasWanted && !r.correct) expect(r.wantedId, 'outlaw named to a player who got it wrong').toBeNull();
        }
        // Outlaw: only the outlaw is told.
        expect(v.game.youAreWanted).toBe(game.order[v.game.posterIndex] === me);
        // Search results: only my own searches and the ones I bought.
        for (const entryId of Object.keys(v.game.myResults)) {
          const e = game.log.find((x) => x.id === entryId)!;
          expect(e.inspectorId === me || game.bought[me].includes(entryId), `${c.label} got someone else's result`).toBe(true);
        }
        for (const o of [...v.game.offersIn, ...v.game.offersOut]) expect(o.buyerId === me || o.sellerId === me).toBe(true);
        // My vote only.
        if (v.game.myVote) expect(game.history.some((h) => h.votes[me] === v.game!.myVote) || game.votes[me] === v.game.myVote).toBe(true);

        // Generic: no object anywhere pairs another player with a color (before the replay).
        if (!ended) {
          for (const [path, o] of walk(v)) {
            // The view and game objects themselves are containers (e.g. myVote next to posterColor);
            // the check is for records inside them.
            if (path === '$' || path === '$.game' || path.includes('myRounds')) continue;
            const vals = Object.values(o);
            const keys = Object.keys(o);
            const mentionsOther = others.some((id) => vals.includes(id) || keys.includes(id));
            const hasColor = vals.some((x) => typeof x === 'string' && COLORS.has(x));
            expect(mentionsOther && hasColor, `${c.label} ${path} pairs a player with a color: ${JSON.stringify(o)}`).toBe(false);
          }
          // Raw state fields never appear.
          for (const [path, o] of walk(v)) for (const k of ['colors', 'order', 'votes', 'results', 'realAt', 'token', 'browserId', 'heldEscapeBonus', 'colorPicked']) expect(k in o, `${path}.${k}`).toBe(false);
        }
      }
    }
    expect(views).toBeGreaterThan(200);
  }, 60_000);

  it("the lobby color list doesn't reveal the color a newcomer was given", async () => {
    const env = await startServer();
    envs.push(env);
    const a = await env.connect('A');
    const created = await env.call(a, 'room:create', { name: 'Ada' });
    const before = await env.call(a, 'lobby:colors');
    for (let i = 0; i < 4; i++) {
      const c = await env.connect(`B${i}`);
      expect((await env.call(c, 'room:join', { code: created.code, name: `B${i}` })).ok).toBe(true);
    }
    const after = await env.call(a, 'lobby:colors');
    expect(after.available).toEqual(before.available);
    expect(after.available).toHaveLength(COLOR_IDS.length);
  });

  it('settles clashing colors at the start so everyone still has a unique color', async () => {
    const env = await startServer();
    envs.push(env);
    const cs: Client[] = [];
    for (let i = 0; i < 6; i++) cs.push(await env.connect(`C${i}`));
    const created = await env.call(cs[0], 'room:create', { name: 'C0' });
    for (const c of cs.slice(1)) await env.call(c, 'room:join', { code: created.code, name: c.label });
    // Everyone else picks the color C0 was given as a suggestion... one at a time.
    await until(cs[0], (v) => !!v.you.color);
    const suggested = cs[0].latest!.you.color;
    expect((await env.call(cs[1], 'lobby:setLook', { color: suggested })).ok).toBe(true);
    expect((await env.call(cs[0], 'game:start')).ok).toBe(true);
    const colors = Object.values(env.server.rooms.get(created.code)!.game!.colors);
    expect(new Set(colors).size).toBe(colors.length);
  });

  it('the lobby color list is refused once the game is running', async () => {
    const env = await startServer();
    envs.push(env);
    const cs: Client[] = [];
    for (let i = 0; i < 6; i++) cs.push(await env.connect(`C${i}`));
    const created = await env.call(cs[0], 'room:create', { name: 'C0' });
    for (const c of cs.slice(1)) await env.call(c, 'room:join', { code: created.code, name: c.label });
    await env.call(cs[0], 'game:start');
    const r = await env.call(cs[1], 'lobby:colors');
    expect(r.ok).toBe(false);
  });
});
