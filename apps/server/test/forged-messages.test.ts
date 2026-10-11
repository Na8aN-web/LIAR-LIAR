import { afterEach, describe, expect, it } from 'vitest';
import { CHAT_MAX, NAME_MAX } from '@wtc/shared';
import { cleanText } from '../src/room';
import { startServer, sleep, until, type Client } from './helpers/net';

// What a cheater would send by hand: messages the real client never sends. Every one must be
// refused (or harmlessly cleaned up) by the server.

const envs: { close: () => Promise<void> }[] = [];
afterEach(async () => {
  for (const e of envs.splice(0)) await e.close();
});

/** Six players in a started game, host = cs[0]. Dev mode only so the test can skip phases quickly. */
async function table(opts: Parameters<typeof startServer>[0] = {}) {
  const env = await startServer({ limits: { events: { burst: 10_000, perSecond: 10_000 } }, ...opts });
  envs.push(env);
  const cs: Client[] = [];
  for (let i = 0; i < 6; i++) cs.push(await env.connect(`C${i}`));
  const created = await env.call(cs[0], 'room:create', { name: 'Host' });
  const tokens = [created.token as string];
  for (const c of cs.slice(1)) tokens.push((await env.call(c, 'room:join', { code: created.code, name: c.label })).token);
  const room = env.server.rooms.get(created.code)!;
  const to = async (phase: string) => {
    for (let i = 0; i < 10 && room.phase !== phase; i++) await env.call(cs[0], 'dev:skipPhase');
    expect(room.phase).toBe(phase);
    await sleep(30);
  };
  const id = (c: Client) => c.latest!.you.id;
  return { env, cs, room, code: created.code as string, tokens, to, id, call: env.call };
}

describe('the server refuses forged game actions', () => {
  it('extra searches beyond the limit, self-searches and searches outside the investigation', async () => {
    const { cs, room, to, id, call } = await table();
    expect((await call(cs[0], 'game:start')).ok).toBe(true);
    expect((await call(cs[1], 'game:inspect', { targetId: id(cs[2]) })).ok).toBe(false); // poster phase
    await to('investigation');
    const limit = room.game!.inspectLimit;
    for (let i = 0; i < limit; i++) expect((await call(cs[1], 'game:inspect', { targetId: id(cs[2]) })).ok).toBe(true);
    const over = await call(cs[1], 'game:inspect', { targetId: id(cs[2]) });
    expect(over.ok).toBe(false);
    expect((await call(cs[2], 'game:inspect', { targetId: id(cs[2]) })).ok).toBe(false);
    expect(room.game!.inspectsUsed[id(cs[1])]).toBe(limit);
    await to('vote'); // the timer ran out
    expect((await call(cs[3], 'game:inspect', { targetId: id(cs[2]) })).ok).toBe(false);
  });

  it('double votes, self-votes, votes for nobody and votes outside the vote', async () => {
    const { cs, room, to, id, call } = await table();
    await call(cs[0], 'game:start');
    await to('investigation');
    expect((await call(cs[1], 'game:vote', { targetId: id(cs[2]) })).ok).toBe(false);
    await to('vote');
    expect((await call(cs[1], 'game:vote', { targetId: id(cs[1]) })).ok).toBe(false);
    expect((await call(cs[1], 'game:vote', { targetId: id(cs[2]) })).ok).toBe(true);
    expect((await call(cs[1], 'game:vote', { targetId: id(cs[3]) })).ok).toBe(false);
    expect(room.game!.votes[id(cs[1])]).toBe(id(cs[2]));
  });

  it('ids that look like object internals are not players', async () => {
    const { cs, room, to, call } = await table();
    await call(cs[0], 'game:start');
    await to('investigation');
    for (const bogus of ['constructor', '__proto__', 'toString', 'hasOwnProperty', '', 'x'.repeat(5000)]) {
      expect((await call(cs[1], 'game:inspect', { targetId: bogus })).ok, bogus).toBe(false);
    }
    for (const bogus of [{ a: 1 }, ['x'], 42, null, true]) expect((await call(cs[1], 'game:inspect', { targetId: bogus })).ok).toBe(false);
    await to('vote');
    for (const bogus of ['constructor', '__proto__', 'valueOf']) expect((await call(cs[2], 'game:vote', { targetId: bogus })).ok, bogus).toBe(false);
    expect(Object.keys(room.game!.votes)).toEqual([]);
    expect(room.game!.log).toHaveLength(0);
  });

  it('malformed payloads get an error, never crash the server', async () => {
    const { env, cs, call } = await table();
    for (const ev of ['room:join', 'lobby:setLook', 'lobby:settings', 'game:inspect', 'buy:offer', 'buy:respond', 'chat:send', 'lobby:kick']) {
      for (const p of [null, 42, 'text', [1, 2], { nested: { deep: true } }]) {
        const r = await call(cs[1], ev, p);
        expect(r === null || r.ok === false || ev === 'lobby:setLook', `${ev} ${JSON.stringify(p)}`).toBe(true);
      }
    }
    // Missing ack callback: no reply, no crash.
    (cs[1].emit as any)('game:inspect', { targetId: 'x' });
    await sleep(50);
    expect(cs[1].connected).toBe(true);
    expect((await env.call(cs[0], 'chat:send', { text: 'still alive' })).ok).toBe(true);
  });

  it('acting as another player: host-only actions and other people’s offers', async () => {
    const { cs, room, to, id, call } = await table();
    expect((await call(cs[1], 'game:start')).ok).toBe(false);
    expect((await call(cs[1], 'lobby:settings', { rules: { buyPrice: 0 } })).ok).toBe(false);
    expect((await call(cs[1], 'lobby:kick', { playerId: id(cs[2]) })).ok).toBe(false);
    expect((await call(cs[1], 'lobby:lock', { locked: true })).ok).toBe(false);
    expect((await call(cs[1], 'lobby:addBot')).ok).toBe(false);
    expect((await call(cs[1], 'dev:skipPhase')).ok).toBe(false);
    // Fields naming another player are ignored: you act as the seat this connection holds.
    expect((await call(cs[1], 'lobby:setLook', { item: 'cloak', playerId: id(cs[2]) })).ok).toBe(true);
    await sleep(30);
    expect(cs[2].latest!.players.find((p) => p.id === id(cs[2]))!.item).not.toBe(undefined);
    expect(room.seats.get(id(cs[1]))!.item).toBe('cloak');

    await call(cs[0], 'game:start');
    await to('investigation');
    const e = await call(cs[1], 'game:inspect', { targetId: id(cs[2]) });
    const offer = await call(cs[3], 'buy:offer', { entryId: e.entryId });
    expect(offer.ok).toBe(true);
    // Only the seller can answer; the buyer can't accept their own offer, nor can a bystander.
    expect((await call(cs[3], 'buy:respond', { offerId: offer.offerId, accept: true })).ok).toBe(false);
    expect((await call(cs[4], 'buy:respond', { offerId: offer.offerId, accept: true })).ok).toBe(false);
    expect((await call(cs[1], 'buy:respond', { offerId: offer.offerId, accept: 'yes' })).ok).toBe(false);
    expect(room.game!.bought[id(cs[3])]).toHaveLength(0);
  });

  it('buying: no debt, the purchase cap, own results and unknown entries', async () => {
    const { cs, room, to, id, call } = await table();
    await call(cs[0], 'lobby:settings', { rules: { startingPoints: 60, extraInspectPrice: 50 } });
    await call(cs[0], 'game:start');
    await to('investigation');
    expect((await call(cs[1], 'buy:extraInspect')).ok).toBe(true); // 60 -> 10
    expect((await call(cs[1], 'buy:extraInspect')).ok).toBe(false); // not enough money
    expect(room.game!.scores[id(cs[1])]).toBe(10);
    const mine = await call(cs[1], 'game:inspect', { targetId: id(cs[2]) });
    expect((await call(cs[1], 'buy:offer', { entryId: mine.entryId })).ok).toBe(false); // own result
    expect((await call(cs[2], 'buy:offer', { entryId: 'nope' })).ok).toBe(false);
    expect((await call(cs[2], 'buy:offer', { entryId: { $ne: null } })).ok).toBe(false);
  });

  it('hand-made settings with silly numbers are refused', async () => {
    const { cs, room, call } = await table();
    const before = structuredClone(room.settings);
    for (const bad of [
      { rules: { buyPrice: -20 } },
      { rules: { startingPoints: 1e9 } },
      { rules: { decoys: 0.5 } },
      { rules: { escapeBonus: 'lots' } },
      { rules: { basePot: Number.NaN } },
      { timers: { investigation: 0 } },
      { timers: { vote: 99999 } },
      { inspectsPerRound: 99 },
      { colorSwaps: -1 },
      { posterMode: 'cheat' },
    ]) {
      expect((await call(cs[0], 'lobby:settings', bad)).ok, JSON.stringify(bad)).toBe(false);
    }
    expect(room.settings).toEqual(before);
  });

  it('color changes only during a payout, once each, never in the last payout', async () => {
    const { cs, room, to, call } = await table();
    await call(cs[0], 'lobby:settings', { colorSwaps: 2 });
    await call(cs[0], 'game:start');
    expect((await call(cs[1], 'swap:color')).ok).toBe(false);
    await to('payout');
    expect((await call(cs[1], 'swap:color')).ok).toBe(true);
    expect((await call(cs[1], 'swap:color')).ok).toBe(false);
    while (room.game!.posterIndex < room.game!.order.length - 1) await call(cs[0], 'dev:skipPhase');
    await to('payout');
    expect((await call(cs[2], 'swap:color')).ok).toBe(false);
  });

  it('oversized messages are dropped and long text is capped', async () => {
    const { env, cs, room, call } = await table();
    const r = await call(cs[1], 'chat:send', { text: 'x'.repeat(5000) });
    expect(r.ok).toBe(true);
    expect(room.chat.at(-1)!.text.length).toBe(CHAT_MAX);
    // 100 KB message: over the server's limit, so the connection is cut and nothing is handled.
    const before = room.chat.length;
    (cs[2].emit as any)('chat:send', { text: 'y'.repeat(100_000) }, () => {});
    await sleep(300);
    expect(room.chat.length).toBe(before);
    expect(cs[2].connected).toBe(false);
    // Long names are capped too.
    const c = await env.connect('long');
    const j = await env.call(c, 'room:join', { code: room.code, name: 'N'.repeat(500) });
    expect(j.ok === false || room.seats.get(j.playerId)!.name.length <= NAME_MAX).toBe(true);
  });
});

describe('text from players is only ever text', () => {
  it('keeps HTML and script as plain characters, strips invisible and direction-override characters', () => {
    expect(cleanText('<img src=x onerror=alert(1)>', 200)).toBe('<img src=x onerror=alert(1)>'); // shown as text, see below
    expect(cleanText('Ada‮niam', 16)).toBe('Adaniam');
    expect(cleanText('A​d‍a﻿', 16)).toBe('Ada');
    expect(cleanText('line\nbreak\ttab', 16)).toBe('linebreaktab');
    expect(cleanText('   spaced    out   ', 16)).toBe('spaced out');
    expect(cleanText({ toString: () => 'evil' }, 16)).toBe('');
  });
});

describe('rooms and sessions', () => {
  it('room codes can’t be brute-forced: wrong guesses are rate limited per connection and per IP', async () => {
    const env = await startServer();
    envs.push(env);
    const c = await env.connect('guesser');
    let refused = 0;
    let unknown = 0;
    for (let i = 0; i < 30; i++) {
      const r = await env.call(c, 'room:join', { code: `ZZZ${String(i).padStart(2, '2')}`, name: 'G' });
      if (r.error?.includes('Too many')) refused++;
      else if (r.error?.includes('No room')) unknown++;
    }
    expect(unknown).toBeLessThanOrEqual(8);
    expect(refused).toBeGreaterThan(20);
    // A fresh connection from the same IP doesn't get a fresh budget.
    let ipRefused = 0;
    for (let k = 0; k < 4; k++) {
      const d = await env.connect(`guesser${k}`);
      for (let i = 0; i < 8; i++) if ((await env.call(d, 'room:join', { code: 'QQQQQ', name: 'G' })).error?.includes('Too many')) ipRefused++;
    }
    expect(ipRefused).toBeGreaterThan(0);
  });

  it('a session token only works for its own seat, and only in its own room', async () => {
    const { env, cs, code, tokens, id, call } = await table();
    const other = await env.call(await env.connect('X'), 'room:create', { name: 'Elsewhere' });
    const thief = await env.connect('thief');
    expect((await call(thief, 'room:resume', { code: other.code, token: tokens[2] })).ok).toBe(false);
    expect((await call(thief, 'room:resume', { code, token: tokens[2].slice(0, -1) + 'A' })).ok).toBe(false);
    expect((await call(thief, 'room:resume', { code, token: { $gt: '' } })).ok).toBe(false);
    const ok = await call(thief, 'room:resume', { code, token: tokens[2] });
    expect(ok.ok).toBe(true);
    expect(ok.playerId).toBe(id(cs[2]));
    expect(ok.playerId).not.toBe(id(cs[1]));
    // The original connection for that seat was replaced.
    await sleep(50);
    expect(cs[2].connected).toBe(false);
  });

  it('room codes stop working when the room closes', async () => {
    const env = await startServer();
    envs.push(env);
    const a = await env.connect('A');
    const created = await env.call(a, 'room:create', { name: 'Ada' });
    a.emit('room:leave');
    await sleep(50);
    expect(env.server.rooms.has(created.code)).toBe(false);
    const b = await env.connect('B');
    expect((await env.call(b, 'room:join', { code: created.code, name: 'Bo' })).error).toMatch(/No room/);
  });

  it('a locked room takes no new players; seated players can still come back', async () => {
    const { env, cs, code, tokens, call } = await table();
    expect((await call(cs[0], 'lobby:lock', { locked: true })).ok).toBe(true);
    const late = await env.connect('late');
    expect((await call(late, 'room:join', { code, name: 'Late' })).error).toMatch(/locked/);
    cs[3].disconnect();
    const back = await env.connect('back');
    expect((await call(back, 'room:resume', { code, token: tokens[3] })).ok).toBe(true);
    expect((await call(cs[0], 'lobby:lock', { locked: false })).ok).toBe(true);
    expect((await call(late, 'room:join', { code, name: 'Late' })).ok).toBe(true);
  });

  it('one seat per browser, and a kicked browser stays out', async () => {
    const { env, cs, code, tokens, id, room, call } = await table();
    const twin = await env.connect('twin', { browserId: cs[1].browserId });
    expect((await call(twin, 'room:join', { code, name: 'Twin' })).error).toMatch(/already in this room/);

    const kickedId = id(cs[4]);
    let told = false;
    cs[4].on('kicked', () => (told = true));
    expect((await call(cs[0], 'lobby:kick', { playerId: kickedId })).ok).toBe(true);
    await sleep(80);
    expect(told).toBe(true);
    expect(cs[4].connected).toBe(false);
    expect(room.seats.has(kickedId)).toBe(false);
    const again = await env.connect('again', { browserId: cs[4].browserId });
    expect((await call(again, 'room:join', { code, name: 'Again' })).error).toMatch(/removed/);
    expect((await call(again, 'room:resume', { code, token: tokens[4] })).ok).toBe(false);
    expect((await call(cs[0], 'lobby:kick', { playerId: id(cs[0]) })).ok).toBe(false); // not yourself
  });

  it('kicking mid-game keeps the seat (the game is unchanged) but the player is out', async () => {
    const { env, cs, code, tokens, id, room, call } = await table();
    await call(cs[0], 'game:start');
    const kickedId = id(cs[2]);
    expect((await call(cs[0], 'lobby:kick', { playerId: kickedId })).ok).toBe(true);
    await sleep(60);
    expect(room.seats.get(kickedId)!.away).toBe(true);
    expect(room.game!.playerIds).toContain(kickedId);
    const back = await env.connect('back', { browserId: cs[2].browserId });
    expect((await call(back, 'room:resume', { code, token: tokens[2] })).ok).toBe(false);
  });

  it('room creation, chat and buy offers are rate limited', async () => {
    const env = await startServer();
    envs.push(env);
    const c = await env.connect('spammer');
    let made = 0;
    for (let i = 0; i < 12; i++) if ((await env.call(c, 'room:create', { name: 'S' })).ok) made++;
    expect(made).toBeLessThanOrEqual(5);
    let said = 0;
    for (let i = 0; i < 30; i++) {
      if ((await env.call(c, 'chat:send', { text: `spam ${i}` })).ok) said++;
      await sleep(5);
    }
    expect(said).toBeLessThanOrEqual(6);
  });

  it('every action on one connection is rate limited', async () => {
    const env = await startServer();
    envs.push(env);
    const c = await env.connect('flood');
    await env.call(c, 'room:create', { name: 'F' });
    const results = await Promise.all(Array.from({ length: 120 }, () => env.call(c, 'lobby:setLook', { item: 'cloak' })));
    expect(results.filter((r) => r?.error === 'Slow down').length).toBeGreaterThan(50);
  });

  it('the lobby color list can’t be polled quickly', async () => {
    const env = await startServer();
    envs.push(env);
    const c = await env.connect('poller');
    await env.call(c, 'room:create', { name: 'P' });
    let answered = 0;
    for (let i = 0; i < 20; i++) if ((await env.call(c, 'lobby:colors')).ok) answered++;
    expect(answered).toBeLessThanOrEqual(6);
  });
});

describe('production servers', () => {
  it('refuse dev tools even when sent by hand', async () => {
    const env = await startServer({ devMode: false, minPlayers: 6, corsOrigin: [] });
    envs.push(env);
    const cs: Client[] = [];
    for (let i = 0; i < 6; i++) cs.push(await env.connect(`P${i}`));
    const created = await env.call(cs[0], 'room:create', { name: 'Host' });
    for (const c of cs.slice(1)) await env.call(c, 'room:join', { code: created.code, name: c.label });
    expect((await env.call(cs[0], 'lobby:addBot')).ok).toBe(false);
    expect((await env.call(cs[0], 'game:start')).ok).toBe(true);
    await until(cs[0], (v) => v.phase === 'poster');
    const skip = await env.call(cs[0], 'dev:skipPhase');
    expect(skip.ok).toBe(false);
    expect(env.server.rooms.get(created.code)!.phase).toBe('poster');
    expect(cs[0].latest!.devMode).toBe(false);
  });

  it('only accept connections from their own site, over https', async () => {
    const env = await startServer({ devMode: false, corsOrigin: ['https://wanted.example.com', 'https://*.trycloudflare.com'] });
    envs.push(env);
    await expect(env.connect('good', { origin: 'https://wanted.example.com' })).resolves.toBeTruthy();
    await expect(env.connect('tunnel', { origin: 'https://abc-def.trycloudflare.com' })).resolves.toBeTruthy();
    await expect(env.connect('evil', { origin: 'https://evil.example' })).rejects.toBeTruthy();
    await expect(env.connect('lookalike', { origin: 'https://wanted.example.com.evil.example' })).rejects.toBeTruthy();
    await expect(env.connect('plain-http', { origin: 'http://wanted.example.com' })).rejects.toBeTruthy();
    await expect(env.connect('none', { origin: null })).rejects.toBeTruthy();
  });

  it('serve nothing over plain HTTP but a health check (no logs, no files)', async () => {
    const env = await startServer({ devMode: false });
    envs.push(env);
    for (const path of ['/logs/games.jsonl', '/games.jsonl', '/../logs/games.jsonl', '/package.json', '/src/index.ts', '/']) {
      const res = await fetch(`http://localhost:${env.port}${path}`);
      expect(res.status, path).toBe(404);
    }
    expect((await fetch(`http://localhost:${env.port}/health`)).status).toBe(200);
  });
});

describe('a whole table on one Wi-Fi', () => {
  it('can join and reconnect many times without hitting the code-guessing limit', async () => {
    const env = await startServer();
    envs.push(env);
    const host = await env.connect('host');
    const created = await env.call(host, 'room:create', { name: 'Host' });
    const tokens: string[] = [];
    for (let i = 0; i < 14; i++) {
      const c = await env.connect(`p${i}`);
      const r = await env.call(c, 'room:join', { code: created.code, name: `P${i}` });
      expect(r.ok, r.error).toBe(true);
      tokens.push(r.token);
    }
    // Everyone drops and comes back twice: 28 resumes from the same IP.
    for (let round = 0; round < 2; round++) {
      for (const t of tokens) {
        const c = await env.connect('back');
        expect((await env.call(c, 'room:resume', { code: created.code, token: t })).ok).toBe(true);
      }
    }
  });
});
