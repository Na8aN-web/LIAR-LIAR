import { afterEach, describe, expect, it, vi } from 'vitest';
import { AUTO_START_SEC, COLOR_IDS, MAX_PLAYERS, NAME_MAX, parseQuickChat, quickChatText, type ChatMessage, type PlayerView } from '@wtc/shared';
import { Room } from '../src/room';
import { secureRng } from '../src/rng';
import { sleep, startServer, until, type Client } from './helpers/net';

// Rooms for game portals (CrazyGames) and everyone: watching a game you joined mid-way,
// quick-start lobbies that fill with bots and start by themselves (people take bots' seats),
// quick chat (no typed text), and 20-character names.

let cleanup: (() => Promise<void>) | null = null;
let rooms: Room[] = [];
afterEach(async () => {
  for (const r of rooms) r.dispose();
  rooms = [];
  await cleanup?.();
  cleanup = null;
  vi.useRealTimers();
});

const NO_LIMITS = { events: { burst: 1000, perSecond: 1000 }, colorProbe: { burst: 1000, perSecond: 1000 }, roomCreate: { burst: 100, perSecond: 100 } };

function makeRoom(o: { autoStart?: boolean; visibility?: 'public' | 'private'; minPlayers?: number } = {}) {
  const sent: { socketId: string; event: string; payload: unknown }[] = [];
  const room = new Room('PORT1', {
    send: (socketId, event, ...args) => sent.push({ socketId, event, payload: args[0] }),
    rng: secureRng,
    devMode: true,
    minPlayers: o.minPlayers ?? 6,
    visibility: o.visibility ?? 'public',
    autoStart: o.autoStart,
  });
  rooms.push(room);
  return { room, sent };
}

describe('joining while a game is on: watch, then play the next game', () => {
  it('watchers see only what every player sees, can’t act, and get a seat back in the lobby', async () => {
    const t = await startServer({ limits: NO_LIMITS, devMode: true, minPlayers: 2 });
    cleanup = t.close;
    const host = await t.connect('host');
    const made = await t.call(host, 'room:create', { name: 'Ada' });
    expect(made.ok).toBe(true);
    for (let i = 0; i < 4; i++) await t.call(host, 'lobby:addBot');
    await t.call(host, 'lobby:settings', { posters: 3 });
    expect((await t.call(host, 'game:start')).ok).toBe(true);
    await until(host, (v) => v.phase === 'poster');

    const late: Client = await t.connect('late');
    const join = await t.call(late, 'room:join', { code: made.code, name: 'Latecomer' });
    expect(join).toMatchObject({ ok: true, spectating: true });
    const v = await until(late, (x) => x.spectating && !!x.game);
    expect(v.players.map((p) => p.name)).not.toContain('Latecomer');
    expect(v.spectators.map((s) => s.name)).toEqual(['Latecomer']);
    expect(v.game).toMatchObject({ youAreWanted: false, myResults: {}, boughtEntryIds: [], offersOut: [], offersIn: [], myVote: null, myScore: 0, myRounds: [], myColorHistory: [], myWorth: null });
    // Everyone in the room sees who's watching.
    await until(host, (x) => x.spectators.length === 1);

    // Watching isn't playing: every game intent is refused.
    const target = v.players[1].id;
    expect(await t.call(late, 'game:inspect', { targetId: target })).toMatchObject({ ok: false });
    expect(await t.call(late, 'game:vote', { targetId: target })).toMatchObject({ ok: false });
    expect(await t.call(late, 'chat:send', { text: 'hello' })).toMatchObject({ ok: false });
    expect(await t.call(late, 'chat:quick', { kind: 'clear' })).toMatchObject({ ok: false });
    // ...but they see the chat.
    await t.call(host, 'chat:send', { text: 'Howdy' });
    await sleep(100);
    expect(late.inbox.some((m) => m.event === 'chat' && (m.payload as ChatMessage).text === 'Howdy')).toBe(true);

    // Play the game out (host skips phases), go back to the lobby: the watcher is seated.
    for (let i = 0; i < 40 && host.latest!.phase !== 'ended'; i++) {
      await t.call(host, 'dev:skipPhase');
      await sleep(30);
    }
    await until(host, (x) => x.phase === 'ended');
    // Nothing secret reached the watcher before the end: the only colors they saw were posters.
    const posters = new Set<string>();
    for (const m of late.inbox) if (m.event === 'view' && (m.payload as PlayerView).game) posters.add((m.payload as PlayerView).game!.posterColor);
    const beforeEnd = late.inbox.filter((m) => !(m.event === 'view' && (m.payload as PlayerView).phase === 'ended'));
    const raw = JSON.stringify(beforeEnd.map((m) => (m.event === 'view' ? { ...(m.payload as PlayerView), you: null, settings: null } : m.payload)));
    for (const c of COLOR_IDS) if (!posters.has(c)) expect(raw.includes(`"${c}"`), `watcher saw "${c}"`).toBe(false);

    expect((await t.call(host, 'game:backToLobby')).ok).toBe(true);
    const seated = await until(late, (x) => x.phase === 'lobby' && !x.spectating);
    expect(seated.players.map((p) => p.name)).toContain('Latecomer');
    expect(seated.you.id).toBe(join.playerId);
    expect(seated.spectators).toEqual([]);
  });

  it('a watcher who reloads gets back in with their session; leaving frees their place', async () => {
    const t = await startServer({ limits: NO_LIMITS, devMode: true, minPlayers: 2 });
    cleanup = t.close;
    const host = await t.connect('host');
    const made = await t.call(host, 'room:create', { name: 'Ada' });
    await t.call(host, 'lobby:addBot');
    await t.call(host, 'game:start');
    const late = await t.connect('late');
    const join = await t.call(late, 'room:join', { code: made.code, name: 'Bo' });
    late.disconnect();
    const again = await t.connect('again', { browserId: late.browserId });
    expect(await t.call(again, 'room:resume', { code: made.code, token: join.token })).toMatchObject({ ok: true, spectating: true, playerId: join.playerId });
    await until(again, (x) => x.spectating);
    again.emit('room:leave');
    await until(host, (x) => x.spectators.length === 0);
  });

  it('a locked room or a practice game can’t be watched', () => {
    const { room } = makeRoom({ minPlayers: 2 });
    const a = room.addPlayer('Ada', 'sa');
    if (!a.ok) throw new Error(a.error);
    room.addBot(a.seat.id);
    room.start(a.seat.id);
    room.setLocked(a.seat.id, true);
    expect(room.addSpectator('Bo', 'sb')).toMatchObject({ ok: false, error: 'This room is locked' });
  });
});

describe('quick-start lobbies (a portal’s one-tap Play)', () => {
  it('fill the empty seats with bots and start by themselves', () => {
    vi.useFakeTimers();
    const { room } = makeRoom({ autoStart: true });
    expect(room.autoStartAt).toBe(Date.now() + AUTO_START_SEC * 1000);
    const a = room.addPlayer('Ada', 'sa');
    expect(a.ok).toBe(true);
    vi.advanceTimersByTime(AUTO_START_SEC * 1000 - 1);
    expect(room.phase).toBe('lobby');
    vi.advanceTimersByTime(1);
    expect(room.phase).toBe('poster');
    expect(room.seats.size).toBe(6);
    expect(room.humans().length).toBe(1);
    expect(room.autoStartAt).toBeNull();
  });

  it('people who join take bots’ seats', () => {
    const { room } = makeRoom({ autoStart: true });
    const a = room.addPlayer('Ada', 'sa');
    if (!a.ok) throw new Error(a.error);
    room.fillWithBots(a.seat.id);
    expect(room.seats.size).toBe(6);
    expect(room.addPlayer('Bo', 'sb').ok).toBe(true);
    expect(room.seats.size).toBe(6);
    expect(room.humans().length).toBe(2);
  });

  it('ordinary rooms keep their bots and never start by themselves', () => {
    vi.useFakeTimers();
    const { room } = makeRoom();
    const a = room.addPlayer('Ada', 'sa');
    if (!a.ok) throw new Error(a.error);
    room.fillWithBots(a.seat.id);
    room.addPlayer('Bo', 'sb');
    expect(room.seats.size).toBe(7);
    expect(room.autoStartAt).toBeNull();
    vi.advanceTimersByTime(10 * 60_000);
    expect(room.phase).toBe('lobby');
  });

  it('start again by themselves after "play again"', () => {
    vi.useFakeTimers();
    const { room } = makeRoom({ autoStart: true, minPlayers: 2 });
    const a = room.addPlayer('Ada', 'sa');
    if (!a.ok) throw new Error(a.error);
    vi.advanceTimersByTime(AUTO_START_SEC * 1000);
    expect(room.phase).toBe('poster');
    expect(room.listing()).toBeNull();
    for (let i = 0; i < 100 && room.phase !== 'ended'; i++) room.skipPhase(a.seat.id);
    expect(room.phase).toBe('ended');
    expect(room.backToLobby(a.seat.id).ok).toBe(true);
    expect(room.autoStartAt).toBe(Date.now() + AUTO_START_SEC * 1000);
    vi.advanceTimersByTime(AUTO_START_SEC * 1000);
    expect(room.phase).toBe('poster');
  });

  it('Quick Play with autoStart joins only quick-start lobbies', async () => {
    const t = await startServer({ limits: NO_LIMITS, devMode: false, minPlayers: 6 });
    cleanup = t.close;
    const site = await t.connect('site');
    await t.call(site, 'room:create', { name: 'Ada', visibility: 'public' });
    const cg = await t.connect('cg');
    const res = await t.call(cg, 'room:quickPlay', { name: 'Bo', autoStart: true });
    expect(res).toMatchObject({ ok: true, created: true });
    const v = await until(cg, (x) => x.room.autoStartAt !== null);
    expect(v.players.map((p) => p.name)).toEqual(['Bo']);
    // A website player's Quick Play may land in it (it's public); another portal player does.
    const cg2 = await t.connect('cg2');
    expect(await t.call(cg2, 'room:quickPlay', { name: 'Cy', autoStart: true })).toMatchObject({ ok: true, created: false, code: res.code });
  });
});

describe('quick chat', () => {
  const ids = ['p1', 'p2'];
  const name = (id: string) => ({ p1: 'Ada', p2: 'Hank' })[id] ?? '?';

  it('builds the text from a fixed list, with exactly the player and color each phrase needs', () => {
    const say = (raw: unknown, from = 'p1') => {
      const q = parseQuickChat(raw, ids);
      return q ? quickChatText(q, from, name) : null;
    };
    expect(say({ kind: 'clear' })).toBe("I'm clear.");
    expect(say({ kind: 'notMe' })).toBe('Not me!');
    expect(say({ kind: 'accuse', player: 'p2' })).toBe("It's Hank!");
    expect(say({ kind: 'claimColor', player: 'p2', color: 'red' })).toBe('Hank is Red.');
    expect(say({ kind: 'claimColor', player: 'p1', color: 'teal' })).toBe("I'm Teal.");
    expect(say({ kind: 'searched', player: 'p2' })).toBe('I searched Hank.');
    expect(say({ kind: 'trustMe' })).toBe('Trust me.');
    expect(say({ kind: 'liar' })).toBe('Liar!');
    expect(say({ kind: 'liar', player: 'p2' })).toBe('Hank is lying!');
    // Wrong shapes are refused.
    expect(parseQuickChat({ kind: 'accuse' }, ids)).toBeNull();
    expect(parseQuickChat({ kind: 'accuse', player: 'nobody' }, ids)).toBeNull();
    expect(parseQuickChat({ kind: 'clear', player: 'p2' }, ids)).toBeNull();
    expect(parseQuickChat({ kind: 'claimColor', player: 'p2' }, ids)).toBeNull();
    expect(parseQuickChat({ kind: 'claimColor', player: 'p2', color: 'chartreuse' }, ids)).toBeNull();
    expect(parseQuickChat({ kind: 'shout', text: 'anything' }, ids)).toBeNull();
    expect(parseQuickChat('I am clear', ids)).toBeNull();
  });

  it('never carries typed text: extra fields are dropped and the message is marked quick', () => {
    const { room, sent } = makeRoom({ minPlayers: 2 });
    const a = room.addPlayer('Ada', 'sa');
    const b = room.addPlayer('Hank', 'sb');
    if (!a.ok || !b.ok) throw new Error('join');
    expect(room.sendQuickChat(a.seat.id, { kind: 'accuse', player: b.seat.id, text: 'something rude' }).ok).toBe(true);
    const msg = sent.find((m) => m.event === 'chat')!.payload as ChatMessage;
    expect(msg).toMatchObject({ text: "It's Hank!", quick: true, name: 'Ada' });
    expect(room.sendChat(b.seat.id, 'typed').ok).toBe(true);
    expect((sent.filter((m) => m.event === 'chat').at(-1)!.payload as ChatMessage).quick).toBe(false);
  });
});

describe('names', () => {
  it('keep 20 characters (every CrazyGames username fits)', () => {
    expect(NAME_MAX).toBe(20);
    const { room } = makeRoom({ minPlayers: 2 });
    const long = 'Abcdefghij_klmnop.qr';
    const a = room.addPlayer(long, 'sa');
    expect(a.ok && a.seat.name).toBe(long);
    const b = room.addPlayer(long, 'sb');
    expect(b.ok && b.seat.name.length).toBeLessThanOrEqual(NAME_MAX);
    expect(MAX_PLAYERS).toBe(15);
  });
});
