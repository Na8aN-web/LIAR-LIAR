import { COSMETIC_TONES as T, type Cosmetics } from '@wtc/shared';

/**
 * A scarecrow's sack head wearing their hat and face detail, as a small icon (vote cards).
 * Drawn from the cosmetic ids, in the same earthy tones as the 3D items. Public information.
 */
export function CosmeticIcon({ cosmetics, size = 40 }: { cosmetics: Cosmetics; size?: number }) {
  const { hat, face } = cosmetics;
  return (
    <svg className="cosmetic-icon" width={size} height={size} viewBox="0 0 40 40" aria-hidden>
      {/* Straw sticking out under the head, and the sack head. */}
      <path d="M11 33l3-4M15 35l2-5M25 35l-2-5M29 33l-3-4" stroke="#b38b4d" strokeWidth="1.6" strokeLinecap="round" />
      <ellipse cx="20" cy="25" rx="10" ry="9.5" fill="#a9824f" stroke="#5e4426" strokeWidth="1.2" />
      {/* Face: plain stitched eyes unless a face detail replaces them. */}
      {face !== 'button-eye' && face !== 'eye-patch' && (
        <>
          <path d="M14.5 23l2 2m0-2l-2 2M23.5 23l2 2m0-2l-2 2" stroke={T.thread} strokeWidth="1.2" />
        </>
      )}
      {face === 'button-eye' && (
        <>
          <path d="M14.5 23l2 2m0-2l-2 2" stroke={T.thread} strokeWidth="1.2" />
          <circle cx="24.5" cy="24" r="2.6" fill={T.soot} stroke={T.straw} strokeWidth="0.8" />
          <circle cx="23.7" cy="23.6" r="0.5" fill={T.straw} />
          <circle cx="25.3" cy="24.4" r="0.5" fill={T.straw} />
        </>
      )}
      {face === 'eye-patch' && (
        <>
          <path d="M14.5 23l2 2m0-2l-2 2" stroke={T.thread} strokeWidth="1.2" />
          <path d="M10.5 20.5L29.5 27" stroke={T.band} strokeWidth="1.2" />
          <ellipse cx="24.5" cy="24.5" rx="3" ry="2.6" fill={T.soot} />
        </>
      )}
      {face === 'stitched-grin' ? (
        <path d="M14 28.5q6 4 12 0M16 28.6l-.4 1.6M20 29.6v1.6M24 28.6l.4 1.6" stroke={T.thread} strokeWidth="1.1" fill="none" />
      ) : (
        <path d="M16.5 29.5h7" stroke={T.thread} strokeWidth="1.1" />
      )}
      {face === 'stitched-scar' && <path d="M12.5 19.5l5 7M13 22l2.5-1.2M14.5 24.3l2.5-1.2" stroke={T.thread} strokeWidth="1.1" />}

      {/* Hats. */}
      {hat === 'straw-hat' && (
        <>
          <ellipse cx="20" cy="17" rx="15" ry="3.2" fill={T.straw} stroke="#6d5c42" strokeWidth="0.8" />
          <path d="M13 17q0-8 7-8t7 8z" fill={T.straw} stroke="#6d5c42" strokeWidth="0.8" />
          <path d="M13.3 15.2h13.4" stroke={T.leather} strokeWidth="1.6" />
        </>
      )}
      {hat === 'cowboy-hat' && (
        <>
          <path d="M5 16.5q4 3.5 15 3.5t15-3.5q-3 1-6 1H11q-3 0-6-1z" fill={T.felt} />
          <path d="M12.5 17.5l1-8q2-2 3.5-.6l3-1.6 3 1.6q1.5-1.4 3.5.6l1 8z" fill={T.felt} stroke="#2e241b" strokeWidth="0.6" />
          <path d="M12.8 15.6h14.4" stroke={T.band} strokeWidth="1.6" />
        </>
      )}
      {hat === 'top-hat' && (
        <>
          <ellipse cx="20" cy="17.5" rx="12" ry="2.4" fill={T.soot} />
          <rect x="13.5" y="3.5" width="13" height="14" rx="1" fill={T.soot} />
          <path d="M13.5 14.6h13" stroke={T.leather} strokeWidth="2" />
        </>
      )}
      {hat === 'bowler' && (
        <>
          <ellipse cx="20" cy="17.5" rx="12.5" ry="2.3" fill={T.charcoal} />
          <path d="M12 17.5q0-10 8-10t8 10z" fill={T.charcoal} />
          <path d="M12.3 15.4h15.4" stroke={T.band} strokeWidth="1.6" />
        </>
      )}
      {(!hat || hat === 'none') && <path d="M14 16l-1.5-4M18 15.3l-.4-4.3M22 15.3l.4-4.3M26 16l1.5-4" stroke="#b38b4d" strokeWidth="1.5" strokeLinecap="round" />}
    </svg>
  );
}
