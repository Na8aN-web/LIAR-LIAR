// Who made the game, and where to find them. Used by the Credits screen, the homepage and the
// house poster in town (config/adSlots.ts, the `reserved` slot).

export const BRAND = {
  game: 'Wanted: True Colors',
  studio: '3042Official',
  author: 'Nathan Kaduru (LOTS)',
  handle: '@3042official',
  crewArt: { color: '/branding/crew-color.webp', print: '/branding/crew-print.webp' },
};

export type SocialId = 'youtube' | 'discord' | 'tiktok' | 'x' | 'instagram';

/** Social links, in display order. An empty `url` hides that button until it's filled in. */
export const SOCIALS: { id: SocialId; label: string; url: string }[] = [
  // The main channel: always first.
  { id: 'youtube', label: 'YouTube', url: 'https://www.youtube.com/@3042official' },
  { id: 'discord', label: 'Discord', url: 'https://discord.gg/avv8gU4KmX' },
  { id: 'tiktok', label: 'TikTok', url: 'https://www.tiktok.com/@3042official' },
  { id: 'x', label: 'X', url: 'https://x.com/3042official' },
  { id: 'instagram', label: 'Instagram', url: 'https://www.instagram.com/3042_official/' },
];

export const YOUTUBE_URL = SOCIALS.find((s) => s.id === 'youtube')!.url;
