import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { parseSource } from '@wtc/shared';
import { anonId, type AnalyticsEvent } from '../src/analytics/events';
import * as metrics from '../src/admin/metrics';
import { FileStore } from '../src/store/file';
import { sleep, startServer, until } from './helpers/net';

// Analytics: what the browser and the server record, that it never holds a name, token or IP,
// and that chat is stored only when a message is reported. Then the dashboard's numbers.

const dirs: string[] = [];
let cleanup: (() => Promise<void>) | null = null;
afterEach(async () => {
  await cleanup?.();
  cleanup = null;
});
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));
const NO_LIMITS = { events: { burst: 1000, perSecond: 1000 }, colorProbe: { burst: 1000, perSecond: 1000 } };

async function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'wtc-analytics-'));
  dirs.push(dir);
  const store = new FileStore(dir);
  await store.init();
  const t = await startServer({ store, limits: NO_LIMITS });
  cleanup = t.close;
  return { ...t, store };
}

describe('recording', () => {
  it('records visits, funnel steps and billboards anonymously, once each per page load', async () => {
    const x = await setup();
    const a = await x.connect('A');
    for (let i = 0; i < 3; i++) await x.call(a, 'analytics:visit', { page: 'home', src: 'YouTube' });
    await x.call(a, 'analytics:step', { step: 'howto_open' });
    await x.call(a, 'analytics:step', { step: 'howto_finish' });
    expect((await x.call(a, 'analytics:step', { step: 'game_finish' })).ok).toBe(false); // the server records that one itself
    await x.call(a, 'analytics:billboard', { slot: 'roof-hotel' });
    expect((await x.call(a, 'analytics:billboard', { slot: '../../etc' })).ok).toBe(false);
    const created = await x.call(a, 'room:create', { name: 'Ada Lovelace' });
    for (let i = 0; i < 5; i++) await x.call(a, 'lobby:addBot');
    await x.call(a, 'game:start');
    await sleep(100);

    const events = await x.store.events();
    const anon = anonId(a.browserId);
    expect(events.map((e) => (e.type === 'step' ? e.step : e.type))).toEqual(['visit', 'howto_open', 'howto_finish', 'billboard', 'lobby', 'lobby', 'game_start']);
    // The room-created event says how they got in (a private room here), nothing more.
    expect(events.find((e) => e.type === 'lobby')).toMatchObject({ action: 'create_private' });
    expect(events.every((e) => e.anon === anon)).toBe(true);
    expect(events[0]).toMatchObject({ page: 'home', src: 'youtube', device: 'desktop', country: null });
    const raw = JSON.stringify(events);
    for (const secret of ['Ada', a.browserId, created.token, '127.0.0.1', '::1']) expect(raw).not.toContain(secret);
  });

  it('stores chat only when a message is reported: that message and a few before it, without names', async () => {
    const x = await setup();
    const a = await x.connect('A');
    const b = await x.connect('B');
    const created = await x.call(a, 'room:create', { name: 'Ada' });
    await x.call(b, 'room:join', { code: created.code, name: 'Bo' });
    for (const [c, text] of [[a, 'hello all'], [b, 'first message'], [a, 'be nice'], [b, 'something nasty']] as const) {
      await x.call(c, 'chat:send', { text });
      await sleep(450);
    }
    await sleep(50);
    expect(JSON.stringify(await x.store.events())).not.toContain('nasty');

    const nasty = a.inbox.filter((m) => m.event === 'chat').map((m) => m.payload as { id: string; text: string }).find((m) => m.text === 'something nasty')!;
    expect((await x.call(a, 'chat:report', { messageId: nasty.id, reason: 'rude' })).ok).toBe(true);
    expect((await x.call(a, 'chat:report', { messageId: nasty.id })).ok).toBe(false); // once
    expect((await x.call(b, 'chat:report', { messageId: nasty.id })).ok).toBe(false); // not your own
    await x.call(a, 'chat:mute', { playerId: b.latest!.you.id });
    await sleep(50);

    const safety = (await x.store.events({ types: ['safety'] })) as Extract<AnalyticsEvent, { type: 'safety' }>[];
    const report = safety.find((e) => e.kind === 'report')!;
    expect(report.target).toBe(anonId(b.browserId));
    expect(report.reason).toBe('rude');
    expect(report.chat).toEqual([
      { text: 'hello all', reported: false, fromReported: false },
      { text: 'first message', reported: false, fromReported: true },
      { text: 'be nice', reported: false, fromReported: false },
      { text: 'something nasty', reported: true, fromReported: true },
    ]);
    expect(JSON.stringify(report)).not.toMatch(/Ada|Bo"/);
    expect(safety.some((e) => e.kind === 'mute' && e.target === anonId(b.browserId))).toBe(true);
  });

  it('records nothing for the playtest check script, and abandoned games when a room closes mid-game', async () => {
    const x = await setup();
    const check = await x.connect('check', { purpose: 'check' });
    await x.call(check, 'analytics:visit', { page: 'home' });
    await x.call(check, 'room:create', { name: 'Bot runner' });
    const a = await x.connect('A');
    const created = await x.call(a, 'room:create', { name: 'Ada' });
    for (let i = 0; i < 5; i++) await x.call(a, 'lobby:addBot');
    await x.call(a, 'game:start');
    await until(a, (v) => v.phase === 'poster');
    x.server.rooms.get(created.code)!.close('test');
    await sleep(50);
    const events = await x.store.events();
    expect(events.filter((e) => e.anon === anonId(check.browserId))).toEqual([]);
    expect(events.find((e) => e.type === 'abandoned')).toMatchObject({ humans: 1, players: 6, poster: 0 });
  });
});

describe('dashboard numbers', () => {
  const at = (day: string, h = 12) => `${day}T${String(h).padStart(2, '0')}:00:00.000Z`;
  const A = 'AAAAAAAAAAAAAAAA';
  const B = 'BBBBBBBBBBBBBBBB';
  const C = 'CCCCCCCCCCCCCCCC';
  const visit = (anon: string, day: string, src: string, device: 'mobile' | 'desktop' = 'mobile', page: 'home' | 'room' = 'home'): AnalyticsEvent => ({
    at: at(day),
    type: 'visit',
    anon,
    page,
    src: parseSource(src),
    device,
    country: 'NG',
  });
  const step = (anon: string, day: string, s: string, h = 13): AnalyticsEvent => ({ at: at(day, h), type: 'step', anon, step: s as never });
  const events: AnalyticsEvent[] = [
    // A: from YouTube on day 1, learns, plays twice, comes back next day.
    visit(A, '2026-10-01', 'youtube'),
    step(A, '2026-10-01', 'howto_open'),
    step(A, '2026-10-01', 'howto_finish'),
    step(A, '2026-10-01', 'lobby', 14),
    step(A, '2026-10-01', 'game_start', 14),
    step(A, '2026-10-01', 'game_finish', 15),
    step(A, '2026-10-01', 'game_start', 16),
    visit(A, '2026-10-02', 'direct'),
    // B: from TikTok via a room link, plays once.
    visit(B, '2026-10-01', 'tiktok', 'desktop', 'room'),
    step(B, '2026-10-01', 'lobby', 14),
    step(B, '2026-10-01', 'game_start', 14),
    step(B, '2026-10-01', 'game_finish', 15),
    // C: looks at the homepage on day 3, skips How to Play, leaves.
    visit(C, '2026-10-03', 'instagram'),
    step(C, '2026-10-03', 'howto_open'),
    step(C, '2026-10-03', 'howto_skip'),
    { at: at('2026-10-01', 14), type: 'concurrency', anon: null, players: 7, sockets: 9, rooms: 1 },
    { at: at('2026-10-01', 15), type: 'concurrency', anon: null, players: 4, sockets: 5, rooms: 1 },
  ];
  const w = { from: new Date('2026-10-01T00:00:00Z'), to: new Date('2026-10-04T00:00:00Z'), now: Date.parse('2026-10-20T00:00:00Z') };

  it('funnel: each step, with drop-off from the step before', () => {
    const f = Object.fromEntries(metrics.funnel(events, w).map((s) => [s.key, s]));
    expect([f.visit.n, f.home.n, f.howto.n, f.lobby.n, f.start.n, f.finish.n, f.again.n]).toEqual([3, 2, 2, 2, 2, 2, 1]);
    expect(f.howto.detail).toEqual({ finished: 1, skipped: 1, notOpened: 1 });
    expect(f.again.dropFromPrevious).toBeCloseTo(0.5);
    // How to Play is optional: no drop-off for it, and the lobby is compared with the homepage.
    expect(f.howto.dropFromPrevious).toBeNull();
    expect(f.lobby.dropFromPrevious).toBe(0);
  });

  it('growth: daily visitors, new vs returning, return rates, devices, peak', () => {
    const g = metrics.growth(events, [], w);
    expect(g.series.map((d) => [d.day, d.visitors, d.new, d.returning, d.players, d.peak])).toEqual([
      ['2026-10-01', 2, 2, 0, 2, 7],
      ['2026-10-02', 1, 0, 1, 0, 0],
      ['2026-10-03', 1, 1, 0, 0, 0],
    ]);
    expect(g.retention.nextDay).toBeCloseTo(1 / 3); // A came back the next day; B and C didn't
    expect(g.devices).toEqual([
      { key: 'mobile', n: 2 },
      { key: 'desktop', n: 1 },
    ]);
    expect(g.totals.peak).toBe(7);
  });

  it('sources: each visitor credited to their first link', () => {
    const rows = Object.fromEntries(metrics.sources(events, w).rows.map((r) => [r.src, r]));
    expect(rows.youtube).toMatchObject({ visitors: 1, players: 1, finishers: 1, finishedGames: 1 });
    expect(rows.tiktok).toMatchObject({ visitors: 1, players: 1, finishedGames: 1 });
    expect(rows.instagram).toMatchObject({ visitors: 1, players: 0, finishedGames: 0 });
    expect(rows.direct).toBeUndefined(); // A's second visit was direct, but A came from YouTube
  });
});
