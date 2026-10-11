'use client';

import { useEffect, useMemo, useRef } from 'react';
import { AdditiveBlending, CanvasTexture, DoubleSide, RepeatWrapping, SRGBColorSpace, type Group, type Object3D } from 'three';
import { useTexture } from '@react-three/drei';
import type { ColorId } from '@wtc/shared';
import { useCanvasFonts } from '@/lib/canvasFonts';
import { AD_SLOTS, badAdSlots } from '@/config/adSlots';
import anchors from '../sceneryAnchors.json';
import { AdBoard } from './AdBoard';
import { Campfire } from './Campfire';
import { WARM, glowTexture } from './glow';
import { BUILDING_SCALE, SIGN_SPOTS, along, facing, placeLots, polar, ringRadius, type PlacedLot } from './layout';
import { EmptyPosterSpot, PosterPanel } from './PosterPanel';
import { PropInstances, type Placement } from './PropInstances';
import { useScenery, type Scenery } from './useScenery';

// The town square at night: a campfire in the middle (the main light), the scarecrows seated
// around it, and a closed ring of buildings so the camera can go all the way round.
// Fog hides everything past the ring.

export { BUILDING_SCALE, ringRadius };

if (process.env.NODE_ENV !== 'production' && badAdSlots().length) console.warn('Ad slots with the wrong aspect ratio:', badAdSlots());

/** Lantern posts between the circle and the buildings. Two carry real lights, two are faked. */
const LANTERN_POST_ANGLES = [45, 135, 225, 315];
const REAL_LANTERNS = [135, 225];
const POST_HEIGHT = 2.8;
const ARM = 0.7;
const postAt = (a: number, circleR: number) => polar(a, circleR + 3.6);
/** The arm points toward the centre; the lantern hangs at its tip. */
const lampAt = (a: number, circleR: number, y: number): [number, number, number] => polar(a, circleR + 3.6 - ARM, y);

const jitter = (i: number) => ((i * 9301 + 49297) % 233280) / 233280; // stable pseudo-random

function useLayout(R: number, circleR: number, alleys: number[], lots: PlacedLot[]) {
  return useMemo(() => {
    const at = (a: number, r: number, extra: Partial<Placement> = {}): Placement => ({ position: polar(a, r), ...extra });
    const lot = (id: string) => lots.find((l) => l.id === id)!.angle;
    // Props in front of a lot: `offset` is degrees along the ring from the lot's centre.
    const front = (id: string, offset: number, inset: number, extra: Partial<Placement> = {}) => at(lot(id) + offset, R - inset, extra);
    return {
      barrel: [front('saloon', -9, 1.6, { rotationY: 1 }), front('store', 6, 1.5), front('hotel', -7, 1.4, { rotationY: 2 }), front('assay', 6, 1.5), front('barber', -6, 1.4)].map((p) => ({ ...p, scale: 0.72 })),
      barrelWater: [front('church', -10, 1.8), front('barn', 12, 2)].map((p) => ({ ...p, scale: 0.72 })),
      barrelHay: [front('livery', -12, 2.2), front('livery', -9, 1.6, { rotationY: 1.3 }), front('barn', -12, 2)].map((p) => ({ ...p, scale: 0.72 })),
      crate: [
        front('store', -6, 1.4, { rotationY: 0.4 }),
        front('dancehall', 10, 1.8, { rotationY: -0.3 }),
        { position: polar(lot('dancehall') + 10, R - 1.8, 0.88), rotationY: 0.5 },
        front('bank', 6, 1.5, { rotationY: 0.9 }),
        front('opera', -10, 1.6, { rotationY: 0.2 }),
      ].map((p) => ({ ...p, scale: 0.8 })),
      // A fence across the back of every alley, so the ring has no holes.
      fence: alleys.map((a) => ({ position: polar(a, R - 0.2), rotationY: along(a) + Math.PI / 2, scale: [1.5, 1.2, 1.2] as [number, number, number] })),
      wagon: [{ position: polar(alleys[5] - 1, R + 5), rotationY: along(alleys[5]) + 0.25 }],
      cart: [{ position: polar(lot('opera') + 14, R - 3.2), rotationY: along(lot('opera')) - 0.3, scale: 0.9 }],
      waterTower: [{ position: polar(alleys[10], R + 8), rotationY: 0.4, scale: 1.25 }],
      cactus1: [95, 160, 236, 300, 20].map((a, i) => ({ position: polar(a, R + 9 + jitter(i) * 5), rotationY: jitter(i + 3) * 6, scale: 1.2 })),
      cactus2: [140, 205, 262, 340].map((a, i) => ({ position: polar(a, R + 9 + jitter(i + 7) * 4), rotationY: jitter(i + 9) * 6, scale: 1.2 })),
      deadTree: [{ position: polar(alleys[2], R + 3), rotationY: 1 }, { position: polar(alleys[8], R + 2.5), rotationY: 2.4 }],
      tumbleweed: [{ position: polar(232, R - 6), rotationY: 0.7, scale: 0.45 }],
      bench: [front('saloon', 0, 1.0, { rotationY: facing(lot('saloon')), scale: 0.6 }), front('hotel', 0, 1.0, { rotationY: facing(lot('hotel')), scale: 0.6 })],
      wheel: [{ position: polar(lot('barn') - 9, R - 1.2, 0), rotationY: facing(lot('barn')) + 0.3, scale: 0.75 }],
      // Oil lanterns hanging from the lantern posts (see LanternPost); scaled down from the pack's large model.
      streetLamp: LANTERN_POST_ANGLES.map((a) => ({ position: lampAt(a, circleR, 1.92), rotationY: facing(a), scale: 0.26 })),
    } satisfies Record<string, Placement[]>;
  }, [R, circleR, alleys, lots]);
}

/** Wooden post with a crossarm; the oil lantern itself is an instanced prop. */
function LanternPost({ angle, circleR }: { angle: number; circleR: number }) {
  return (
    <group position={postAt(angle, circleR)} rotation-y={facing(angle)}>
      <mesh position-y={POST_HEIGHT / 2}>
        <boxGeometry args={[0.13, POST_HEIGHT, 0.13]} />
        <meshStandardMaterial color="#3a2616" roughness={1} />
      </mesh>
      <mesh position={[0, POST_HEIGHT - 0.12, ARM / 2]}>
        <boxGeometry args={[0.09, 0.09, ARM + 0.1]} />
        <meshStandardMaterial color="#3a2616" roughness={1} />
      </mesh>
      <mesh position={[0, POST_HEIGHT - 0.42, ARM - 0.05]}>
        <cylinderGeometry args={[0.008, 0.008, 0.5, 4]} />
        <meshStandardMaterial color="#1a120b" />
      </mesh>
    </group>
  );
}

/** A fake light: a halo sprite at the lamp, a pool of light on the ground, nothing real. */
function FakeLight({ position, ground = true, size = 1.6 }: { position: [number, number, number]; ground?: boolean; size?: number }) {
  const tex = glowTexture();
  return (
    <group position={position}>
      <sprite scale={[size, size, 1]}>
        <spriteMaterial map={tex} color={WARM} blending={AdditiveBlending} transparent depthWrite={false} opacity={0.9} />
      </sprite>
      {ground && (
        <mesh position-y={-position[1] + 0.03} rotation-x={-Math.PI / 2}>
          <planeGeometry args={[size * 3.2, size * 3.2]} />
          <meshBasicMaterial map={tex} color={WARM} blending={AdditiveBlending} transparent depthWrite={false} opacity={0.32} />
        </mesh>
      )}
    </group>
  );
}

/** Painted name board over a door (plain storefronts become the general store, hotel, bank…). */
function SignBoard({ text, position, width }: { text: string; position: [number, number, number]; width: number }) {
  const fonts = useCanvasFonts();
  const texture = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 112;
    const g = c.getContext('2d')!;
    g.fillStyle = '#2a1a0f';
    g.fillRect(0, 0, c.width, c.height);
    g.strokeStyle = '#6b4a2a';
    g.lineWidth = 8;
    g.strokeRect(4, 4, c.width - 8, c.height - 8);
    g.fillStyle = '#e8d6aa';
    g.font = `${text.length > 10 ? 50 : 58}px ${fonts.display}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, c.width / 2, c.height / 2 + 4, c.width - 40);
    const t = new CanvasTexture(c);
    t.colorSpace = SRGBColorSpace;
    return t;
  }, [text, fonts.ready, fonts.display]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => texture.dispose(), [texture]);
  return (
    <mesh position={position}>
      <planeGeometry args={[width, (width * 112) / 512]} />
      {/* Self-lit enough to read across the square at night. */}
      <meshStandardMaterial map={texture} roughness={1} emissive="#ffffff" emissiveMap={texture} emissiveIntensity={0.55} />
    </mesh>
  );
}

function Building({ scenery, model, angle, R, children }: { scenery: Scenery; model: string; angle: number; R: number; children?: React.ReactNode }) {
  const object = useMemo(() => scenery.building(model), [scenery, model]);
  return (
    <group position={polar(angle, R)} rotation-y={facing(angle)}>
      <group scale={BUILDING_SCALE}>
        <primitive object={object} />
        {children}
      </group>
    </group>
  );
}

export type SeatType = 'log' | 'crate' | 'barrel' | 'stump';
export interface Seat {
  type: SeatType;
  position: [number, number, number];
  rotationY: number;
  /** Height of the seat top, world units. */
  height: number;
}

/** Prop sizes (from the scenery file) and the footprint each seat should have, metres. */
const SEAT_FIT: Record<SeatType, { prop: string; size: [number, number, number]; footprint: [number, number] }> = {
  crate: { prop: 'crate', size: [1.09, 1.11, 1.09], footprint: [0.68, 0.68] },
  barrel: { prop: 'barrel', size: [1.26, 1.42, 1.23], footprint: [0.64, 0.62] },
  stump: { prop: 'stump', size: [0.96, 0.68, 1.03], footprint: [0.7, 0.74] },
  log: { prop: 'log', size: [1.79, 0.42, 0.47], footprint: [1.5, 0.66] },
};

/** Seats under the scarecrows, instanced per type and stretched to each seat's height. */
function Seats({ scenery, seats }: { scenery: Scenery; seats: Seat[] }) {
  const byType = useMemo(() => {
    const out: Record<string, Placement[]> = {};
    for (const s of seats) {
      const fit = SEAT_FIT[s.type];
      (out[fit.prop] ??= []).push({
        position: s.position,
        rotationY: s.rotationY,
        scale: [fit.footprint[0] / fit.size[0], s.height / fit.size[1], fit.footprint[1] / fit.size[2]],
      });
    }
    return out;
  }, [seats]);
  return (
    <>
      {Object.entries(byType).map(([prop, placements]) => (
        <PropInstances key={prop} scenery={scenery} name={prop} placements={placements} />
      ))}
    </>
  );
}

export interface PosterState {
  color: ColorId | null;
  pot: number;
  number: number | null;
  of: number | null;
}

export function Town({ circleRadius, poster, seats }: { circleRadius: number; poster: PosterState; seats: Seat[] }) {
  const scenery = useScenery();
  const R = ringRadius(circleRadius);
  const { lots, alleys } = useMemo(() => placeLots(R), [R]);
  const layout = useLayout(R, circleRadius, alleys, lots);
  const ground = useTexture('/textures/ground.webp');
  useMemo(() => {
    ground.wrapS = ground.wrapT = RepeatWrapping;
    ground.repeat.set(30, 30);
    ground.colorSpace = SRGBColorSpace;
  }, [ground]);

  // Nothing in town moves except the fire, so stop three.js recomputing ~1,000 matrices a
  // frame: compute each once, then freeze. Runs after every render, so anything moved or
  // added (seats when players join, lantern posts when the circle grows) is picked up.
  const root = useRef<Group>(null);
  useEffect(() => {
    const freeze = (o: Object3D) => {
      if (o.name === 'campfire') return;
      o.matrixAutoUpdate = true;
      o.updateMatrix();
      o.matrixAutoUpdate = false;
      o.children.forEach(freeze);
    };
    root.current?.children.forEach(freeze);
    root.current?.updateMatrixWorld(true);
  });

  const spots = anchors.posterSpots;
  // Glow sits at the lantern glass, a little above where the instanced lantern model stands.
  const lampPositions = LANTERN_POST_ANGLES.map((a) => lampAt(a, circleRadius, 2.18));

  return (
    <group name="town" ref={root}>
      {/* Bluish moonlight from above, and a sky/ground fill so the far side never goes black. */}
      <directionalLight position={[-12, 30, 18]} intensity={2.3} color="#9fb6ff" />
      <hemisphereLight args={['#6f84c4', '#2a1f14', 1.25]} />
      <ambientLight intensity={0.3} color="#b8c4ff" />

      {/* The fire is the main light. Two lanterns are real lights; the rest are faked. */}
      <Campfire />
      {LANTERN_POST_ANGLES.map((a, i) =>
        REAL_LANTERNS.includes(a) ? <pointLight key={a} position={lampPositions[i]} color={WARM} intensity={16} distance={16} decay={1.5} /> : null,
      )}
      {LANTERN_POST_ANGLES.map((a) => (
        <LanternPost key={a} angle={a} circleR={circleRadius} />
      ))}
      {lampPositions.map((p, i) => (
        <FakeLight key={i} position={p} size={1.7} />
      ))}

      <mesh rotation-x={-Math.PI / 2} position-y={-0.01}>
        <circleGeometry args={[R + 30, 48]} />
        <meshStandardMaterial map={ground} color="#7a6d5e" roughness={1} />
      </mesh>

      {lots.map((lot) => {
        const info = anchors.buildings[lot.model];
        const w = info.width;
        const ads = AD_SLOTS.filter((s) => s.lot === lot.id);
        const sign = lot.sign ? SIGN_SPOTS[lot.model] : undefined;
        // A painted wall ad takes the upper wall, so the name board moves up under the roofline.
        const signPos: [number, number, number] | undefined =
          sign && (ads.some((s) => s.kind === 'wall') ? [sign.position[0], 4.2, sign.position[2]] : sign.position);
        return (
          <group key={lot.id} name={`lot:${lot.id}`}>
            <Building scenery={scenery} model={lot.model} angle={lot.angle} R={R}>
              {/* Porch lanterns: emissive glass + halo + warm spill lighting the facade (no real light). */}
              {[-w * 0.3, w * 0.3].map((x) => (
                <group key={x}>
                  <mesh position={[x, 2.05, -0.35]}>
                    <boxGeometry args={[0.16, 0.22, 0.16]} />
                    <meshStandardMaterial color="#ffc27a" emissive="#ff9a3c" emissiveIntensity={3} />
                  </mesh>
                  <FakeLight position={[x, 2.05, -0.3]} size={1.3} ground={false} />
                  <mesh position={[x, 2.2, -1.38]}>
                    <planeGeometry args={[3.6, 3.6]} />
                    <meshBasicMaterial map={glowTexture()} color={WARM} blending={AdditiveBlending} transparent depthWrite={false} opacity={0.75} side={DoubleSide} />
                  </mesh>
                </group>
              ))}
              {/* Moonlit wash over the upper storey, so name boards and the roofline read at night. */}
              <mesh position={[0, info.height * 0.72, -1.36]}>
                <planeGeometry args={[w * 1.1, info.height * 0.7]} />
                <meshBasicMaterial map={glowTexture()} color="#8fa6e8" blending={AdditiveBlending} transparent depthWrite={false} opacity={0.32} side={DoubleSide} />
              </mesh>
              {lot.sign && signPos && <SignBoard text={lot.sign} position={signPos} width={sign!.width} />}
              {spots
                .filter((s) => s.building === lot.id)
                .map((s) =>
                  s.active ? (
                    <group key={s.id}>
                      <PosterPanel {...poster} position={s.position as [number, number, number]} />
                      <FakeLight position={[s.position[0], s.position[1] + 0.9, s.position[2] + 0.25]} size={1.4} ground={false} />
                    </group>
                  ) : (
                    <EmptyPosterSpot key={s.id} position={s.position as [number, number, number]} />
                  ),
                )}
            </Building>
            {ads.length > 0 && (
              // Ads are sized in metres, so they sit in the lot's unscaled frame.
              <group position={polar(lot.angle, R)} rotation-y={facing(lot.angle)}>
                {ads.map((s) => (
                  <AdBoard key={s.id} slot={s} />
                ))}
              </group>
            )}
          </group>
        );
      })}
      <Building scenery={scenery} model="well" angle={alleys[9] + 2} R={R - 5} />

      {Object.entries(layout).map(([name, placements]) => (
        <PropInstances key={name} scenery={scenery} name={name} placements={placements} />
      ))}
      <Seats scenery={scenery} seats={seats} />
    </group>
  );
}
