'use client';

import { io, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@wtc/shared';

export type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let socket: GameSocket | null = null;

export function serverUrl() {
  return process.env.NEXT_PUBLIC_SERVER_URL || `${location.protocol}//${location.hostname}:3001`;
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
