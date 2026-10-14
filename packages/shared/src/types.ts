import type { Cosmetics } from './cosmetics';
import type { ColorId } from './palette';
import type { RoomInfo } from './lobby';

export type PlayerId = string;
export type ItemType = 'poncho' | 'cloak' | 'bandana';

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
  /** Searches you get for one extra-search purchase. */
  extraInspectCount: number;
  purchaseCap: number;
  /** Dirty trick: price of a color change. */
  swapPrice: number;
  /** Dirty trick: price of covering your tracks for the next round. */
  coverPrice: number;
  /** Price of a private snapshot of everyone's worth. */
  worthPrice: number;
  /** Decoy colors shown with the real one on each inspect (spec: 2). */
  decoys: number;
}

export interface RoomSettings {
  /** 'auto' = 3 for 6–11 players, 4 for 12–15. */
  inspectsPerRound: number | 'auto';
  /** Most color changes per player per game. 'auto' = one per payout (see defaultSwaps). 0 = off. Each one costs rules.swapPrice. */
  colorSwaps: number | 'auto';
  /** Posters in a game (POSTER_RANGE). Each picks a random outlaw; repeats allowed. */
  posters: number;
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
  swapLimit: number;
  swapsUsed: number;
  /** Your dirty trick this payout (one per payout, final, secret), or null. */
  trickThisPayout: DirtyTrick | null;
  /** You covered your tracks for this poster: searches of you show false results. */
  coveredThisPoster: boolean;
  /** Your latest snapshot of everyone's worth (bought, private), or null. */
  myWorth: WorthSnapshot | null;
  /** You already bought a worth snapshot this poster. */
  worthBoughtThisPoster: boolean;
  /** Private: your own color history. */
  myColorHistory: ColorChange[];
  myVote: PlayerId | null;
  /** Public: how many players have voted on this poster so far (never who). */
  votesCast: number;
  /** What each player earned from the most recent bounty (totals stay hidden until the end). */
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

export type DirtyTrick = 'swap' | 'cover';

/** First-game tutorial progress a browser reports: the stage reached (1-4, 4 = everything
 *  unlocked), or that the player skipped it. */
export type TutorialProgress = 1 | 2 | 3 | 4 | 'skipped';

/** Everyone's money as of the last payout, bought privately. */
export interface WorthSnapshot {
  /** Poster (0-based) it was bought during. */
  poster: number;
  /** Totals as of the latest payout. */
  scores: Record<PlayerId, number>;
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
  /** Room name, public or private, and the host's auto-fill setting. */
  room: RoomInfo;
}
