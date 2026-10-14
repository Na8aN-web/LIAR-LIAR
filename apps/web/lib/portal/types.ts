import type { PortalId, RoomPresence } from '@wtc/shared';
import type { KeyValue } from './storage';

// The adapter layer: everything that differs between the website and a game portal. The game
// asks the current adapter (lib/portal/index.ts) instead of checking which portal it's on, so
// another portal (Vatar/Lagos Life, Poki) is a new adapter, not changes all over the game.

export interface PortalUser {
  name: string;
  avatarUrl: string | null;
  /** Logged in to the portal (false: a portal guest with a made-up name). */
  loggedIn: boolean;
}

/** Settings the portal imposes. They win over the game's own (e.g. an in-game sound toggle). */
export interface PortalSettings {
  /** Typed chat is off: only quick chat is shown and sent. */
  chatDisabled: boolean;
  /** All game audio off. */
  muted: boolean;
}

export interface PortalFeatures {
  /** The website's own name entry and menus. False: the portal gives the name, one tap to play. */
  ownMenus: boolean;
  /** Outgoing links allowed: 'all' (website), or only the community link (Discord) on the menu. */
  links: 'all' | 'community';
  /** In-world billboards that sell space to sponsors. */
  sponsorBoards: boolean;
  /** Social handles on in-world art (the 3042Official billboard). */
  brandHandle: boolean;
  /** A one-line privacy notice for new players. */
  privacyNotice: boolean;
  /** Remember the player's garment and hat between games (in the portal's save). */
  rememberLook: boolean;
  /** One-tap Play joins a quick-start lobby (fills with bots, starts by itself). */
  quickStart: boolean;
  /** The 5-4-3-2-1 intro on the first scene load (portals: straight in, time to gameplay counts). */
  introCountdown: boolean;
}

export interface PortalAdapter {
  id: PortalId;
  features: PortalFeatures;
  /** Loads and starts the portal's SDK. Resolves even if the SDK fails (the game still runs). */
  init(): Promise<void>;
  storage: KeyValue;
  /** The portal's player (name, picture), or null: use the game's own name entry. */
  user(): Promise<PortalUser | null>;
  settings(): PortalSettings;
  onSettings(l: () => void): () => void;

  /** Loading and gameplay events (portals measure loading time and playtime with them). */
  loadingStart(): void;
  loadingStop(): void;
  gameplayStart(): void;
  gameplayStop(): void;

  /** Tell the portal's friends features (Join, Invite) about the room you're in; null: you left. */
  updateRoom(p: RoomPresence | null): void;
  /** An invite link for a room, from the portal; null: use the game's own /r/CODE link. */
  inviteLink(code: string): string | null;
  /** The room this launch was invited to, or null. */
  inviteRoom(): string | null;
  /** A friend's invite was accepted while the game is open: go to that room. */
  onJoinRoom(l: (code: string) => void): () => void;
  /** Launched from the portal's multiplayer button: straight into a new private room. */
  instantMultiplayer(): boolean;

  /**
   * A break between games: the portal may show an ad. `started` runs when an ad actually starts
   * (mute and pause then). Resolves when it's over, or at once if there's none.
   */
  midgameAd(started: () => void): Promise<void>;
}
