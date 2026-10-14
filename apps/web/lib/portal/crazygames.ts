import { guestName, roomFromInvite } from '@wtc/shared';
import type { PortalAdapter, PortalSettings, PortalUser } from './types';

// CrazyGames (crazygames.com), through their HTML5 SDK v3 (docs.crazygames.com). Loaded only on
// /play/crazygames pages. If the SDK can't load or reports itself disabled (any domain that isn't
// CrazyGames or localhost), every call quietly does nothing and the game still runs.

const SDK_URL = 'https://sdk.crazygames.com/crazygames-sdk-v3.js';
const GUEST_NAME_KEY = 'wtc:guest-name';

/** The parts of the SDK we use (window.CrazyGames.SDK). */
interface CgSdk {
  init(): Promise<void>;
  environment: 'local' | 'crazygames' | 'disabled';
  game: {
    loadingStart(): void;
    loadingStop(): void;
    gameplayStart(): void;
    gameplayStop(): void;
    settings: { disableChat: boolean; muteAudio: boolean };
    addSettingsChangeListener(l: (s: { disableChat: boolean; muteAudio: boolean }) => void): void;
    updateRoom(d: { roomId?: string; isJoinable?: boolean; inviteParams?: Record<string, string> }): void;
    leftRoom(): void;
    inviteLink(params: Record<string, string>): string;
    inviteParams: Record<string, string> | null;
    addJoinRoomListener(l: (params: Record<string, string>) => void): void;
    removeJoinRoomListener(l: (params: Record<string, string>) => void): void;
    isInstantMultiplayer: boolean;
  };
  user: {
    isUserAccountAvailable: boolean;
    getUser(): Promise<{ username: string; profilePictureUrl: string } | null>;
    addAuthListener(l: (user: unknown) => void): void;
  };
  data: { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void };
  ad: {
    requestAd(type: 'midgame' | 'rewarded', cb: { adStarted?: () => void; adFinished?: () => void; adError?: (e: { code: string; message: string }) => void }): void;
  };
}

declare global {
  interface Window {
    CrazyGames?: { SDK: CgSdk };
  }
}

let sdk: CgSdk | null = null;
let settings: PortalSettings = { chatDisabled: false, muted: false };
const settingsListeners = new Set<() => void>();
let inGameplay = false;
let loading = false;

function loadScript(): Promise<void> {
  if (window.CrazyGames?.SDK) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = SDK_URL;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('CrazyGames SDK failed to load'));
    document.head.appendChild(s);
  });
}

/** Runs an SDK call; an SDK error never breaks the game. */
function safe<T>(fn: (s: CgSdk) => T, fallback: T): T {
  if (!sdk) return fallback;
  try {
    return fn(sdk);
  } catch (err) {
    console.warn('CrazyGames SDK:', err);
    return fallback;
  }
}

const localStore = {
  getItem: (k: string) => localStorage.getItem(k),
  setItem: (k: string, v: string) => localStorage.setItem(k, v),
  removeItem: (k: string) => localStorage.removeItem(k),
};

export const crazyGamesPortal: PortalAdapter = {
  id: 'crazygames',
  features: {
    ownMenus: false,
    links: 'community',
    sponsorBoards: false,
    brandHandle: false,
    privacyNotice: true,
    rememberLook: true,
    quickStart: true,
    introCountdown: false,
  },

  async init() {
    try {
      await loadScript();
      const s = window.CrazyGames!.SDK;
      await s.init();
      if (s.environment === 'disabled') {
        console.warn('CrazyGames SDK is disabled on this domain: running without it.');
        return;
      }
      sdk = s;
      crazyGamesPortal.loadingStart();
      const apply = (g: { disableChat: boolean; muteAudio: boolean }) => {
        settings = { chatDisabled: !!g.disableChat, muted: !!g.muteAudio };
        settingsListeners.forEach((l) => l());
      };
      apply(s.game.settings);
      s.game.addSettingsChangeListener(apply);
      // Logging in mid-game: the Data module reloads the game itself; we only need fresh names,
      // which a reload gives too.
      s.user.addAuthListener(() => location.reload());
    } catch (err) {
      console.warn('CrazyGames SDK unavailable:', err);
      sdk = null;
    }
  },

  // Progress in the Data module (follows a logged-in player; guests' stays on this device).
  // Without the SDK (or before it's ready): this browser.
  storage: {
    getItem: (k) => (sdk ? safe((s) => s.data.getItem(k), null) : localStore.getItem(k)),
    setItem: (k, v) => (sdk ? safe((s) => s.data.setItem(k, v), undefined) : localStore.setItem(k, v)),
    removeItem: (k) => (sdk ? safe((s) => s.data.removeItem(k), undefined) : localStore.removeItem(k)),
  },

  async user(): Promise<PortalUser> {
    const account = sdk?.user.isUserAccountAvailable ? await sdk.user.getUser().catch(() => null) : null;
    if (account?.username) return { name: account.username, avatarUrl: account.profilePictureUrl || null, loggedIn: true };
    // A guest: a made-up name, kept so they're the same person next time on this device.
    let name = crazyGamesPortal.storage.getItem(GUEST_NAME_KEY);
    if (!name) {
      name = guestName(Math.random);
      crazyGamesPortal.storage.setItem(GUEST_NAME_KEY, name);
    }
    return { name, avatarUrl: null, loggedIn: false };
  },

  settings: () => settings,
  onSettings(l) {
    settingsListeners.add(l);
    return () => settingsListeners.delete(l);
  },

  loadingStart() {
    if (loading) return;
    loading = true;
    safe((s) => s.game.loadingStart(), undefined);
  },
  loadingStop() {
    if (!loading) return;
    loading = false;
    safe((s) => s.game.loadingStop(), undefined);
  },
  gameplayStart() {
    if (inGameplay) return;
    inGameplay = true;
    safe((s) => s.game.gameplayStart(), undefined);
  },
  gameplayStop() {
    if (!inGameplay) return;
    inGameplay = false;
    safe((s) => s.game.gameplayStop(), undefined);
  },

  updateRoom(p) {
    safe((s) => (p ? s.game.updateRoom({ roomId: p.roomId, isJoinable: p.isJoinable, inviteParams: p.inviteParams }) : s.game.leftRoom()), undefined);
  },
  inviteLink: (code) => safe((s) => s.game.inviteLink({ room: code }), null),
  inviteRoom: () => safe((s) => roomFromInvite(s.game.inviteParams), null),
  onJoinRoom(l) {
    const listener = (params: Record<string, string>) => {
      const code = roomFromInvite(params);
      if (code) l(code);
    };
    safe((s) => s.game.addJoinRoomListener(listener), undefined);
    return () => safe((s) => s.game.removeJoinRoomListener(listener), undefined);
  },
  instantMultiplayer: () => safe((s) => !!s.game.isInstantMultiplayer, false),

  midgameAd(started) {
    if (!sdk) return Promise.resolve();
    return new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        resolve();
      };
      try {
        // The SDK paces these (at most one every few minutes): a request that comes too early
        // just errors (adCooldown), and the game carries on.
        sdk!.ad.requestAd('midgame', { adStarted: started, adFinished: finish, adError: finish });
      } catch {
        finish();
      }
      // Never leave the game waiting on an ad that doesn't answer.
      setTimeout(finish, 90_000);
    });
  },
};
