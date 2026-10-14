import { randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage } from 'node:http';
import { Server, type Socket } from 'socket.io';
import {
  CLIENT_STEPS,
  REPORT_REASON_MAX,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  VISIT_PAGES,
  isBillboardSlot,
  parseSource,
  type Ack,
  type Announcement,
  type ClientStep,
  type VisitPage,
  type ClientToServerEvents,
  type JoinResult,
  type ServerToClientEvents,
} from '@wtc/shared';
import { Room, type FeedbackEntry, type FinishedGame, type Seat, type Spectator } from './room';
import type { GameSummary } from './game/summary';
import { secureRng, type Rng } from './rng';
import { DEFAULT_TIMEOUTS, type RoomTimeouts } from './timeouts';
import { reportError } from './errors';
import { LIMITS, RateLimiter, browserIdOf, clientIp, originAllowed } from './security';
import { anonId, countryOf, deviceOf, type AnalyticsEvent, type LobbyAction } from './analytics/events';
import { MemoryLobbyDirectory, type LobbyDirectory } from './lobby/directory';
import type { Store } from './store/types';
import { AccessVerifier, type AccessConfig } from './admin/access';
import { adminHandler, billboardHandler } from './admin/api';
import { AdminAuth, type AdminCredentials } from './admin/auth';
import { Control } from './admin/control';
import { Monitor } from './admin/monitor';

interface SocketData {
  code?: string;
  playerId?: string;
  ip: string;
  browserId: string | null;
  /** Connected by `pnpm playtest:check`: its games are marked so the stats leave them out. */
  check: boolean;
}

type IO = Server<ClientToServerEvents, ServerToClientEvents, {}, SocketData>;
type GameSocket = Socket<ClientToServerEvents, ServerToClientEvents, {}, SocketData>;

export interface GameServerOptions {
  port: number;
  /** Dev tools on (bots, phase skipping, small lobbies). Never in production. */
  devMode: boolean;
  minPlayers: number;
  /**
   * Origins allowed to connect. `true` = any (dev only). An array = exactly these. In
   * production with an empty array, only the server's own host may connect.
   */
  corsOrigin?: string[] | true | (() => string[]);
  /** Trust X-Forwarded-For / CF-Connecting-IP (only behind a proxy you control). */
  trustProxy?: boolean;
  rng?: Rng;
  onGameEnd?: (summary: GameSummary) => void;
  onFeedback?: (entry: FeedbackEntry) => void;
  /** Override limits (tests). */
  limits?: Partial<typeof LIMITS>;
  /** Where the Find a Lobby list lives (default: in memory). */
  lobbyDirectory?: LobbyDirectory;
  /** Analytics, feedback, the admin log and admin settings. Null/omitted: nothing is stored. */
  store?: Store | null;
  /** Admin dashboard login (`pnpm admin:setup`). Omitted: the admin API refuses everything. */
  admin?: { credentials?: AdminCredentials | null; access?: AccessConfig | null; accessVerifier?: AccessVerifier };
  monitor?: Monitor;
  /** Idle and AFK limits (default DEFAULT_TIMEOUTS; production reads them from the environment). */
  timeouts?: Partial<RoomTimeouts>;
}

/** Finished games (with their secrets) stay viewable by the admins this long, in memory only. */
const FINISHED_KEEP_MS = 3 * 3600_000;

/**
 * Events that count as a player doing something (idle rooms, AFK hosts and players). Never the
 * ones a page sends by itself: resume, analytics, How to Play reports, watching the lobby list.
 */
const INPUT_EVENTS = new Set([
  'chat:send', 'chat:quick', 'chat:mute', 'chat:report', 'feedback:send', 'room:stillHere',
  'lobby:setLook', 'lobby:settings', 'lobby:visibility', 'lobby:lock', 'lobby:autoFill', 'lobby:addBot', 'lobby:removeBot', 'lobby:fill', 'lobby:kick',
  'game:start', 'game:inspect', 'game:vote', 'game:backToLobby', 'buy:offer', 'buy:respond', 'buy:extraInspect', 'buy:worth', 'swap:color', 'trick:cover',
  // Dev builds only: pressing skip is deliberate (the How to Play capture skips whole posters).
  'dev:skipPhase',
]);
const fail = (error: string) => ({ ok: false as const, error });

export function createGameServer(opts: GameServerOptions) {
  const rng = opts.rng ?? secureRng;
  const L = { ...LIMITS, ...opts.limits };
  const T: RoomTimeouts = { ...DEFAULT_TIMEOUTS, ...opts.timeouts };
  const trustProxy = !!opts.trustProxy;
  const anyOrigin = opts.corsOrigin === true || (opts.corsOrigin === undefined && opts.devMode);
  // A function is re-read on every connection, so the list can change while rooms stay up
  // (a playtest tunnel gets a new URL each time it starts).
  const allowedOrigins = (): string[] => (typeof opts.corsOrigin === 'function' ? opts.corsOrigin() : Array.isArray(opts.corsOrigin) ? opts.corsOrigin : []);

  const store = opts.store ?? null;
  const monitor = opts.monitor ?? new Monitor();
  const control = new Control(store);
  const record = (e: AnalyticsEvent) => {
    store?.addEvent(e).catch((err) => console.error('analytics write failed', err instanceof Error ? err.message : 'unknown'));
  };
  const finished: FinishedGame[] = [];
  const keepFinished = (f: FinishedGame) => {
    finished.unshift(f);
    const cutoff = Date.now() - FINISHED_KEEP_MS;
    while (finished.length > 50 || (finished.length && Date.parse(finished[finished.length - 1].endedAt) < cutoff)) finished.pop();
  };

  // Plain HTTP serves only /health, replaced billboard images and the admin API (which checks
  // its own login). No files, no logs, nothing else.
  let admin: (ReturnType<typeof adminHandler> & { prune?: () => void }) | null = null;
  const billboards = billboardHandler({ store, control });
  const http = createServer((req, res) => {
    res.setHeader('x-content-type-options', 'nosniff');
    if (req.url === '/health') {
      res.writeHead(200, { 'content-type': 'text/plain' }).end('ok');
      return;
    }
    if (req.url?.startsWith('/admin/api/') && admin) return void admin(req, res);
    if (req.url?.startsWith('/billboards/')) return void billboards(req, res);
    res.writeHead(404).end();
  });

  const rate = {
    connect: new RateLimiter(L.connectPerIp.burst, L.connectPerIp.perSecond),
    connectBrowser: new RateLimiter(L.connectPerBrowser.burst, L.connectPerBrowser.perSecond),
    create: new RateLimiter(L.roomCreate.burst, L.roomCreate.perSecond),
    createIp: new RateLimiter(L.roomCreateIp.burst, L.roomCreateIp.perSecond),
    joinBrowser: new RateLimiter(L.joinPerBrowser.burst, L.joinPerBrowser.perSecond),
    joinIp: new RateLimiter(L.joinPerIp.burst, L.joinPerIp.perSecond),
    joinSocket: new RateLimiter(L.joinPerSocket.burst, L.joinPerSocket.perSecond),
    events: new RateLimiter(L.events.burst, L.events.perSecond),
    chat: new RateLimiter(L.chat.burst, L.chat.perSecond),
    offers: new RateLimiter(L.offers.burst, L.offers.perSecond),
    probe: new RateLimiter(L.colorProbe.burst, L.colorProbe.perSecond),
    lobbyWatch: new RateLimiter(L.lobbyWatch.burst, L.lobbyWatch.perSecond),
    lobbyWatchIp: new RateLimiter(L.lobbyWatchIp.burst, L.lobbyWatchIp.perSecond),
    lobbyJoin: new RateLimiter(L.lobbyJoin.burst, L.lobbyJoin.perSecond),
    lobbyJoinIp: new RateLimiter(L.lobbyJoinIp.burst, L.lobbyJoinIp.perSecond),
  };
  const socketsPerIp = new Map<string, number>();
  const socketsPerBrowser = new Map<string, number>();
  /**
   * Who a per-browser limit applies to: the browser's random id, or (for clients that send none,
   * which the game never does) their IP, so leaving the id out doesn't escape the limits.
   */
  const browserKey = (browserId: string | null, ip: string) => (browserId ? `b:${browserId}` : `ip:${ip}`);
  /** Takes from a per-browser bucket and the per-IP ceiling; both must allow it. */
  const both = (perBrowser: RateLimiter, perIp: RateLimiter, key: string, ip: string) => {
    // A refused take spends nothing and is counted for the Safety page.
    if (!perBrowser.peek(key)) return perBrowser.take(key);
    if (!perIp.peek(ip)) return perIp.take(ip);
    return perBrowser.take(key) && perIp.take(ip);
  };
  const count = (m: Map<string, number>, k: string, d: number) => {
    const n = (m.get(k) ?? 0) + d;
    if (n > 0) m.set(k, n);
    else m.delete(k);
  };
  // Rate-limit hits, counted per limit and saved once a minute (Safety page).
  const hits = new Map<string, number>();
  for (const [name, limiter] of Object.entries(rate)) {
    const take = limiter.take.bind(limiter);
    limiter.take = (key: string, now?: number) => take(key, now) || (hits.set(name, (hits.get(name) ?? 0) + 1), false);
  }

  const io: IO = new Server(http, {
    cors: { origin: anyOrigin ? true : (origin, cb) => cb(null, !!origin && allowedOrigins().includes(origin)) },
    // Game messages are tiny; anything bigger is junk or an attack.
    maxHttpBufferSize: L.maxPayloadBytes,
    // Who may open a connection at all: our own site (production), and not too often per IP.
    allowRequest: (req: IncomingMessage, cb) => {
      if (!anyOrigin && !originAllowed(req, { allowed: allowedOrigins(), requireHttps: !opts.devMode, trustProxy })) return cb('Origin not allowed', false);
      const ip = clientIp(req, trustProxy);
      if ((socketsPerIp.get(ip) ?? 0) >= L.maxSocketsPerIp) return cb('Too many connections', false);
      if (!rate.connect.take(ip)) return cb('Too many connections', false);
      cb(null, true);
    },
  });
  // Banned browsers (by anonymous id) can't connect at all.
  io.use((socket, next) => (control.isBanned(anonId(browserIdOf(socket.handshake.auth))) ? next(new Error('banned')) : next()));
  // Per-browser connection limits (the browser id comes with the handshake, after the IP check).
  io.use((socket, next) => {
    const key = browserKey(browserIdOf(socket.handshake.auth), clientIp(socket.request, trustProxy));
    if ((socketsPerBrowser.get(key) ?? 0) >= L.maxSocketsPerBrowser) return next(new Error('Too many connections'));
    if (!rate.connectBrowser.take(key)) return next(new Error('Too many connections'));
    next();
  });
  const rooms = new Map<string, Room>();

  const newCode = () => {
    for (;;) {
      let code = '';
      for (let i = 0; i < ROOM_CODE_LENGTH; i++) code += ROOM_CODE_ALPHABET[rng.int(ROOM_CODE_ALPHABET.length)];
      if (!rooms.has(code)) return code;
    }
  };
  const normCode = (v: unknown) => (typeof v === 'string' && v.length <= 16 ? v.toUpperCase().replace(/[^A-Z0-9]/g, '') : '');

  // Find a Lobby: rooms report their row here; watchers get the list live.
  const directory: LobbyDirectory = opts.lobbyDirectory ?? new MemoryLobbyDirectory();
  const LOBBY_ROOM = 'lobby-watchers';
  const lobbyUpdate = () => ({ rooms: directory.list(), online: io.engine.clientsCount });
  const pushLobby = () => {
    if (io.sockets.adapter.rooms.get(LOBBY_ROOM)?.size) io.to(LOBBY_ROOM).emit('lobby:list', lobbyUpdate());
  };
  directory.onChange(pushLobby);
  const syncListing = (code: string) => {
    const room = rooms.get(code);
    directory.set(code, room ? room.listing() : null);
  };
  const lobbyEvent = (action: LobbyAction, anon: string | null, check: boolean) => {
    if (!check) record({ at: new Date().toISOString(), type: 'lobby', anon, action });
  };

  /** Closes a room for good: players still in it are told why (if a reason is given), every
   *  timer stops, and it leaves the room list and Find a Lobby. */
  const closeRoom = (code: string, reason?: string) => {
    const room = rooms.get(code);
    if (!room) return;
    if (reason) room.close(reason);
    else room.dispose();
    rooms.delete(code);
    directory.set(code, null);
    monitor.noteClosed(reason ?? 'empty lobby');
  };

  const newRoom = (practice = false, check = false, lobby: { visibility?: 'public' | 'private'; roomName?: string; autoStart?: boolean } = {}) => {
    const code = newCode();
    const room = new Room(code, {
      ...lobby,
      onListingChange: () => syncListing(code),
      rng,
      onEvent: record,
      defaults: () => control.defaults,
      onFinished: keepFinished,
      practice,
      check,
      devMode: opts.devMode,
      minPlayers: opts.minPlayers,
      onGameEnd: opts.onGameEnd,
      onFeedback: opts.onFeedback,
      send: (socketId, event, ...args) => io.to(socketId).emit(event, ...args),
      onEmpty: () => closeRoom(code),
      timeouts: T,
      kick: (socketId, reason) => {
        const s = io.sockets.sockets.get(socketId);
        if (!s) return;
        s.data.code = undefined;
        s.data.playerId = undefined;
        if (reason) s.emit('roomClosed', { reason });
        else s.emit('kicked');
        s.disconnect(true);
      },
    });
    rooms.set(code, room);
    return room;
  };

  const sweep = setInterval(() => {
    const now = Date.now();
    for (const r of Object.values(rate)) r.prune(now);
    admin?.prune?.();
    // Once a minute: rate-limit hits, and how many people are online (peak concurrent players).
    const at = new Date(now).toISOString();
    for (const [limit, count] of hits) record({ at, type: 'safety', kind: 'rate_limit', by: 'server', anon: null, limit, count });
    hits.clear();
    const sockets = io.engine.clientsCount;
    if (sockets || lastSampleNonZero) record({ at, type: 'concurrency', anon: null, players: seatedPlayers(), sockets, rooms: rooms.size, publicWaiting: directory.list().length });
    // The online count moves as people come and go: refresh watchers now and then.
    pushLobby();
    lastSampleNonZero = sockets > 0;
  }, 60_000);
  let lastSampleNonZero = false;
  // Idle rooms, AFK hosts and players, hard limits (timeouts.ts).
  const roomSweep = setInterval(() => {
    const now = Date.now();
    for (const [code, room] of [...rooms]) {
      const reason = room.tick(now);
      if (reason) closeRoom(code, reason);
    }
  }, T.sweepMs);
  // Leak watch for the admin Live page: rooms, players and memory once a minute.
  const history = setInterval(() => monitor.record({ rooms: rooms.size, players: seatedPlayers() }), 60_000);
  monitor.record({ rooms: 0, players: 0 });
  const cpuSampler = setInterval(() => monitor.sample(), 5_000);
  const seatedPlayers = () => [...rooms.values()].reduce((n, r) => n + r.humans().filter((s) => s.connected).length, 0);

  const announce = (text: string): Announcement => {
    const a = { id: randomBytes(6).toString('base64url'), text, at: Date.now() };
    io.emit('announcement', a);
    return a;
  };
  const pushStatus = () => io.emit('status', control.status());
  const adminCloseRoom = (code: string, reason: string) => {
    const room = rooms.get(code);
    if (!room) return false;
    const ids = room.socketIds();
    room.close(reason);
    rooms.delete(code);
    for (const id of ids) {
      const s = io.sockets.sockets.get(id);
      if (s) {
        s.data.code = undefined;
        s.data.playerId = undefined;
      }
    }
    return true;
  };
  const dropBanned = (anon: string) => {
    let n = 0;
    for (const s of io.sockets.sockets.values()) {
      if (anonId(s.data.browserId) !== anon) continue;
      s.emit('banned');
      s.disconnect(true);
      n++;
    }
    return n;
  };
  const creds = opts.admin?.credentials ?? null;
  const access = opts.admin?.accessVerifier ?? (opts.admin?.access ? new AccessVerifier(opts.admin.access) : null);
  const auth = creds ? new AdminAuth(creds) : null;
  const adminFn = adminHandler({
    store,
    control,
    monitor,
    auth,
    access,
    trustProxy,
    rooms,
    finished: () => finished,
    online: () => ({ sockets: io.engine.clientsCount, players: seatedPlayers() }),
    closeRoom: adminCloseRoom,
    announce,
    pushStatus,
    dropBanned,
  });
  admin = Object.assign(adminFn, { prune: () => auth?.prune() });

  io.on('connection', (socket: GameSocket) => {
    const ip = clientIp(socket.request, trustProxy);
    socket.data = { ip, browserId: browserIdOf(socket.handshake.auth), check: (socket.handshake.auth as { purpose?: unknown } | null)?.purpose === 'check' };
    const who = browserKey(socket.data.browserId, ip);
    count(socketsPerIp, ip, 1);
    count(socketsPerBrowser, who, 1);
    const anon = anonId(socket.data.browserId);
    socket.emit('status', control.status());

    const current = (): { room: Room; seat: Seat } | null => {
      const room = socket.data.code ? rooms.get(socket.data.code) : undefined;
      const seat = room && socket.data.playerId ? room.seats.get(socket.data.playerId) : undefined;
      return room && seat && seat.socketId === socket.id ? { room, seat } : null;
    };
    const detach = () => {
      const c = current();
      if (c) c.room.disconnect(c.seat.id, socket.id);
      // Watching a game: the watcher's place is held for a while, like a seat.
      const watching = !c && socket.data.code && socket.data.playerId ? rooms.get(socket.data.code) : undefined;
      if (watching && socket.data.playerId) watching.disconnectSpectator(socket.data.playerId, socket.id);
      socket.data.code = undefined;
      socket.data.playerId = undefined;
    };
    // The session token goes only to its owner, in this reply. It's never logged.
    const bind = (room: Room, seat: Seat): Ack<JoinResult> => {
      socket.data.code = room.code;
      socket.data.playerId = seat.id;
      return { ok: true, code: room.code, playerId: seat.id, token: seat.token };
    };
    /** Joined mid-game: bound as a watcher (no seat, so every game intent fails with "Not in a room"). */
    const bindSpectator = (room: Room, sp: Spectator): Ack<JoinResult> => {
      socket.data.code = room.code;
      socket.data.playerId = sp.id;
      return { ok: true, code: room.code, playerId: sp.id, token: sp.token, spectating: true };
    };

    /**
     * Every event goes through here: a per-connection rate limit, then the handler, with any
     * thrown error turned into a generic reply (details stay in the server log, without payloads).
     */
    const handle =
      <A extends unknown[]>(fn: (...args: A) => void) =>
      (...args: A) => {
        const ack = args[args.length - 1];
        const reply = (res: Ack) => typeof ack === 'function' && (ack as (r: Ack) => void)(res);
        if (!rate.events.take(socket.id)) return reply(fail('Slow down'));
        try {
          fn(...args);
        } catch (err) {
          console.error('handler error', err instanceof Error ? err.message : 'unknown');
          reportError(err, 'socket handler');
          reply(fail('Server error'));
        }
      };
    const withSeat = <T>(ack: unknown, fn: (c: { room: Room; seat: Seat }) => Ack<T>) => {
      if (typeof ack !== 'function') return;
      const c = current();
      ack(c ? fn(c) : fail('Not in a room'));
    };
    const obj = (p: unknown): Record<string, unknown> => (p && typeof p === 'object' && !Array.isArray(p) ? (p as Record<string, unknown>) : {});
    /** Join and resume share one budget, spent only by failures: what a code-guessing script burns. */
    const joinBudget = () => rate.joinBrowser.peek(who) && rate.joinIp.peek(ip) && rate.joinSocket.peek(socket.id);
    const joinFailed = <T extends Ack<JoinResult>>(res: T): T => {
      if (!res.ok) {
        rate.joinBrowser.take(who);
        rate.joinIp.take(ip);
        rate.joinSocket.take(socket.id);
      }
      return res;
    };

    const createRoom = (practice: boolean, p: unknown, ack: (r: Ack<JoinResult>) => void) => {
      if (control.maintenance.on) return ack(fail(control.maintenance.message));
      if (!both(rate.create, rate.createIp, who, ip)) return ack(fail('Too many new rooms. Wait a minute.'));
      if (rooms.size >= L.maxRooms) return ack(fail('The town is full right now. Try again soon.'));
      detach();
      const visibility = !practice && obj(p).visibility === 'public' ? 'public' : 'private';
      // Quick-start lobbies are public ones made by a portal's one-tap Play (see Room.autoStart).
      const autoStart = !practice && visibility === 'public' && obj(p).autoStart === true;
      const room = newRoom(practice, socket.data.check, { visibility, roomName: obj(p).roomName as string, autoStart });
      const res = room.addPlayer(obj(p).name as string, socket.id, false, socket.data.browserId);
      if (!res.ok) {
        closeRoom(room.code);
        return ack(res);
      }
      if (practice) {
        const started = room.startPractice(res.seat.id);
        if (!started.ok) {
          closeRoom(room.code);
          return ack(started);
        }
      }
      if (!practice) lobbyEvent(visibility === 'public' ? 'create_public' : 'create_private', anon, socket.data.check);
      ack(bind(room, res.seat));
    };

    socket.on('room:create', handle((p, ack) => typeof ack === 'function' && createRoom(false, p, ack)));

    // Find a Lobby: the list now, then live updates while watching.
    socket.on('lobby:watch', handle((ack) => {
      if (typeof ack !== 'function') return;
      if (!both(rate.lobbyWatch, rate.lobbyWatchIp, who, ip)) return ack(fail('Slow down'));
      socket.join(LOBBY_ROOM);
      ack({ ok: true, ...lobbyUpdate() });
    }));
    socket.on('lobby:unwatch', handle(() => void socket.leave(LOBBY_ROOM)));

    /** Joins a listed room by its list id; fails if it isn't listed any more (filled, locked, started). */
    const joinListed = (listingId: unknown, name: unknown) => {
      const code = typeof listingId === 'string' ? directory.roomFor(listingId) : null;
      const room = code ? rooms.get(code) : undefined;
      if (!room || !room.listing()) return fail('That campfire is gone. Pick another.');
      detach();
      const res = room.addPlayer(name as string, socket.id, false, socket.data.browserId);
      return res.ok ? bind(room, res.seat) : res;
    };
    socket.on('room:joinListed', handle((p, ack) => {
      if (typeof ack !== 'function') return;
      if (!both(rate.lobbyJoin, rate.lobbyJoinIp, who, ip)) return ack(fail('Slow down'));
      const res = joinListed(obj(p).id, obj(p).name);
      if (res.ok) lobbyEvent('list_join', anon, socket.data.check);
      ack(res);
    }));
    // Quick Play: the fullest public room still waiting that will have us; otherwise a new public room.
    socket.on('room:quickPlay', handle((p, ack) => {
      if (typeof ack !== 'function') return;
      if (!both(rate.lobbyJoin, rate.lobbyJoinIp, who, ip)) return ack(fail('Slow down'));
      // A portal's one-tap Play only joins quick-start lobbies (they start by themselves).
      const autoStart = obj(p).autoStart === true;
      for (const row of directory.list().filter((r) => !autoStart || r.autoStart)) {
        const res = joinListed(row.id, obj(p).name);
        if (res.ok) {
          lobbyEvent('quick_join', anon, socket.data.check);
          return ack({ ...res, created: false });
        }
        // A bad name fails everywhere; don't try every room.
        if (res.error === 'Enter a name') return ack(res);
      }
      createRoom(false, { name: obj(p).name, visibility: 'public', autoStart }, (res) => {
        if (res.ok) lobbyEvent('quick_create', anon, socket.data.check);
        ack(res.ok ? { ...res, created: true } : res);
      });
    }));
    socket.on('room:practice', handle((p, ack) => typeof ack === 'function' && createRoom(true, p, ack)));

    socket.on('room:join', handle((p, ack) => {
      if (typeof ack !== 'function') return;
      if (!joinBudget()) return ack(fail('Too many tries. Wait a minute.'));
      const room = rooms.get(normCode(obj(p).code));
      if (!room) return ack(joinFailed(fail('No room with that code')));
      detach();
      // A game is on: watch it, and take a seat when the room goes back to the lobby.
      if (room.phase !== 'lobby') {
        const watch = room.addSpectator(obj(p).name as string, socket.id, socket.data.browserId);
        return ack(watch.ok ? bindSpectator(room, watch.spectator) : joinFailed(watch));
      }
      const res = room.addPlayer(obj(p).name as string, socket.id, false, socket.data.browserId);
      if (res.ok) lobbyEvent('code_join', anon, socket.data.check);
      ack(res.ok ? bind(room, res.seat) : joinFailed(res));
    }));

    socket.on('room:resume', handle((p, ack) => {
      if (typeof ack !== 'function') return;
      if (!joinBudget()) return ack(fail('Too many tries. Wait a minute.'));
      const { code, token } = obj(p);
      const room = rooms.get(normCode(code));
      if (!room || typeof token !== 'string') return ack(joinFailed(fail('Session expired')));
      const prev = room.seatByToken(token)?.socketId ?? room.spectatorByToken(token)?.socketId;
      detach();
      const seat = room.resume(token, socket.id);
      if (!seat) {
        const sp = room.resumeSpectator(token, socket.id);
        if (!sp) return ack(joinFailed(fail('Session expired')));
        if (prev && prev !== socket.id) io.sockets.sockets.get(prev)?.disconnect(true);
        return ack(bindSpectator(room, sp));
      }
      // Same seat opened elsewhere: the newest connection wins.
      if (prev && prev !== socket.id) io.sockets.sockets.get(prev)?.disconnect(true);
      ack(bind(room, seat));
    }));

    // Activity: only deliberate input counts (an open or background tab sends none of these).
    socket.use(([event], next) => {
      if (INPUT_EVENTS.has(event)) {
        const c = current();
        c?.room.noteInput(c.seat.id);
      }
      next();
    });
    // "We're still here": the input itself is what keeps the room open (noted just above).
    socket.on('room:stillHere', handle((ack) => withSeat(ack, () => ({ ok: true }))));

    socket.on('room:leave', handle(() => {
      const c = current();
      if (c) c.room.leave(c.seat.id);
      else if (socket.data.code && socket.data.playerId) rooms.get(socket.data.code)?.leaveSpectator(socket.data.playerId);
      socket.data.code = undefined;
      socket.data.playerId = undefined;
    }));

    socket.on('lobby:colors', handle((ack) =>
      withSeat(ack, ({ room, seat }) => (rate.probe.take(socket.id) ? room.lobbyColors(seat.id) : fail('Slow down'))),
    ));
    socket.on('lobby:setLook', handle((p, ack) =>
      withSeat(ack, ({ room, seat }) => {
        // Picking a color is also a probe (a taken color is refused), so it shares that budget.
        if (obj(p).color !== undefined && !rate.probe.take(socket.id)) return fail('Slow down');
        return room.setLook(seat.id, obj(p));
      }),
    ));
    socket.on('lobby:settings', handle((p, ack) => withSeat(ack, ({ room, seat }) => room.updateSettings(seat.id, obj(p)))));
    socket.on('lobby:addBot', handle((ack) => withSeat(ack, ({ room, seat }) => room.addBot(seat.id))));
    socket.on('lobby:removeBot', handle((p, ack) => withSeat(ack, ({ room, seat }) => room.removeBot(seat.id, obj(p).playerId as string))));
    socket.on('lobby:kick', handle((p, ack) => withSeat(ack, ({ room, seat }) => room.kick(seat.id, obj(p).playerId))));
    socket.on('lobby:lock', handle((p, ack) => withSeat(ack, ({ room, seat }) => room.setLocked(seat.id, obj(p).locked))));
    socket.on('lobby:visibility', handle((p, ack) => withSeat(ack, ({ room, seat }) => room.setVisibility(seat.id, obj(p).visibility))));
    socket.on('lobby:autoFill', handle((p, ack) => withSeat(ack, ({ room, seat }) => room.setAutoFill(seat.id, obj(p)))));
    socket.on('lobby:fill', handle((ack) => withSeat(ack, ({ room, seat }) => room.fillWithBots(seat.id))));
    socket.on('game:start', handle((ack) => withSeat(ack, ({ room, seat }) => room.start(seat.id))));
    socket.on('game:inspect', handle((p, ack) => withSeat(ack, ({ room, seat }) => room.inspect(seat.id, obj(p).targetId as string))));
    socket.on('game:vote', handle((p, ack) => withSeat(ack, ({ room, seat }) => room.vote(seat.id, obj(p).targetId as string))));
    socket.on('buy:offer', handle((p, ack) =>
      withSeat(ack, ({ room, seat }) => (rate.offers.take(socket.id) ? room.offer(seat.id, obj(p).entryId) : fail('Slow down'))),
    ));
    socket.on('buy:respond', handle((p, ack) =>
      withSeat(ack, ({ room, seat }) => room.respondOffer(seat.id, obj(p).offerId, obj(p).accept)),
    ));
    socket.on('buy:extraInspect', handle((ack) => withSeat(ack, ({ room, seat }) => room.buyExtraInspect(seat.id))));
    socket.on('swap:color', handle((ack) => withSeat(ack, ({ room, seat }) => room.swapColor(seat.id))));
    socket.on('trick:cover', handle((ack) => withSeat(ack, ({ room, seat }) => room.coverTracks(seat.id))));
    socket.on('buy:worth', handle((ack) => withSeat(ack, ({ room, seat }) => room.buyWorth(seat.id))));
    socket.on('game:backToLobby', handle((ack) => withSeat(ack, ({ room, seat }) => room.backToLobby(seat.id))));
    socket.on('chat:send', handle((p, ack) =>
      withSeat(ack, ({ room, seat }) => (rate.chat.take(socket.id) ? room.sendChat(seat.id, obj(p).text) : fail('Slow down'))),
    ));
    socket.on('chat:quick', handle((p, ack) =>
      withSeat(ack, ({ room, seat }) => (rate.chat.take(socket.id) ? room.sendQuickChat(seat.id, p) : fail('Slow down'))),
    ));
    socket.on('client:tutorial', handle((p, ack) => withSeat(ack, ({ room, seat }) => room.setTutorial(seat.id, obj(p).progress))));
    socket.on('client:howto', handle((p, ack) => withSeat(ack, ({ room, seat }) => room.setHowto(seat.id, obj(p).status))));
    socket.on('feedback:send', handle((p, ack) => withSeat(ack, ({ room, seat }) => room.submitFeedback(seat.id, p))));
    socket.on('chat:report', handle((p, ack) =>
      withSeat(ack, ({ room, seat }) => room.reportChat(seat.id, obj(p).messageId, typeof obj(p).reason === 'string' ? (obj(p).reason as string).slice(0, REPORT_REASON_MAX * 2) : '')),
    ));
    const muted = new Set<string>();
    socket.on('chat:mute', handle((p, ack) =>
      withSeat(ack, ({ room, seat }) => {
        const target = typeof obj(p).playerId === 'string' ? (obj(p).playerId as string) : '';
        if (!room.seats.has(target) || target === seat.id) return fail('Unknown player');
        if (!muted.has(target) && !socket.data.check && !room.practice) {
          record({ at: new Date().toISOString(), type: 'safety', kind: 'mute', by: 'player', anon, target: room.anonOf(target) });
        }
        muted.add(target);
        return { ok: true };
      }),
    ));

    // Anonymous analytics from the browser, each counted once per connection.
    const seen = new Set<string>();
    const once = (key: string) => (seen.has(key) || seen.size > 40 ? false : (seen.add(key), true));
    const ok = (ack: unknown) => typeof ack === 'function' && ack({ ok: true });
    socket.on('analytics:visit', handle((p, ack) => {
      const page = obj(p).page as VisitPage;
      if (!VISIT_PAGES.includes(page)) return typeof ack === 'function' && ack(fail('Unknown page'));
      if (once(`visit:${page}`) && !socket.data.check) {
        const src = parseSource(obj(p).src);
        record({ at: new Date().toISOString(), type: 'visit', anon, page, src, device: deviceOf(socket.request.headers), country: countryOf(socket.request.headers, trustProxy) });
      }
      ok(ack);
    }));
    socket.on('analytics:step', handle((p, ack) => {
      const step = obj(p).step as ClientStep;
      if (!CLIENT_STEPS.includes(step)) return typeof ack === 'function' && ack(fail('Unknown step'));
      if (once(`step:${step}`) && !socket.data.check) record({ at: new Date().toISOString(), type: 'step', anon, step });
      ok(ack);
    }));
    socket.on('analytics:billboard', handle((p, ack) => {
      const slot = obj(p).slot;
      if (!isBillboardSlot(slot)) return typeof ack === 'function' && ack(fail('Unknown slot'));
      if (once(`billboard:${slot}`) && !socket.data.check) record({ at: new Date().toISOString(), type: 'billboard', anon, slot });
      ok(ack);
    }));

    // Dev tool. Production servers refuse it outright (and the room checks again).
    socket.on('dev:skipPhase', handle((ack) => {
      if (!opts.devMode) return typeof ack === 'function' && ack(fail('Not available'));
      withSeat(ack, ({ room, seat }) => room.skipPhase(seat.id));
    }));

    socket.on('disconnect', () => {
      detach();
      count(socketsPerIp, ip, -1);
      count(socketsPerBrowser, who, -1);
    });
  });

  return {
    io,
    rooms,
    directory,
    control,
    monitor,
    listen: async () => {
      await control.load();
      return new Promise<number>((resolve) => http.listen(opts.port, () => resolve((http.address() as { port: number }).port)));
    },
    close: async () => {
      clearInterval(sweep);
      clearInterval(roomSweep);
      clearInterval(history);
      clearInterval(cpuSampler);
      for (const room of rooms.values()) room.dispose();
      await io.close();
    },
  };
}
