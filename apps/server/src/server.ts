import { createServer } from 'node:http';
import { Server, type Socket } from 'socket.io';
import {
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  type Ack,
  type ClientToServerEvents,
  type JoinResult,
  type ServerToClientEvents,
} from '@wtc/shared';
import { Room, type Seat } from './room';
import type { GameSummary } from './game/summary';
import { secureRng, type Rng } from './rng';

interface SocketData {
  code?: string;
  playerId?: string;
}

type IO = Server<ClientToServerEvents, ServerToClientEvents, {}, SocketData>;
type GameSocket = Socket<ClientToServerEvents, ServerToClientEvents, {}, SocketData>;

export interface GameServerOptions {
  port: number;
  devMode: boolean;
  minPlayers: number;
  corsOrigin?: string[] | true;
  rng?: Rng;
  onGameEnd?: (summary: GameSummary) => void;
}

const ROOM_IDLE_MS = 10 * 60_000;

export function createGameServer(opts: GameServerOptions) {
  const rng = opts.rng ?? secureRng;
  const http = createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'content-type': 'text/plain' }).end('ok');
      return;
    }
    res.writeHead(404).end();
  });
  const io: IO = new Server(http, { cors: { origin: opts.corsOrigin ?? true } });
  const rooms = new Map<string, Room>();

  const newCode = () => {
    for (;;) {
      let code = '';
      for (let i = 0; i < ROOM_CODE_LENGTH; i++) code += ROOM_CODE_ALPHABET[rng.int(ROOM_CODE_ALPHABET.length)];
      if (!rooms.has(code)) return code;
    }
  };
  const normCode = (v: unknown) => (typeof v === 'string' ? v.toUpperCase().replace(/[^A-Z0-9]/g, '') : '');

  const newRoom = () => {
    const code = newCode();
    const room = new Room(code, {
      rng,
      devMode: opts.devMode,
      minPlayers: opts.minPlayers,
      onGameEnd: opts.onGameEnd,
      send: (socketId, event, ...args) => io.to(socketId).emit(event, ...args),
    });
    rooms.set(code, room);
    return room;
  };

  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [code, room] of rooms) {
      if (room.hasConnectedHuman()) room.idleSince = null;
      else if (room.idleSince === null) room.idleSince = now;
      else if (now - room.idleSince > ROOM_IDLE_MS) {
        room.dispose();
        rooms.delete(code);
      }
    }
  }, 60_000);

  io.on('connection', (socket: GameSocket) => {
    const current = (): { room: Room; seat: Seat } | null => {
      const room = socket.data.code ? rooms.get(socket.data.code) : undefined;
      const seat = room && socket.data.playerId ? room.seats.get(socket.data.playerId) : undefined;
      return room && seat && seat.socketId === socket.id ? { room, seat } : null;
    };
    const detach = () => {
      const c = current();
      if (c) c.room.disconnect(c.seat.id, socket.id);
      socket.data = {};
    };
    const bind = (room: Room, seat: Seat): Ack<JoinResult> => {
      socket.data = { code: room.code, playerId: seat.id };
      return { ok: true, code: room.code, playerId: seat.id, token: seat.token };
    };

    /** Wraps a handler so bad payloads or thrown errors never crash the server. */
    const handle =
      <A extends unknown[]>(fn: (...args: A) => void) =>
      (...args: A) => {
        try {
          fn(...args);
        } catch (err) {
          console.error('handler error', err);
          const ack = args[args.length - 1];
          if (typeof ack === 'function') ack({ ok: false, error: 'Server error' });
        }
      };
    const withSeat = <T>(ack: unknown, fn: (c: { room: Room; seat: Seat }) => Ack<T>) => {
      if (typeof ack !== 'function') return;
      const c = current();
      ack(c ? fn(c) : { ok: false, error: 'Not in a room' });
    };

    socket.on('room:create', handle((p, ack) => {
      if (typeof ack !== 'function') return;
      detach();
      const room = newRoom();
      const res = room.addPlayer(p?.name as string, socket.id);
      if (!res.ok) {
        rooms.delete(room.code);
        return ack(res);
      }
      ack(bind(room, res.seat));
    }));

    socket.on('room:join', handle((p, ack) => {
      if (typeof ack !== 'function') return;
      const room = rooms.get(normCode(p?.code));
      if (!room) return ack({ ok: false, error: 'No room with that code' });
      detach();
      const res = room.addPlayer(p?.name as string, socket.id);
      ack(res.ok ? bind(room, res.seat) : res);
    }));

    socket.on('room:resume', handle((p, ack) => {
      if (typeof ack !== 'function') return;
      const room = rooms.get(normCode(p?.code));
      if (!room || typeof p?.token !== 'string') return ack({ ok: false, error: 'Session expired' });
      detach();
      const prev = [...room.seats.values()].find((s) => s.token === p.token)?.socketId;
      const seat = room.resume(p.token, socket.id);
      if (!seat) return ack({ ok: false, error: 'Session expired' });
      // Same seat opened elsewhere: the newest connection wins.
      if (prev && prev !== socket.id) io.sockets.sockets.get(prev)?.disconnect(true);
      ack(bind(room, seat));
    }));

    socket.on('room:leave', handle(() => {
      const c = current();
      if (c) c.room.leave(c.seat.id);
      socket.data = {};
    }));

    socket.on('lobby:colors', handle((ack) =>
      withSeat(ack, ({ room, seat }) => ({ ok: true, available: room.freeColors(seat.id) })),
    ));
    socket.on('lobby:setLook', handle((p, ack) => withSeat(ack, ({ room, seat }) => room.setLook(seat.id, p ?? {}))));
    socket.on('lobby:settings', handle((p, ack) => withSeat(ack, ({ room, seat }) => room.updateSettings(seat.id, p))));
    socket.on('lobby:addBot', handle((ack) => withSeat(ack, ({ room, seat }) => room.addBot(seat.id))));
    socket.on('lobby:removeBot', handle((p, ack) =>
      withSeat(ack, ({ room, seat }) => room.removeBot(seat.id, p?.playerId)),
    ));
    socket.on('game:start', handle((ack) => withSeat(ack, ({ room, seat }) => room.start(seat.id))));
    socket.on('game:inspect', handle((p, ack) => withSeat(ack, ({ room, seat }) => room.inspect(seat.id, p?.targetId))));
    socket.on('game:vote', handle((p, ack) => withSeat(ack, ({ room, seat }) => room.vote(seat.id, p?.targetId))));
    socket.on('buy:offer', handle((p, ack) => withSeat(ack, ({ room, seat }) => room.offer(seat.id, p?.entryId))));
    socket.on('buy:respond', handle((p, ack) =>
      withSeat(ack, ({ room, seat }) => room.respondOffer(seat.id, p?.offerId, p?.accept)),
    ));
    socket.on('buy:extraInspect', handle((ack) => withSeat(ack, ({ room, seat }) => room.buyExtraInspect(seat.id))));
    socket.on('swap:color', handle((ack) => withSeat(ack, ({ room, seat }) => room.swapColor(seat.id))));
    socket.on('game:backToLobby', handle((ack) => withSeat(ack, ({ room, seat }) => room.backToLobby(seat.id))));
    socket.on('chat:send', handle((p, ack) => withSeat(ack, ({ room, seat }) => room.sendChat(seat.id, p?.text))));
    socket.on('dev:skipPhase', handle((ack) => withSeat(ack, ({ room, seat }) => room.skipPhase(seat.id))));

    socket.on('disconnect', () => detach());
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
