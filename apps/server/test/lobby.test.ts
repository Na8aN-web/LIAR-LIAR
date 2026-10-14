import { afterEach, describe, expect, it, vi } from 'vitest';
import { COLOR_IDS, HOST_GRACE_MS, hasBadWords, type LobbyListUpdate } from '@wtc/shared';
import { Room } from '../src/room';
import { secureRng } from '../src/rng';
import { type Client, sleep, startServer } from './helpers/net';

// Public and private rooms, Find a Lobby, Quick Play.

let cleanup: (() => Promise<void>) | null = null;
afterEach(async () => {
  await cleanup?.();
  cleanup = null;
  vi.useRealTimers();
});
const NO_LIMITS = { events: { burst: 1000, perSecond: 1000 }, colorProbe: { burst: 1000, perSecond: 1000 }, roomCreate: { burst: 100, perSecond: 100 } };

async function setup(opts: Parameters<typeof startServer>[0] = {}) {
  const t = await startServer({ limits: NO_LIMITS, devMode: false, minPlayers: 6, ...opts });
  cleanup = t.close;
  /** The latest list a watcher has, live. */
  const watch = async (c: Client) => {
    const state: { last: LobbyListUpdate | null } = { last: null };
    c.on('lobby:list', (u) => (state.last = u));
    const first = await t.call(c, 'lobby:watch');
    state.last = first;
    return state;
  };
  return { ...t, watch };
}
const waitFor = async (pred: () => boolean, ms = 3000) => {
  for (let t = 0; t < ms; t += 20) {
    if (pred()) return;
    await sleep(20);
  }
  throw new Error('timed out');
};

describe('public and private rooms', () => {
  it('creates both; only waiting public rooms are listed, and the list never shows a code', async () => {
    const x = await setup();
    const browser = await x.connect('browser');
    const list = await x.watch(browser);
    expect(list.last!.rooms).toEqual([]);

    const ada = await x.connect('Ada');
    const pub = await x.call(ada, 'room:create', { name: 'Ada', visibility: 'public', roomName: 'Dust Devils' });
    const bo = await x.connect('Bo');
    const priv = await x.call(bo, 'room:create', { name: 'Bo', visibility: 'private' });
    const cy = await x.connect('Cy');
    await x.call(cy, 'room:create', { name: 'Cy' }); // default: private
    expect(pub.ok && priv.ok).toBe(true);

    await waitFor(() => list.last!.rooms.length === 1);
    const [row] = list.last!.rooms;
    expect(row).toMatchObject({ name: 'Dust Devils', host: 'Ada', players: 1, bots: 0, maxPlayers: 15, posters: 10, autoStart: false });
    expect(Object.keys(row).sort()).toEqual(['autoStart', 'bots', 'host', 'id', 'maxPlayers', 'name', 'players', 'posters', 'searches']);

    // Nothing private anywhere in what a browser received: no room codes, no colors, no tokens.
    const raw = JSON.stringify(browser.inbox);
    for (const secret of [pub.code, priv.code, pub.token, priv.token, 'Bo', 'Cy']) expect(raw).not.toContain(secret);
    for (const c of COLOR_IDS) expect(raw).not.toContain(`"${c}"`);
    expect(ada.latest!.room).toMatchObject({ name: 'Dust Devils', visibility: 'public' });
  });

  it('hides rooms that are locked, playing or turned private, and updates the list live', async () => {
    const x = await setup({ devMode: true });
    const browser = await x.connect('browser');
    const list = await x.watch(browser);
    const ada = await x.connect('Ada');
    await x.call(ada, 'room:create', { name: 'Ada', visibility: 'public' });
    await waitFor(() => list.last!.rooms.length === 1);
    expect(list.last!.rooms[0].name).toBe("Ada's Campfire");

    // Someone joins: the watcher sees 2 players without asking again.
    const bo = await x.connect('Bo');
    expect((await x.call(bo, 'room:joinListed', { id: list.last!.rooms[0].id, name: 'Bo' })).ok).toBe(true);
    await waitFor(() => list.last!.rooms[0]?.players === 2);

    await x.call(ada, 'lobby:lock', { locked: true });
    await waitFor(() => list.last!.rooms.length === 0);
    await x.call(ada, 'lobby:lock', { locked: false });
    await waitFor(() => list.last!.rooms.length === 1);
    await x.call(ada, 'lobby:visibility', { visibility: 'private' });
    await waitFor(() => list.last!.rooms.length === 0);
    expect((await x.call(bo, 'lobby:visibility', { visibility: 'public' })).ok).toBe(false); // host only
    await x.call(ada, 'lobby:visibility', { visibility: 'public' });
    await waitFor(() => list.last!.rooms.length === 1);

    // A game starts: off the list. Joining by the old list id fails.
    const id = list.last!.rooms[0].id;
    for (let i = 0; i < 4; i++) await x.call(ada, 'lobby:addBot');
    expect((await x.call(ada, 'game:start')).ok).toBe(true);
    await waitFor(() => list.last!.rooms.length === 0);
    const late = await x.connect('Late');
    expect(await x.call(late, 'room:joinListed', { id, name: 'Late' })).toEqual({ ok: false, error: 'That campfire is gone. Pick another.' });
    expect((await x.call(late, 'room:joinListed', { id: 'nonsense', name: 'Late' })).ok).toBe(false);
  });
});

describe('Quick Play', () => {
  it('creates a public room when none are waiting, then joins the fullest one', async () => {
    const x = await setup();
    const a = await x.connect('A');
    const first = await x.call(a, 'room:quickPlay', { name: 'Ada' });
    expect(first).toMatchObject({ ok: true, created: true });
    expect(a.latest!.room.visibility).toBe('public');

    // A second public room with three people.
    const b = await x.connect('B');
    const big = await x.call(b, 'room:create', { name: 'Bo', visibility: 'public' });
    for (const n of ['Cy', 'Di']) await x.call(await x.connect(n), 'room:join', { code: big.code, name: n });
    // A private room that's even fuller is never picked.
    const p = await x.connect('P');
    const priv = await x.call(p, 'room:create', { name: 'Pa', visibility: 'private' });
    for (const n of ['Q1', 'Q2', 'Q3', 'Q4']) await x.call(await x.connect(n), 'room:join', { code: priv.code, name: n });

    const e = await x.connect('E');
    const res = await x.call(e, 'room:quickPlay', { name: 'Ed' });
    expect(res).toMatchObject({ ok: true, created: false, code: big.code });
    expect(e.latest!.players).toHaveLength(4);
  });
});

describe('filling public rooms with bots', () => {
  it('lets hosts of public rooms fill seats with bots in production, offering it after the set time', async () => {
    const x = await setup();
    const a = await x.connect('A');
    await x.call(a, 'room:create', { name: 'Ada', visibility: 'private' });
    expect(a.latest!.room.fillOfferAt).toBeNull(); // the timed offer is for public rooms
    await x.call(a, 'lobby:visibility', { visibility: 'public' });
    const offer = a.latest!.room.fillOfferAt!;
    expect(offer - a.latest!.serverNow).toBeGreaterThan(100_000); // default 2 minutes
    expect((await x.call(a, 'lobby:autoFill', { afterSec: 5 })).ok).toBe(false); // under the minimum
    expect((await x.call(a, 'lobby:autoFill', { afterSec: 60 })).ok).toBe(true);
    expect(a.latest!.room.fillOfferAt! - offer).toBeLessThan(0);
    const fill = await x.call(a, 'lobby:fill');
    expect(fill).toEqual({ ok: true, added: 5 });
    expect(a.latest!.players).toHaveLength(6);
    expect(a.latest!.room.fillOfferAt).toBeNull(); // enough to start now
    expect((await x.call(a, 'game:start')).ok).toBe(true);
  });
});

describe('host migration', () => {
  it('passes host to the longest-connected player when the host leaves, and the room stays listed', async () => {
    const x = await setup();
    const list = await x.watch(await x.connect('browser'));
    const a = await x.connect('A');
    await x.call(a, 'room:create', { name: 'Ada', visibility: 'public', roomName: 'High Noon' });
    await waitFor(() => list.last!.rooms.length === 1);
    const b = await x.connect('B');
    await x.call(b, 'room:joinListed', { id: list.last!.rooms[0].id, name: 'Bo' });
    await sleep(20);
    const c = await x.connect('C');
    await x.call(c, 'room:joinListed', { id: list.last!.rooms[0].id, name: 'Cy' });
    a.emit('room:leave');
    await waitFor(() => !!b.latest!.you.isHost);
    await waitFor(() => list.last!.rooms[0]?.host === 'Bo' && list.last!.rooms[0].players === 2);
    expect(list.last!.rooms[0].name).toBe('High Noon');
    // Everyone leaves: the room closes and leaves the list.
    b.emit('room:leave');
    c.emit('room:leave');
    await waitFor(() => list.last!.rooms.length === 0);
    expect(x.server.rooms.size).toBe(0);
  });

  it('after a disconnect, once the grace period ends', () => {
    vi.useFakeTimers();
    const room = new Room('HOSTS', { send: () => {}, rng: secureRng, devMode: false, minPlayers: 6, visibility: 'public' });
    const a = room.addPlayer('Ada', 's1');
    vi.advanceTimersByTime(10);
    const b = room.addPlayer('Bo', 's2');
    vi.advanceTimersByTime(10);
    room.addPlayer('Cy', 's3');
    if (!a.ok || !b.ok) throw new Error('join');
    room.disconnect(a.seat.id, 's1');
    expect(room.hostId).toBe(a.seat.id); // a short drop doesn't cost the host their seat
    vi.advanceTimersByTime(HOST_GRACE_MS + 10);
    expect(room.hostId).toBe(b.seat.id); // Bo has been here longest
    expect(room.listing()!.host).toBe('Bo');
    room.dispose();
  });
});

describe('room names', () => {
  it('filters bad words, caps the length, and falls back to the default name', async () => {
    const x = await setup();
    const a = await x.connect('A');
    await x.call(a, 'room:create', { name: 'Ada', visibility: 'public', roomName: 'f.u.c.k this' });
    expect(a.latest!.room.name).toBe("Ada's Campfire");
    const b = await x.connect('B');
    await x.call(b, 'room:create', { name: 'Bo', visibility: 'public', roomName: 'x'.repeat(200) });
    expect(b.latest!.room.name).toHaveLength(28);
  });

  it('the word filter catches disguised words without flagging ordinary ones', () => {
    for (const bad of ['Sh1t Show', 'B I T C H', 'fuuuck', 'a$$', 'Nazi Camp']) expect(hasBadWords(bad), bad).toBe(true);
    for (const ok of ['Dust Devils', 'Cocktail Hour', 'Scunthorpe Saloon', 'Classic Camp', 'Essex Riders', 'High Noon', "Hank's Campfire"]) expect(hasBadWords(ok), ok).toBe(false);
  });
});

describe('rate limits', () => {
  it('limits how often one connection can reload the list', async () => {
    const t = await startServer({ devMode: false, minPlayers: 6 });
    cleanup = t.close;
    const c = await t.connect('c');
    const results = [];
    for (let i = 0; i < 12; i++) results.push((await t.call(c, 'lobby:watch')).ok);
    expect(results.filter((r) => !r).length).toBeGreaterThan(0);
  });
});
