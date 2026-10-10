import { colorInfo, type ColorId } from '@wtc/shared';

interface Props {
  color?: ColorId | null;
  pot?: number;
  subtitle?: string;
  /** Extra line under the poster, e.g. the public color-change count. */
  note?: string | null;
  className?: string;
}

/** The parchment Wanted poster. With no color it shows "???" (menu art). */
export function WantedPoster({ color, pot = 100, subtitle, note, className = '' }: Props) {
  const info = color ? colorInfo(color) : null;
  return (
    <div className={`poster ${className}`}>
      <div className="poster-title">WANTED</div>
      <div className="poster-art" style={info ? ({ '--c': info.hex } as React.CSSProperties) : undefined}>
        <svg viewBox="0 0 100 110" aria-hidden>
          <path d="M38 14 Q50 8 62 14 L64 26 L36 26 Z" className="sil" />
          <path d="M20 27 Q30 22 36 25 L64 25 Q70 22 80 27 Q74 32 50 32 Q26 32 20 27 Z" className="sil" />
          <circle cx="50" cy="40" r="11" className="sil" />
          <path d="M14 58 L86 58 L86 64 L66 64 L70 104 L30 104 L34 64 L14 64 Z" className="sil" />
          <path d="M30 56 L70 56 L78 86 L22 86 Z" className={info ? 'item' : 'sil'} />
        </svg>
      </div>
      <div className="poster-color">
        {info ? (
          <>
            <span className="swatch lg" style={{ background: info.hex }} />
            {info.name}
          </>
        ) : (
          '???'
        )}
      </div>
      <div className="poster-reward">REWARD ${pot}</div>
      {subtitle && <div className="poster-sub">{subtitle}</div>}
      {note && <div className="poster-note">{note}</div>}
    </div>
  );
}
