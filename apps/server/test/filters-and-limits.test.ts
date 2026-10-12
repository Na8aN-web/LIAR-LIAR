import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, maskBadWords } from '@wtc/shared';
import * as metrics from '../src/admin/metrics';
import type { GameSummary } from '../src/game/summary';
import { type Client, sleep, startServer, until } from './helpers/net';

// Bots in any room (games with bots are tagged), the word filter on names and public chat,
// and per-browser rate limits with per-IP ceilings (many phones share one carrier IP).

let cleanup: (() => Promise<void>) | null = null;
afterEach(async () => {
  await cleanup?.();
  cleanup = null;
});
const FAST = { events: { burst: 1000, perSecond: 1000 }, colorProbe: { burst: 1000, perSecond: 1000 } };

async function prod(limits: Record<string, unknown> = {}) {
  const t = await startServer({ devMode: false, minPlayers: 6, limits: { ...FAST, ...limits } });
  cleanup = t.close;
  return t;
}

describe('bots in private rooms', () => {
  it('a few friends can fill a private room with bots in production, and the game is tagged', async () => {
    const ended: GameSummary[] = [];
    const t = await startServer({ devMode: true, minPlayers: 6, limits: FAST, onGameEnd: (s) => ended.push(s) });
    cleanup = t.close;
    const a = await t.connect('A');
    await t.call(a, 'room:create', { name: 'Ada', visibility: 'private' });
    expect(await t.call(a, 'lobby:fill')).toEqual({ ok: true, added: 5 });
    expect(a.latest!.room.visibility).toBe('private');
    await t.call(a, 'game:start');
    for (let i = 0; i < 80 && a.latest!.phase !== 'ended'; i++) {
      await t.call(a, 'dev:skipPhase');
      await sleep(15);
    }
    await until(a, (v) => v.phase === 'ended');
    await sleep(30);
    expect(ended[0].withBots).toBe(true);
  });

  it('production private rooms accept bots too', async () => {
    const t = await prod();
    const a = await t.connect('A');
    await t.call(a, 'room:create', { name: 'Ada', visibility: 'private' });
    expect((await t.call(a, 'lobby:addBot')).ok).toBe(true);
    expect((await t.call(a, 'lobby:fill')).ok).toBe(true);
    expect(a.latest!.players).toHaveLength(6);
    expect((await t.call(a, 'game:start')).ok).toBe(true);
  });

  it('the dashboard can keep to human-only games (or only games with bots)', () => {
    const g = (endedAt: string, bots: number, tag = false): GameSummary => ({
      ...(tag ? { withBots: true as const } : {}),
      endedAt, durationMs: 600_000, players: 8, bots, inspectLimit: 3, settings: DEFAULT_SETTINGS,
      posters: [{ poster: 0, wantedIsBot: false, pot: 100, voters: 7, correct: 3, escaped: false, payoutEach: 33 }],
      inspects: 1, offers: { made: 0, accepted: 0, declined: 0, expired: 0 }, extraInspects: 0, finalScores: [100], winnerCorrectVotes: 0, swapLimit: 2, totalSwaps: 0, colorChanges: [0],
    });
    const games = [g('2026-10-01T10:00:00Z', 0), g('2026-10-01T11:00:00Z', 3, true), g('2026-10-01T12:00:00Z', 2)];
    const w = { from: new Date('2026-10-01T00:00:00Z'), to: new Date('2026-10-02T00:00:00Z'), now: Date.now() };
    expect(metrics.balance(games, [], w).games).toBe(3);
    expect(metrics.balance(games, [], w, { who: 'humans' }).games).toBe(1);
    // Older lines without the tag count by their bot number.
    expect(metrics.balance(games, [], w, { who: 'withBots' }).games).toBe(2);
  });
});

describe('word filter: names and public chat', () => {
  it('turns a filtered name into "Stranger N" everywhere the name shows', async () => {
    const t = await prod();
    const a = await t.connect('A');
    await t.call(a, 'room:create', { name: 'Sh1tlord', visibility: 'public' });
    expect(a.latest!.you.name).toBe('Stranger 1');
    const b = await t.connect('B');
    await t.call(b, 'room:join', { code: a.latest!.code, name: 'F U C K' });
    const c = await t.connect('C');
    await t.call(c, 'room:join', { code: a.latest!.code, name: 'Hank' });
    await until(c, (v) => v.players.length === 3);
    expect(c.latest!.players.map((p) => p.name)).toEqual(['Stranger 1', 'Stranger 2', 'Hank']);
    const list = await t.call(await t.connect('browser'), 'lobby:watch');
    expect(list.rooms[0]).toMatchObject({ host: 'Stranger 1', name: "Stranger 1's Campfire" });
    expect(JSON.stringify(c.inbox)).not.toMatch(/Sh1tlord|F U C K/);
  });

  it('masks filtered words in public rooms, leaves private rooms as typed', async () => {
    const t = await prod();
    const talk = async (visibility: 'public' | 'private') => {
      const a = await t.connect(`A-${visibility}`);
      const created = await t.call(a, 'room:create', { name: 'Ada', visibility });
      const b: Client = await t.connect(`B-${visibility}`);
      await t.call(b, 'room:join', { code: created.code, name: 'Bo' });
      await t.call(a, 'chat:send', { text: 'what the f u c k, you shit' });
      await sleep(80);
      return b.inbox.filter((m) => m.event === 'chat').map((m) => (m.payload as { text: string }).text).at(-1);
    };
    expect(await talk('public')).toBe('what the * * * *, you ****');
    expect(await talk('private')).toBe('what the f u c k, you shit');
  });

  it('masks disguised words and leaves ordinary ones alone', () => {
    expect(maskBadWords('you are a f.u.c.k.i.n.g idiot')).toBe('you are a ************* idiot');
    expect(maskBadWords('a$$hole move')).toBe('******* move');
    for (const ok of ['nice cocktail in Scunthorpe', 'it is definitely not me', 'I saw red on Hank', 'class act']) expect(maskBadWords(ok)).toBe(ok);
  });
});

describe('rate limits: per browser, with per-IP ceilings', () => {
  it('many players behind one IP each get their own room-creation budget', async () => {
    const t = await prod();
    // Ten browsers on the same IP (one carrier, CGNAT): each can open a room. The old per-IP
    // limit would have refused everyone after the fifth.
    for (let i = 0; i < 10; i++) {
      const c = await t.connect(`phone${i}`);
      expect((await t.call(c, 'room:create', { name: `P${i}` })).ok, `phone ${i}`).toBe(true);
    }
  });

  it('one browser is limited however many connections it opens', async () => {
    const t = await prod();
    const first = await t.connect('one');
    const results: boolean[] = [];
    for (let i = 0; i < 7; i++) {
      const c = await t.connect(`same${i}`, { browserId: first.browserId });
      results.push((await t.call(c, 'room:create', { name: 'Ada' })).ok);
      c.disconnect();
    }
    expect(results.filter(Boolean)).toHaveLength(5);
    // Find a Lobby too: reconnecting doesn't reset it.
    let watched = 0;
    for (let i = 0; i < 12; i++) {
      const c = await t.connect(`watch${i}`, { browserId: first.browserId });
      if ((await t.call(c, 'lobby:watch')).ok) watched++;
      c.disconnect();
    }
    expect(watched).toBe(8);
  });

  it('a script inventing new browser ids runs into the per-IP ceiling', async () => {
    const t = await prod({ roomCreateIp: { burst: 15, perSecond: 1 / 60 } });
    let created = 0;
    for (let i = 0; i < 25; i++) if ((await t.call(await t.connect(`fake${i}`), 'room:create', { name: 'Bot' })).ok) created++;
    expect(created).toBe(15);
  });

  it('a whole carrier IP can hold many connections; one browser only a few', async () => {
    const t = await prod();
    // 60 people behind one IP (the old cap was 40 per IP).
    const many: Client[] = [];
    for (let i = 0; i < 60; i++) many.push(await t.connect(`p${i}`));
    expect(many.every((c) => c.connected)).toBe(true);
    // One browser opening tab after tab stops at 12.
    const same = many[0].browserId;
    let refused = 0;
    for (let i = 0; i < 14; i++) await t.connect(`tab${i}`, { browserId: same }).catch(() => refused++);
    expect(refused).toBe(3); // the 12 allowed include the first connection
  });
});
