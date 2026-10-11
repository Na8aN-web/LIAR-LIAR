'use client';

import { io, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@wtc/shared';

export type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let socket: GameSocket | null = null;

/**
 * Where the game server lives. Set NEXT_PUBLIC_SERVER_URL to a URL, or to
 * "same-origin" when a proxy/tunnel serves /socket.io on the page's own origin.
 * Unset: local dev (page on :3000 -> server on :3001), otherwise same-origin.
 */
export function serverUrl() {
  const env = process.env.NEXT_PUBLIC_SERVER_URL;
  if (env === 'same-origin') return location.origin;
  if (env) return env;
  return location.port === '3000' ? `${location.protocol}//${location.hostname}:3001` : location.origin;
}

/**
 * A random id for this browser, sent when connecting. The server allows one seat per browser in
 * a room and remembers browsers the host removed. It identifies nothing about the person.
 */
function browserId(): string {
  const make = () => {
    const b = new Uint8Array(16);
    crypto.getRandomValues(b);
    return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  };
  try {
    // Dev: per tab (sessionStorage), so several tabs can be different players while testing.
    const store = process.env.NODE_ENV === 'development' ? sessionStorage : localStorage;
    let id = store.getItem('wtc:browser');
    if (!id || !/^[A-Za-z0-9_-]{16,64}$/.test(id)) {
      id = make();
      store.setItem('wtc:browser', id);
    }
    return id;
  } catch {
    return make();
  }
}

export function getSocket(): GameSocket {
  if (!socket) socket = io(serverUrl(), { transports: ['websocket'], auth: { browserId: browserId() } });
  return socket;
}

type Events = ClientToServerEvents;
type Args<E extends keyof Events> = Parameters<Events[E]>;
type AckOf<E extends keyof Events> = Args<E> extends [...unknown[], (res: infer R) => void] ? R : never;
type PayloadOf<E extends keyof Events> = Args<E> extends [infer P, unknown] ? [P] : [];

/** Emit an intent and wait for the server's ack. Never rejects. */
export function call<E extends keyof Events>(event: E, ...payload: PayloadOf<E>): Promise<AckOf<E>> {
  return new Promise((resolve) => {
    (getSocket().timeout(8000) as any).emit(event, ...payload, (err: unknown, res: AckOf<E>) =>
      resolve(err ? ({ ok: false, error: 'Connection problem, try again' } as AckOf<E>) : res),
    );
  });
}
