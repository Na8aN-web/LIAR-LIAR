// Single source of truth for the Wanted poster artwork. The UI renders it as SVG
// (WantedPoster.tsx); the 3D scene draws the same shapes onto a canvas texture
// (drawPoster below). Coordinates are in a 300 x 420 poster space.

export const POSTER_W = 300;
export const POSTER_H = 420;
export const PAPER_URL = '/textures/paper.webp';

export interface PosterContent {
  /** Hex of the Wanted color, or null for an unknown/blank poster ("???"). */
  colorHex: string | null;
  colorName: string | null;
  pot: number;
  /** 1-based poster number and total, or null to omit. */
  number: number | null;
  of: number | null;
}

/** Deterministic jitter so the torn edge is the same everywhere it's drawn. */
function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

/** Torn paper outline: a slightly skewed rectangle with ragged edges and a torn corner. */
export const TORN_OUTLINE: string = (() => {
  const r = seeded(1849);
  const pts: [number, number][] = [];
  const edge = (x0: number, y0: number, x1: number, y1: number, steps: number, depth: number, inward: [number, number]) => {
    for (let i = 0; i < steps; i++) {
      const t = i / steps;
      const j = (r() - 0.5) * 2 * depth + (r() < 0.12 ? depth * 1.6 : 0);
      pts.push([x0 + (x1 - x0) * t + inward[0] * j, y0 + (y1 - y0) * t + inward[1] * j]);
    }
  };
  edge(10, 8, 290, 12, 22, 3.2, [0, 1]);
  edge(290, 12, 294, 380, 26, 3.2, [-1, 0]);
  // Torn lower-right corner.
  pts.push([294, 380], [280, 392], [286, 400], [268, 404], [272, 412]);
  edge(272, 412, 8, 414, 22, 3.6, [0, -1]);
  edge(8, 414, 10, 8, 28, 3.2, [1, 0]);
  return 'M' + pts.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join(' L') + ' Z';
})();

export const NAILS: [number, number][] = [
  [30, 28],
  [270, 32],
  [26, 392],
  [258, 384],
];

/** Art frame and the scarecrow (sack head, straw, poncho) inside it. Source art is 100 x 110. */
export const FRAME = { x: 60, y: 112, w: 180, h: 168 };
const ART_SCALE = 1.5;
export const ART_TRANSFORM = { x: FRAME.x + (FRAME.w - 100 * ART_SCALE) / 2, y: FRAME.y + 2, s: ART_SCALE };

/** Scarecrow silhouette parts. `item` is the colored poncho; everything else is ink. */
export const SCARECROW = {
  ink: [
    // Stake
    'M48.5 80 h3 v28 h-3 Z',
    // Trousers, straw at the ankles
    'M40 70 L60 70 L62 96 L55 96 L50 80 L45 96 L38 96 Z',
    'M38 96 L35 104 L40 99 L41 105 L43 99 L46 104 L45 96 Z',
    'M55 96 L54 104 L57 99 L59 105 L60 99 L64 104 L62 96 Z',
    // Crossbar arms, straw hands
    'M11 50 L89 50 L89 54 L11 54 Z',
    'M12 48 L4 45 L8 51 L2 53 L9 55 L4 60 L13 56 Z',
    'M88 48 L96 45 L92 51 L98 53 L91 55 L96 60 L87 56 Z',
  ],
  item: 'M40 45 Q50 49 60 45 L82 66 L78 70 L73 67 L69 73 L63 71 L50 85 L37 71 L31 73 L27 67 L22 70 L18 66 Z',
  over: [
    // Straw collar
    'M36 48 L39 41 L42 47 L45 40 L48 46 L50 39 L52 46 L55 40 L58 47 L61 41 L64 48 Q50 44 36 48 Z',
    // Sack head, tied at the top with a straw tuft (faceless)
    'M38 31 Q37 20 46 17 Q50 15 54 17 Q63 20 62 31 Q62 40 50 41 Q38 40 38 31 Z',
    'M46.5 17.5 L44 9 L48.5 14 L50 6 L51.5 14 L56 9 L53.5 17.5 Z',
  ],
  tie: 'M45 16 h10 v2.4 h-10 Z',
};

export const INK = '#2b1a0d';
export const STAMP_RED = '#9c2a22';

/** Text and stamp layout (shared by SVG and canvas). */
export const LAYOUT = {
  title: { y: 74, size: 51, spacing: 3 },
  number: { y: 101, size: 13 },
  swatch: { y: 300, r: 11 },
  colorName: { y: 338, size: 30 },
  stamp: { cx: 150, cy: 377, w: 196, h: 44, rotate: -6, size: 24 },
};

export const numberText = (c: PosterContent) => (c.number ? `— No. ${c.number}${c.of ? ` of ${c.of}` : ''} —` : '— Dead or alive —');
export const rewardText = (c: PosterContent) => `REWARD $${c.pot}`;

// ---------------------------------------------------------------- canvas (3D texture)

export interface CanvasFontNames {
  display: string;
  body: string;
}

/**
 * Draw the poster onto a canvas. `paper` must be a loaded image (or null for flat parchment).
 * `parts` can leave out the color dab + name or the REWARD stamp (the thumbnail studio draws
 * its own); the game and the menu draw everything.
 */
export function drawPoster(
  ctx: CanvasRenderingContext2D,
  content: PosterContent,
  fonts: CanvasFontNames,
  paper: CanvasImageSource | null,
  parts: { color?: boolean; stamp?: boolean } = {},
) {
  const { color = true, stamp = true } = parts;
  const { width, height } = ctx.canvas;
  ctx.save();
  ctx.clearRect(0, 0, width, height);
  ctx.scale(width / POSTER_W, height / POSTER_H);

  const outline = new Path2D(TORN_OUTLINE);
  ctx.save();
  ctx.clip(outline);
  // Paper: texture, warm tint, darker edges.
  ctx.fillStyle = '#dcc596';
  ctx.fillRect(0, 0, POSTER_W, POSTER_H);
  if (paper) {
    ctx.globalAlpha = 0.85;
    ctx.drawImage(paper, 0, 0, POSTER_W, POSTER_H);
    ctx.globalAlpha = 1;
  }
  ctx.fillStyle = 'rgba(214,180,120,0.35)';
  ctx.fillRect(0, 0, POSTER_W, POSTER_H);
  const v = ctx.createRadialGradient(150, 200, 90, 150, 210, 260);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, 'rgba(90,50,15,0.55)');
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, POSTER_W, POSTER_H);
  ctx.restore();
  ctx.strokeStyle = 'rgba(70,40,15,0.55)';
  ctx.lineWidth = 1.2;
  ctx.stroke(outline);

  // Title + number
  ctx.fillStyle = INK;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.font = `${LAYOUT.title.size}px ${fonts.display}`;
  if ('letterSpacing' in ctx) (ctx as unknown as { letterSpacing: string }).letterSpacing = `${LAYOUT.title.spacing}px`;
  ctx.fillText('WANTED', 152, LAYOUT.title.y);
  if ('letterSpacing' in ctx) (ctx as unknown as { letterSpacing: string }).letterSpacing = '0px';
  ctx.font = `italic ${LAYOUT.number.size}px ${fonts.body}`;
  ctx.fillText(numberText(content), 150, LAYOUT.number.y);

  // Art frame + scarecrow
  ctx.fillStyle = 'rgba(60,35,10,0.12)';
  ctx.fillRect(FRAME.x, FRAME.y, FRAME.w, FRAME.h);
  ctx.strokeStyle = 'rgba(58,36,18,0.6)';
  ctx.lineWidth = 2;
  ctx.strokeRect(FRAME.x, FRAME.y, FRAME.w, FRAME.h);
  ctx.save();
  ctx.translate(ART_TRANSFORM.x, ART_TRANSFORM.y);
  ctx.scale(ART_TRANSFORM.s, ART_TRANSFORM.s);
  ctx.fillStyle = INK;
  for (const d of SCARECROW.ink) ctx.fill(new Path2D(d));
  ctx.fillStyle = content.colorHex ?? INK;
  ctx.fill(new Path2D(SCARECROW.item));
  ctx.strokeStyle = INK;
  ctx.lineWidth = 1.4;
  ctx.stroke(new Path2D(SCARECROW.item));
  ctx.fillStyle = INK;
  for (const d of SCARECROW.over) ctx.fill(new Path2D(d));
  ctx.fillStyle = '#6b4a24';
  ctx.fill(new Path2D(SCARECROW.tie));
  ctx.restore();

  if (color) {
    // Color: ink dab + name
    ctx.beginPath();
    ctx.arc(150, LAYOUT.swatch.y, LAYOUT.swatch.r, 0, Math.PI * 2);
    ctx.fillStyle = content.colorHex ?? INK;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = INK;
    ctx.stroke();
    ctx.fillStyle = INK;
    ctx.font = `${LAYOUT.colorName.size}px ${fonts.display}`;
    ctx.fillText(content.colorName ?? '???', 150, LAYOUT.colorName.y);
  }

  if (stamp) {
    // REWARD stamp
    const st = LAYOUT.stamp;
    ctx.save();
    ctx.translate(st.cx, st.cy);
    ctx.rotate((st.rotate * Math.PI) / 180);
    ctx.globalAlpha = 0.88;
    ctx.strokeStyle = STAMP_RED;
    ctx.lineWidth = 3;
    ctx.strokeRect(-st.w / 2, -st.h / 2, st.w, st.h);
    ctx.lineWidth = 1.2;
    ctx.strokeRect(-st.w / 2 + 5, -st.h / 2 + 5, st.w - 10, st.h - 10);
    ctx.fillStyle = STAMP_RED;
    ctx.font = `${st.size}px ${fonts.display}`;
    ctx.textBaseline = 'middle';
    ctx.fillText(rewardText(content), 0, 2);
    ctx.restore();
  }

  // Nail holes with rust halos
  for (const [x, y] of NAILS) {
    const h = ctx.createRadialGradient(x, y, 2, x, y, 11);
    h.addColorStop(0, 'rgba(110,55,20,0.55)');
    h.addColorStop(1, 'rgba(110,55,20,0)');
    ctx.fillStyle = h;
    ctx.beginPath();
    ctx.arc(x, y, 11, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#1a120b';
    ctx.beginPath();
    ctx.arc(x, y, 3.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,240,210,0.35)';
    ctx.beginPath();
    ctx.arc(x - 1, y - 1, 1.1, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}
