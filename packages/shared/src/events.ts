import type { Cosmetics } from './cosmetics';
import type { ColorId } from './palette';
import type { FeedbackAnswers, HowtoStatus } from './playtest';
import type { Announcement, ClientStep, ServerStatus, VisitPage } from './analytics';
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
  /** A practice game against bots, started at once (see PRACTICE). */
  'room:practice': (p: { name: string }, ack: AckFn<JoinResult>) => void;
  'room:resume': (p: { code: string; token: string }, ack: AckFn<JoinResult>) => void;
  'room:leave': () => void;

  'lobby:colors': (ack: AckFn<{ available: ColorId[] }>) => void;
  'lobby:setLook': (p: { item?: ItemType; color?: ColorId; cosmetics?: Partial<Cosmetics> }, ack: AckFn) => void;
  'lobby:settings': (p: Partial<RoomSettings>, ack: AckFn) => void;
  'lobby:addBot': (ack: AckFn) => void;
  'lobby:removeBot': (p: { playerId: PlayerId }, ack: AckFn) => void;
  /** Host: remove a player (they can't rejoin this room from that browser). */
  'lobby:kick': (p: { playerId: PlayerId }, ack: AckFn) => void;
  /** Host: lock or unlock the room to new players. */
  'lobby:lock': (p: { locked: boolean }, ack: AckFn) => void;

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

  /** Playtest stats: what this player did with How to Play. */
  'client:howto': (p: { status: HowtoStatus }, ack: AckFn) => void;
  /** End-of-game feedback form (optional, once per game). */
  'feedback:send': (p: Partial<FeedbackAnswers>, ack: AckFn) => void;

  /** Report a chat message (it's stored for the admins, with a little context). */
  'chat:report': (p: { messageId: string; reason?: string }, ack: AckFn) => void;
  /** This player muted someone's chat (the hiding happens in the browser; this is only counted). */
  'chat:mute': (p: { playerId: PlayerId }, ack: AckFn) => void;

  /** Analytics, anonymous: a page was opened (with the link's ?src=). */
  'analytics:visit': (p: { page: VisitPage; src?: string }, ack: AckFn) => void;
  /** Analytics, anonymous: a How to Play step. */
  'analytics:step': (p: { step: ClientStep }, ack: AckFn) => void;
  /** Analytics, anonymous: an ad slot was on this player's screen. */
  'analytics:billboard': (p: { slot: string }, ack: AckFn) => void;

  /** Dev builds only: host ends the current phase now. */
  'dev:skipPhase': (ack: AckFn) => void;
}

export interface ServerToClientEvents {
  view: (v: PlayerView) => void;
  chat: (m: ChatMessage) => void;
  chatHistory: (m: ChatMessage[]) => void;
  /** You were removed from the room by the host. */
  kicked: () => void;
  /** Server-wide state (maintenance, billboard images): on connecting and whenever it changes. */
  status: (s: ServerStatus) => void;
  /** A message from the admins to everyone online. */
  announcement: (a: Announcement) => void;
  /** The admins closed your room. */
  roomClosed: (p: { reason: string }) => void;
  /** This browser is banned. */
  banned: () => void;
}
