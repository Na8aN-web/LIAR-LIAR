import type { ColorId } from './palette';
import type { ChatMessage, ItemType, PlayerId, PlayerView, RoomSettings } from './types';

export type Ack<T = {}> = ({ ok: true } & T) | { ok: false; error: string };
export type AckFn<T = {}> = (res: Ack<T>) => void;

export interface JoinResult {
  code: string;
  playerId: PlayerId;
  token: string;
}

/** Intents. The server validates every one. */
export interface ClientToServerEvents {
  'room:create': (p: { name: string }, ack: AckFn<JoinResult>) => void;
  'room:join': (p: { code: string; name: string }, ack: AckFn<JoinResult>) => void;
  'room:resume': (p: { code: string; token: string }, ack: AckFn<JoinResult>) => void;
  'room:leave': () => void;

  'lobby:colors': (ack: AckFn<{ available: ColorId[] }>) => void;
  'lobby:setLook': (p: { item?: ItemType; color?: ColorId }, ack: AckFn) => void;
  'lobby:settings': (p: Partial<RoomSettings>, ack: AckFn) => void;
  'lobby:addBot': (ack: AckFn) => void;
  'lobby:removeBot': (p: { playerId: PlayerId }, ack: AckFn) => void;

  'game:start': (ack: AckFn) => void;
  'game:inspect': (p: { targetId: PlayerId }, ack: AckFn<{ entryId: string; result: ColorId[] }>) => void;
  'game:vote': (p: { targetId: PlayerId }, ack: AckFn) => void;
  'buy:offer': (p: { entryId: string }, ack: AckFn<{ offerId: string }>) => void;
  'buy:respond': (p: { offerId: string; accept: boolean }, ack: AckFn) => void;
  'buy:extraInspect': (ack: AckFn) => void;
  /** Payout phase only. The server assigns a random free color (no free-color list is ever sent). One per payout, final. */
  'swap:color': (ack: AckFn<{ color: ColorId }>) => void;
  'game:backToLobby': (ack: AckFn) => void;

  'chat:send': (p: { text: string }, ack: AckFn) => void;

  /** Dev builds only: host ends the current phase now. */
  'dev:skipPhase': (ack: AckFn) => void;
}

export interface ServerToClientEvents {
  view: (v: PlayerView) => void;
  chat: (m: ChatMessage) => void;
  chatHistory: (m: ChatMessage[]) => void;
}
