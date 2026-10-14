'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Vector3, type PerspectiveCamera } from 'three';
import { colorInfo, type ColorId, type Cosmetics, type ItemType } from '@wtc/shared';
import { useCanvasFonts } from '@/lib/canvasFonts';
import { PAPER_URL, POSTER_H, POSTER_W, LAYOUT, INK, drawPoster } from '../../poster/posterArt';
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

const OUT_W = 3840;
const OUT_H = 2160;
/** The 3D view is laid out at this CSS size and rendered at 2x (= OUT_W x OUT_H). */
const VIEW_W = 1920;
const VIEW_H = 1080;

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

interface Look {
  exposure: number;
  contrast: number;
  saturation: number;
  fire: number;
  fill: number;
  vignette: number;
  embers: number;
}

interface Settings {
  posterColor: ColorId;
  cam: Cam;
  look: Look;
  show: { title: boolean; tagline: boolean; credit: boolean; poster: boolean };
}

const DEFAULTS: Settings = {
  posterColor: 'red',
  cam: CAM_PRESETS.Hero,
  look: { exposure: 1.6, contrast: 1.15, saturation: 1.45, fire: 1.6, fill: 1.4, vignette: 0.55, embers: 6 },
  show: { title: true, tagline: true, credit: true, poster: true },
};
const STORE = 'wtc:thumbnail';

function loadSettings(): Settings {
  try {
    const s = JSON.parse(localStorage.getItem(STORE) ?? 'null');
    if (s && typeof s === 'object') return { ...DEFAULTS, ...s, cam: { ...DEFAULTS.cam, ...s.cam }, look: { ...DEFAULTS.look, ...s.look }, show: { ...DEFAULTS.show, ...s.show } };
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
      dpr={OUT_W / VIEW_W}
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
      <directionalLight position={[Math.sin(s.cam.rotate) * 10, 6, Math.cos(s.cam.rotate) * 10]} intensity={1.1 * s.look.fill} color="#f4f1ff" />
      <Campfire embers={s.look.embers} glow={s.look.fire} />
      <Suspense fallback={null}>
        <Circle posterColor={s.posterColor} rotate={s.cam.rotate} />
      </Suspense>
      <Rig cam={s.cam} exposure={s.look.exposure} fire={fire} />
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

/** The poster, at high resolution: the menu poster with the color name swapped for a solid swatch. */
function posterImage(color: ColorId, fonts: Fonts): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = POSTER_W * 4;
  c.height = POSTER_H * 4;
  const ctx = c.getContext('2d')!;
  const hex = colorInfo(color).hex;
  drawPoster(ctx, { colorHex: hex, colorName: '', pot: 100, number: null, of: null }, fonts, paper);
  ctx.save();
  ctx.scale(4, 4);
  const w = 150;
  const h = 34;
  const y = LAYOUT.colorName.y - 26;
  ctx.beginPath();
  ctx.roundRect(150 - w / 2, y, w, h, 4);
  ctx.fillStyle = hex;
  ctx.fill();
  ctx.lineWidth = 2.2;
  ctx.strokeStyle = INK;
  ctx.stroke();
  ctx.restore();
  return c;
}

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

  // The Wanted poster on its post, right side.
  if (s.show.poster && poster) {
    const pw = 226 * u;
    const ph = (pw * POSTER_H) / POSTER_W;
    const cx = W - 160 * u;
    const top = 232 * u;
    const post = ctx.createLinearGradient(cx - 22 * u, 0, cx + 22 * u, 0);
    post.addColorStop(0, '#1d120a');
    post.addColorStop(0.3, '#4a311d');
    post.addColorStop(0.5, '#5a3c23');
    post.addColorStop(0.75, '#3a2615');
    post.addColorStop(1, '#1a1009');
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.7)';
    ctx.shadowBlur = 30 * u;
    ctx.fillStyle = post;
    ctx.translate(cx, top - 50 * u);
    ctx.rotate((1 * Math.PI) / 180);
    ctx.fillRect(-22 * u, 0, 44 * u, H);
    ctx.restore();
    ctx.save();
    ctx.translate(cx, top + ph / 2);
    ctx.rotate((-3 * Math.PI) / 180);
    ctx.shadowColor = 'rgba(0,0,0,0.65)';
    ctx.shadowBlur = 26 * u;
    ctx.shadowOffsetY = 8 * u;
    ctx.drawImage(poster, -pw / 2, -ph / 2, pw, ph);
    ctx.restore();
  }

  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  // Title, top center: the menu title's font and colors, a lot bigger.
  if (s.show.title) {
    const a = 92 * u;
    const b = 112 * u;
    ctx.font = `${a}px ${fonts.display}`;
    outlined(ctx, 'Wanted:', W / 2, 30 * u + a, a, '#f1d78f', 0.16);
    ctx.font = `${b}px ${fonts.display}`;
    outlined(ctx, 'True Colors', W / 2, 30 * u + a + b * 0.98, b, '#f3e6c4', 0.15);
  }
  // Tagline, bottom center, in the menu tagline's typewriter font.
  if (s.show.tagline) {
    const t = 44 * u;
    ctx.font = `${t}px ${fonts.telegram}`;
    outlined(ctx, 'Everyone lies. Find the outlaw.', W / 2 - 40 * u, H - 48 * u, t, '#f3e6c4', 0.2);
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

  // Fit the 16:9 stage into the free area.
  const area = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.5);
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setScale(Math.min((el.clientWidth - 24) / VIEW_W, (el.clientHeight - 24) / VIEW_H)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

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
        a.download = `wanted-true-colors-thumbnail-${w}x${h}.png`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      }, 'image/png');
    },
    [s, fonts, poster],
  );

  const cam = (k: keyof Cam, v: number) => setS((x) => ({ ...x, cam: { ...x.cam, [k]: v } }));
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
            <canvas ref={out} width={OUT_W} height={OUT_H} style={{ position: 'absolute', inset: 0, width: VIEW_W, height: VIEW_H }} />
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
            <button className="rec" disabled={!fonts} onClick={() => download(1280, 720)}>
              Download PNG 1280×720
            </button>
            <button className="rec" disabled={!fonts} onClick={() => download(OUT_W, OUT_H)}>
              Download PNG 3840×2160
            </button>
          </div>
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
            {Object.entries(CAM_PRESETS).map(([name, c]) => (
              <button key={name} onClick={() => setS((x) => ({ ...x, cam: c }))}>
                {name}
              </button>
            ))}
          </div>
          {slider('Rotate', s.cam.rotate, -Math.PI, Math.PI, 0.01, (v) => cam('rotate', v), (v) => `${Math.round((v * 180) / Math.PI)}°`)}
          {slider('Distance', s.cam.distance, 5, 14, 0.05, (v) => cam('distance', v))}
          {slider('Height', s.cam.height, 0.6, 7, 0.05, (v) => cam('height', v))}
          {slider('Look at height', s.cam.lookY, -0.5, 2.5, 0.05, (v) => cam('lookY', v))}
          {slider('Zoom (fov)', s.cam.fov, 22, 60, 0.5, (v) => cam('fov', v), (v) => `${v.toFixed(0)}°`)}
          {slider('Shift left/right', s.cam.shiftX, -0.3, 0.3, 0.005, (v) => cam('shiftX', v))}
          {slider('Shift up/down', s.cam.shiftY, -0.3, 0.3, 0.005, (v) => cam('shiftY', v))}
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
          ).map(([k, label]) => (
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
