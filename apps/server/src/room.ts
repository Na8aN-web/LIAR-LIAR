import {
  CHAT_MAX,
  COLOR_IDS,
  DEFAULT_SETTINGS,
  HOST_GRACE_MS,
  INSPECT_RANGE,
  ITEM_TYPES,
  MAX_PLAYERS,
  NAME_MAX,
  POSTER_MODES,
  RULE_LIMITS,
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
import { makeId, pick, type Rng } from './rng';

export interface Seat {
  id: PlayerId;
  token: string;
  name: string;
  item: ItemType;
  color: ColorId;
  seat: number;
  isBot: boolean;
  socketId: string | null;
  connected: boolean;
  away: boolean;
  connectedSince: number;
  holdTimer: NodeJS.Timeout | null;
  lastChatAt: number;
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
  bots?: Partial<BotConfig>;
}

const CHAT_HISTORY = 150;
const CHAT_COOLDOWN_MS = 400;
const BOT_NAMES = ['Hank', 'Dolly', 'Clem', 'Ezra', 'Mae', 'Silas', 'Ruby', 'Jeb', 'Pearl', 'Wyatt', 'Etta', 'Boone', 'Nell', 'Cody', 'June'];

const fail = (error: string) => ({ ok: false as const, error });

export function cleanText(raw: unknown, max: number): string {
  if (typeof raw !== 'string') return '';
  return raw.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
}

export class Room {
  readonly seats = new Map<PlayerId, Seat>();
  hostId: PlayerId | null = null;
  settings: RoomSettings = structuredClone(DEFAULT_SETTINGS);
  phase: Phase = 'lobby';
  phaseEndsAt: number | null = null;
  game: engine.GameState | null = null;
  replay: ReplayView | null = null;
  chat: ChatMessage[] = [];
  /** Set while no human is connected; used by the room sweeper. */
  idleSince: number | null = null;

  private phaseTimer: NodeJS.Timeout | null = null;
  private gameStartedAt = 0;
  private hostTimer: NodeJS.Timeout | null = null;
  private nextSeat = 0;
  private flushQueued = false;
  private readonly bots: BotDriver;

  constructor(readonly code: string, private readonly deps: RoomDeps) {
    this.bots = new BotDriver(this, deps.rng, deps.bots);
  }

  get rng() {
    return this.deps.rng;
  }

  // ---------------------------------------------------------------- membership

  addPlayer(rawName: string, socketId: string | null, isBot = false): Ack<{ seat: Seat }> {
    if (this.phase !== 'lobby') return fail('That game has already started');
    if (this.seats.size >= MAX_PLAYERS) return fail('Room is full');
    const name = this.uniqueName(cleanText(rawName, NAME_MAX));
    if (!name) return fail('Enter a name');

    const free = this.freeColors();
    const now = Date.now();
    const seat: Seat = {
      id: makeId(),
      token: makeId(18),
      name,
      item: pick(ITEM_TYPES, this.rng),
      color: pick(free, this.rng),
      seat: this.nextSeat++,
      isBot,
      socketId,
      connected: !isBot,
      away: false,
      connectedSince: now,
      holdTimer: null,
      lastChatAt: 0,
    };
    this.seats.set(seat.id, seat);
    if (!this.hostId && !isBot) this.hostId = seat.id;
    this.broadcast();
    if (socketId) this.deps.send(socketId, 'chatHistory', this.chat);
    return { ok: true, seat };
  }

  resume(token: string, socketId: string): Seat | null {
    const seat = [...this.seats.values()].find((s) => !s.isBot && s.token === token);
    if (!seat) return null;
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

  freeColors(exceptId?: PlayerId): ColorId[] {
    const taken = new Set([...this.seats.values()].filter((s) => s.id !== exceptId).map((s) => s.color));
    return COLOR_IDS.filter((c) => !taken.has(c));
  }

  setLook(id: PlayerId, p: { item?: unknown; color?: unknown }): Ack {
    const seat = this.seats.get(id);
    if (!seat) return fail('Not in room');
    if (this.phase !== 'lobby') return fail('Your look is locked once the game starts');
    if (p.item !== undefined && !ITEM_TYPES.includes(p.item as ItemType)) return fail('Unknown item');
    if (p.color !== undefined) {
      if (!isColorId(p.color)) return fail('Unknown color');
      if (!this.freeColors(id).includes(p.color)) return fail('That color was just taken');
    }
    const itemChanged = p.item !== undefined && p.item !== seat.item;
    if (p.item !== undefined) seat.item = p.item as ItemType;
    if (p.color !== undefined) seat.color = p.color as ColorId;
    // A color change only goes to its owner, so others can't time who took what.
    if (itemChanged) this.broadcast();
    else this.sendTo(seat);
    return { ok: true };
  }

  updateSettings(id: PlayerId, p: Partial<RoomSettings>): Ack {
    if (id !== this.hostId) return fail('Only the host can change settings');
    if (this.phase !== 'lobby') return fail('Settings are locked during a game');
    if (!p || typeof p !== 'object') return fail('Bad settings');
    const next = structuredClone(this.settings);

    if (p.inspectsPerRound !== undefined) {
      const v = p.inspectsPerRound;
      if (v !== 'auto' && !(Number.isInteger(v) && v >= INSPECT_RANGE.min && v <= INSPECT_RANGE.max)) {
        return fail('Inspects must be 2–5 or auto');
      }
      next.inspectsPerRound = v;
    }
    if (p.colorSwaps !== undefined) {
      const v = p.colorSwaps;
      if (v !== 'auto' && !(Number.isInteger(v) && v >= SWAP_RANGE.min && v <= SWAP_RANGE.max)) {
        return fail(`Color swaps must be ${SWAP_RANGE.min}–${SWAP_RANGE.max} or auto`);
      }
      next.colorSwaps = v;
    }
    if (p.posterMode !== undefined) {
      if (!POSTER_MODES.includes(p.posterMode)) return fail('Unknown poster mode');
      next.posterMode = p.posterMode;
    }
    if (p.timers !== undefined) {
      if (!p.timers || typeof p.timers !== 'object') return fail('Bad timers');
      for (const key of Object.keys(TIMER_LIMITS) as (keyof PhaseTimers)[]) {
        const v = (p.timers as Partial<PhaseTimers>)[key];
        if (v === undefined) continue;
        const [min, max] = TIMER_LIMITS[key];
        if (!Number.isInteger(v) || v < min || v > max) return fail(`${key} timer must be ${min}–${max}s`);
        next.timers[key] = v;
      }
    }
    if (p.rules !== undefined) {
      if (!p.rules || typeof p.rules !== 'object') return fail('Bad rules');
      for (const key of Object.keys(RULE_LIMITS) as (keyof GameRules)[]) {
        const v = (p.rules as Partial<GameRules>)[key];
        if (v === undefined) continue;
        const [min, max] = RULE_LIMITS[key];
        if (!Number.isInteger(v) || v < min || v > max) return fail(`${key} must be ${min}–${max}`);
        next.rules[key] = v;
      }
    }
    this.settings = next;
    this.broadcast();
    return { ok: true };
  }

  addBot(id: PlayerId): Ack {
    if (!this.deps.devMode) return fail('Bots are dev-only');
    if (id !== this.hostId) return fail('Only the host can add bots');
    const used = new Set([...this.seats.values()].map((s) => s.name));
    const name = BOT_NAMES.find((n) => !used.has(`Bot ${n}`)) ?? 'Bot';
    const res = this.addPlayer(`Bot ${name}`, null, true);
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

    const { inspectsPerRound, posterMode } = this.settings;
    this.game = engine.createGame(
      players.map((s) => ({ id: s.id, color: s.color })),
      {
        inspectLimit: inspectsPerRound === 'auto' ? defaultInspects(players.length) : inspectsPerRound,
        posterMode,
        rules: this.settings.rules,
        // One poster per player, so 'auto' scales with lobby size.
        swapLimit: this.settings.colorSwaps === 'auto' ? defaultSwaps(players.length) : this.settings.colorSwaps,
      },
      this.rng,
    );
    this.replay = null;
    this.gameStartedAt = Date.now();
    this.enterPhase('poster');
    return { ok: true };
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
    for (const s of [...this.seats.values()]) if (s.away) this.seats.delete(s.id);
    this.bots.onPhase('lobby');
    this.broadcast();
    return { ok: true };
  }

  // ---------------------------------------------------------------- game intents

  inspect(id: PlayerId, targetId: PlayerId): Ack<{ entryId: string; result: ColorId[] }> {
    if (!this.game || this.phase !== 'investigation') return fail('You can only inspect during the investigation');
    const res = engine.inspect(this.game, id, targetId, this.rng);
    if (!res.ok) return res;
    this.broadcast();
    return { ok: true, entryId: res.entry.id, result: res.result };
  }

  vote(id: PlayerId, targetId: PlayerId): Ack {
    if (!this.game || this.phase !== 'vote') return fail('Voting is closed');
    const res = engine.castVote(this.game, id, targetId);
    if (!res.ok) return res;
    // Votes are secret: only the voter gets an update.
    const seat = this.seats.get(id);
    if (seat) this.sendTo(seat);
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
    if (!this.game || this.phase !== 'investigation') return fail('You can only buy during the investigation');
    if (typeof entryId !== 'string') return fail('Unknown inspect');
    const res = engine.makeOffer(this.game, id, entryId);
    if (!res.ok) return res;
    this.sendToIds(res.offer.buyerId, res.offer.sellerId);
    this.bots.onOffer(res.offer);
    return { ok: true, offerId: res.offer.id };
  }

  respondOffer(id: PlayerId, offerId: unknown, accept: unknown): Ack {
    if (!this.game || this.phase !== 'investigation') return fail('Offers are closed');
    if (typeof offerId !== 'string' || typeof accept !== 'boolean') return fail('Bad response');
    const res = engine.respondOffer(this.game, id, offerId, accept);
    if (!res.ok) return res;
    this.sendToIds(res.offer.buyerId, res.offer.sellerId);
    return { ok: true };
  }

  buyExtraInspect(id: PlayerId): Ack {
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
    const seat = this.seats.get(id);
    const err = this.swapWindow(seat);
    if (err) return fail(err);
    const res = engine.swapColor(this.game!, id, this.rng);
    if (!res.ok) return res;
    this.sendTo(seat!);
    return { ok: true, color: res.color };
  }

  undoSwap(id: PlayerId): Ack<{ color: ColorId }> {
    const seat = this.seats.get(id);
    const err = this.swapWindow(seat);
    if (err) return fail(err);
    const res = engine.undoSwap(this.game!, id);
    if (!res.ok) return res;
    this.sendTo(seat!);
    return { ok: true, color: res.color };
  }

  /** End the vote early once everyone who can act has voted. */
  private checkVotesDone() {
    if (!this.game || this.phase !== 'vote') return;
    const active = [...this.seats.values()].filter((s) => s.isBot || s.connected);
    if (active.length && active.every((s) => this.game!.votes[s.id])) {
      this.clearPhaseTimer();
      this.phaseTimer = setTimeout(() => this.onPhaseEnd(), 800);
    }
  }

  sendChat(id: PlayerId, raw: unknown): Ack {
    const seat = this.seats.get(id);
    if (!seat) return fail('Not in room');
    const text = cleanText(raw, CHAT_MAX);
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

  skipPhase(id: PlayerId): Ack {
    if (!this.deps.devMode) return fail('Dev only');
    if (id !== this.hostId) return fail('Host only');
    if (this.phase === 'lobby' || this.phase === 'ended') return fail('Nothing to skip');
    this.clearPhaseTimer();
    this.onPhaseEnd();
    return { ok: true };
  }

  // ---------------------------------------------------------------- phases

  private enterPhase(phase: Exclude<Phase, 'lobby' | 'ended'>) {
    this.clearPhaseTimer();
    this.phase = phase;
    const ms = this.settings.timers[phase] * 1000;
    this.phaseEndsAt = Date.now() + ms;
    this.phaseTimer = setTimeout(() => this.onPhaseEnd(), ms);
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
        return this.enterPhase('payout');
      case 'payout':
        if (engine.hasNextPoster(game)) {
          engine.advancePoster(game);
          return this.enterPhase('poster');
        }
        this.phase = 'ended';
        this.phaseEndsAt = null;
        this.replay = engine.buildReplay(game);
        this.bots.onPhase('ended');
        try {
          this.deps.onGameEnd?.(
            summarize(game, {
              startedAt: this.gameStartedAt,
              settings: this.settings,
              isBot: (id) => !!this.seats.get(id)?.isBot,
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
    });
  }

  dispose() {
    this.clearPhaseTimer();
    this.clearHostTimer();
    this.bots.clear();
    for (const s of this.seats.values()) if (s.holdTimer) clearTimeout(s.holdTimer);
  }
}
