import {
  CHAT_MAX,
  COLOR_IDS,
  DEFAULT_SETTINGS,
  GAME_COUNTDOWN_SECONDS,
  HOST_GRACE_MS,
  INSPECT_RANGE,
  ITEM_TYPES,
  parseCosmetics,
  randomCosmetics,
  type Cosmetics,
  MAX_PLAYERS,
  NAME_MAX,
  POSTER_MODES,
  PRACTICE,
  REPORT_REASON_MAX,
  RULE_LIMITS,
  AUTO_FILL,
  ROOM_NAME_MAX,
  defaultRoomName,
  hasBadWords,
  maskBadWords,
  type AutoFill,
  type LobbyListing,
  type Visibility,
  SEAT_HOLD_MS,
  SWAP_RANGE,
  TIMER_LIMITS,
  defaultInspects,
  defaultSwaps,
  isColorId,
  type Ack,
  type ChatMessage,
  type ColorId,
  type ItemType,
  type Phase,
  type PhaseTimers,
  type PlayerId,
  type GameRules,
  type PlayerView,
  type PublicPlayer,
  type ReplayView,
  type RoomSettings,
  type ServerToClientEvents,
} from '@wtc/shared';
import { BotDriver, type BotConfig } from './bots/driver';
import { summarize, type GameSummary } from './game/summary';
import * as engine from './game/engine';
import { DEFAULT_TIMEOUTS, type RoomTimeouts } from './timeouts';
import { makeId, pick, type Rng } from './rng';
import { HOWTO_STATUSES, parseFeedback, type FeedbackAnswers, type HowtoStatus } from './playtest';
import { sameToken } from './security';
import { anonId, type AnalyticsEvent } from './analytics/events';

export interface Seat {
  id: PlayerId;
  token: string;
  name: string;
  item: ItemType;
  /** Hat and head detail: public, purely visual. */
  cosmetics: Cosmetics;
  color: ColorId;
  /**
   * The player chose this color in the lobby. Until then it's only a suggestion: it isn't
   * reserved, so the lobby's free-color list never reveals the color a player got when they
   * joined. Clashes are re-rolled at game start.
   */
  colorPicked: boolean;
  /** Random id from the player's browser (handshake), for one seat per browser. */
  browserId: string | null;
  /** Anonymous analytics id (a hash of browserId): what stats and the admins see. */
  anon: string | null;
  seat: number;
  isBot: boolean;
  socketId: string | null;
  connected: boolean;
  away: boolean;
  connectedSince: number;
  holdTimer: NodeJS.Timeout | null;
  lastChatAt: number;
  /** Playtest stats for the current game: connection drops and returns. */
  disconnects: number;
  reconnects: number;
  /** What the player did with How to Play, as their browser reports it. */
  howto: HowtoStatus | null;
  /** Last deliberate input (see timeouts.ts: never a page load, reconnect or background report). */
  lastInputAt: number;
  /** Any input during the current poster. */
  actedThisPoster: boolean;
  /** Posters in a row without any input (away at timeouts.awayAfterPosters, removed at removeAfterPosters). */
  idlePosters: number;
  /** Removed for being away too long: the seat stays in the game's records, the player is gone. */
  removed: boolean;
}

export type Send = <E extends keyof ServerToClientEvents>(
  socketId: string,
  event: E,
  ...args: Parameters<ServerToClientEvents[E]>
) => void;

export interface RoomDeps {
  send: Send;
  rng: Rng;
  devMode: boolean;
  minPlayers: number;
  /** Called once per finished game with anonymous stats. */
  onGameEnd?: (summary: GameSummary) => void;
  /** A practice room: one human plus bots, short game, not counted in the stats. */
  practice?: boolean;
  /** Created by the playtest check script: its game summary is marked `check`. */
  check?: boolean;
  bots?: Partial<BotConfig>;
  /** Called when the last human has left a room in the lobby: the room (and its code) can go. */
  onEmpty?: () => void;
  /** Tell a kicked player's connection, then drop it. With a reason: shown to them as why. */
  kick?: (socketId: string, reason?: string) => void;
  /** Idle and AFK limits (default: DEFAULT_TIMEOUTS). */
  timeouts?: RoomTimeouts;
  /** Called with each player's answers to the end-of-game feedback form. */
  onFeedback?: (entry: FeedbackEntry) => void;
  /** Anonymous analytics (funnel steps, kicks, reports, abandoned games). */
  onEvent?: (e: AnalyticsEvent) => void;
  /** Default settings for a new room (the admins can change them). */
  defaults?: () => RoomSettings;
  /** Public (listed in Find a Lobby) or private (code and invite link only). Default private. */
  visibility?: Visibility;
  /** The host's chosen room name (filtered); empty = "<host>'s Campfire". */
  roomName?: string;
  /** Something the lobby list shows may have changed (players, host, phase, lock, visibility...). */
  onListingChange?: () => void;
  /** A game ended: its replay (with the secrets), for the admins to look at afterwards. */
  onFinished?: (record: FinishedGame) => void;
}

/** A finished game as the admins see it afterwards: names and every secret, now that it's over. */
export interface FinishedGame {
  gameId: string;
  code: string;
  endedAt: string;
  names: Record<PlayerId, string>;
  replay: ReplayView;
}

/** What the admin dashboard may see of a room at any time: public information only. */
export interface RoomSnapshot {
  code: string;
  createdAt: string;
  phase: Phase;
  phaseEndsAt: number | null;
  poster: number | null;
  posters: number | null;
  locked: boolean;
  practice: boolean;
  visibility: Visibility;
  name: string;
  host: string | null;
  players: { name: string; bot: boolean; connected: boolean; away: boolean; host: boolean; anon: string | null }[];
}

/** One player's feedback after a game. The display name only: never ids or tokens. */
export interface FeedbackEntry {
  at: string;
  gameId: string;
  name: string;
  /** Anonymous per-browser id. */
  anon?: string | null;
  answers: FeedbackAnswers;
  /** Made up by `pnpm admin:seed`. */
  seed?: true;
}

const CHAT_HISTORY = 150;
const CHAT_COOLDOWN_MS = 400;
const BOT_NAMES = ['Hank', 'Dolly', 'Clem', 'Ezra', 'Mae', 'Silas', 'Ruby', 'Jeb', 'Pearl', 'Wyatt', 'Etta', 'Boone', 'Nell', 'Cody', 'June'];

const fail = (error: string) => ({ ok: false as const, error });

/**
 * Plain text from a client: control characters, invisible characters and text-direction
 * overrides removed (they can disguise a name as someone else's), whitespace collapsed,
 * length capped. It is always rendered as text, never as HTML.
 */
export function cleanText(raw: unknown, max: number): string {
  if (typeof raw !== 'string') return '';
  return raw
    .slice(0, max * 4)
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u2069\ufeff]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

/**
 * A settings change checked against the allowed ranges: the new settings, or why not.
 * Used by hosts in the lobby and by the admins for the default settings.
 */
export function applySettings(current: RoomSettings, p: unknown): Ack<{ settings: RoomSettings }> {
  if (!p || typeof p !== 'object' || Array.isArray(p)) return fail('Bad settings');
  const patch = p as Partial<RoomSettings>;
  const next = structuredClone(current);

  if (patch.inspectsPerRound !== undefined) {
    const v = patch.inspectsPerRound;
    if (v !== 'auto' && !(Number.isInteger(v) && v >= INSPECT_RANGE.min && v <= INSPECT_RANGE.max)) {
      return fail('Inspects must be 2–5 or auto');
    }
    next.inspectsPerRound = v;
  }
  if (patch.colorSwaps !== undefined) {
    const v = patch.colorSwaps;
    if (v !== 'auto' && !(Number.isInteger(v) && v >= SWAP_RANGE.min && v <= SWAP_RANGE.max)) {
      return fail(`Color swaps must be ${SWAP_RANGE.min}–${SWAP_RANGE.max} or auto`);
    }
    next.colorSwaps = v;
  }
  if (patch.posterMode !== undefined) {
    if (!POSTER_MODES.includes(patch.posterMode)) return fail('Unknown poster mode');
    next.posterMode = patch.posterMode;
  }
  if (patch.timers !== undefined) {
    if (!patch.timers || typeof patch.timers !== 'object') return fail('Bad timers');
    for (const key of Object.keys(TIMER_LIMITS) as (keyof PhaseTimers)[]) {
      const v = (patch.timers as Partial<PhaseTimers>)[key];
      if (v === undefined) continue;
      const [min, max] = TIMER_LIMITS[key];
      if (!Number.isInteger(v) || v < min || v > max) return fail(`${key} timer must be ${min}–${max}s`);
      next.timers[key] = v;
    }
  }
  if (patch.rules !== undefined) {
    if (!patch.rules || typeof patch.rules !== 'object') return fail('Bad rules');
    for (const key of Object.keys(RULE_LIMITS) as (keyof GameRules)[]) {
      const v = (patch.rules as Partial<GameRules>)[key];
      if (v === undefined) continue;
      const [min, max] = RULE_LIMITS[key];
      if (!Number.isInteger(v) || v < min || v > max) return fail(`${key} must be ${min}–${max}`);
      next.rules[key] = v;
    }
  }
  return { ok: true, settings: next };
}

/** A host's room name: plain text, capped, and nothing that fails the word filter. */
export function cleanRoomName(raw: unknown): string {
  const name = cleanText(raw, ROOM_NAME_MAX);
  return name && !hasBadWords(name) ? name : '';
}

export class Room {
  readonly seats = new Map<PlayerId, Seat>();
  hostId: PlayerId | null = null;
  settings: RoomSettings;
  readonly createdAt = Date.now();
  phase: Phase = 'lobby';
  phaseEndsAt: number | null = null;
  game: engine.GameState | null = null;
  replay: ReplayView | null = null;
  chat: ChatMessage[] = [];
  /** Set while no human is connected; used by the room sweeper. */
  idleSince: number | null = null;
  /** Last deliberate input from anyone, or a join (lobby and end-screen idle checks). */
  lastActivityAt = Date.now();
  /** When the room last entered the lobby (the lobby's hard limit counts from here). */
  lobbySince = Date.now();
  /** About to close: when, and why. Shown to the room; the room is off Find a Lobby meanwhile. */
  closing: { at: number; why: 'idle' | 'maxAge' } | null = null;
  /** Host setting: no new players may join (seated players can still reconnect). */
  locked = false;
  visibility: Visibility;
  /** Chosen room name ('' until the host has a name: then "<host>'s Campfire"). */
  private chosenName: string;
  /** Opaque id for joining from the lobby list (never the room code). */
  readonly listingId = makeId(10);
  autoFill: AutoFill = { enabled: true, afterSec: AUTO_FILL.defaultSec };
  /** When the auto-fill clock started: room opened, or went public. */
  private publicSince = Date.now();
  /** Browsers kicked from this room: they can't join it again. */
  private readonly banned = new Set<string>();
  /** Current game: random id (links the stats line and feedback), and when each poster began. */
  private gameId = '';
  private posterStarts: number[] = [];
  /** Seats that already sent feedback for this game. */
  private readonly feedbackFrom = new Set<PlayerId>();

  private phaseTimer: NodeJS.Timeout | null = null;
  private gameStartedAt = 0;
  private hostTimer: NodeJS.Timeout | null = null;
  private nextSeat = 0;
  private flushQueued = false;
  private readonly bots: BotDriver;

  constructor(readonly code: string, private readonly deps: RoomDeps) {
    this.settings = structuredClone(deps.defaults?.() ?? DEFAULT_SETTINGS);
    this.visibility = deps.practice ? 'private' : (deps.visibility ?? 'private');
    this.chosenName = cleanRoomName(deps.roomName);
    this.bots = new BotDriver(this, deps.rng, deps.bots);
  }

  /** Records an analytics event, except for practice games and the playtest check script. */
  private track(e: Record<string, unknown> & { type: AnalyticsEvent['type'] }) {
    if (this.practice || this.deps.check) return;
    try {
      this.deps.onEvent?.({ at: new Date().toISOString(), anon: null, ...e } as AnalyticsEvent);
    } catch {}
  }

  private trackStep(step: 'lobby' | 'game_start' | 'game_finish', seats: Seat[]) {
    for (const s of seats) if (!s.isBot && s.anon) this.track({ type: 'step', step, anon: s.anon, ...(step === 'lobby' ? {} : { gameId: this.gameId }) });
  }

  anonOf(id: PlayerId): string | null {
    return this.seats.get(id)?.anon ?? null;
  }

  get rng() {
    return this.deps.rng;
  }

  // ---------------------------------------------------------------- membership

  get practice(): boolean {
    return !!this.deps.practice;
  }

  addPlayer(rawName: string, socketId: string | null, isBot = false, browserId: string | null = null): Ack<{ seat: Seat }> {
    if (this.phase !== 'lobby') return fail('That game has already started');
    if (this.practice && !isBot && [...this.seats.values()].some((s) => !s.isBot)) return fail("That's someone's practice game");
    if (!isBot && this.locked) return fail('This room is locked');
    if (browserId && this.banned.has(browserId)) return fail('You were removed from this room');
    // One seat per browser: a second tab can't take a second seat (it can resume the first).
    if (browserId && !isBot && [...this.seats.values()].some((s) => s.browserId === browserId)) return fail("You're already in this room");
    if (this.seats.size >= MAX_PLAYERS) return fail('That room is full');
    // A name that fails the word filter becomes "Stranger N" (everywhere: plates, ledger, chat, lists).
    const typed = cleanText(rawName, NAME_MAX);
    const name = this.uniqueName(typed && hasBadWords(typed) ? this.strangerName() : typed);
    if (!name) return fail('Enter a name');

    // A suggestion only (see Seat.colorPicked): drawn from colors nobody has picked.
    const free = this.freeColors();
    const now = Date.now();
    const seat: Seat = {
      id: makeId(),
      token: makeId(18),
      name,
      item: pick(ITEM_TYPES, this.rng),
      cosmetics: randomCosmetics((n) => this.rng.int(n)),
      color: pick(free, this.rng),
      colorPicked: false,
      browserId: isBot ? null : browserId,
      anon: isBot ? null : anonId(browserId),
      seat: this.nextSeat++,
      isBot,
      socketId,
      connected: !isBot,
      away: false,
      connectedSince: now,
      holdTimer: null,
      lastChatAt: 0,
      disconnects: 0,
      reconnects: 0,
      howto: null,
      lastInputAt: now,
      actedThisPoster: false,
      idlePosters: 0,
      removed: false,
    };
    this.seats.set(seat.id, seat);
    if (!isBot) this.noteActivity(now);
    if (!this.hostId && !isBot) this.hostId = seat.id;
    if (!isBot) this.trackStep('lobby', [seat]);
    this.broadcast();
    if (socketId) this.deps.send(socketId, 'chatHistory', this.chat);
    return { ok: true, seat };
  }

  /** The human seat a session token belongs to (constant-time compare), or null. */
  seatByToken(token: unknown): Seat | null {
    if (typeof token !== 'string' || token.length < 16 || token.length > 64) return null;
    return [...this.seats.values()].find((s) => !s.isBot && sameToken(s.token, token)) ?? null;
  }

  resume(token: string, socketId: string): Seat | null {
    const seat = this.seatByToken(token);
    if (!seat) return null;
    if (this.game && this.phase !== 'lobby' && !seat.connected) seat.reconnects++;
    if (seat.holdTimer) clearTimeout(seat.holdTimer);
    seat.holdTimer = null;
    seat.socketId = socketId;
    seat.connected = true;
    seat.away = false;
    seat.connectedSince = Date.now();
    if (this.hostId === seat.id) this.clearHostTimer();
    if (!this.hostId) this.hostId = seat.id;
    this.idleSince = null;
    this.broadcast();
    this.deps.send(socketId, 'chatHistory', this.chat);
    return seat;
  }

  disconnect(id: PlayerId, socketId: string) {
    const seat = this.seats.get(id);
    if (!seat || seat.socketId !== socketId) return;
    seat.socketId = null;
    seat.connected = false;
    if (this.game && this.phase !== 'lobby' && this.phase !== 'ended') seat.disconnects++;
    seat.holdTimer = setTimeout(() => {
      seat.holdTimer = null;
      if (this.phase === 'lobby') this.removeSeat(id);
      else {
        seat.away = true;
        this.broadcast();
      }
    }, SEAT_HOLD_MS);
    if (this.hostId === id) {
      this.clearHostTimer();
      this.hostTimer = setTimeout(() => this.transferHost(), HOST_GRACE_MS);
    }
    this.broadcast();
    this.checkVotesDone();
  }

  /** Explicit leave. In a game the seat stays (still counted) but is marked away. */
  leave(id: PlayerId) {
    const seat = this.seats.get(id);
    if (!seat) return;
    if (this.phase === 'lobby') return this.removeSeat(id);
    if (seat.holdTimer) clearTimeout(seat.holdTimer);
    seat.holdTimer = null;
    seat.socketId = null;
    seat.connected = false;
    seat.away = true;
    if (this.hostId === id) this.transferHost();
    this.broadcast();
    this.checkVotesDone();
  }

  private removeSeat(id: PlayerId) {
    const seat = this.seats.get(id);
    if (!seat) return;
    if (seat.holdTimer) clearTimeout(seat.holdTimer);
    this.seats.delete(id);
    if (this.hostId === id) this.transferHost();
    this.broadcast();
    // Last human gone from the lobby: close the room so its code stops working.
    if (this.phase === 'lobby' && !this.humans().length) this.deps.onEmpty?.();
  }

  /**
   * Host removes a player. In the lobby the seat goes; mid-game it stays (still counted, can't
   * act) because removing it would change the game. Either way the player's connection is
   * dropped, their session stops working and their browser can't join this room again.
   */
  kick(id: PlayerId, targetId: unknown): Ack {
    if (id !== this.hostId) return fail('Only the host can remove players');
    if (typeof targetId !== 'string' || !this.seats.has(targetId)) return fail('Unknown player');
    if (targetId === id) return fail("You can't remove yourself");
    const seat = this.seats.get(targetId)!;
    if (seat.browserId) this.banned.add(seat.browserId);
    this.track({ type: 'safety', kind: 'kick', by: 'host', anon: this.anonOf(id), target: seat.anon });
    seat.token = makeId(18); // the old session no longer resumes anything
    const socketId = seat.socketId;
    if (this.phase === 'lobby') {
      this.removeSeat(targetId);
    } else {
      if (seat.holdTimer) clearTimeout(seat.holdTimer);
      seat.holdTimer = null;
      seat.socketId = null;
      seat.connected = false;
      seat.away = true;
      this.broadcast();
      this.checkVotesDone();
    }
    if (socketId) this.deps.kick?.(socketId);
    return { ok: true };
  }

  // ---------------------------------------------------------------- idle rooms and AFK players

  /** The server always passes its limits. A room made on its own (tests, tools) never removes
   *  idle players unless it's given limits that say so. */
  private get timeouts(): RoomTimeouts {
    return this.deps.timeouts ?? { ...DEFAULT_TIMEOUTS, awayAfterPosters: Infinity, removeAfterPosters: Infinity };
  }

  /** Something happened in the room (input or a join): it's not idle, so an idle warning is off. */
  private noteActivity(now = Date.now()) {
    this.lastActivityAt = now;
    if (this.closing?.why === 'idle') {
      this.closing = null;
      this.broadcast();
    }
  }

  /**
   * A player did something on purpose (the server calls this for input events only: never for
   * reconnects, page loads or background reports). Clears their idle count, and an away mark
   * that came from idling.
   */
  noteInput(id: PlayerId, now = Date.now()) {
    const seat = this.seats.get(id);
    if (!seat || seat.isBot || seat.removed) return;
    seat.lastInputAt = now;
    seat.actedThisPoster = true;
    if (seat.idlePosters > 0 || (seat.away && seat.connected)) {
      seat.idlePosters = 0;
      if (seat.away && seat.connected) {
        seat.away = false;
        this.broadcast();
      }
    }
    this.noteActivity(now);
  }

  /** After each poster: players who did nothing all poster count up; away, then removed. */
  private reviewIdlePlayers() {
    const { awayAfterPosters, removeAfterPosters } = this.timeouts;
    let changed = false;
    for (const s of this.humans()) {
      if (s.removed) continue;
      if (s.actedThisPoster) s.idlePosters = 0;
      else s.idlePosters++;
      s.actedThisPoster = false;
      if (s.idlePosters >= removeAfterPosters) {
        this.removeIdle(s);
        changed = true;
      } else if (s.idlePosters >= awayAfterPosters && !s.away) {
        s.away = true;
        changed = true;
      }
    }
    if (changed) this.broadcast();
  }

  /** Removed for idling: like a host kick mid-game (the seat stays in the game's records), but no ban. */
  private removeIdle(seat: Seat) {
    this.track({ type: 'safety', kind: 'kick', by: 'server', anon: null, target: seat.anon });
    seat.removed = true;
    seat.away = true;
    seat.token = makeId(18);
    if (seat.holdTimer) clearTimeout(seat.holdTimer);
    seat.holdTimer = null;
    const socketId = seat.socketId;
    seat.socketId = null;
    seat.connected = false;
    if (this.hostId === seat.id) this.transferHost();
    if (socketId) this.deps.kick?.(socketId, `You were removed from the game after ${seat.idlePosters} posters in a row without doing anything.`);
  }

  /** How long this game should take, from its settings (all posters, every phase, plus the countdown). */
  private expectedGameMs(): number {
    if (!this.game) return 0;
    const t = this.settings.timers;
    return (this.game.order.length * (t.poster + t.investigation + t.vote + t.payout) + GAME_COUNTDOWN_SECONDS) * 1000;
  }

  /**
   * Called by the server every few seconds. Applies the idle limits (see timeouts.ts) and returns
   * why the room should close now, or null to keep it.
   */
  tick(now = Date.now()): string | null {
    const T = this.timeouts;
    // Nobody connected at all.
    if (this.hasConnectedHuman()) this.idleSince = null;
    else if (this.idleSince === null) this.idleSince = now;
    if (this.idleSince !== null && now - this.idleSince >= T.emptyRoomMs) return 'Everyone left, so the room closed.';

    const inGame = !!this.game && this.phase !== 'lobby' && this.phase !== 'ended';
    if (inGame) {
      // Everyone human was removed or left for good: nobody to play for.
      if (this.humans().every((s) => s.removed)) return 'Everyone left, so the room closed.';
      if (now - this.gameStartedAt > this.expectedGameMs() * T.gameOvertimeFactor + T.gameOvertimeExtraMs) {
        return 'This game ran far longer than it should have, so the room closed.';
      }
      return null;
    }

    // Lobby and end screen.
    if (this.closing && now >= this.closing.at) {
      return this.closing.why === 'idle'
        ? 'This campfire went cold: nothing happened for a while, so the room closed. Make a new one any time.'
        : 'This room was open for an hour without a game, so it closed. Make a new one any time.';
    }
    const maxAt = this.lobbySince + T.lobbyMaxMs;
    if (this.phase === 'lobby' && now >= maxAt - T.lobbyIdleGraceMs && this.closing?.why !== 'maxAge') {
      this.closing = { at: maxAt, why: 'maxAge' };
      this.broadcast();
    } else if (!this.closing && now - this.lastActivityAt >= T.lobbyIdleMs) {
      this.closing = { at: now + T.lobbyIdleGraceMs, why: 'idle' };
      this.broadcast();
    }

    // Public lobby: an inactive host hands over to the most active player who's waiting.
    if (this.phase === 'lobby' && this.visibility === 'public' && this.hostId) {
      const host = this.seats.get(this.hostId);
      if (host && now - host.lastInputAt >= T.hostAfkMs) {
        const next = this.humans()
          .filter((s) => s.id !== host.id && s.connected && now - s.lastInputAt < T.hostAfkMs)
          .sort((a, b) => b.lastInputAt - a.lastInputAt)[0];
        if (next) {
          this.hostId = next.id;
          this.clearHostTimer();
          this.broadcast();
        }
      }
    }
    return null;
  }

  // ---------------------------------------------------------------- public rooms

  get roomName(): string {
    const host = this.hostId ? this.seats.get(this.hostId) : undefined;
    return this.chosenName || defaultRoomName(host && !hasBadWords(host.name) ? host.name : 'A stranger');
  }

  /** Host: public (listed) or private, before the game starts. */
  setVisibility(id: PlayerId, v: unknown): Ack {
    if (id !== this.hostId) return fail('Only the host can change that');
    if (this.practice) return fail("Practice games can't be public");
    if (this.phase !== 'lobby') return fail('Not during a game');
    if (v !== 'public' && v !== 'private') return fail('Public or private');
    if (v === 'public' && this.visibility !== 'public') this.publicSince = Date.now();
    this.visibility = v;
    this.broadcast();
    return { ok: true };
  }

  setAutoFill(id: PlayerId, p: unknown): Ack {
    if (id !== this.hostId) return fail('Only the host can change that');
    if (!p || typeof p !== 'object') return fail('Bad setting');
    const { enabled, afterSec } = p as Partial<AutoFill>;
    if (enabled !== undefined && typeof enabled !== 'boolean') return fail('Bad setting');
    if (afterSec !== undefined && !(Number.isInteger(afterSec) && afterSec >= AUTO_FILL.minSec && afterSec <= AUTO_FILL.maxSec)) {
      return fail(`Between ${AUTO_FILL.minSec / 60} and ${AUTO_FILL.maxSec / 60} minutes`);
    }
    this.autoFill = { enabled: enabled ?? this.autoFill.enabled, afterSec: afterSec ?? this.autoFill.afterSec };
    this.broadcast();
    return { ok: true };
  }

  /** Host: bots take the empty seats up to the minimum to start. */
  fillWithBots(id: PlayerId): Ack<{ added: number }> {
    if (id !== this.hostId) return fail('Only the host can add bots');
    if (this.phase !== 'lobby') return fail('Not during a game');
    let added = 0;
    while (this.seats.size < this.deps.minPlayers) {
      const res = this.addBot(id);
      if (!res.ok) return added ? { ok: true, added } : res;
      added++;
    }
    return { ok: true, added };
  }

  /** When the host gets the "fill with bots?" offer (server time), or null. */
  private fillOfferAt(): number | null {
    if (this.visibility !== 'public' || !this.autoFill.enabled || this.phase !== 'lobby') return null;
    if (this.humans().length >= this.deps.minPlayers || this.seats.size >= this.deps.minPlayers) return null;
    return this.publicSince + this.autoFill.afterSec * 1000;
  }

  /**
   * This room's row in Find a Lobby, or null when it mustn't be listed: private, locked, full,
   * practice, already playing, or nobody here. Only what the list shows; never the code.
   */
  listing(): LobbyListing | null {
    if (this.visibility !== 'public' || this.practice || this.locked || this.phase !== 'lobby') return null;
    if (this.seats.size >= MAX_PLAYERS || !this.hasConnectedHuman() || this.closing) return null;
    const host = this.hostId ? this.seats.get(this.hostId) : undefined;
    const players = this.seats.size;
    return {
      id: this.listingId,
      name: this.roomName,
      host: host && !hasBadWords(host.name) ? host.name : 'A stranger',
      players,
      bots: [...this.seats.values()].filter((s) => s.isBot).length,
      maxPlayers: MAX_PLAYERS,
      posters: players,
      searches: this.settings.inspectsPerRound === 'auto' ? defaultInspects(players) : this.settings.inspectsPerRound,
    };
  }

  /** Host setting: lock the room to new players. */
  setLocked(id: PlayerId, locked: unknown): Ack {
    if (id !== this.hostId) return fail('Only the host can lock the room');
    if (typeof locked !== 'boolean') return fail('Bad setting');
    this.locked = locked;
    this.broadcast();
    return { ok: true };
  }

  /** Host passes to the longest-connected human. */
  private transferHost() {
    this.clearHostTimer();
    const next = this.humans()
      .filter((s) => s.connected)
      .sort((a, b) => a.connectedSince - b.connectedSince)[0];
    if (next) this.hostId = next.id;
    else if (this.hostId && !this.seats.has(this.hostId)) this.hostId = null;
    this.broadcast();
  }

  private clearHostTimer() {
    if (this.hostTimer) clearTimeout(this.hostTimer);
    this.hostTimer = null;
  }

  humans() {
    return [...this.seats.values()].filter((s) => !s.isBot);
  }

  hasConnectedHuman() {
    return this.humans().some((s) => s.connected);
  }

  /** "Stranger 1", "Stranger 2"...: the first number nobody here has. */
  private strangerName(): string {
    const taken = new Set([...this.seats.values()].map((s) => s.name.toLowerCase()));
    for (let n = 1; ; n++) if (!taken.has(`stranger ${n}`)) return `Stranger ${n}`;
  }

  private uniqueName(name: string): string {
    if (!name) return '';
    const taken = new Set([...this.seats.values()].map((s) => s.name.toLowerCase()));
    if (!taken.has(name.toLowerCase())) return name;
    for (let n = 2; ; n++) {
      const candidate = `${name.slice(0, NAME_MAX - 3)} ${n}`;
      if (!taken.has(candidate.toLowerCase())) return candidate;
    }
  }

  // ---------------------------------------------------------------- lobby

  /** Colors nobody has picked (suggested colors from joining don't count, see Seat.colorPicked). */
  freeColors(exceptId?: PlayerId): ColorId[] {
    const taken = new Set([...this.seats.values()].filter((s) => s.id !== exceptId && s.colorPicked).map((s) => s.color));
    return COLOR_IDS.filter((c) => !taken.has(c));
  }

  /** The lobby's color list, for the picker. Lobby only: mid-game it would describe the starting colors. */
  lobbyColors(id: PlayerId): Ack<{ available: ColorId[] }> {
    if (this.phase !== 'lobby') return fail('Colors are locked once the game starts');
    return { ok: true, available: this.freeColors(id) };
  }

  setLook(id: PlayerId, p: { item?: unknown; color?: unknown; cosmetics?: unknown }): Ack {
    const seat = this.seats.get(id);
    if (!seat) return fail('Not in room');
    if (this.phase !== 'lobby') return fail('Your look is locked once the game starts');
    if (p.item !== undefined && !ITEM_TYPES.includes(p.item as ItemType)) return fail('Unknown item');
    if (p.color !== undefined) {
      if (!isColorId(p.color)) return fail('Unknown color');
      if (!this.freeColors(id).includes(p.color)) return fail('That color was just taken');
    }
    const cosmetics = p.cosmetics === undefined ? {} : parseCosmetics(p.cosmetics);
    if (!cosmetics) return fail('Unknown hat or head detail');
    // Item and cosmetics are public, so their changes go to everyone.
    const itemChanged = (p.item !== undefined && p.item !== seat.item) || Object.keys(cosmetics).length > 0;
    seat.cosmetics = { ...seat.cosmetics, ...cosmetics };
    if (p.item !== undefined) seat.item = p.item as ItemType;
    if (p.color !== undefined) {
      seat.color = p.color as ColorId;
      seat.colorPicked = true;
      // Anyone merely suggested this color gets another suggestion.
      for (const s of this.seats.values()) {
        if (s !== seat && !s.colorPicked && s.color === seat.color) {
          s.color = pick(this.freeColors(s.id).filter((c) => c !== seat.color), this.rng);
          this.sendTo(s);
        }
      }
    }
    // A color change only goes to its owner, so others can't time who took what.
    if (itemChanged) this.broadcast();
    else this.sendTo(seat);
    return { ok: true };
  }

  updateSettings(id: PlayerId, p: Partial<RoomSettings>): Ack {
    if (id !== this.hostId) return fail('Only the host can change settings');
    if (this.phase !== 'lobby') return fail('Settings are locked during a game');
    const res = applySettings(this.settings, p);
    if (!res.ok) return res;
    this.settings = res.settings;
    this.broadcast();
    return { ok: true };
  }

  addBot(id: PlayerId): Ack {
    // Any room may have bots (a few friends need them to reach 6). Games with bots are tagged
    // (summary.withBots), so stats and the dashboard can keep to human-only games.
    if (id !== this.hostId) return fail('Only the host can add bots');
    const used = new Set([...this.seats.values()].map((s) => s.name));
    // Plain names ("Hank"), same style as people; the lobby marks bots with a BOT tag.
    const lower = new Set([...used].map((n) => n.toLowerCase()));
    const name = BOT_NAMES.find((n) => !lower.has(n.toLowerCase())) ?? 'Drifter';
    const res = this.addPlayer(name, null, true);
    return res.ok ? { ok: true } : res;
  }

  removeBot(id: PlayerId, botId: PlayerId): Ack {
    if (id !== this.hostId) return fail('Only the host can remove bots');
    if (this.phase !== 'lobby') return fail('Not during a game');
    if (!this.seats.get(botId)?.isBot) return fail('Not a bot');
    this.removeSeat(botId);
    return { ok: true };
  }

  start(id: PlayerId): Ack {
    if (id !== this.hostId) return fail('Only the host can start');
    if (this.phase !== 'lobby') return fail('Already started');
    const players = [...this.seats.values()].sort((a, b) => a.seat - b.seat);
    if (players.length < this.deps.minPlayers) return fail(`Need at least ${this.deps.minPlayers} players`);

    // Settle colors: picked colors are unique already; suggested ones that clash get a fresh one.
    const used = new Set(players.filter((s) => s.colorPicked).map((s) => s.color));
    for (const s of players.filter((p) => !p.colorPicked)) {
      if (used.has(s.color)) s.color = pick(COLOR_IDS.filter((c) => !used.has(c)), this.rng);
      used.add(s.color);
    }

    const { inspectsPerRound, posterMode } = this.settings;
    this.game = engine.createGame(
      players.map((s) => ({ id: s.id, color: s.color })),
      {
        inspectLimit: inspectsPerRound === 'auto' ? defaultInspects(players.length) : inspectsPerRound,
        posterMode,
        rules: this.settings.rules,
        // One poster per player, so 'auto' scales with lobby size.
        swapLimit: this.settings.colorSwaps === 'auto' ? defaultSwaps(this.practice ? PRACTICE.posters : players.length) : this.settings.colorSwaps,
        posterLimit: this.practice ? PRACTICE.posters : undefined,
      },
      this.rng,
    );
    this.replay = null;
    this.gameStartedAt = Date.now();
    this.closing = null;
    for (const s of this.seats.values()) Object.assign(s, { actedThisPoster: false, idlePosters: 0 });
    this.gameId = makeId(9);
    this.posterStarts = [];
    this.feedbackFrom.clear();
    for (const s of this.seats.values()) {
      s.disconnects = 0;
      s.reconnects = 0;
    }
    this.trackStep('game_start', players);
    // The first poster's phase runs a few seconds longer: clients count down over that time.
    this.enterPhase('poster', GAME_COUNTDOWN_SECONDS * 1000);
    return { ok: true };
  }

  /** Seats the bots and starts at once, with the practice timers. */
  startPractice(humanId: PlayerId): Ack {
    if (!this.practice) return fail('Not a practice room');
    this.settings = { ...this.settings, timers: { ...PRACTICE.timers }, posterMode: 'randomRepeats' };
    for (let i = 0; i < PRACTICE.bots; i++) {
      const res = this.addBot(humanId);
      if (!res.ok) return res;
    }
    return this.start(humanId);
  }

  backToLobby(id: PlayerId): Ack {
    if (id !== this.hostId) return fail('Only the host can do that');
    if (this.phase !== 'ended') return fail('The game is still running');
    this.clearPhaseTimer();
    // Players keep the color they ended the game with (still unique).
    if (this.game) for (const s of this.seats.values()) s.color = this.game.colors[s.id] ?? s.color;
    this.game = null;
    this.replay = null;
    this.phase = 'lobby';
    this.phaseEndsAt = null;
    // Gone players leave with the game; anyone still here who was only idle is welcome back.
    for (const s of [...this.seats.values()]) {
      if (s.away && (!s.connected || s.removed)) this.seats.delete(s.id);
      else Object.assign(s, { away: false, idlePosters: 0, actedThisPoster: false });
    }
    this.lobbySince = this.lastActivityAt = Date.now();
    this.closing = null;
    for (const s of this.seats.values()) s.colorPicked = false; // back to suggestions
    this.bots.onPhase('lobby');
    this.broadcast();
    return { ok: true };
  }

  // ---------------------------------------------------------------- game intents

  inspect(id: PlayerId, targetId: PlayerId): Ack<{ entryId: string; result: ColorId[] }> {
    this.noteInput(id);
    if (!this.game || this.phase !== 'investigation') return fail('You can only inspect during the investigation');
    const res = engine.inspect(this.game, id, targetId, this.rng);
    if (!res.ok) return res;
    this.broadcast();
    return { ok: true, entryId: res.entry.id, result: res.result };
  }

  vote(id: PlayerId, targetId: PlayerId): Ack {
    this.noteInput(id);
    if (!this.game || this.phase !== 'vote') return fail('Voting is closed');
    const res = engine.castVote(this.game, id, targetId);
    if (!res.ok) return res;
    // Who voted for whom stays secret; everyone sees the count go up ("6/9 have voted").
    this.broadcast();
    this.checkVotesDone();
    return { ok: true };
  }

  // ---------------------------------------------------------------- buying (private: only buyer and seller get updates)

  private sendToIds(...ids: PlayerId[]) {
    for (const id of new Set(ids)) {
      const seat = this.seats.get(id);
      if (seat) this.sendTo(seat);
    }
  }

  offer(id: PlayerId, entryId: unknown): Ack<{ offerId: string }> {
    this.noteInput(id);
    if (!this.game || this.phase !== 'investigation') return fail('You can only buy during the investigation');
    if (typeof entryId !== 'string') return fail('Unknown inspect');
    const res = engine.makeOffer(this.game, id, entryId);
    if (!res.ok) return res;
    this.sendToIds(res.offer.buyerId, res.offer.sellerId);
    this.bots.onOffer(res.offer);
    return { ok: true, offerId: res.offer.id };
  }

  respondOffer(id: PlayerId, offerId: unknown, accept: unknown): Ack {
    this.noteInput(id);
    if (!this.game || this.phase !== 'investigation') return fail('Offers are closed');
    if (typeof offerId !== 'string' || typeof accept !== 'boolean') return fail('Bad response');
    const res = engine.respondOffer(this.game, id, offerId, accept);
    if (!res.ok) return res;
    this.sendToIds(res.offer.buyerId, res.offer.sellerId);
    return { ok: true };
  }

  buyExtraInspect(id: PlayerId): Ack {
    this.noteInput(id);
    if (!this.game || this.phase !== 'investigation') return fail('You can only buy during the investigation');
    const res = engine.buyExtraInspect(this.game, id);
    if (!res.ok) return res;
    this.sendToIds(id);
    return { ok: true };
  }

  // ---------------------------------------------------------------- color swaps (private: only the swapper gets updates)

  private swapWindow(seat: Seat | undefined): string | null {
    if (!seat) return 'Not in room';
    if (!this.game || this.phase !== 'payout') return 'You can only change color between posters, during the payout';
    if (!engine.hasNextPoster(this.game)) return 'No more posters, so no more color changes';
    if (!seat.isBot && !seat.connected) return 'Reconnect to change color';
    return null;
  }

  /** The server picks a random free color. Only the swapper is told. */
  swapColor(id: PlayerId): Ack<{ color: ColorId }> {
    this.noteInput(id);
    const seat = this.seats.get(id);
    const err = this.swapWindow(seat);
    if (err) return fail(err);
    const res = engine.swapColor(this.game!, id, this.rng);
    if (!res.ok) return res;
    this.sendTo(seat!);
    return { ok: true, color: res.color };
  }


  /** End the vote early once everyone who can act has voted. */
  private checkVotesDone() {
    if (!this.game || this.phase !== 'vote') return;
    // Away players (gone, or idle for posters) don't hold the vote open.
    const active = [...this.seats.values()].filter((s) => (s.isBot || s.connected) && !s.away);
    if (active.length && active.every((s) => this.game!.votes[s.id])) {
      this.clearPhaseTimer();
      this.phaseTimer = setTimeout(() => this.onPhaseEnd(), 800);
    }
  }

  sendChat(id: PlayerId, raw: unknown): Ack {
    this.noteInput(id);
    const seat = this.seats.get(id);
    if (!seat) return fail('Not in room');
    // Public rooms are full of strangers: filtered words show as asterisks. Private rooms are
    // friends' rooms and are left as typed (mute and report work in both).
    const clean = cleanText(raw, CHAT_MAX);
    const text = this.visibility === 'public' ? maskBadWords(clean) : clean;
    if (!text) return fail('Empty message');
    const now = Date.now();
    if (now - seat.lastChatAt < CHAT_COOLDOWN_MS) return fail('Slow down');
    seat.lastChatAt = now;
    const msg: ChatMessage = {
      id: makeId(6),
      playerId: id,
      name: seat.name,
      text,
      poster: this.game && this.phase !== 'lobby' ? this.game.posterIndex : null,
      at: now,
    };
    this.chat.push(msg);
    if (this.chat.length > CHAT_HISTORY) this.chat.splice(0, this.chat.length - CHAT_HISTORY);
    for (const s of this.seats.values()) if (s.socketId) this.deps.send(s.socketId, 'chat', msg);
    this.bots.onChat(msg);
    return { ok: true };
  }

  /** Reports per player per room, so one person can't flood the admins. */
  private readonly reports = new Map<PlayerId, Set<string>>();

  /**
   * A player reports a chat message. The message and up to four before it are stored for the
   * admins (text only, no names): the only time chat is ever kept.
   */
  reportChat(id: PlayerId, messageId: unknown, reason: unknown): Ack {
    const seat = this.seats.get(id);
    if (!seat) return fail('Not in room');
    if (typeof messageId !== 'string') return fail('Unknown message');
    const i = this.chat.findIndex((m) => m.id === messageId);
    if (i < 0) return fail('That message is gone');
    const msg = this.chat[i];
    if (msg.playerId === id) return fail("You can't report yourself");
    const mine = this.reports.get(id) ?? new Set<string>();
    if (mine.has(messageId)) return fail('Already reported');
    if (mine.size >= 10) return fail('Thanks, the admins have your reports');
    mine.add(messageId);
    this.reports.set(id, mine);
    this.track({
      type: 'safety',
      kind: 'report',
      by: 'player',
      anon: seat.anon,
      target: this.anonOf(msg.playerId),
      reason: cleanText(reason, REPORT_REASON_MAX),
      chat: this.chat.slice(Math.max(0, i - 4), i + 1).map((m) => ({ text: m.text, reported: m.id === msg.id, fromReported: m.playerId === msg.playerId })),
    });
    return { ok: true };
  }

  /** The player's browser reports what they did with How to Play (for playtest stats). */
  setHowto(id: PlayerId, status: unknown): Ack {
    const seat = this.seats.get(id);
    if (!seat) return fail('Not in room');
    if (!HOWTO_STATUSES.includes(status as HowtoStatus)) return fail('Bad status');
    // Only ever upgrades: never -> skipped -> finished.
    const rank = (s: HowtoStatus | null) => (s ? HOWTO_STATUSES.indexOf(s) : -1);
    if (rank(status as HowtoStatus) > rank(seat.howto)) seat.howto = status as HowtoStatus;
    return { ok: true };
  }

  /** End-of-game feedback form: once per player per game, plain text, capped. */
  submitFeedback(id: PlayerId, raw: unknown): Ack {
    const seat = this.seats.get(id);
    if (!seat || seat.isBot) return fail('Not in room');
    if (this.phase !== 'ended' || !this.gameId) return fail('Feedback opens when the game ends');
    if (this.feedbackFrom.has(id)) return fail('Thanks, we already have yours');
    const answers = parseFeedback(raw);
    if (!answers) return fail('Bad feedback');
    this.feedbackFrom.add(id);
    this.deps.onFeedback?.({ at: new Date().toISOString(), gameId: this.gameId, name: seat.name, anon: seat.anon, answers });
    return { ok: true };
  }

  skipPhase(id: PlayerId): Ack {
    if (!this.deps.devMode) return fail('Dev only');
    if (id !== this.hostId) return fail('Host only');
    if (this.phase === 'lobby' || this.phase === 'ended') return fail('Nothing to skip');
    this.clearPhaseTimer();
    this.onPhaseEnd();
    return { ok: true };
  }

  // ---------------------------------------------------------------- phases

  private enterPhase(phase: Exclude<Phase, 'lobby' | 'ended'>, extraMs = 0) {
    this.clearPhaseTimer();
    this.phase = phase;
    const ms = this.settings.timers[phase] * 1000 + extraMs;
    this.phaseEndsAt = Date.now() + ms;
    this.phaseTimer = setTimeout(() => this.onPhaseEnd(), ms);
    if (phase === 'poster' && this.game) this.posterStarts[this.game.posterIndex] = Date.now();
    this.bots.onPhase(phase);
    this.broadcast();
  }

  private onPhaseEnd() {
    this.phaseTimer = null;
    const game = this.game;
    if (!game) return;
    switch (this.phase) {
      case 'poster':
        return this.enterPhase('investigation');
      case 'investigation':
        engine.expireOffers(game);
        return this.enterPhase('vote');
      case 'vote':
        engine.resolvePoster(game);
        this.reviewIdlePlayers();
        engine.setPosterReactions(game, this.deps.rng);
        return this.enterPhase('payout');
      case 'payout':
        if (engine.hasNextPoster(game)) {
          engine.advancePoster(game);
          return this.enterPhase('poster');
        }
        this.phase = 'ended';
        this.phaseEndsAt = null;
        this.replay = engine.buildReplay(game);
        engine.setEndReactions(game, this.deps.rng);
        this.bots.onPhase('ended');
        this.trackStep('game_finish', [...this.seats.values()].filter((s) => !s.away));
        if (!this.practice) {
          try {
            this.deps.onFinished?.({ ...this.finishedGame()!, endedAt: new Date().toISOString() });
          } catch {}
        }
        try {
          if (!this.practice) this.deps.onGameEnd?.(
            summarize(game, {
              gameId: this.gameId,
              check: !!this.deps.check,
              startedAt: this.gameStartedAt,
              settings: this.settings,
              isBot: (id) => !!this.seats.get(id)?.isBot,
              posterStarts: this.posterStarts,
              seat: (id) => {
                const s = this.seats.get(id);
                return { disconnects: s?.disconnects ?? 0, reconnects: s?.reconnects ?? 0, howto: s?.howto ?? null, away: !!s?.away, anon: s?.anon ?? null };
              },
            }),
          );
        } catch (err) {
          console.error('game summary failed', err);
        }
        return this.broadcast();
    }
  }

  private clearPhaseTimer() {
    if (this.phaseTimer) clearTimeout(this.phaseTimer);
    this.phaseTimer = null;
  }

  // ---------------------------------------------------------------- views

  viewFor(seat: Seat): PlayerView {
    const players: PublicPlayer[] = [...this.seats.values()]
      .sort((a, b) => a.seat - b.seat)
      .map((s) => ({
        id: s.id,
        name: s.name,
        item: s.item,
        cosmetics: { ...s.cosmetics },
        seat: s.seat,
        isHost: s.id === this.hostId,
        isBot: s.isBot,
        connected: s.isBot || s.connected,
        away: s.away,
      }));
    return {
      code: this.code,
      serverNow: Date.now(),
      devMode: this.deps.devMode,
      minPlayers: this.deps.minPlayers,
      maxPlayers: MAX_PLAYERS,
      you: {
        id: seat.id,
        name: seat.name,
        color: this.game?.colors[seat.id] ?? seat.color,
        item: seat.item,
        isHost: seat.id === this.hostId,
      },
      players,
      settings: this.settings,
      phase: this.phase,
      phaseEndsAt: this.phaseEndsAt,
      game: this.game && this.phase !== 'lobby' ? engine.gameViewFor(this.game, seat.id) : null,
      replay: this.phase === 'ended' ? this.replay : null,
      practice: this.practice,
      locked: this.locked,
      room: { name: this.roomName, visibility: this.visibility, autoFill: { ...this.autoFill }, fillOfferAt: this.fillOfferAt(), closing: this.closing ? { ...this.closing } : null },
    };
  }

  sendTo(seat: Seat) {
    if (seat.socketId) this.deps.send(seat.socketId, 'view', this.viewFor(seat));
  }

  /** Coalesces several changes in one tick into one view per player. */
  broadcast() {
    if (this.flushQueued) return;
    this.flushQueued = true;
    queueMicrotask(() => {
      this.flushQueued = false;
      for (const seat of this.seats.values()) this.sendTo(seat);
      // Every broadcast can change the list row (players, host, phase, lock...); the list throttles.
      this.deps.onListingChange?.();
    });
  }

  /** A game cut short (room closed mid-game) counts as abandoned. */
  private trackAbandoned() {
    if (!this.game || this.phase === 'lobby' || this.phase === 'ended') return;
    this.track({ type: 'abandoned', gameId: this.gameId, humans: this.humans().length, players: this.seats.size, poster: this.game.posterIndex, posters: this.game.order.length });
  }

  /** Admins close the room: everyone in it is told, and any game in progress ends (abandoned). */
  close(reason: string) {
    for (const s of this.seats.values()) if (s.socketId) this.deps.send(s.socketId, 'roomClosed', { reason });
    this.dispose();
  }

  /** Public information only, safe to show the admins while a game runs (a test checks it). */
  snapshot(): RoomSnapshot {
    const host = this.hostId ? this.seats.get(this.hostId) : undefined;
    const inGame = !!this.game && this.phase !== 'lobby';
    return {
      code: this.code,
      createdAt: new Date(this.createdAt).toISOString(),
      phase: this.phase,
      phaseEndsAt: this.phaseEndsAt,
      poster: inGame ? this.game!.posterIndex : null,
      posters: inGame ? this.game!.order.length : null,
      locked: this.locked,
      practice: this.practice,
      visibility: this.visibility,
      name: this.roomName,
      host: host?.name ?? null,
      players: [...this.seats.values()]
        .sort((a, b) => a.seat - b.seat)
        .map((s) => ({ name: s.name, bot: s.isBot, connected: s.isBot || s.connected, away: s.away, host: s.id === this.hostId, anon: s.anon })),
    };
  }

  /** The finished game with its secrets, only once it has ended. Null before that. */
  finishedGame(): FinishedGame | null {
    if (this.phase !== 'ended' || !this.replay) return null;
    const names = Object.fromEntries([...this.seats.values()].map((s) => [s.id, s.name]));
    return { gameId: this.gameId, code: this.code, endedAt: '', names, replay: this.replay };
  }

  /** Socket ids of everyone connected here. */
  socketIds(): string[] {
    return [...this.seats.values()].flatMap((s) => (s.socketId ? [s.socketId] : []));
  }

  private disposed = false;
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.trackAbandoned();
    this.clearPhaseTimer();
    this.clearHostTimer();
    this.bots.clear();
    for (const s of this.seats.values()) if (s.holdTimer) clearTimeout(s.holdTimer);
  }
}
