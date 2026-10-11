'use client';

import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Fog, Vector3, type PerspectiveCamera } from 'three';
import { OrbitControls } from '@react-three/drei';
import { colorInfo, type GameView, type Phase, type PlayerView } from '@wtc/shared';
import { useBrightness } from '@/lib/brightness';
import { eyeCounts } from '@/lib/inspections';
import { useGame } from '@/lib/store';
import { PerfProbe } from './PerfProbe';
import { SCALE, SEATED_HEIGHT, Scarecrow, type LookCue, type ReactionCue } from './Scarecrow';
import { SEAT_BELOW_HIPS, SIT_CLIPS, SIT_HIPS, type SitPose } from './scarecrowModel';
import { Town, ringRadius, type PosterState, type Seat, type SeatType } from './town/Town';

// The game scene. Reads the client view only; swap models freely without touching game logic.

const SELECTABLE: Phase[] = ['investigation', 'vote'];
// Keep in sync with the desktop breakpoint and side panel width in globals.css.
const DESKTOP_MIN = 900;
const SIDE_PANEL_PX = 380;
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

export default function Scene() {
  const view = useGame((s) => s.view);
  const selectedId = useGame((s) => s.selectedId);
  const select = useGame((s) => s.select);
  const brightness = useBrightness();
  const [moved, setMoved] = useState(false);

  const players = view?.players ?? [];
  const me = view?.you;
  const n = Math.max(players.length, 1);
  const radius = Math.max(3.2, n * 0.42);
  const canSelect = !!view && SELECTABLE.includes(view.phase);
  // Eye badges: how often each player was inspected this poster (from the public log).
  const eyes = useMemo(() => (view?.game ? eyeCounts(view.game) : new Map<string, number>()), [view?.game]);
  const seats = useSeats(view, radius);
  const seatList = useMemo(() => [...seats.values()].map((s) => s.seat), [seats]);

  const ringR = ringRadius(radius);
  const game = view?.game;
  const poster: PosterState = useMemo(
    () =>
      game
        ? { color: game.posterColor, pot: game.pot, number: game.posterIndex + 1, of: game.posterCount }
        : { color: null, pot: view?.settings.rules.basePot ?? 100, number: null, of: null },
    [game?.posterColor, game?.pot, game?.posterIndex, game?.posterCount, view?.settings.rules.basePot], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // Head turns: log entries are ordered by time, so the last fresh one per target wins.
  const looks = useMemo(() => lookCues(game, view?.serverNow ?? 0, seats), [game?.log, game?.posterIndex, seats]); // eslint-disable-line react-hooks/exhaustive-deps
  // Reactions come decided and filtered by the server (the Wanted player's true one only reaches them).
  const reactions = game?.reactions && (view?.phase === 'payout' || view?.phase === 'ended') ? game.reactions : null;

  return (
    <>
      <Canvas
        className="scene"
        dpr={[1, 1.75]}
        camera={{ position: [0, 6.6, radius + 6.5], fov: 50 }}
        gl={{ antialias: true, powerPreference: 'high-performance' }}
        onPointerMissed={() => select(null)}
      >
        <color attach="background" args={['#0b0d19']} />
        <Exposure value={brightness} />
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
                name={isMe ? 'You' : p.name}
                item={isMe ? me!.item : p.item}
                colorHex={isMe ? colorInfo(me!.color).hex : null}
                position={s.position}
                rotationY={s.rotationY}
                pose={s.pose}
                seed={s.seed}
                selected={selectedId === p.id}
                faded={!p.connected || p.away}
                eyeCount={eyes.get(p.id) ?? 0}
                onSelect={canSelect && !isMe ? () => select(p.id) : undefined}
                reaction={r ? ({ key: reactions!.key, clip: r } satisfies ReactionCue) : null}
                look={looks.get(p.id) ?? null}
              />
            );
          })}
        </Suspense>

        <PerfProbe />
        <CameraRig radius={radius} ringR={ringR} sidePanel={view?.phase !== 'lobby' && view?.phase !== 'ended'} onMoved={setMoved} />
        <OrbitControls
          makeDefault
          enablePan={false}
          enableDamping
          target={TARGET}
          minDistance={5}
          // Stays inside the ring of buildings (ringRadius), so nothing ever blocks the fire.
          maxDistance={radius + 16}
          minPolarAngle={0.35}
          // Never level with the ground, never below it.
          maxPolarAngle={1.36}
          rotateSpeed={0.7}
        />
      </Canvas>
      {moved && (
        <button type="button" className="btn small view-reset" onClick={() => window.dispatchEvent(new Event(RESET_EVENT))} aria-label="Reset the camera view">
          Reset view
        </button>
      )}
    </>
  );
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
 * Frames the circle for the screen shape. On portrait phones the camera pulls back
 * and the image shifts up slightly, so the circle sits above the bottom panel. On desktop
 * the image shifts left to center in the space beside the side panel. The player can orbit
 * all the way round; "Reset view" glides back to this framing.
 */
function CameraRig({ radius, ringR, sidePanel, onMoved }: { radius: number; ringR: number; sidePanel: boolean; onMoved: (moved: boolean) => void }) {
  const camera = useThree((s) => s.camera);
  const scene = useThree((s) => s.scene);
  const size = useThree((s) => s.size);
  const controls = useThree((s) => s.controls) as { update?: () => void; target?: Vector3 } | null;
  const portrait = size.width < size.height;
  const home = useMemo(() => {
    const pull = portrait ? Math.min(1.9, 0.75 / (size.width / size.height)) : 1;
    // High enough to look over your own seated scarecrow at the fire.
    return new Vector3(0, 6.6 * pull, (radius + 6.5) * pull);
  }, [portrait, size.width, size.height, radius]);
  const glide = useRef<{ from: Vector3; t: number } | null>(null);
  const wasMoved = useRef(false);

  useEffect(() => {
    camera.position.copy(home);
    camera.lookAt(TARGET);
    controls?.update?.();
    // Fog follows the camera distance, so the far side of the circle stays a half-visible
    // silhouette even when a portrait phone pulls the camera back.
    const toCentre = home.length();
    // It ends just past the ring of buildings: the town square is visible, the desert beyond is not.
    scene.fog = new Fog(FOG_COLOR, toCentre * 0.75, toCentre + ringR + 16);
  }, [camera, controls, scene, home, ringR]);

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
    const cam = camera as PerspectiveCamera;
    const { width: w, height: h } = size;
    // Phones: nudge the picture up a little so the circle clears the action panel; the side
    // panel starts collapsed, so a small shift keeps the town and its poster below the top bar.
    if (portrait) cam.setViewOffset(w, h, 0, h * 0.06, w, h);
    else if (sidePanel && w >= DESKTOP_MIN) cam.setViewOffset(w, h, SIDE_PANEL_PX / 2, 0, w, h);
    else cam.clearViewOffset();
    cam.updateProjectionMatrix();
  }, [camera, size, portrait, sidePanel]);

  return null;
}
