import type { SocialId } from '@/config/brand';

// Simple one-color glyphs for the social buttons (drawn here, in the game's style, rather
// than pulling in an icon pack). currentColor, 24 x 24.
const PATHS: Record<SocialId, React.ReactNode> = {
  youtube: (
    <>
      <rect x="2" y="5" width="20" height="14" rx="4" fill="currentColor" />
      <path d="M10 9 L15.5 12 L10 15 Z" fill="var(--social-cut, #2a1a0f)" />
    </>
  ),
  discord: (
    <>
      <path
        d="M5 6.5 Q8 5 10 4.8 L10.6 6 Q12 5.8 13.4 6 L14 4.8 Q16 5 19 6.5 Q21.5 11 21 17 Q18.8 18.8 16 19.3 L15 17.6 Q12 18.5 9 17.6 L8 19.3 Q5.2 18.8 3 17 Q2.5 11 5 6.5 Z"
        fill="currentColor"
      />
      <ellipse cx="9" cy="12.5" rx="1.6" ry="1.9" fill="var(--social-cut, #2a1a0f)" />
      <ellipse cx="15" cy="12.5" rx="1.6" ry="1.9" fill="var(--social-cut, #2a1a0f)" />
    </>
  ),
  tiktok: (
    <path
      d="M13 3 H16 Q16.4 6.6 20 7 V10 Q17.8 10 16 8.8 V15 A5.5 5.5 0 1 1 10.5 9.5 V12.6 A2.5 2.5 0 1 0 13 15 Z"
      fill="currentColor"
    />
  ),
  x: <path d="M4 4 H8.4 L20 20 H15.6 Z M18.6 4 H20.6 L13.2 12.4 L12 10.8 Z M3.4 20 L10.8 11.6 L12 13.2 L5.4 20 Z" fill="currentColor" />,
  instagram: (
    <>
      <rect x="3.5" y="3.5" width="17" height="17" rx="5" fill="none" stroke="currentColor" strokeWidth="2.2" />
      <circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" strokeWidth="2.2" />
      <circle cx="17.2" cy="6.8" r="1.3" fill="currentColor" />
    </>
  ),
};

export function SocialIcon({ id }: { id: SocialId }) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden className="social-icon">
      {PATHS[id]}
    </svg>
  );
}
