'use client';

import { Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Fog, Vector3, type PerspectiveCamera } from 'three';
import { OrbitControls } from '@react-three/drei';
import { colorInfo, searchedThisPoster, type GameView, type Phase, type PlayerView } from '@wtc/shared';
import { useBrightness } from '@/lib/brightness';
import { reportSag, useQuality } from '@/lib/quality';
import { useAdBreak } from '@/lib/portal/ads';
import { useGame, useGameCountdown } from '@/lib/store';
import { useStreamerMode } from '@/lib/streamer';
import { fitCircle, measureInsets, type Insets } from './framing';
import { PerfProbe } from './PerfProbe';
import { SCALE, SEATED_HEIGHT, Scarecrow, type LookCue, type ReactionCue } from './Scarecrow';
import { SEAT_BELOW_HIPS, SIT_CLIPS, SIT_HIPS, type SitPose } from './scarecrowModel';
import { Town, ringRadius, type PosterState, type Seat, type SeatType } from './town/Town';

// The game scene. Reads the client view only; swap models freely without touching game logic.

const SELECTABLE: Phase[] = ['investigation', 'vote'];
// Keep in sync with the desktop breakpoint in globals.css.
const DESKTOP_MIN = 900;
const FOG_COLOR = '#0c0e1a';
const TARGET = new Vector3(0, 1.6, 0);
const SEAT_TYPES: SeatType[] = ['log', 'crate', 'barrel', 'stump'];
/** An inspect older than this (server time) doesn't turn heads when the view arrives. */
const LOOK_FRESH_MS = 4000;
const RESET_EVENT = 'wtc:reset-view';

/** Stable 0..1 from a string (FNV-1a). Same on every client, so poses match everywhere. */
function hash01(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}

interface SeatInfo {
  position: [number, number, number];
  rotationY: number;
  pose: SitPose;
  seed: number;
  seat: Seat;
  /** Where an inspector's head is, for head turns. */
  head: [number, number, number];
}

/** Seats around the fire, one per player, facing the centre. Your seat is nearest the camera. */
function useSeats(view: PlayerView | null, radius: number): Map<string, SeatInfo> {
  const players = view?.players ?? [];
  const me = view?.you.id;
  const code = view?.code ?? '';
  const ids = players.map((p) => p.id).join(',');
  return useMemo(() => {
    const n = Math.max(players.length, 1);
    const myIndex = Math.max(0, players.findIndex((p) => p.id === me));
    const out = new Map<string, SeatInfo>();
    players.forEach((p, i) => {
      const a = ((i - myIndex) / n) * Math.PI * 2;
      const position: [number, number, number] = [Math.sin(a) * radius, 0, Math.cos(a) * radius];
      const rotationY = a + Math.PI;
      // Pose, seat and timing come from the player id + room, so they hold all game and
      // look the same on every screen (and after a reload).
      const seed = hash01(`${code}:${p.id}`);
      const pose = SIT_CLIPS[Math.floor(hash01(`pose:${code}:${p.id}`) * SIT_CLIPS.length)];
      const type = SEAT_TYPES[Math.floor(hash01(`seat:${code}:${p.id}`) * SEAT_TYPES.length)];
      // The seat goes under the hips, which sit a little behind the feet.
      const back = SIT_HIPS[pose].z * SCALE;
      const seatPos: [number, number, number] = [position[0] - Math.sin(a) * back, 0, position[2] - Math.cos(a) * back];
      out.set(p.id, {
        position,
        rotationY,
        pose,
        seed,
        seat: { type, position: seatPos, rotationY, height: (SIT_HIPS[pose].y - SEAT_BELOW_HIPS) * SCALE },
        head: [position[0], SEATED_HEIGHT - 0.3, position[2]],
      });
    });
    return out;
  }, [ids, me, code, radius]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** Latest fresh inspect per target this poster, as a head-turn cue toward the inspector. */
function lookCues(game: GameView | null | undefined, serverNow: number, seats: Map<string, SeatInfo>): Map<string, LookCue> {
  const out = new Map<string, LookCue>();
  if (!game) return out;
  for (const e of game.log) {
    if (e.poster !== game.posterIndex || serverNow - e.at > LOOK_FRESH_MS) continue;
    const from = seats.get(e.inspectorId);
    if (!from) continue;
    out.set(e.targetId, { key: e.id, target: from.head });
  }
  return out;
}

/**
 * Trailer mode only (/dev/trailer, dev builds): the scene shows made-up local data, so it may
 * paint everyone's colors. The game never passes this; there, other players' colors don't exist
 * on the client at all.
 */
export interface SceneTrailer {
  /** Item color per player id. */
  colors: Record<string, string>;
  labels: boolean;
  /** Player whose scarecrow glows (null: nobody). */
  glowId: string | null;
  /** Camera and capture tools, rendered inside the canvas instead of the game's camera and controls. */
  rig: ReactNode;
  /** Where each seat is (world space), for camera moves. */
  onSeats?: (seats: Map<string, { position: [number, number, number]; head: [number, number, number] }>) => void;
  /**
   * Trailer studio rendering: 'never' hands the frame loop to the studio (it calls advance()
   * with its own clock, frame by frame). Shadows and the drawing buffer kept for capture.
   */
  canvas?: { frameloop?: 'never' | 'always'; shadows?: boolean; dpr?: number; exposure?: number };
}

export default function Scene({ trailer }: { trailer?: SceneTrailer } = {}) {
  const view = useGame((s) => s.view);
  const adBreak = useAdBreak();
  const selectedId = useGame((s) => s.selectedId);
  const select = useGame((s) => s.select);
  const brightness = useBrightness();
  // Smooth (cheap phones): one pixel per CSS pixel, no antialiasing, 30 fps, fewer lights.
  const quality = useQuality();
  // Trailers always render at full quality.
  const smooth = !trailer && quality === 'smooth';
  // Antialiasing is fixed when the canvas is made; a switch mid-game applies on the next visit.
  const [antialias] = useState(!smooth);
  // Streamer mode: your own scarecrow looks like everyone else's (no real color, no glow).
  const streamer = useStreamerMode();
  const [moved, setMoved] = useState(false);
  const [homeDistance, setHomeDistance] = useState(0);

  const players = view?.players ?? [];
  const me = view?.you;
  const n = Math.max(players.length, 1);
  const radius = Math.max(3.2, n * 0.42);
  const canSelect = !!view && SELECTABLE.includes(view.phase);
  // Eye badges: how often each player was inspected this poster (from the public log).
  const eyes = useMemo(() => (view?.game ? searchedThisPoster(view.game.log, view.game.posterIndex) : new Set<string>()), [view?.game]);
  const seats = useSeats(view, radius);
  const seatList = useMemo(() => [...seats.values()].map((s) => s.seat), [seats]);
  const onSeats = trailer?.onSeats;
  useEffect(() => onSeats?.(seats), [seats, onSeats]);

  const ringR = ringRadius(radius);
  const game = view?.game;
  // Nothing on the sheriff's board until the start-of-game countdown ends.
  const counting = useGameCountdown() > 0;
  const poster: PosterState = useMemo(
    () =>
      game && !counting
        ? { color: game.posterColor, pot: game.pot, number: game.posterIndex + 1, of: game.posterCount }
        : { color: null, pot: view?.settings.rules.basePot ?? 100, number: null, of: null },
    [game?.posterColor, game?.pot, game?.posterIndex, game?.posterCount, view?.settings.rules.basePot, counting], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // Head turns: log entries are ordered by time, so the last fresh one per target wins.
  const looks = useMemo(() => lookCues(game, view?.serverNow ?? 0, seats), [game?.log, game?.posterIndex, seats]); // eslint-disable-line react-hooks/exhaustive-deps
  // Reactions come decided and filtered by the server (the Wanted player's true one only reaches them).
  const reactions = game?.reactions && (view?.phase === 'payout' || view?.phase === 'ended') ? game.reactions : null;

  return (
    <>
      <Canvas
        className="scene"
        dpr={trailer?.canvas?.dpr ?? (smooth ? 1 : [1, 1.75])}
        // During a portal's ad break the scene stands still.
        frameloop={trailer?.canvas?.frameloop ?? (adBreak ? 'never' : smooth ? 'demand' : 'always')}
        shadows={trailer?.canvas?.shadows ? 'soft' : undefined}
        camera={{ position: [0, 6.6, radius + 6.5], fov: 50 }}
        gl={{ antialias, powerPreference: 'high-performance', preserveDrawingBuffer: !!trailer?.canvas }}
        onPointerMissed={() => select(null)}
      >
        <color attach="background" args={['#0b0d19']} />
        <Exposure value={trailer?.canvas?.exposure ?? brightness} />
        {/* Moon */}
        <mesh position={[-24, 34, -60]}>
          <sphereGeometry args={[3, 16, 12]} />
          <meshBasicMaterial color="#eef0ff" fog={false} />
        </mesh>

        {/* Town square, campfire, lights, props and the seats. */}
        <Suspense fallback={null}>
          <Town circleRadius={radius} poster={poster} seats={seatList} />
        </Suspense>

        <Suspense fallback={null}>
          {players.map((p) => {
            const s = seats.get(p.id);
            if (!s) return null;
            const isMe = p.id === me?.id;
            const r = reactions?.byPlayer[p.id];
            return (
              <Scarecrow
                key={p.id}
                objectName={`scarecrow:${p.id}`}
                name={isMe && !trailer ? 'You' : p.name}
                item={isMe ? me!.item : p.item}
                cosmetics={p.cosmetics}
                colorHex={trailer ? (trailer.colors[p.id] ?? null) : isMe && !streamer ? colorInfo(me!.color).hex : null}
                glowHex={trailer ? (trailer.glowId === p.id ? (trailer.colors[p.id] ?? null) : null) : isMe && !streamer && view?.phase !== 'lobby' ? colorInfo(me!.color).hex : null}
                label={trailer ? trailer.labels : true}
                position={s.position}
                rotationY={s.rotationY}
                pose={s.pose}
                seed={s.seed}
                selected={selectedId === p.id}
                faded={!p.connected || p.away}
                searched={eyes.has(p.id)}
                onSelect={canSelect && !isMe ? () => select(p.id) : undefined}
                reaction={r ? ({ key: reactions!.key, clip: r } satisfies ReactionCue) : null}
                look={looks.get(p.id) ?? null}
              />
            );
          })}
        </Suspense>

        <PerfProbe />
        {trailer ? null : smooth ? <FrameCap fps={30} /> : <SagWatch />}
        <ScreenProbe seats={seats} me={me?.id} eyes={eyes} />
        {trailer ? (
          trailer.rig
        ) : (
          <>
        <CameraRig radius={radius} ringR={ringR} onMoved={setMoved} onHome={setHomeDistance} />
        <OrbitControls
          makeDefault
          enablePan={false}
          enableDamping
          target={TARGET}
          minDistance={5}
          // Stays inside the ring of buildings (ringRadius), so nothing ever blocks the fire.
          // Never closer to the buildings than the framing needs; the framing stays inside the ring.
          maxDistance={Math.max(radius + 16, homeDistance + 1)}
          minPolarAngle={0.35}
          // Never level with the ground, never below it.
          maxPolarAngle={1.36}
          rotateSpeed={0.7}
        />
          </>
        )}
      </Canvas>
      {moved && !trailer && (
        <button type="button" className="btn small view-reset" onClick={() => window.dispatchEvent(new Event(RESET_EVENT))} aria-label="Reset the camera view">
          Reset view
        </button>
      )}
    </>
  );
}

/** Smooth quality: renders at a steady, lower frame rate (the canvas is in 'demand' mode). */
function FrameCap({ fps }: { fps: number }) {
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    const step = 1000 / fps;
    let last = 0;
    let raf = 0;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      // A little slack, so a 60 Hz screen lands on every other frame instead of drifting.
      if (now - last < step - 4) return;
      last = now;
      invalidate();
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [fps, invalidate]);
  return null;
}

/**
 * Auto quality: if the frame rate stays low for a few seconds of play, switch to smooth.
 * Skips the first seconds (models and textures still loading) and any window with a long
 * pause (tab in the background, phone locked).
 */
function SagWatch() {
  const w = useRef({ start: 0, frames: 0, longest: 0, last: 0, bad: 0, warm: 0 });
  useFrame(() => {
    const s = w.current;
    const now = performance.now();
    if (!s.start) {
      s.start = s.last = now;
      s.warm = now + 6000;
      return;
    }
    s.longest = Math.max(s.longest, now - s.last);
    s.last = now;
    s.frames++;
    if (now - s.start < 2000) return;
    const fps = (s.frames * 1000) / (now - s.start);
    if (now > s.warm && s.longest < 1000) s.bad = fps < 38 ? s.bad + 1 : 0;
    s.start = now;
    s.frames = 0;
    s.longest = 0;
    if (s.bad >= 3) reportSag();
  });
  return null;
}

/** Brightness setting: tone-mapping exposure, so every light (fire, moon, lamps) scales together. */
function Exposure({ value }: { value: number }) {
  const gl = useThree((s) => s.gl);
  useEffect(() => {
    gl.toneMappingExposure = value;
  }, [gl, value]);
  return null;
}

/**
 * Frames the circle for the screen shape. On portrait phones the camera pulls back and the
 * image shifts down a little, so the billboards across the square clear the top bar while the
 * circle still sits above the bottom panel (just a Hints button and the tabs). On desktop the camera
 * finds the framing that fits every seat into the area between the panels, and the picture
 * is centred there. The player can orbit all the way round; "Reset view" glides back here.
 */
function CameraRig({
  radius,
  ringR,
  onMoved,
  onHome,
}: {
  radius: number;
  ringR: number;
  onMoved: (moved: boolean) => void;
  onHome: (distance: number) => void;
}) {
  const camera = useThree((s) => s.camera) as PerspectiveCamera;
  const scene = useThree((s) => s.scene);
  const size = useThree((s) => s.size);
  const controls = useThree((s) => s.controls) as { update?: () => void; maxDistance?: number } | null;
  const portrait = size.width < size.height;
  const desktop = !portrait && size.width >= DESKTOP_MIN;
  const insets = useInsets(desktop, size.width, size.height);

  const frame = useMemo(() => {
    if (desktop && insets) {
      return fitCircle({
        radius,
        labelTop: SEATED_HEIGHT + 0.7,
        target: TARGET,
        width: size.width,
        height: size.height,
        fov: camera.fov,
        insets,
        // Stay well inside the ring of buildings.
        maxHorizontal: ringR - 3,
        minElevation: 0.36,
      });
    }
    const pull = portrait ? Math.min(1.9, 0.75 / (size.width / size.height)) : 1;
    // High enough to look over your own seated scarecrow at the fire.
    return {
      position: new Vector3(0, 6.6 * pull, (radius + 6.5) * pull),
      offsetX: 0,
      offsetY: portrait ? -size.height * 0.03 : 0,
    };
  }, [desktop, insets, portrait, size.width, size.height, radius, ringR, camera]);
  const home = frame.position;
  const glide = useRef<{ from: Vector3; t: number } | null>(null);
  const wasMoved = useRef(false);
  const prevHome = useRef<Vector3 | null>(null);

  useEffect(() => {
    onHome(home.distanceTo(TARGET));
    // Re-frame when the layout changes, unless the player has moved the camera away from the
    // old framing themselves. (Compared with the old framing, not the moved flag: a frame can
    // run between the new layout and this effect and would count as a move.)
    const follow = !prevHome.current || camera.position.distanceTo(prevHome.current) < 0.6;
    prevHome.current = home.clone();
    // Let the controls reach the new framing before placing the camera there (the prop catches up a render later).
    if (controls && controls.maxDistance !== undefined) controls.maxDistance = Math.max(controls.maxDistance, home.distanceTo(TARGET) + 1);
    if (follow) {
      if (wasMoved.current) {
        wasMoved.current = false;
        onMoved(false);
      }
      camera.position.copy(home);
      camera.lookAt(TARGET);
      controls?.update?.();
    }
    // Fog follows the camera distance, so the far side of the circle stays a half-visible
    // silhouette even when the camera pulls back.
    const toCentre = home.length();
    // It ends just past the ring of buildings: the town square is visible, the desert beyond is not.
    scene.fog = new Fog(FOG_COLOR, toCentre * 0.75, toCentre + ringR + 16);
  }, [camera, controls, scene, home, ringR, onHome, onMoved]);

  useEffect(() => {
    const reset = () => (glide.current = { from: camera.position.clone(), t: 0 });
    window.addEventListener(RESET_EVENT, reset);
    return () => window.removeEventListener(RESET_EVENT, reset);
  }, [camera]);

  useFrame((_, dt) => {
    const g = glide.current;
    if (g) {
      // Glide around the circle (not through it): interpolate angle, height and distance.
      g.t = Math.min(1, g.t + dt / 0.7);
      const k = g.t * g.t * (3 - 2 * g.t);
      const a0 = Math.atan2(g.from.x, g.from.z);
      const a1 = Math.atan2(home.x, home.z);
      let da = a1 - a0;
      if (da > Math.PI) da -= Math.PI * 2;
      if (da < -Math.PI) da += Math.PI * 2;
      const r0 = Math.hypot(g.from.x, g.from.z);
      const r1 = Math.hypot(home.x, home.z);
      const a = a0 + da * k;
      const r = r0 + (r1 - r0) * k;
      camera.position.set(Math.sin(a) * r, g.from.y + (home.y - g.from.y) * k, Math.cos(a) * r);
      camera.lookAt(TARGET);
      controls?.update?.();
      if (g.t >= 1) glide.current = null;
    }
    const moved = camera.position.distanceTo(home) > 0.6;
    if (moved !== wasMoved.current) {
      wasMoved.current = moved;
      onMoved(moved);
    }
  });

  useEffect(() => {
    const { width: w, height: h } = size;
    if (frame.offsetX || frame.offsetY) camera.setViewOffset(w, h, frame.offsetX, frame.offsetY, w, h);
    else camera.clearViewOffset();
    camera.updateProjectionMatrix();
  }, [camera, size, frame]);

  return null;
}

/** Desktop only: what the panels cover, re-measured as they open, close and resize. */
function useInsets(enabled: boolean, w: number, h: number): Insets | null {
  const [insets, setInsets] = useState<Insets | null>(null);
  useEffect(() => {
    if (!enabled) return setInsets(null);
    const read = () =>
      setInsets((prev) => {
        const next = measureInsets(w, h);
        return prev && prev.left === next.left && prev.right === next.right && prev.top === next.top && prev.bottom === next.bottom ? prev : next;
      });
    read();
    // Panels mount and fold without resizing the window, so check a few times a second.
    const id = setInterval(read, 400);
    return () => clearInterval(id);
  }, [enabled, w, h]);
  return insets;
}

declare global {
  interface Window {
    /** Where a player's scarecrow is on screen (CSS px; 'me' for your own): for scripted screenshots (pnpm howto:screens). */
    __wtcScreen?: (id: string) => { x: number; y: number; r: number } | null;
    /** Screen box around the whole circle of seats. */
    __wtcCircle?: () => { x: number; y: number; w: number; h: number } | null;
    /** Name plates showing an eye badge (searched this poster), on screen. */
    __wtcEyes?: () => { id: string; x: number; y: number; }[];
    /** Everyone else's player id, in seat order. */
    __wtcOthers?: () => string[];
  }
}

/** Exposes on-screen positions of the seats (public information) for the screenshot script. */
function ScreenProbe({ seats, me, eyes }: { seats: Map<string, SeatInfo>; me?: string; eyes: Set<string> }) {
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  useEffect(() => {
    const project = (p: [number, number, number]) => {
      const v = new Vector3(...p).project(camera);
      return { x: ((v.x + 1) / 2) * size.width, y: ((1 - v.y) / 2) * size.height };
    };
    window.__wtcScreen = (id) => {
      const s = seats.get(id === 'me' && me ? me : id);
      if (!s) return null;
      const top = project([s.position[0], SEATED_HEIGHT, s.position[2]]);
      const feet = project([s.position[0], 0, s.position[2]]);
      return { x: (top.x + feet.x) / 2, y: (top.y + feet.y) / 2, r: Math.abs(feet.y - top.y) * 0.7 };
    };
    window.__wtcEyes = () =>
      [...seats.entries()]
        .filter(([id]) => eyes.has(id))
        .map(([id, s]) => ({ id, ...project([s.position[0], SEATED_HEIGHT + 0.35, s.position[2]]) }));
    window.__wtcOthers = () => [...seats.keys()].filter((id) => id !== me);
    window.__wtcCircle = () => {
      const pts = [...seats.values()].flatMap((s) => [project([s.position[0], 0, s.position[2]]), project([s.position[0], SEATED_HEIGHT, s.position[2]])]);
      if (!pts.length) return null;
      const xs = pts.map((p) => p.x);
      const ys = pts.map((p) => p.y);
      return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
    };
    return () => {
      delete window.__wtcScreen;
      delete window.__wtcCircle;
      delete window.__wtcEyes;
      delete window.__wtcOthers;
    };
  }, [camera, size, seats, me, eyes]);
  return null;
}
