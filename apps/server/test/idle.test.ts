import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';
import { afterEach, describe, expect, it } from 'vitest';
import type { PlayerView } from '@wtc/shared';
import { Room } from '../src/room';
import { secureRng } from '../src/rng';
import { DEFAULT_TIMEOUTS, timeoutsFromEnv, type RoomTimeouts } from '../src/timeouts';
import { sleep, startServer } from './helpers/net';

// Idle lobbies, AFK hosts and players, hard limits, and that closed rooms really go away.

const MIN = 60_000;
let rooms: Room[] = [];
let cleanup: (() => Promise<void>) | null = null;
afterEach(async () => {
  for (const r of rooms) r.dispose();
  rooms = [];
  await cleanup?.();
  cleanup = null;
});

function makeRoom(o: { visibility?: 'public' | 'private'; players?: number; timeouts?: Partial<RoomTimeouts> } = {}) {
  const kicked: { socketId: string; reason?: string }[] = [];
  const views: { socketId: string; view: PlayerView }[] = [];
  const room = new Room('IDLE1', {
    send: (socketId, event, ...args) => event === 'view' && views.push({ socketId, view: args[0] as PlayerView }),
    rng: secureRng,
    devMode: true,
    minPlayers: 2,
    visibility: o.visibility ?? 'private',
    timeouts: { ...DEFAULT_TIMEOUTS, ...o.timeouts },
    kick: (socketId, reason) => kicked.push({ socketId, reason }),
  });
  rooms.push(room);
  const ids: string[] = [];
  for (let i = 0; i < (o.players ?? 3); i++) {
    const res = room.addPlayer(`P${i}`, `sock${i}`);
    if (!res.ok) throw new Error(res.error);
    ids.push(res.seat.id);
  }
  return { room, ids, host: ids[0], kicked, views };
}

describe('idle lobbies', () => {
  it('warn after 10 quiet minutes, leave Find a Lobby, and close 5 minutes later', () => {
    const { room } = makeRoom({ visibility: 'public' });
    const t0 = room.lastActivityAt;
    expect(room.tick(t0 + 9 * MIN)).toBeNull();
    expect(room.closing).toBeNull();
    expect(room.listing()).not.toBeNull();

    expect(room.tick(t0 + 10 * MIN)).toBeNull();
    expect(room.closing).toEqual({ at: t0 + 15 * MIN, why: 'idle' });
    expect(room.listing()).toBeNull(); // off the list straight away

    expect(room.tick(t0 + 15 * MIN - 1)).toBeNull();
    expect(room.tick(t0 + 15 * MIN)).toMatch(/went cold/);
  });

  it('any input keeps the room open and lists it again', () => {
    const { room, ids } = makeRoom({ visibility: 'public' });
    const t0 = room.lastActivityAt;
    room.tick(t0 + 10 * MIN);
    expect(room.closing?.why).toBe('idle');
    room.noteInput(ids[2], t0 + 11 * MIN);
    expect(room.closing).toBeNull();
    expect(room.listing()).not.toBeNull();
    // The clock starts again from that input.
    expect(room.tick(t0 + 20 * MIN)).toBeNull();
    expect(room.closing).toBeNull();
    room.tick(t0 + 21 * MIN);
    expect(room.closing?.why).toBe('idle');
  });

  it('close after 60 minutes in the lobby however busy they are', () => {
    const { room, host } = makeRoom();
    const t0 = room.lobbySince;
    for (let m = 5; m < 55; m += 5) {
      room.noteInput(host, t0 + m * MIN);
      expect(room.tick(t0 + m * MIN)).toBeNull();
    }
    room.noteInput(host, t0 + 55 * MIN);
    expect(room.tick(t0 + 55 * MIN)).toBeNull();
    expect(room.closing).toEqual({ at: t0 + 60 * MIN, why: 'maxAge' });
    room.noteInput(host, t0 + 59 * MIN); // doesn't help
    expect(room.closing?.why).toBe('maxAge');
    expect(room.tick(t0 + 60 * MIN)).toMatch(/an hour/);
  });
});

describe('AFK hosts', () => {
  it('a public lobby passes host to the most recently active waiting player', () => {
    const { room, ids, host } = makeRoom({ visibility: 'public', players: 4 });
    const t0 = room.seats.get(host)!.lastInputAt;
    room.noteInput(ids[1], t0 + 2 * MIN);
    room.noteInput(ids[2], t0 + 4 * MIN);
    expect(room.tick(t0 + 5 * MIN - 1)).toBeNull();
    expect(room.hostId).toBe(host);
    room.tick(t0 + 5 * MIN);
    expect(room.hostId).toBe(ids[2]);
  });

  it('stays put when nobody else is active, and in private rooms', () => {
    const pub = makeRoom({ visibility: 'public' });
    pub.room.tick(pub.room.lastActivityAt + 6 * MIN);
    expect(pub.room.hostId).toBe(pub.host);
    const priv = makeRoom({ visibility: 'private' });
    const t0 = priv.room.lastActivityAt;
    priv.room.noteInput(priv.ids[1], t0 + 4 * MIN);
    priv.room.tick(t0 + 6 * MIN);
    expect(priv.room.hostId).toBe(priv.host);
  });
});

describe('AFK players in games', () => {
  /** Plays posters; everyone but `idle` does something during each. */
  function play(room: Room, host: string, ids: string[], idle: string[], posters: number) {
    for (let p = 0; p < posters; p++) {
      for (const id of ids) if (!idle.includes(id)) room.noteInput(id);
      const at = room.game!.posterIndex;
      for (let i = 0; i < 10 && !(room.phase === 'payout' && room.game!.posterIndex === at); i++) room.skipPhase(host);
      // On to the next poster's start.
      if (room.phase === 'payout') room.skipPhase(host);
    }
  }

  it('are away after 2 quiet posters and removed after 3; acting clears it', () => {
    const { room, ids, host, kicked } = makeRoom({ players: 6 });
    expect(room.start(host).ok).toBe(true);
    const [quiet, comesBack] = [ids[4], ids[5]];

    play(room, host, ids, [quiet, comesBack], 1);
    expect(room.seats.get(quiet)!.away).toBe(false);
    play(room, host, ids, [quiet, comesBack], 1);
    expect(room.seats.get(quiet)!.away).toBe(true);
    expect(room.seats.get(comesBack)!.away).toBe(true);
    expect(room.viewFor(room.seats.get(ids[1])!).players.find((p) => p.id === quiet)!.away).toBe(true);

    room.noteInput(comesBack); // back
    expect(room.seats.get(comesBack)!.away).toBe(false);

    const oldToken = room.seats.get(quiet)!.token;
    play(room, host, ids, [quiet], 1);
    const q = room.seats.get(quiet)!;
    expect(q.removed).toBe(true);
    expect(q.connected).toBe(false);
    expect(kicked).toEqual([{ socketId: 'sock4', reason: expect.stringMatching(/3 posters/) }]);
    expect(room.seats.get(comesBack)!.removed).toBe(false);
    // A removed player's session no longer resumes anything.
    expect(room.resume(oldToken, 'sockX')).toBeNull();
    expect(q.connected).toBe(false);
  });

  it("don't hold the vote open while away", () => {
    const { room, ids, host } = makeRoom({ players: 6 });
    room.start(host);
    play(room, host, ids, [ids[5]], 2);
    expect(room.seats.get(ids[5])!.away).toBe(true);
    for (let i = 0; i < 10 && room.phase !== 'vote'; i++) room.skipPhase(host);
    for (const id of ids.slice(0, 5)) room.vote(id, id === ids[0] ? ids[1] : ids[0]);
    // Everyone who can act has voted: the vote ends early (timer set to 800 ms).
    expect(room.phaseEndsAt).not.toBeNull();
    expect(room['phaseTimer']).not.toBeNull();
  });

  it('close a game running far past its expected length', () => {
    const { room, host } = makeRoom({ players: 6 });
    room.start(host);
    const t = room.settings.timers;
    const expected = (room.game!.order.length * (t.poster + t.investigation + t.vote + t.payout) + 5) * 1000;
    const started = room['gameStartedAt'] as number;
    expect(room.tick(started + expected * 2 + 10 * MIN - 1000)).toBeNull();
    expect(room.tick(started + expected * 2 + 10 * MIN + 1000)).toMatch(/far longer/);
  });
});

describe('configuration', () => {
  it('reads the limits from the environment, ignoring nonsense', () => {
    const t = timeoutsFromEnv({ ROOM_LOBBY_IDLE_MIN: '15', ROOM_HOST_AFK_MIN: 'soon', ROOM_AWAY_AFTER_POSTERS: '1', ROOM_SWEEP_SECONDS: '5' });
    expect(t.lobbyIdleMs).toBe(15 * MIN);
    expect(t.hostAfkMs).toBe(DEFAULT_TIMEOUTS.hostAfkMs);
    expect(t.awayAfterPosters).toBe(1);
    expect(t.sweepMs).toBe(5000);
    expect(t.removeAfterPosters).toBe(3);
  });
});

// ---------------------------------------------------------------- over real connections

const FAST: Partial<RoomTimeouts> = { lobbyIdleMs: 300, lobbyIdleGraceMs: 300, emptyRoomMs: 300, sweepMs: 25 };
const NO_LIMITS = { events: { burst: 10_000, perSecond: 10_000 }, roomCreate: { burst: 10_000, perSecond: 10_000 }, roomCreateIp: { burst: 10_000, perSecond: 10_000 } };

describe('idle rooms over real connections', () => {
  it('an open tab that only reconnects and reports does not keep a lobby alive', async () => {
    const x = await startServer({ devMode: false, timeouts: FAST, limits: NO_LIMITS });
    cleanup = x.close;
    const c = await x.connect('Ada');
    const made = await x.call(c, 'room:create', { name: 'Ada' });
    expect(made.ok).toBe(true);
    // What a background tab sends by itself: analytics, How to Play status, a resume.
    for (let i = 0; i < 6; i++) {
      (c.emit as (e: string, p: unknown) => void)('analytics:visit', { page: 'room' });
      await x.call(c, 'room:resume', { code: made.code, token: made.token });
      await sleep(60);
    }
    expect(c.latest?.room.closing?.why).toBe('idle');
    for (let t = 0; t < 2000 && !c.inbox.some((m) => m.event === 'roomClosed'); t += 25) await sleep(25);
    expect(c.inbox.find((m) => m.event === 'roomClosed')?.payload).toEqual({ reason: expect.stringMatching(/went cold/) });
    expect(x.server.rooms.size).toBe(0);
  });

  it("an input event (or \"We're still here\") keeps it open", async () => {
    const x = await startServer({ devMode: false, timeouts: FAST, limits: NO_LIMITS });
    cleanup = x.close;
    const c = await x.connect('Ada');
    await x.call(c, 'room:create', { name: 'Ada' });
    for (let i = 0; i < 12; i++) {
      await x.call(c, i % 2 ? 'room:stillHere' : 'lobby:settings', ...(i % 2 ? [] : [{ posters: 10 }]));
      await sleep(80);
    }
    expect(x.server.rooms.size).toBe(1);
    expect(c.inbox.some((m) => m.event === 'roomClosed')).toBe(false);
  });
});

describe('cleanup', () => {
  it('creates and abandons hundreds of rooms without keeping any of them in memory', async () => {
    setFlagsFromString('--expose_gc');
    const gc = runInNewContext('gc') as () => void;
    const settle = async () => {
      for (let i = 0; i < 4; i++) {
        gc();
        await sleep(10);
      }
    };
    const x = await startServer({ devMode: false, timeouts: FAST, limits: NO_LIMITS });
    cleanup = x.close;
    const c = await x.connect('Ada');
    const timers = () => process.getActiveResourcesInfo().filter((r) => r === 'Timeout').length;

    const wave = async (n: number) => {
      const refs: WeakRef<Room>[] = [];
      for (let i = 0; i < n; i++) {
        // Each new room leaves the last one behind with a disconnected seat (a held seat timer).
        const r = await x.call(c, i % 2 ? 'room:create' : 'room:practice', { name: `Ada${i}`, visibility: i % 3 ? 'public' : 'private' });
        expect(r.ok).toBe(true);
        refs.push(new WeakRef(x.server.rooms.get(r.code)!));
      }
      await x.call(c, 'room:leave');
      for (let t = 0; t < 5000 && x.server.rooms.size > 0; t += 25) await sleep(25);
      return refs;
    };

    await settle();
    const timersBefore = timers();
    const first = await wave(150);
    expect(x.server.rooms.size).toBe(0);
    expect(x.server.directory.list()).toEqual([]);
    await settle();
    const heapAfterFirst = process.memoryUsage().heapUsed;
    expect(first.filter((r) => r.deref()).length).toBe(0); // every room garbage-collected

    for (let i = 0; i < 2; i++) await wave(150);
    await settle();
    const heapAfterMore = process.memoryUsage().heapUsed;
    expect(x.server.rooms.size).toBe(0);
    expect(timers()).toBeLessThanOrEqual(timersBefore + 2);
    // 300 more rooms later, the heap hasn't grown with them.
    expect((heapAfterMore - heapAfterFirst) / 2 ** 20).toBeLessThan(8);
  }, 60_000);
});
