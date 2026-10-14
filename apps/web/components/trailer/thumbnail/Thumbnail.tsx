'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Vector3, type PerspectiveCamera } from 'three';
import { colorInfo, type ColorId, type Cosmetics, type ItemType } from '@wtc/shared';
import { useCanvasFonts } from '@/lib/canvasFonts';
import { PAPER_URL, POSTER_H, POSTER_W, drawPoster } from '../../poster/posterArt';
import { SCALE, Scarecrow } from '../../scene/Scarecrow';
import { SEAT_BELOW_HIPS, SIT_HIPS, type SitPose } from '../../scene/scarecrowModel';
import { Campfire } from '../../scene/town/Campfire';
import { Ground } from '../../scene/town/Ground';
import { PropInstances } from '../../scene/town/PropInstances';
import { Seats, type Seat, type SeatType } from '../../scene/town/Town';
import { useScenery } from '../../scene/town/useScenery';
import '../studio/studio.css';

// Thumbnail mode of the trailer studio (dev builds only, /dev/trailer/studio?mode=thumbnail):
// a promotional still of the menu's campfire scene for YouTube. Everyone's true garment color
// shows, the poster carries one of them, and the title, tagline and credit are drawn on top.
// The whole picture is composed on one 2D canvas at 3840x2160, so the preview is exactly the
// export; the 1280x720 PNG is a downscale of it. Nothing here touches the menu or the game.

/**
 * Picture shapes. The 3D view is laid out at view size (CSS px) and rendered at 2x, and the
 * picture is composed at that 2x size; each download is that picture, scaled to its size.
 * Covers are CrazyGames' game covers (docs: Requirements > Game covers).
 */
type CoverShape = 'landscape' | 'portrait' | 'square';
interface Shape {
  view: [number, number];
  downloads: [number, number][];
}
const THUMB_SHAPE: Shape = { view: [1920, 1080], downloads: [[1280, 720], [3840, 2160]] };
const COVER_SHAPES: Record<CoverShape, Shape> = {
  landscape: { view: [1920, 1080], downloads: [[1920, 1080], [3840, 2160]] },
  portrait: { view: [1080, 1620], downloads: [[800, 1200], [2160, 3240]] },
  square: { view: [1440, 1440], downloads: [[800, 800], [2880, 2880]] },
};
const shapeOf = (s: Settings): Shape => (s.layout === 'cover' ? COVER_SHAPES[s.coverShape] : THUMB_SHAPE);

interface Sitter {
  color: ColorId;
  item: ItemType;
  cosmetics: Cosmetics;
  pose: SitPose;
  seat: SeatType;
}

// Strong, clearly different colors, so every player visibly has one.
const SITTERS: Sitter[] = [
  { color: 'red', item: 'poncho', cosmetics: { hat: 'cowboy-hat', face: 'none' }, pose: 'sit-relaxed', seat: 'log' },
  { color: 'teal', item: 'cloak', cosmetics: { hat: 'top-hat', face: 'button-eye' }, pose: 'sit-leaning', seat: 'barrel' },
  { color: 'yellow', item: 'poncho', cosmetics: { hat: 'straw-hat', face: 'stitched-grin' }, pose: 'sit-hunched', seat: 'crate' },
  { color: 'purple', item: 'cloak', cosmetics: { hat: 'bowler', face: 'eye-patch' }, pose: 'sit-talking', seat: 'stump' },
  { color: 'green', item: 'poncho', cosmetics: { hat: 'none', face: 'stitched-scar' }, pose: 'sit-leaning', seat: 'log' },
  { color: 'orange', item: 'cloak', cosmetics: { hat: 'cowboy-hat', face: 'stitched-grin' }, pose: 'sit-relaxed', seat: 'crate' },
];
const RADIUS = 2.9;
/**
 * Seats around the fire, as angles from the camera's side (0 = between the camera and the
 * fire, left open so the fire shows). The first seat is the poster color's: front left,
 * a little closer to the camera.
 */
const SEAT_ANGLES = [-0.95, 0.95, -1.9, 1.9, -2.75, 2.75];
const FRONT_PULL = 0.5;

interface Cam {
  rotate: number;
  distance: number;
  height: number;
  lookY: number;
  fov: number;
  shiftX: number;
  shiftY: number;
}

const CAM_PRESETS: Record<string, Cam> = {
  // Shifted left, so the whole circle stays clear of the poster on the right.
  Hero: { rotate: 0, distance: 9.4, height: 2.9, lookY: 0.85, fov: 38, shiftX: -0.08, shiftY: -0.06 },
  Close: { rotate: 0, distance: 8, height: 2.4, lookY: 0.9, fov: 40, shiftX: -0.08, shiftY: -0.07 },
  Low: { rotate: 0, distance: 8.8, height: 1.4, lookY: 1.15, fov: 40, shiftX: -0.08, shiftY: -0.09 },
  High: { rotate: 0, distance: 9.6, height: 5.4, lookY: 0.2, fov: 38, shiftX: -0.08, shiftY: -0.05 },
  Wide: { rotate: 0, distance: 12, height: 3.6, lookY: 0.7, fov: 36, shiftX: -0.08, shiftY: -0.06 },
};

// The Poster layout shows the scene in the poster's picture frame: a tight, centered view.
const POSTER_CAM_PRESETS: Record<string, Cam> = {
  Tight: { rotate: 0, distance: 7.6, height: 2.5, lookY: 0.75, fov: 36, shiftX: 0, shiftY: -0.02 },
  Closer: { rotate: 0, distance: 6.6, height: 2.2, lookY: 0.8, fov: 38, shiftX: 0, shiftY: -0.02 },
  Low: { rotate: 0, distance: 7.4, height: 1.3, lookY: 1.05, fov: 38, shiftX: 0, shiftY: -0.04 },
  High: { rotate: 0, distance: 7.8, height: 4.6, lookY: 0.2, fov: 36, shiftX: 0, shiftY: 0 },
};
// Covers: a clean, centered view with room for the title on top.
const COVER_CAM_PRESETS: Record<CoverShape, Cam> = {
  landscape: { rotate: 0, distance: 8.8, height: 2.9, lookY: 0.7, fov: 38, shiftX: 0, shiftY: -0.1 },
  // Tall and square frames: from higher up, the circle reads rounder and fits the width.
  portrait: { rotate: 0, distance: 11.8, height: 9.5, lookY: 0, fov: 46, shiftX: 0, shiftY: -0.15 },
  square: { rotate: 0, distance: 11, height: 6.2, lookY: 0.2, fov: 42, shiftX: 0, shiftY: -0.12 },
};
type CamSlot = 'scene' | 'poster' | `cover-${CoverShape}`;
const camSlot = (s: Settings): CamSlot => (s.layout === 'cover' ? `cover-${s.coverShape}` : s.layout);
const activeCam = (s: Settings) => s.cams[camSlot(s)];

interface Look {
  exposure: number;
  contrast: number;
  saturation: number;
  fire: number;
  fill: number;
  vignette: number;
  embers: number;
}

type Layout = 'scene' | 'poster' | 'cover';

interface Settings {
  /** "Campfire scene" (the first version) or "Poster" (the whole frame is the Wanted poster). */
  layout: Layout;
  posterColor: ColorId;
  /** Cover layout: which of CrazyGames' three cover shapes. */
  coverShape: CoverShape;
  /** One camera per layout (and cover shape), so switching doesn't undo another's framing. */
  cams: Record<CamSlot, Cam>;
  look: Look;
  show: { title: boolean; tagline: boolean; credit: boolean; poster: boolean };
}

const DEFAULTS: Settings = {
  layout: 'scene',
  posterColor: 'red',
  coverShape: 'landscape',
  cams: {
    scene: CAM_PRESETS.Hero,
    poster: POSTER_CAM_PRESETS.Tight,
    'cover-landscape': COVER_CAM_PRESETS.landscape,
    'cover-portrait': COVER_CAM_PRESETS.portrait,
    'cover-square': COVER_CAM_PRESETS.square,
  },
  look: { exposure: 1.6, contrast: 1.15, saturation: 1.45, fire: 1.6, fill: 1.4, vignette: 0.55, embers: 6 },
  show: { title: true, tagline: true, credit: true, poster: true },
};
const STORE = 'wtc:thumbnail';

function loadSettings(): Settings {
  try {
    const s = JSON.parse(localStorage.getItem(STORE) ?? 'null');
    if (s && typeof s === 'object') {
      const cams = Object.fromEntries(
        (Object.keys(DEFAULTS.cams) as CamSlot[]).map((k) => [k, { ...DEFAULTS.cams[k], ...(s.cams?.[k] ?? (k === 'scene' ? s.cam : undefined)) }]),
      ) as Settings['cams'];
      const layout: Layout = s.layout === 'poster' || s.layout === 'cover' ? s.layout : 'scene';
      const coverShape: CoverShape = s.coverShape in COVER_SHAPES ? s.coverShape : 'landscape';
      return { ...DEFAULTS, ...s, layout, coverShape, cams, look: { ...DEFAULTS.look, ...s.look }, show: { ...DEFAULTS.show, ...s.show } };
    }
  } catch {
    /* ignore */
  }
  return DEFAULTS;
}

// ---------------------------------------------------------------- the 3D scene

function Circle({ posterColor, rotate }: { posterColor: ColorId; rotate: number }) {
  const scenery = useScenery();
  // The poster color takes the front seat; the others fill the rest in order.
  const order = useMemo(() => [...SITTERS].sort((a, b) => Number(b.color === posterColor) - Number(a.color === posterColor)), [posterColor]);
  const placed = useMemo(
    () =>
      order.map((s, i) => {
        const a = rotate + SEAT_ANGLES[i];
        const r = RADIUS + (i === 0 ? FRONT_PULL : 0);
        const position: [number, number, number] = [Math.sin(a) * r, 0, Math.cos(a) * r];
        const rotationY = a + Math.PI;
        const back = SIT_HIPS[s.pose].z * SCALE;
        const seat: Seat = {
          type: s.seat,
          position: [position[0] - Math.sin(a) * back, 0, position[2] - Math.cos(a) * back],
          rotationY,
          height: (SIT_HIPS[s.pose].y - SEAT_BELOW_HIPS) * SCALE,
        };
        return { s, position, rotationY, seat, seed: (i * 0.37 + 0.11) % 1 };
      }),
    [order, rotate],
  );
  const props = useMemo(
    () => ({
      cactus1: [{ position: [-7, 0, -6] as [number, number, number], rotationY: 0.4, scale: 1.3 }],
      cactus2: [{ position: [8, 0, -3] as [number, number, number], rotationY: 1.2, scale: 1.2 }],
      deadTree: [{ position: [5, 0, -8] as [number, number, number], rotationY: 2 }],
      wagon: [{ position: [-6.5, 0, 4] as [number, number, number], rotationY: 0.9 }],
    }),
    [],
  );
  return (
    <>
      <Ground radius={30} circleRadius={RADIUS} rutAngles={[200, 330]} rutFrom={RADIUS + 2} rutTo={20} stones={24} tufts={36} />
      <Seats scenery={scenery} seats={placed.map((p) => p.seat)} />
      {Object.entries(props).map(([name, placements]) => (
        <PropInstances key={name} scenery={scenery} name={name} placements={placements} />
      ))}
      {placed.map(({ s, position, rotationY, seed }) => (
        <Scarecrow
          key={s.color}
          name=""
          label={false}
          item={s.item}
          cosmetics={s.cosmetics}
          colorHex={colorInfo(s.color).hex}
          position={position}
          rotationY={rotationY}
          selected={false}
          faded={false}
          searched={false}
          pose={s.pose}
          seed={seed}
          reaction={null}
        />
      ))}
    </>
  );
}

/** Camera from the settings, with a lens shift; reports where the fire lands on screen. */
function Rig({ cam, exposure, fire }: { cam: Cam; exposure: number; fire: React.MutableRefObject<{ x: number; y: number }> }) {
  const camera = useThree((s) => s.camera) as PerspectiveCamera;
  const gl = useThree((s) => s.gl);
  const size = useThree((s) => s.size);
  const target = useMemo(() => new Vector3(), []);
  const p = useMemo(() => new Vector3(), []);
  useEffect(() => {
    gl.toneMappingExposure = exposure;
  }, [gl, exposure]);
  useEffect(() => () => camera.clearViewOffset(), [camera]);
  useFrame(() => {
    camera.position.set(Math.sin(cam.rotate) * cam.distance, cam.height, Math.cos(cam.rotate) * cam.distance);
    target.set(0, cam.lookY, 0);
    camera.lookAt(target);
    camera.fov = cam.fov;
    // Shift the picture without turning the camera (positive x moves the scene right).
    camera.setViewOffset(size.width, size.height, -cam.shiftX * size.width, cam.shiftY * size.height, size.width, size.height);
    camera.updateProjectionMatrix();
    p.set(0, 0.7, 0).project(camera);
    fire.current = { x: (p.x + 1) / 2, y: (1 - p.y) / 2 };
  });
  return null;
}

function ThumbScene({ s, fire, onGl }: { s: Settings; fire: React.MutableRefObject<{ x: number; y: number }>; onGl: (c: HTMLCanvasElement) => void }) {
  return (
    <Canvas
      dpr={2}
      resize={{ offsetSize: true }}
      gl={{ antialias: true, preserveDrawingBuffer: true }}
      camera={{ position: [0, 2.7, 8.4], fov: 38 }}
      onCreated={({ gl }) => onGl(gl.domElement)}
    >
      <color attach="background" args={['#0d1020']} />
      <fog attach="fog" args={['#0e1122', 9, 26]} />
      <hemisphereLight args={['#7f94d4', '#3a2a1a', 0.9 * s.look.fill]} />
      <directionalLight position={[-12, 30, 18]} intensity={1.4} color="#9fb6ff" />
      {/* Soft fill from the camera's side, so the garments read against the night. */}
      <directionalLight position={[Math.sin(activeCam(s).rotate) * 10, 6, Math.cos(activeCam(s).rotate) * 10]} intensity={1.1 * s.look.fill} color="#f4f1ff" />
      <Campfire embers={s.look.embers} glow={s.look.fire} />
      <Suspense fallback={null}>
        <Circle posterColor={s.posterColor} rotate={activeCam(s).rotate} />
      </Suspense>
      <Rig cam={activeCam(s)} exposure={s.look.exposure} fire={fire} />
    </Canvas>
  );
}

// ---------------------------------------------------------------- 2D composition

interface Fonts {
  display: string;
  body: string;
  telegram: string;
}

let paper: HTMLImageElement | null = null;
function loadPaper(): Promise<HTMLImageElement | null> {
  return new Promise((res) => {
    const img = new Image();
    img.onload = () => res((paper = img));
    img.onerror = () => res(null);
    img.src = PAPER_URL;
  });
}

/**
 * The poster, at high resolution: the menu poster, its figure in the outlaw's color (no color
 * dab or name), and the reward in big, bold, dark red lettering that reads at phone size.
 */
function posterImage(color: ColorId, fonts: Fonts): HTMLCanvasElement {
  const k = 6;
  const c = document.createElement('canvas');
  c.width = POSTER_W * k;
  c.height = POSTER_H * k;
  const ctx = c.getContext('2d')!;
  drawPoster(ctx, { colorHex: colorInfo(color).hex, colorName: null, pot: 100, number: null, of: null }, fonts, paper, { color: false, stamp: false });
  ctx.save();
  ctx.scale(k, k);
  ctx.translate(150, 344);
  ctx.rotate((-3 * Math.PI) / 180);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.lineJoin = 'round';
  const line = (text: string, size: number, y: number) => {
    ctx.font = `${size}px ${fonts.display}`;
    // Fit the poster's width, whatever the font's proportions.
    const w = ctx.measureText(text).width;
    if (w > 250) ctx.font = `${(size * 250) / w}px ${fonts.display}`;
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#3d0805';
    ctx.strokeText(text, 0, y);
    ctx.fillStyle = REWARD_RED;
    ctx.fillText(text, 0, y);
  };
  line('REWARD', 46, -6);
  line('$100', 62, 52);
  ctx.restore();
  return c;
}
const REWARD_RED = '#8e140c';

/** Bold text with a thick dark outline and a soft drop shadow. */
function outlined(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, fill: string, outline: number) {
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.75)';
  ctx.shadowBlur = size * 0.35;
  ctx.shadowOffsetY = size * 0.08;
  ctx.lineWidth = size * outline;
  ctx.strokeStyle = '#1a0e05';
  ctx.strokeText(text, x, y);
  ctx.restore();
  ctx.lineWidth = size * outline;
  ctx.strokeStyle = '#1a0e05';
  ctx.strokeText(text, x, y);
  ctx.fillStyle = fill;
  ctx.fillText(text, x, y);
}

function compose(ctx: CanvasRenderingContext2D, scene: HTMLCanvasElement | null, s: Settings, fonts: Fonts, poster: HTMLCanvasElement | null, fire: { x: number; y: number }) {
  if (s.layout === 'poster') return composePoster(ctx, scene, s, fonts, fire);
  if (s.layout === 'cover') return composeCover(ctx, scene, s, fonts, fire);
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  const u = H / 720; // one pixel of the 1280x720 layout
  ctx.save();
  ctx.fillStyle = '#0b0d19';
  ctx.fillRect(0, 0, W, H);
  if (scene && scene.width) {
    ctx.filter = `contrast(${s.look.contrast}) saturate(${s.look.saturation})`;
    ctx.drawImage(scene, 0, 0, W, H);
    ctx.filter = 'none';
  }

  // A warm bloom over the fire.
  const fx = fire.x * W;
  const fy = fire.y * H;
  ctx.globalCompositeOperation = 'lighter';
  const g = ctx.createRadialGradient(fx, fy, 0, fx, fy, 260 * u);
  g.addColorStop(0, `rgba(255,150,60,${Math.min(0.5, 0.16 * s.look.fire)})`);
  g.addColorStop(1, 'rgba(255,120,40,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  ctx.globalCompositeOperation = 'source-over';

  // Vignette: edges darker, the eye goes to the fire, the circle and the poster.
  const v = ctx.createRadialGradient(W * 0.5, H * 0.55, H * 0.35, W * 0.5, H * 0.55, H * 1.05);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, `rgba(0,0,0,${s.look.vignette})`);
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, W, H);

  // Text metrics first: the poster is fitted around the title and the tagline.
  ctx.textBaseline = 'alphabetic';
  const ta = 92 * u;
  const tb = 112 * u;
  const titleY1 = 30 * u + ta;
  const titleY2 = titleY1 + tb * 0.98;
  ctx.font = `${tb}px ${fonts.display}`;
  const line2 = ctx.measureText('True Colors');
  ctx.font = `${ta}px ${fonts.display}`;
  // Optical centering: "Wanted:" is centered on "Wanted", the colon hangs off the right.
  const wantedW = ctx.measureText('Wanted').width;
  const titleRight = W / 2 + Math.max(line2.width, ctx.measureText('Wanted:').width) / 2 + tb * 0.08;
  const titleBottom = titleY2 + line2.actualBoundingBoxDescent + tb * 0.08;
  const tg = 44 * u;
  ctx.font = `${tg}px ${fonts.telegram}`;
  const tag = ctx.measureText('Everyone lies. Find the outlaw.');
  const tagY = H - 30 * u;
  const tagTop = tagY - tag.actualBoundingBoxAscent - tg * 0.1;
  const tagRight = W / 2 + tag.width / 2 + tg * 0.1;

  // The Wanted poster on its post, right side, level with the circle: as big as it fits (up to
  // 1.5x the first version), below the title and above the tagline, inside the frame.
  if (s.show.poster && poster) {
    const margin = 14 * u;
    const gap = 10 * u;
    const tilt = (-3 * Math.PI) / 180;
    // A rotated w x h box needs this much room.
    const extent = (w: number) => {
      const h = (w * POSTER_H) / POSTER_W;
      return { w: w * Math.cos(-tilt) + h * Math.sin(-tilt), h: h * Math.cos(-tilt) + w * Math.sin(-tilt) };
    };
    const fit = (w: number) => {
      const e = extent(w);
      const left = W - margin - e.w;
      const top = s.show.title && left < titleRight ? titleBottom + gap : margin;
      const floor = s.show.tagline && left < tagRight ? tagTop - gap : H - margin;
      return { e, left, top, ok: top + e.h <= floor, floor };
    };
    let pw = 339 * u;
    while (pw > 150 * u && !fit(pw).ok) pw -= 2 * u;
    const f = fit(pw);
    const ph = (pw * POSTER_H) / POSTER_W;
    const cx = f.left + f.e.w / 2;
    // Centered in the room it has (so it sits level with the scarecrows and the fire).
    const cy = (f.top + Math.min(f.floor, H - margin)) / 2;
    // For checking the layout from the console: the poster's size against the first version.
    (window as unknown as { __thumbPoster?: object }).__thumbPoster = { scale: pw / (226 * u), top: f.top / u, bottom: (cy + f.e.h / 2) / u, left: f.left / u };
    const postW = 33 * u;
    const post = ctx.createLinearGradient(cx - postW, 0, cx + postW, 0);
    post.addColorStop(0, '#1d120a');
    post.addColorStop(0.3, '#4a311d');
    post.addColorStop(0.5, '#5a3c23');
    post.addColorStop(0.75, '#3a2615');
    post.addColorStop(1, '#1a1009');
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.7)';
    ctx.shadowBlur = 30 * u;
    ctx.fillStyle = post;
    ctx.translate(cx, cy - ph / 2 - 60 * u);
    ctx.rotate((1 * Math.PI) / 180);
    ctx.fillRect(-postW, 0, 2 * postW, H);
    ctx.restore();
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(tilt);
    ctx.shadowColor = 'rgba(0,0,0,0.65)';
    ctx.shadowBlur = 26 * u;
    ctx.shadowOffsetY = 8 * u;
    ctx.drawImage(poster, -pw / 2, -ph / 2, pw, ph);
    ctx.restore();
  }

  // Title, top center: the menu title's font and colors, a lot bigger.
  if (s.show.title) {
    ctx.font = `${ta}px ${fonts.display}`;
    ctx.textAlign = 'left';
    outlined(ctx, 'Wanted:', W / 2 - wantedW / 2, titleY1, ta, '#f1d78f', 0.16);
    ctx.font = `${tb}px ${fonts.display}`;
    ctx.textAlign = 'center';
    outlined(ctx, 'True Colors', W / 2, titleY2, tb, '#f3e6c4', 0.15);
  }
  // Tagline, bottom center, in the menu tagline's typewriter font.
  if (s.show.tagline) {
    ctx.font = `${tg}px ${fonts.telegram}`;
    ctx.textAlign = 'center';
    outlined(ctx, 'Everyone lies. Find the outlaw.', W / 2, tagY, tg, '#f3e6c4', 0.2);
  }
  // Credit, bottom left: small, clear of the tagline and the poster.
  if (s.show.credit) {
    const c = 18 * u;
    ctx.font = `700 ${c}px ${fonts.body}`;
    ctx.textAlign = 'left';
    ctx.globalAlpha = 0.85;
    outlined(ctx, 'Made by 3042Official', 22 * u, H - 20 * u, c, '#e6d6b0', 0.22);
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}

// ---------------------------------------------------------------- the Poster layout

/** Same numbers every time (so the paper's tears and stains don't change between frames). */
function seeded(seed: number) {
  let x = seed >>> 0;
  return () => {
    x = (x * 1664525 + 1013904223) >>> 0;
    return x / 4294967296;
  };
}

/** A torn-paper outline just inside the rectangle: small ragged steps with a few deeper bites. */
function tornPath(x0: number, y0: number, x1: number, y1: number, u: number): Path2D {
  const rnd = seeded(3042);
  const path = new Path2D();
  const step = 7 * u;
  const depth = () => (rnd() * 4.5 + (rnd() < 0.06 ? 5 + rnd() * 5 : 0)) * u;
  const edge = (ax: number, ay: number, bx: number, by: number, nx: number, ny: number, first: boolean) => {
    const len = Math.hypot(bx - ax, by - ay);
    const n = Math.max(2, Math.round(len / step));
    for (let i = 0; i < n; i++) {
      const t = i / n;
      const d = depth();
      const px = ax + (bx - ax) * t + nx * d;
      const py = ay + (by - ay) * t + ny * d;
      if (first && i === 0) path.moveTo(px, py);
      else path.lineTo(px, py);
    }
  };
  edge(x0, y0, x1, y0, 0, 1, true);
  edge(x1, y0, x1, y1, -1, 0, false);
  edge(x1, y1, x0, y1, 0, -1, false);
  edge(x0, y1, x0, y0, 1, 0, false);
  path.closePath();
  return path;
}

const POSTER_INK = '#24160a';

/**
 * The whole frame is the Wanted poster: torn paper on a thin strip of night, nails in the
 * corners, the title in the poster's ink, a live campfire photo in the picture frame, the
 * reward in big red lettering and the tagline at the bottom.
 */
function composePoster(ctx: CanvasRenderingContext2D, scene: HTMLCanvasElement | null, s: Settings, fonts: Fonts, fire: { x: number; y: number }) {
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  const u = H / 720;
  ctx.save();

  // The night behind the paper.
  const night = ctx.createRadialGradient(W / 2, H / 2, H * 0.2, W / 2, H / 2, W * 0.7);
  night.addColorStop(0, '#1a1726');
  night.addColorStop(1, '#07080f');
  ctx.fillStyle = night;
  ctx.fillRect(0, 0, W, H);

  // Paper: base, texture, warm tint, stains, darker edges, all clipped to the torn outline.
  const px0 = 16 * u;
  const py0 = 12 * u;
  const px1 = W - 16 * u;
  const py1 = H - 12 * u;
  const torn = tornPath(px0, py0, px1, py1, u);
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.8)';
  ctx.shadowBlur = 18 * u;
  ctx.fillStyle = '#dcc596';
  ctx.fill(torn);
  ctx.restore();
  ctx.save();
  ctx.clip(torn);
  if (paper) {
    ctx.globalAlpha = 0.85;
    ctx.drawImage(paper, 0, 0, W, H);
    ctx.globalAlpha = 1;
  }
  ctx.fillStyle = 'rgba(214,180,120,0.35)';
  ctx.fillRect(0, 0, W, H);
  const rnd = seeded(77);
  for (let i = 0; i < 9; i++) {
    const x = px0 + rnd() * (px1 - px0);
    const y = py0 + rnd() * (py1 - py0);
    const rad = (40 + rnd() * 110) * u;
    const g = ctx.createRadialGradient(x, y, rad * 0.1, x, y, rad);
    g.addColorStop(0, `rgba(120,78,30,${0.05 + rnd() * 0.07})`);
    g.addColorStop(0.7, `rgba(120,78,30,${0.02 + rnd() * 0.03})`);
    g.addColorStop(1, 'rgba(120,78,30,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  const edgeDark = ctx.createRadialGradient(W / 2, H / 2, H * 0.45, W / 2, H / 2, W * 0.62);
  edgeDark.addColorStop(0, 'rgba(0,0,0,0)');
  edgeDark.addColorStop(1, 'rgba(90,50,15,0.5)');
  ctx.fillStyle = edgeDark;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
  ctx.strokeStyle = 'rgba(70,40,15,0.55)';
  ctx.lineWidth = 1.5 * u;
  ctx.stroke(torn);

  // Text layout (1280x720 units).
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  const titleSize = 84 * u;
  const titleY = 108 * u;
  const subY = 140 * u;
  const frame = { x: 250 * u, y: 156 * u, w: 780 * u, h: 368 * u };
  const rewardY = 598 * u;
  const tagY = 664 * u;

  // Title in the poster's ink, on one line (the colon sits mid-line, so the ends set the center).
  if (s.show.title) {
    ctx.font = `${titleSize}px ${fonts.display}`;
    ctx.fillStyle = POSTER_INK;
    ctx.fillText('Wanted: True Colors', W / 2, titleY);
    ctx.font = `italic ${20 * u}px ${fonts.body}`;
    ctx.fillText('— Dead or alive —', W / 2, subY);
  }

  // The picture: a live, tight crop of the campfire, printed on the poster (warm, aged, still colorful).
  ctx.save();
  ctx.fillStyle = '#120c08';
  ctx.fillRect(frame.x, frame.y, frame.w, frame.h);
  if (scene && scene.width) {
    const aspect = frame.w / frame.h;
    const sw = scene.width;
    const sh = Math.min(scene.height, sw / aspect);
    const sx = 0;
    const sy = (scene.height - sh) / 2;
    ctx.beginPath();
    ctx.rect(frame.x, frame.y, frame.w, frame.h);
    ctx.clip();
    ctx.filter = `sepia(0.16) saturate(${1.25 * s.look.saturation}) contrast(${s.look.contrast})`;
    ctx.drawImage(scene, sx, sy, sw, sh, frame.x, frame.y, frame.w, frame.h);
    ctx.filter = 'none';
    // A warm bloom over the fire.
    const fx = frame.x + fire.x * frame.w;
    const fy = frame.y + ((fire.y * scene.height - sy) / sh) * frame.h;
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(fx, fy, 0, fx, fy, 220 * u);
    g.addColorStop(0, `rgba(255,150,60,${Math.min(0.5, 0.16 * s.look.fire)})`);
    g.addColorStop(1, 'rgba(255,120,40,0)');
    ctx.fillStyle = g;
    ctx.fillRect(frame.x, frame.y, frame.w, frame.h);
    ctx.globalCompositeOperation = 'source-over';
    // Aged print: a warm wash and darker corners.
    ctx.fillStyle = 'rgba(255,214,160,0.08)';
    ctx.fillRect(frame.x, frame.y, frame.w, frame.h);
    const pv = ctx.createRadialGradient(frame.x + frame.w / 2, frame.y + frame.h / 2, frame.h * 0.35, frame.x + frame.w / 2, frame.y + frame.h / 2, frame.w * 0.62);
    pv.addColorStop(0, 'rgba(0,0,0,0)');
    pv.addColorStop(1, `rgba(40,20,5,${0.25 + s.look.vignette * 0.4})`);
    ctx.fillStyle = pv;
    ctx.fillRect(frame.x, frame.y, frame.w, frame.h);
  }
  ctx.restore();
  // Thin dark border, and a fine outer rule like the poster's own frame.
  ctx.strokeStyle = POSTER_INK;
  ctx.lineWidth = 4 * u;
  ctx.strokeRect(frame.x, frame.y, frame.w, frame.h);
  ctx.strokeStyle = 'rgba(36,22,10,0.55)';
  ctx.lineWidth = 1.5 * u;
  ctx.strokeRect(frame.x - 8 * u, frame.y - 8 * u, frame.w + 16 * u, frame.h + 16 * u);

  // Creases: faint folds across the paper (a highlight beside a shadow).
  const crease = (ax: number, ay: number, bx: number, by: number) => {
    ctx.lineWidth = 2 * u;
    ctx.strokeStyle = 'rgba(255,246,222,0.22)';
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();
    ctx.lineWidth = 1.2 * u;
    ctx.strokeStyle = 'rgba(80,50,20,0.16)';
    ctx.beginPath();
    ctx.moveTo(ax + 2 * u, ay + 1 * u);
    ctx.lineTo(bx + 2 * u, by + 1 * u);
    ctx.stroke();
  };
  ctx.save();
  ctx.clip(torn);
  crease(W * 0.335, py0, W * 0.345, py1);
  crease(px0, H * 0.47, px1, H * 0.455);
  ctx.restore();

  // Nails in the corners.
  for (const [x, y] of [
    [44, 38],
    [W / u - 44, 38],
    [44, 720 - 38],
    [W / u - 44, 720 - 38],
  ]) {
    const nx = x * u;
    const ny = y * u;
    const h = ctx.createRadialGradient(nx, ny, 2 * u, nx, ny, 14 * u);
    h.addColorStop(0, 'rgba(110,55,20,0.6)');
    h.addColorStop(1, 'rgba(110,55,20,0)');
    ctx.fillStyle = h;
    ctx.beginPath();
    ctx.arc(nx, ny, 14 * u, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#1a120b';
    ctx.beginPath();
    ctx.arc(nx, ny, 5 * u, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,240,210,0.4)';
    ctx.beginPath();
    ctx.arc(nx - 1.5 * u, ny - 1.5 * u, 1.6 * u, 0, Math.PI * 2);
    ctx.fill();
  }

  // REWARD $100: big, bold, dark red, a touch of tilt.
  ctx.save();
  ctx.translate(W / 2, rewardY);
  ctx.rotate((-1.5 * Math.PI) / 180);
  ctx.font = `${68 * u}px ${fonts.display}`;
  ctx.textAlign = 'center';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 3.5 * u;
  ctx.strokeStyle = '#3d0805';
  ctx.strokeText('REWARD $100', 0, 0);
  ctx.fillStyle = REWARD_RED;
  ctx.fillText('REWARD $100', 0, 0);
  ctx.restore();

  // Tagline in dark ink.
  if (s.show.tagline) {
    ctx.font = `${38 * u}px ${fonts.telegram}`;
    ctx.textAlign = 'center';
    ctx.fillStyle = POSTER_INK;
    ctx.fillText('Everyone lies. Find the outlaw.', W / 2, tagY);
  }
  // Credit, small, on the paper in the bottom right corner.
  if (s.show.credit) {
    ctx.font = `700 ${14 * u}px ${fonts.body}`;
    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(36,22,10,0.75)';
    ctx.fillText('Made by 3042Official', W - 76 * u, H - 30 * u);
  }
  ctx.restore();
}

// ---------------------------------------------------------------- the Cover layout

/**
 * CrazyGames' game covers (landscape 1920x1080, portrait 800x1200, square 800x800): the
 * campfire with everyone's true colors, and the title as the only text (their rule).
 */
function composeCover(ctx: CanvasRenderingContext2D, scene: HTMLCanvasElement | null, s: Settings, fonts: Fonts, fire: { x: number; y: number }) {
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  const m = Math.min(W, H);
  ctx.save();
  ctx.fillStyle = '#0b0d19';
  ctx.fillRect(0, 0, W, H);
  if (scene && scene.width) {
    ctx.filter = `contrast(${s.look.contrast}) saturate(${s.look.saturation})`;
    ctx.drawImage(scene, 0, 0, W, H);
    ctx.filter = 'none';
  }
  const fx = fire.x * W;
  const fy = fire.y * H;
  ctx.globalCompositeOperation = 'lighter';
  const g = ctx.createRadialGradient(fx, fy, 0, fx, fy, m * 0.36);
  g.addColorStop(0, `rgba(255,150,60,${Math.min(0.5, 0.16 * s.look.fire)})`);
  g.addColorStop(1, 'rgba(255,120,40,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  ctx.globalCompositeOperation = 'source-over';
  const v = ctx.createRadialGradient(W / 2, H * 0.58, m * 0.35, W / 2, H * 0.58, Math.hypot(W, H) * 0.55);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, `rgba(0,0,0,${s.look.vignette})`);
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, W, H);

  // The title: two lines, as big as fits (about 88% of the width), "Wanted:" centered on its letters.
  if (s.show.title) {
    const maxW = W * 0.88;
    const fit = (text: string, size: number) => {
      ctx.font = `${size}px ${fonts.display}`;
      return Math.min(size, (size * maxW) / ctx.measureText(text).width);
    };
    const b = fit('True Colors', m * (W < H ? 0.17 : 0.16));
    const a = Math.min(b * 0.82, fit('Wanted:', b));
    const top = H * (W < H ? 0.05 : 0.045);
    ctx.textBaseline = 'alphabetic';
    ctx.font = `${a}px ${fonts.display}`;
    const wantedW = ctx.measureText('Wanted').width;
    ctx.textAlign = 'left';
    outlined(ctx, 'Wanted:', W / 2 - wantedW / 2, top + a, a, '#f1d78f', 0.16);
    ctx.font = `${b}px ${fonts.display}`;
    ctx.textAlign = 'center';
    outlined(ctx, 'True Colors', W / 2, top + a + b * 0.98, b, '#f3e6c4', 0.15);
  }
  ctx.restore();
}

// ---------------------------------------------------------------- the page

function cssFamily(name: string, fallback: string) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

export function Thumbnail() {
  const [s, setS] = useState<Settings>(DEFAULTS);
  useEffect(() => setS(loadSettings()), []);
  useEffect(() => {
    try {
      localStorage.setItem(STORE, JSON.stringify(s));
    } catch {
      /* ignore */
    }
  }, [s]);

  const canvasFonts = useCanvasFonts();
  const [fonts, setFonts] = useState<Fonts | null>(null);
  const [paperReady, setPaperReady] = useState(false);
  useEffect(() => {
    const f: Fonts = { display: canvasFonts.display, body: canvasFonts.body, telegram: cssFamily('--font-telegram', 'monospace') };
    Promise.all([document.fonts.load(`100px ${f.display}`), document.fonts.load(`700 40px ${f.body}`), document.fonts.load(`40px ${f.telegram}`)])
      .catch(() => undefined)
      .then(() => setFonts(f));
    loadPaper().then(() => setPaperReady(true));
  }, [canvasFonts.ready, canvasFonts.display, canvasFonts.body]);
  const poster = useMemo(() => (fonts ? posterImage(s.posterColor, fonts) : null), [fonts, s.posterColor, paperReady]); // eslint-disable-line react-hooks/exhaustive-deps

  const out = useRef<HTMLCanvasElement>(null);
  const gl = useRef<HTMLCanvasElement | null>(null);
  const fire = useRef({ x: 0.5, y: 0.55 });
  const latest = useRef({ s, fonts, poster });
  latest.current = { s, fonts, poster };

  // Re-compose continuously (the fire flickers, the scarecrows breathe).
  useEffect(() => {
    let raf = 0;
    let last = 0;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (now - last < 50) return;
      last = now;
      const ctx = out.current?.getContext('2d');
      const { s, fonts, poster } = latest.current;
      if (ctx && fonts) compose(ctx, gl.current, s, fonts, poster, fire.current);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // Fit the stage (its shape depends on the layout) into the free area.
  const shape = shapeOf(s);
  const [VIEW_W, VIEW_H] = shape.view;
  const area = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.5);
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    const fit = () => setScale(Math.min((el.clientWidth - 24) / VIEW_W, (el.clientHeight - 24) / VIEW_H));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [VIEW_W, VIEW_H]);

  const download = useCallback(
    (w: number, h: number) => {
      const src = out.current;
      if (!src || !fonts) return;
      compose(src.getContext('2d')!, gl.current, s, fonts, poster, fire.current);
      let canvas = src;
      if (w !== src.width) {
        canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d')!;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(src, 0, 0, w, h);
      }
      canvas.toBlob((blob) => {
        if (!blob) return;
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `wanted-true-colors-${s.layout === 'cover' ? `cover-${s.coverShape}` : 'thumbnail'}-${w}x${h}.png`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      }, 'image/png');
    },
    [s, fonts, poster],
  );

  const cam = (k: keyof Cam, v: number) => setS((x) => ({ ...x, cams: { ...x.cams, [camSlot(x)]: { ...activeCam(x), [k]: v } } }));
  const c = activeCam(s);
  const presets: Record<string, Cam> = s.layout === 'poster' ? POSTER_CAM_PRESETS : s.layout === 'cover' ? { Default: COVER_CAM_PRESETS[s.coverShape] } : CAM_PRESETS;
  const look = (k: keyof Look, v: number) => setS((x) => ({ ...x, look: { ...x.look, [k]: v } }));
  const slider = (label: string, value: number, min: number, max: number, step: number, set: (v: number) => void, fmt = (v: number) => v.toFixed(2)) => (
    <label className="thumb-slider">
      <span>{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => set(Number(e.target.value))} />
      <output>{fmt(value)}</output>
    </label>
  );

  return (
    <div className="studio thumb">
      <div className="studio-stage-area" ref={area}>
        <div className="studio-stage" style={{ width: VIEW_W * scale, height: VIEW_H * scale }}>
          <div style={{ width: VIEW_W, height: VIEW_H, transform: `scale(${scale})`, transformOrigin: '0 0', position: 'absolute', left: 0, top: 0 }}>
            {/* The live 3D view sits underneath; what you see is the composed picture on top. */}
            <div style={{ position: 'absolute', inset: 0 }}>
              <ThumbScene s={s} fire={fire} onGl={(c) => (gl.current = c)} />
            </div>
            {/* Keyed by shape: a new size means a fresh canvas. */}
            <canvas key={`${VIEW_W}x${VIEW_H}`} ref={out} width={VIEW_W * 2} height={VIEW_H * 2} style={{ position: 'absolute', inset: 0, width: VIEW_W, height: VIEW_H }} />
          </div>
        </div>
      </div>

      <aside className="studio-panel">
        <section>
          <h4>Thumbnail</h4>
          <div className="row">
            <a href="?" className="thumb-link">
              ← Trailer studio
            </a>
          </div>
          <div className="hint">A YouTube still of the menu campfire scene. The preview is exactly what downloads.</div>
        </section>

        <section>
          <h4>Export</h4>
          <div className="row">
            {shape.downloads.map(([w, h]) => (
              <button key={`${w}x${h}`} className="rec" disabled={!fonts} onClick={() => download(w, h)}>
                Download PNG {w}×{h}
              </button>
            ))}
          </div>
        </section>

        <section>
          <h4>Layout</h4>
          <div className="row">
            {(
              [
                ['scene', 'Campfire scene'],
                ['poster', 'Poster'],
                ['cover', 'Cover'],
              ] as const
            ).map(([id, label]) => (
              <button key={id} className={s.layout === id ? 'on' : ''} onClick={() => setS((x) => ({ ...x, layout: id }))}>
                {label}
              </button>
            ))}
          </div>
          <div className="hint">
            {s.layout === 'poster'
              ? 'The whole thumbnail is the Wanted poster, with the campfire in its picture frame.'
              : s.layout === 'cover'
                ? 'CrazyGames game covers: the campfire and the title, no other text (their rule).'
                : 'The campfire scene with the title, the poster on its post and the tagline.'}
          </div>
          {s.layout === 'cover' && (
            <div className="row">
              {(
                [
                  ['landscape', 'Landscape 1920×1080'],
                  ['portrait', 'Portrait 800×1200'],
                  ['square', 'Square 800×800'],
                ] as const
              ).map(([id, label]) => (
                <button key={id} className={s.coverShape === id ? 'on' : ''} onClick={() => setS((x) => ({ ...x, coverShape: id }))}>
                  {label}
                </button>
              ))}
            </div>
          )}
        </section>

        <section>
          <h4>Poster color</h4>
          <div className="row">
            {SITTERS.map((p) => (
              <button
                key={p.color}
                className={s.posterColor === p.color ? 'on' : ''}
                onClick={() => setS((x) => ({ ...x, posterColor: p.color }))}
                title={`${colorInfo(p.color).name} (${p.item})`}
              >
                <span className="thumb-dot" style={{ background: colorInfo(p.color).hex }} /> {colorInfo(p.color).name}
              </button>
            ))}
          </div>
          <div className="hint">That player sits front left, a little closer to the camera.</div>
        </section>

        <section>
          <h4>Camera</h4>
          <div className="row">
            {Object.entries(presets).map(([name, preset]) => (
              <button key={name} onClick={() => setS((x) => ({ ...x, cams: { ...x.cams, [x.layout]: preset } }))}>
                {name}
              </button>
            ))}
          </div>
          {slider('Rotate', c.rotate, -Math.PI, Math.PI, 0.01, (v) => cam('rotate', v), (v) => `${Math.round((v * 180) / Math.PI)}°`)}
          {slider('Distance', c.distance, 5, 14, 0.05, (v) => cam('distance', v))}
          {slider('Height', c.height, 0.6, 7, 0.05, (v) => cam('height', v))}
          {slider('Look at height', c.lookY, -0.5, 2.5, 0.05, (v) => cam('lookY', v))}
          {slider('Zoom (fov)', c.fov, 22, 60, 0.5, (v) => cam('fov', v), (v) => `${v.toFixed(0)}°`)}
          {slider('Shift left/right', c.shiftX, -0.3, 0.3, 0.005, (v) => cam('shiftX', v))}
          {slider('Shift up/down', c.shiftY, -0.3, 0.3, 0.005, (v) => cam('shiftY', v))}
        </section>

        <section>
          <h4>Look</h4>
          {slider('Brightness', s.look.exposure, 0.6, 3.5, 0.05, (v) => look('exposure', v))}
          {slider('Contrast', s.look.contrast, 0.7, 1.8, 0.01, (v) => look('contrast', v))}
          {slider('Color pop', s.look.saturation, 0.6, 2.2, 0.01, (v) => look('saturation', v))}
          {slider('Fire glow', s.look.fire, 0.4, 3.5, 0.05, (v) => look('fire', v))}
          {slider('Fill light', s.look.fill, 0, 3, 0.05, (v) => look('fill', v))}
          {slider('Vignette', s.look.vignette, 0, 0.95, 0.01, (v) => look('vignette', v))}
          {slider('Embers', s.look.embers, 0, 28, 1, (v) => look('embers', v), (v) => (v ? String(v) : 'off'))}
        </section>

        <section>
          <h4>Show</h4>
          {(
            [
              ['title', 'Title'],
              ['tagline', 'Tagline'],
              ['credit', 'Credit'],
              ['poster', 'Wanted poster'],
            ] as const
          )
            .filter(([k]) => !(s.layout === 'poster' && k === 'poster') && !(s.layout === 'cover' && k !== 'title'))
            .map(([k, label]) => (
            <label key={k}>
              <input type="checkbox" checked={s.show[k]} onChange={(e) => setS((x) => ({ ...x, show: { ...x.show, [k]: e.target.checked } }))} /> {label}
            </label>
          ))}
          <div className="row">
            <button onClick={() => setS(DEFAULTS)}>Reset everything</button>
          </div>
        </section>
      </aside>
    </div>
  );
}
