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

export function getSocket(): GameSocket {
  if (!socket) socket = io(serverUrl(), { transports: ['websocket'] });
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
