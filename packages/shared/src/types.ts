import type { Cosmetics } from './cosmetics';
import type { ColorId } from './palette';

export type PlayerId = string;
export type ItemType = 'poncho' | 'cloak' | 'bandana';

/**
 * everyoneOnce: shuffled order, each player Wanted exactly once (spec default).
 * randomRepeats: each poster picks a random player; repeats allowed.
 */
export type PosterMode = 'everyoneOnce' | 'randomRepeats';

export type Phase = 'lobby' | 'poster' | 'investigation' | 'vote' | 'payout' | 'ended';

export interface PhaseTimers {
  poster: number;
  investigation: number;
  vote: number;
  payout: number;
}

/** Balance numbers. Host-tunable so playtests can try alternatives without a code change. */
export interface GameRules {
  startingPoints: number;
  basePot: number;
  escapeBonus: number;
  buyPrice: number;
  extraInspectPrice: number;
  purchaseCap: number;
  /** Decoy colors shown with the real one on each inspect (spec: 2). */
  decoys: number;
}

export interface RoomSettings {
  /** 'auto' = 3 for 6–11 players, 4 for 12–15. */
  inspectsPerRound: number | 'auto';
  /** Color changes per player per game. 'auto' = about 1 per 4 posters (see defaultSwaps). 0 = off. */
  colorSwaps: number | 'auto';
  posterMode: PosterMode;
  timers: PhaseTimers;
  rules: GameRules;
}

/** What everyone may know about a player. Never contains a color. */
export interface PublicPlayer {
  id: PlayerId;
  name: string;
  item: ItemType;
  /** Hat and head detail. Public: everyone sees everyone's. */
  cosmetics: Cosmetics;
  seat: number;
  isHost: boolean;
  isBot: boolean;
  connected: boolean;
  away: boolean;
}

export interface InspectLogEntry {
  id: string;
  poster: number;
  inspectorId: PlayerId;
  targetId: PlayerId;
  at: number;
}

export interface ChatMessage {
  id: string;
  playerId: PlayerId;
  name: string;
  text: string;
  /** Poster index when sent, null in lobby. */
  poster: number | null;
  at: number;
}

/** One entry in a player's color history. afterPoster null = starting color. */
export interface ColorChange {
  color: ColorId;
  /** 0-based poster index this change happened after (during its payout). */
  afterPoster: number | null;
}

/** Animation a scarecrow plays after a payout or at the end of the game. Decided by the server. */
export type Reaction = 'victory' | 'despair-1' | 'despair-2';

/**
 * Reactions for one payout (key `poster-<n>`) or the end of the game (key `end`).
 * Built per viewer: the Wanted player always shows despair to everyone else; only
 * their own view carries their true result.
 */
export interface ReactionsView {
  key: string;
  byPlayer: Record<PlayerId, Reaction>;
}

export type OfferStatus = 'pending' | 'accepted' | 'declined' | 'expired';

/** An offer to buy one inspect result. Only the buyer and seller ever see it. */
export interface OfferView {
  id: string;
  entryId: string;
  buyerId: PlayerId;
  sellerId: PlayerId;
  price: number;
  status: OfferStatus;
  poster: number;
  at: number;
}

/** One poster's outcome from a single player's point of view. */
export interface RoundResult {
  poster: number;
  color: ColorId;
  wasWanted: boolean;
  /** Wanted player only: nobody voted for them. */
  escaped: boolean;
  votedFor: PlayerId | null;
  correct: boolean;
  /** Only set when this player is allowed to know (voted correctly, or was Wanted). */
  wantedId: PlayerId | null;
  payout: number;
}

export interface GameView {
  posterIndex: number;
  posterCount: number;
  posterColor: ColorId;
  pot: number;
  youAreWanted: boolean;
  /** Base inspects per round, from settings. */
  inspectLimit: number;
  /** Extra inspects bought this round. */
  extraInspects: number;
  inspectsUsed: number;
  /** Completed purchases this round (accepted offers + extra inspects). */
  purchasesUsed: number;
  log: InspectLogEntry[];
  /** Inspect results this player owns or bought, by log entry id. */
  myResults: Record<string, ColorId[]>;
  /** Log entry ids whose result was bought (subset of myResults). */
  boughtEntryIds: string[];
  offersOut: OfferView[];
  offersIn: OfferView[];
  /** Public: players who changed color before each poster (index = poster). Never says who. */
  colorChanges: number[];
  swapLimit: number;
  swapsUsed: number;
  /** You already changed color this payout (one per payout, final). */
  swappedThisPayout: boolean;
  /** Private: your own color history. */
  myColorHistory: ColorChange[];
  myVote: PlayerId | null;
  /** Public scores, updated after each payout. */
  scores: Record<PlayerId, number>;
  /** Score changes from the most recent payout. */
  scoreDeltas: Record<PlayerId, number>;
  /** Live own score (differs from public once buying exists). */
  myScore: number;
  myCorrectVotes: number;
  /** Your escape bonuses, held until the end of the game (private). */
  myHeldEscapeBonus: number;
  myRounds: RoundResult[];
  /** Set during a payout and after the game ends; null otherwise. */
  reactions: ReactionsView | null;
}

export interface ReplayPoster {
  poster: number;
  wantedId: PlayerId;
  color: ColorId;
  pot: number;
  votes: Record<PlayerId, PlayerId | null>;
  correctIds: PlayerId[];
  escaped: boolean;
  payoutEach: number;
}

export interface ReplayView {
  /** Final colors. */
  colors: Record<PlayerId, ColorId>;
  colorHistory: Record<PlayerId, ColorChange[]>;
  posters: ReplayPoster[];
  /** `real` is the target's color at the time of that inspect. */
  log: (InspectLogEntry & { result: ColorId[]; real: ColorId })[];
  /** Final scores, including escape bonuses. */
  finalScores: Record<PlayerId, number>;
  /** Escape bonuses paid at the end (included in finalScores). */
  escapeBonuses: Record<PlayerId, number>;
  correctVotes: Record<PlayerId, number>;
  winners: PlayerId[];
}

/** Everything one client is allowed to see. Built per player on the server. */
export interface PlayerView {
  code: string;
  serverNow: number;
  devMode: boolean;
  minPlayers: number;
  maxPlayers: number;
  you: { id: PlayerId; name: string; color: ColorId; item: ItemType; isHost: boolean };
  players: PublicPlayer[];
  settings: RoomSettings;
  phase: Phase;
  phaseEndsAt: number | null;
  game: GameView | null;
  replay: ReplayView | null;
  /** A practice game against bots: the client shows hint bubbles. */
  practice: boolean;
  /** Host has locked the room to new players. */
  locked: boolean;
}
