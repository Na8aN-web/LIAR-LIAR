import type { PortalAdapter } from './types';

// The website (wantedtruecolors.com): no portal SDK, the game's own menus and links. Every
// call is a no-op, so the website behaves exactly as it always has.

export const webPortal: PortalAdapter = {
  id: 'web',
  features: {
    ownMenus: true,
    links: 'all',
    sponsorBoards: true,
    brandHandle: true,
    privacyNotice: false,
    rememberLook: false,
    quickStart: false,
    introCountdown: true,
  },
  init: async () => {},
  storage: {
    getItem: (k) => localStorage.getItem(k),
    setItem: (k, v) => localStorage.setItem(k, v),
    removeItem: (k) => localStorage.removeItem(k),
  },
  user: async () => null,
  settings: () => ({ chatDisabled: false, muted: false }),
  onSettings: () => () => {},
  loadingStart: () => {},
  loadingStop: () => {},
  gameplayStart: () => {},
  gameplayStop: () => {},
  updateRoom: () => {},
  inviteLink: () => null,
  inviteRoom: () => null,
  onJoinRoom: () => () => {},
  instantMultiplayer: () => false,
  midgameAd: async () => {},
};
