'use client';

import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Vector3 } from 'three';
import { PALETTE, type Cosmetics, type ItemType } from '@wtc/shared';
import { useBrightness } from '@/lib/brightness';
import { PerfProbe } from '../scene/PerfProbe';
import { SCALE, Scarecrow, type ReactionCue } from '../scene/Scarecrow';
import { SEAT_BELOW_HIPS, SIT_HIPS, type ClipName, type SitPose } from '../scene/scarecrowModel';
import { Campfire } from '../scene/town/Campfire';
import { Ground } from '../scene/town/Ground';
import { PropInstances } from '../scene/town/PropInstances';
import { Seats, type Seat, type SeatType } from '../scene/town/Town';
import { useScenery } from '../scene/town/useScenery';

// The main menu's backdrop: a few scarecrows at the campfire, embers rising, the camera slowly
// circling. Same models and fire as the game, without the town (kept light for phones).

interface Sitter {
  item: ItemType;
  cosmetics: Cosmetics;
  pose: SitPose;
  seat: SeatType;
  /** Only one shows a color: as in the game, everyone else's is plain burlap. */
  color?: string;
}

const SITTERS: Sitter[] = [
  { item: 'poncho', cosmetics: { hat: 'cowboy-hat', face: 'none' }, pose: 'sit-relaxed', seat: 'log', color: PALETTE.find((c) => c.id === 'red')!.hex },
  { item: 'cloak', cosmetics: { hat: 'top-hat', face: 'button-eye' }, pose: 'sit-leaning', seat: 'barrel' },
  { item: 'bandana', cosmetics: { hat: 'straw-hat', face: 'stitched-grin' }, pose: 'sit-hunched', seat: 'crate' },
  { item: 'poncho', cosmetics: { hat: 'bowler', face: 'eye-patch' }, pose: 'sit-talking', seat: 'stump' },
  { item: 'cloak', cosmetics: { hat: 'none', face: 'stitched-scar' }, pose: 'sit-leaning', seat: 'log' },
];
const RADIUS = 2.9;
const REACTIONS: ClipName[] = ['victory', 'despair-1', 'despair-2'];

function Circle() {
  const scenery = useScenery();

  const placed = useMemo(
    () =>
      SITTERS.map((s, i) => {
        const a = (i / SITTERS.length) * Math.PI * 2 + 0.3;
        const position: [number, number, number] = [Math.sin(a) * RADIUS, 0, Math.cos(a) * RADIUS];
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
    [],
  );

  // Every so often someone reacts, so the circle feels alive.
  const [cue, setCue] = useState<{ who: number; cue: ReactionCue } | null>(null);
  useEffect(() => {
    let n = 0;
    const id = setInterval(() => {
      n++;
      setCue({ who: Math.floor(Math.random() * SITTERS.length), cue: { key: `home-${n}`, clip: REACTIONS[n % REACTIONS.length] } });
    }, 7000);
    return () => clearInterval(id);
  }, []);

  // A few silhouettes at the edge of the light.
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
      {placed.map(({ s, position, rotationY, seed }, i) => (
        <Scarecrow
          key={i}
          name=""
          label={false}
          item={s.item}
          cosmetics={s.cosmetics}
          colorHex={s.color ?? null}
          position={position}
          rotationY={rotationY}
          selected={false}
          faded={false}
          eyeCount={0}
          pose={s.pose}
          seed={seed}
          reaction={cue?.who === i ? cue.cue : null}
        />
      ))}
    </>
  );
}

/** Slow orbit around the fire. */
function Orbit({ portrait }: { portrait: boolean }) {
  const camera = useThree((s) => s.camera);
  const angle = useRef(0.6);
  // Phones: look below the fire so it sits in the top half, above the menu.
  const target = useMemo(() => new Vector3(0, portrait ? -1.4 : 1.0, 0), [portrait]);
  useFrame((_, dt) => {
    angle.current += Math.min(dt, 0.1) * 0.05;
    const r = portrait ? 9 : 9.2;
    camera.position.set(Math.sin(angle.current) * r, portrait ? 3.4 : 3.0, Math.cos(angle.current) * r);
    camera.lookAt(target);
  });
  return null;
}

function Exposure() {
  const gl = useThree((s) => s.gl);
  const value = useBrightness();
  useEffect(() => {
    gl.toneMappingExposure = value;
  }, [gl, value]);
  return null;
}

export default function HomeScene() {
  const [portrait] = useState(() => typeof window !== 'undefined' && window.innerWidth < window.innerHeight);
  return (
    <Canvas
      className="home-scene"
      // Phones: fewer pixels and no MSAA; the scene is small and soft anyway.
      dpr={portrait ? [1, 1.3] : [1, 1.75]}
      gl={{ antialias: !portrait, powerPreference: 'high-performance' }}
      camera={{ position: [0, 2.6, 7.6], fov: portrait ? 50 : 42 }}
    >
      <color attach="background" args={['#0b0d19']} />
      <fog attach="fog" args={['#0c0e1a', 7, 22]} />
      <Exposure />
      <hemisphereLight args={['#6f84c4', '#2a1f14', 0.9]} />
      <directionalLight position={[-12, 30, 18]} intensity={1.4} color="#9fb6ff" />
      <Campfire />
      <Suspense fallback={null}>
        <Circle />
      </Suspense>
      <Orbit portrait={portrait} />
      <PerfProbe />
    </Canvas>
  );
}
