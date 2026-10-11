import { useId } from 'react';
import { colorInfo, type ColorId } from '@wtc/shared';
import {
  ART_TRANSFORM,
  FRAME,
  INK,
  LAYOUT,
  NAILS,
  PAPER_URL,
  POSTER_H,
  POSTER_W,
  SCARECROW,
  STAMP_RED,
  TORN_OUTLINE,
  numberText,
  rewardText,
  type PosterContent,
} from './poster/posterArt';

interface Props {
  color?: ColorId | null;
  pot?: number;
  /** 1-based poster number and total. Omitted on the menu poster. */
  number?: number;
  of?: number;
  /** Caption under the poster, e.g. "That's you." */
  subtitle?: string;
  /** Extra caption line, e.g. the public color-change count. */
  note?: string | null;
  className?: string;
}

/**
 * The Wanted poster, as SVG: aged paper, torn edges, nail holes, a scarecrow in the
 * colored poncho, the color name, a red REWARD stamp with the pot, and the poster number.
 * Same artwork as the poster nailed up in the 3D town (see poster/posterArt.ts).
 */
export function WantedPoster({ color, pot = 100, number, of, subtitle, note, className = '' }: Props) {
  const info = color ? colorInfo(color) : null;
  const content: PosterContent = { colorHex: info?.hex ?? null, colorName: info?.name ?? null, pot, number: number ?? null, of: of ?? null };
  const st = LAYOUT.stamp;
  const label = info ? `Wanted: ${info.name}. ${rewardText(content)}.${number ? ` Poster ${number}${of ? ` of ${of}` : ''}.` : ''}` : 'Wanted poster';
  const display = { fontFamily: 'var(--font-display), serif' } as const;
  // Unique ids: several posters can be on screen at once (top bar + big poster).
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const torn = `torn${uid}`, vignette = `vig${uid}`, rust = `rust${uid}`;

  return (
    <figure className={`poster-svg ${className}`}>
      <svg viewBox={`0 0 ${POSTER_W} ${POSTER_H}`} role="img" aria-label={label}>
        <defs>
          <clipPath id={torn}>
            <path d={TORN_OUTLINE} />
          </clipPath>
          <radialGradient id={vignette} cx="50%" cy="48%" r="62%">
            <stop offset="55%" stopColor="rgba(0,0,0,0)" />
            <stop offset="100%" stopColor="rgba(90,50,15,0.55)" />
          </radialGradient>
          <radialGradient id={rust}>
            <stop offset="0%" stopColor="rgba(110,55,20,0.55)" />
            <stop offset="100%" stopColor="rgba(110,55,20,0)" />
          </radialGradient>
        </defs>

        <g clipPath={`url(#${torn})`}>
          <rect width={POSTER_W} height={POSTER_H} fill="#dcc596" />
          <image href={PAPER_URL} width={POSTER_W} height={POSTER_H} preserveAspectRatio="none" opacity={0.85} />
          <rect width={POSTER_W} height={POSTER_H} fill="rgba(214,180,120,0.35)" />
          <rect width={POSTER_W} height={POSTER_H} fill={`url(#${vignette})`} />
        </g>
        <path d={TORN_OUTLINE} fill="none" stroke="rgba(70,40,15,0.55)" strokeWidth={1.2} />

        <text x={152} y={LAYOUT.title.y} textAnchor="middle" fontSize={LAYOUT.title.size} letterSpacing={LAYOUT.title.spacing} fill={INK} style={display}>
          WANTED
        </text>
        <text x={150} y={LAYOUT.number.y} textAnchor="middle" fontSize={LAYOUT.number.size} fontStyle="italic" fill={INK} style={{ fontFamily: 'var(--font-body), serif' }}>
          {numberText(content)}
        </text>

        <rect x={FRAME.x} y={FRAME.y} width={FRAME.w} height={FRAME.h} fill="rgba(60,35,10,0.12)" stroke="rgba(58,36,18,0.6)" strokeWidth={2} />
        <g transform={`translate(${ART_TRANSFORM.x} ${ART_TRANSFORM.y}) scale(${ART_TRANSFORM.s})`}>
          {SCARECROW.ink.map((d) => (
            <path key={d} d={d} fill={INK} />
          ))}
          <path d={SCARECROW.item} fill={info?.hex ?? INK} stroke={INK} strokeWidth={1.4} />
          {SCARECROW.over.map((d) => (
            <path key={d} d={d} fill={INK} />
          ))}
          <path d={SCARECROW.tie} fill="#6b4a24" />
        </g>

        <circle cx={150} cy={LAYOUT.swatch.y} r={LAYOUT.swatch.r} fill={info?.hex ?? INK} stroke={INK} strokeWidth={2} />
        <text x={150} y={LAYOUT.colorName.y} textAnchor="middle" fontSize={LAYOUT.colorName.size} fill={INK} style={display}>
          {info?.name ?? '???'}
        </text>

        <g transform={`translate(${st.cx} ${st.cy}) rotate(${st.rotate})`} opacity={0.88}>
          <rect x={-st.w / 2} y={-st.h / 2} width={st.w} height={st.h} fill="none" stroke={STAMP_RED} strokeWidth={3} />
          <rect x={-st.w / 2 + 5} y={-st.h / 2 + 5} width={st.w - 10} height={st.h - 10} fill="none" stroke={STAMP_RED} strokeWidth={1.2} />
          <text x={0} y={2} textAnchor="middle" dominantBaseline="middle" fontSize={st.size} fill={STAMP_RED} style={display}>
            {rewardText(content)}
          </text>
        </g>

        {NAILS.map(([x, y]) => (
          <g key={`${x}-${y}`}>
            <circle cx={x} cy={y} r={11} fill={`url(#${rust})`} />
            <circle cx={x} cy={y} r={3.6} fill="#1a120b" />
            <circle cx={x - 1} cy={y - 1} r={1.1} fill="rgba(255,240,210,0.35)" />
          </g>
        ))}
      </svg>
      {(subtitle || note) && (
        <figcaption>
          {subtitle && <span className="poster-caption">{subtitle}</span>}
          {note && <span className="poster-caption note">{note}</span>}
        </figcaption>
      )}
    </figure>
  );
}
