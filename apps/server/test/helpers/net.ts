import { randomBytes } from 'node:crypto';
import { io, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, PlayerView, ServerToClientEvents } from '@wtc/shared';
import { createGameServer, type GameServerOptions } from '../../src/server';

// Real socket clients against a real server on a free port: what a cheater's script sees.

export type Client = Socket<ServerToClientEvents, ClientToServerEvents> & {
  label: string;
  /** Every message this client received, in order (views, chat, acks). */
  inbox: { event: string; payload: unknown }[];
  latest: PlayerView | null;
  browserId: string;
};

export async function startServer(opts: Partial<GameServerOptions> = {}) {
  const server = createGameServer({ port: 0, devMode: true, minPlayers: 6, ...opts });
  const port = await server.listen();
  const clients: Client[] = [];
  const connect = (label: string, o: { origin?: string | null; browserId?: string; purpose?: string } = {}) =>
    new Promise<Client>((resolve, reject) => {
      const browserId = o.browserId ?? randomBytes(16).toString('base64url');
      const headers: Record<string, string> = {};
      if (o.origin !== null) headers.origin = o.origin ?? `http://localhost:${port}`;
      const s = io(`http://localhost:${port}`, { transports: ['websocket'], forceNew: true, reconnection: false, extraHeaders: headers, auth: { browserId, purpose: o.purpose } }) as Client;
      s.label = label;
      s.inbox = [];
      s.latest = null;
      s.browserId = browserId;
      s.onAny((event, payload) => {
        s.inbox.push({ event, payload });
        if (event === 'view') s.latest = payload as PlayerView;
      });
      s.on('connect', () => resolve(s));
      s.on('connect_error', (e) => reject(e));
      clients.push(s);
    });
  /** Emit and wait for the ack; the ack is recorded in the inbox too. Times out to null. */
  const call = <T = any>(c: Client, event: string, ...args: unknown[]) =>
    new Promise<T>((resolve) => {
      const t = setTimeout(() => resolve(null as T), 3000);
      (c.emit as any)(event, ...args, (res: T) => {
        clearTimeout(t);
        c.inbox.push({ event: `ack:${event}`, payload: res });
        resolve(res);
      });
    });
  const close = async () => {
    for (const c of clients) c.disconnect();
    await server.close();
  };
  return { server, port, connect, call, close };
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Waits until a client's latest view satisfies `pred`. */
export async function until(c: Client, pred: (v: PlayerView) => boolean, ms = 3000) {
  for (let t = 0; t < ms; t += 20) {
    if (c.latest && pred(c.latest)) return c.latest;
    await sleep(20);
  }
  throw new Error(`${c.label}: condition not met (phase ${c.latest?.phase})`);
}
