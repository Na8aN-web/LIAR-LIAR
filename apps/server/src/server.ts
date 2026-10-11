import { createServer, type IncomingMessage } from 'node:http';
import { Server, type Socket } from 'socket.io';
import {
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  type Ack,
  type ClientToServerEvents,
  type JoinResult,
  type ServerToClientEvents,
} from '@wtc/shared';
import { Room, type FeedbackEntry, type Seat } from './room';
import type { GameSummary } from './game/summary';
import { secureRng, type Rng } from './rng';
import { LIMITS, RateLimiter, browserIdOf, clientIp, originAllowed } from './security';

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
}

const ROOM_IDLE_MS = 10 * 60_000;
const fail = (error: string) => ({ ok: false as const, error });

export function createGameServer(opts: GameServerOptions) {
  const rng = opts.rng ?? secureRng;
  const L = { ...LIMITS, ...opts.limits };
  const trustProxy = !!opts.trustProxy;
  const anyOrigin = opts.corsOrigin === true || (opts.corsOrigin === undefined && opts.devMode);
  // A function is re-read on every connection, so the list can change while rooms stay up
  // (a playtest tunnel gets a new URL each time it starts).
  const allowedOrigins = (): string[] => (typeof opts.corsOrigin === 'function' ? opts.corsOrigin() : Array.isArray(opts.corsOrigin) ? opts.corsOrigin : []);

  // Only /health is served over plain HTTP: no files, no logs, nothing else.
  const http = createServer((req, res) => {
    res.setHeader('x-content-type-options', 'nosniff');
    if (req.url === '/health') {
      res.writeHead(200, { 'content-type': 'text/plain' }).end('ok');
      return;
    }
    res.writeHead(404).end();
  });

  const rate = {
    connect: new RateLimiter(L.connectPerIp.burst, L.connectPerIp.perSecond),
    create: new RateLimiter(L.roomCreate.burst, L.roomCreate.perSecond),
    joinIp: new RateLimiter(L.joinPerIp.burst, L.joinPerIp.perSecond),
    joinSocket: new RateLimiter(L.joinPerSocket.burst, L.joinPerSocket.perSecond),
    events: new RateLimiter(L.events.burst, L.events.perSecond),
    chat: new RateLimiter(L.chat.burst, L.chat.perSecond),
    offers: new RateLimiter(L.offers.burst, L.offers.perSecond),
    probe: new RateLimiter(L.colorProbe.burst, L.colorProbe.perSecond),
  };
  const socketsPerIp = new Map<string, number>();

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
  const rooms = new Map<string, Room>();

  const newCode = () => {
    for (;;) {
      let code = '';
      for (let i = 0; i < ROOM_CODE_LENGTH; i++) code += ROOM_CODE_ALPHABET[rng.int(ROOM_CODE_ALPHABET.length)];
      if (!rooms.has(code)) return code;
    }
  };
  const normCode = (v: unknown) => (typeof v === 'string' && v.length <= 16 ? v.toUpperCase().replace(/[^A-Z0-9]/g, '') : '');

  const closeRoom = (code: string) => {
    const room = rooms.get(code);
    if (!room) return;
    room.dispose();
    rooms.delete(code);
  };

  const newRoom = (practice = false, check = false) => {
    const code = newCode();
    const room = new Room(code, {
      rng,
      practice,
      check,
      devMode: opts.devMode,
      minPlayers: opts.minPlayers,
      onGameEnd: opts.onGameEnd,
      onFeedback: opts.onFeedback,
      send: (socketId, event, ...args) => io.to(socketId).emit(event, ...args),
      onEmpty: () => closeRoom(code),
      kick: (socketId) => {
        const s = io.sockets.sockets.get(socketId);
        if (!s) return;
        s.data.code = undefined;
        s.data.playerId = undefined;
        s.emit('kicked');
        s.disconnect(true);
      },
    });
    rooms.set(code, room);
    return room;
  };

  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [code, room] of rooms) {
      if (room.hasConnectedHuman()) room.idleSince = null;
      else if (room.idleSince === null) room.idleSince = now;
      else if (now - room.idleSince > ROOM_IDLE_MS) closeRoom(code);
    }
    for (const r of Object.values(rate)) r.prune(now);
  }, 60_000);

  io.on('connection', (socket: GameSocket) => {
    const ip = clientIp(socket.request, trustProxy);
    socketsPerIp.set(ip, (socketsPerIp.get(ip) ?? 0) + 1);
    socket.data = { ip, browserId: browserIdOf(socket.handshake.auth), check: (socket.handshake.auth as { purpose?: unknown } | null)?.purpose === 'check' };

    const current = (): { room: Room; seat: Seat } | null => {
      const room = socket.data.code ? rooms.get(socket.data.code) : undefined;
      const seat = room && socket.data.playerId ? room.seats.get(socket.data.playerId) : undefined;
      return room && seat && seat.socketId === socket.id ? { room, seat } : null;
    };
    const detach = () => {
      const c = current();
      if (c) c.room.disconnect(c.seat.id, socket.id);
      socket.data.code = undefined;
      socket.data.playerId = undefined;
    };
    // The session token goes only to its owner, in this reply. It's never logged.
    const bind = (room: Room, seat: Seat): Ack<JoinResult> => {
      socket.data.code = room.code;
      socket.data.playerId = seat.id;
      return { ok: true, code: room.code, playerId: seat.id, token: seat.token };
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
    const joinBudget = () => rate.joinIp.peek(ip) && rate.joinSocket.peek(socket.id);
    const joinFailed = <T extends Ack<JoinResult>>(res: T): T => {
      if (!res.ok) {
        rate.joinIp.take(ip);
        rate.joinSocket.take(socket.id);
      }
      return res;
    };

    const createRoom = (practice: boolean, p: unknown, ack: (r: Ack<JoinResult>) => void) => {
      if (!rate.create.take(ip)) return ack(fail('Too many new rooms. Wait a minute.'));
      if (rooms.size >= L.maxRooms) return ack(fail('The town is full right now. Try again soon.'));
      detach();
      const room = newRoom(practice, socket.data.check);
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
      ack(bind(room, res.seat));
    };

    socket.on('room:create', handle((p, ack) => typeof ack === 'function' && createRoom(false, p, ack)));
    socket.on('room:practice', handle((p, ack) => typeof ack === 'function' && createRoom(true, p, ack)));

    socket.on('room:join', handle((p, ack) => {
      if (typeof ack !== 'function') return;
      if (!joinBudget()) return ack(fail('Too many tries. Wait a minute.'));
      const room = rooms.get(normCode(obj(p).code));
      if (!room) return ack(joinFailed(fail('No room with that code')));
      detach();
      const res = room.addPlayer(obj(p).name as string, socket.id, false, socket.data.browserId);
      ack(res.ok ? bind(room, res.seat) : joinFailed(res));
    }));

    socket.on('room:resume', handle((p, ack) => {
      if (typeof ack !== 'function') return;
      if (!joinBudget()) return ack(fail('Too many tries. Wait a minute.'));
      const { code, token } = obj(p);
      const room = rooms.get(normCode(code));
      if (!room || typeof token !== 'string') return ack(joinFailed(fail('Session expired')));
      const prev = room.seatByToken(token)?.socketId;
      detach();
      const seat = room.resume(token, socket.id);
      if (!seat) return ack(joinFailed(fail('Session expired')));
      // Same seat opened elsewhere: the newest connection wins.
      if (prev && prev !== socket.id) io.sockets.sockets.get(prev)?.disconnect(true);
      ack(bind(room, seat));
    }));

    socket.on('room:leave', handle(() => {
      const c = current();
      if (c) c.room.leave(c.seat.id);
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
    socket.on('game:backToLobby', handle((ack) => withSeat(ack, ({ room, seat }) => room.backToLobby(seat.id))));
    socket.on('chat:send', handle((p, ack) =>
      withSeat(ack, ({ room, seat }) => (rate.chat.take(socket.id) ? room.sendChat(seat.id, obj(p).text) : fail('Slow down'))),
    ));
    socket.on('client:howto', handle((p, ack) => withSeat(ack, ({ room, seat }) => room.setHowto(seat.id, obj(p).status))));
    socket.on('feedback:send', handle((p, ack) => withSeat(ack, ({ room, seat }) => room.submitFeedback(seat.id, p))));
    // Dev tool. Production servers refuse it outright (and the room checks again).
    socket.on('dev:skipPhase', handle((ack) => {
      if (!opts.devMode) return typeof ack === 'function' && ack(fail('Not available'));
      withSeat(ack, ({ room, seat }) => room.skipPhase(seat.id));
    }));

    socket.on('disconnect', () => {
      detach();
      const n = (socketsPerIp.get(ip) ?? 1) - 1;
      if (n > 0) socketsPerIp.set(ip, n);
      else socketsPerIp.delete(ip);
    });
  });

  return {
    io,
    rooms,
    listen: () => new Promise<number>((resolve) => http.listen(opts.port, () => resolve((http.address() as { port: number }).port))),
    close: async () => {
      clearInterval(sweep);
      for (const room of rooms.values()) room.dispose();
      await io.close();
    },
  };
}
