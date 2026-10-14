'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { COSMETICS, ITEM_TYPES, NO_COSMETIC, PALETTE, type Cosmetics, type ItemType } from '@wtc/shared';
import { runClipCheck, runHatCheck } from './clipCheck';
import { SCALE, Scarecrow, type ReactionCue } from './Scarecrow';
import { SEAT_BELOW_HIPS, SIT_CLIPS, SIT_HIPS, useScarecrowModel, type ClipName, type SitPose } from './scarecrowModel';
import { Seats, type Seat, type SeatType } from './town/Town';
import { useScenery } from './town/useScenery';

// Dev-only lineups on the real Scarecrow component, seated on real seats.
//   ?lineup=garments   every item in every sitting pose, in your colour (default)
//   ?lineup=neutral    the same, as everyone else sees them (undyed burlap)
//   ?lineup=cosmetics  every hat and head detail, plus mixed looks
//   ?lineup=hats       one row per hat: three sitting poses, then despair-1, despair-2, victory
//                      (reactions start a second in; shoot ~2.5 s later)
//   ?react=victory|despair-1|despair-2   play a reaction after a second
//   ?view=front|side|back|three-quarter  ?row=N shows one row, close up
//   ?clipcheck=1       measure cloth sinking into seats (results on window.__clip)
const VIEWS = { front: 0, side: Math.PI / 2, back: Math.PI, 'three-quarter': Math.PI / 5 } as const;
const COLORS: Record<ItemType, string> = {
  poncho: PALETTE.find((c) => c.id === 'red')!.hex,
  cloak: PALETTE.find((c) => c.id === 'blue')!.hex,
  bandana: PALETTE.find((c) => c.id === 'yellow')!.hex,
};
const SEATS: SeatType[] = ['log', 'crate', 'barrel', 'stump'];

interface Entry {
  label: string;
  item: ItemType;
  pose: SitPose;
  colorHex: string | null;
  cosmetics: Cosmetics;
  /** Reaction this one plays (hats grid). */
  react?: ClipName;
}

function lineup(kind: string): Entry[][] {
  const none: Cosmetics = { hat: NO_COSMETIC, face: NO_COSMETIC };
  if (kind === 'hats') {
    return COSMETICS.filter((c) => c.slot === 'hat').map((h) => [
      ...SIT_CLIPS.map((pose) => ({ label: `${h.name} · ${pose.slice(4)}`, item: 'bandana' as ItemType, pose, colorHex: COLORS.bandana, cosmetics: { hat: h.id, face: NO_COSMETIC } })),
      ...(['despair-1', 'despair-2', 'victory'] as ClipName[]).map((react) => ({
        label: `${h.name} · ${react}`,
        item: 'bandana' as ItemType,
        pose: 'sit-relaxed' as SitPose,
        colorHex: COLORS.bandana,
        cosmetics: { hat: h.id, face: NO_COSMETIC },
        react,
      })),
    ]);
  }
  if (kind === 'cosmetics') {
    const hats = COSMETICS.filter((c) => c.slot === 'hat');
    const faces = COSMETICS.filter((c) => c.slot === 'face');
    const poses = SIT_CLIPS;
    return [
      hats.map((h, i) => ({ label: h.name, item: ITEM_TYPES[i % 3], pose: poses[i % 3], colorHex: null, cosmetics: { ...none, hat: h.id } })),
      faces.map((f, i) => ({ label: f.name, item: ITEM_TYPES[(i + 1) % 3], pose: 'sit-relaxed', colorHex: null, cosmetics: { ...none, face: f.id } })),
      [
        { label: 'straw hat + grin', item: 'poncho', pose: 'sit-relaxed', colorHex: null, cosmetics: { hat: 'straw-hat', face: 'stitched-grin' } },
        { label: 'cowboy + patch', item: 'bandana', pose: 'sit-leaning', colorHex: null, cosmetics: { hat: 'cowboy-hat', face: 'eye-patch' } },
        { label: 'top hat + button', item: 'cloak', pose: 'sit-hunched', colorHex: null, cosmetics: { hat: 'top-hat', face: 'button-eye' } },
        { label: 'bowler + scar', item: 'bandana', pose: 'sit-relaxed', colorHex: COLORS.bandana, cosmetics: { hat: 'bowler', face: 'stitched-scar' } },
      ],
    ];
  }
  const neutral = kind === 'neutral';
  return ITEM_TYPES.map((item) =>
    SIT_CLIPS.map((pose) => ({ label: `${item} · ${pose.slice(4)}`, item, pose, colorHex: neutral ? null : COLORS[item], cosmetics: none })),
  );
}

function ClipCheck() {
  const model = useScarecrowModel();
  useEffect(() => {
    const t = setTimeout(() => {
      const w = window as unknown as { __clip: unknown; __hats: unknown };
      w.__hats = runHatCheck(model);
      w.__clip = runClipCheck(model);
    }, 50);
    return () => clearTimeout(t);
  }, [model]);
  return null;
}

function Lineup({ rows, rot, cue, started }: { rows: Entry[][]; rot: number; cue: ReactionCue | null; started: boolean }) {
  const scenery = useScenery();
  const placed = useMemo(
    () =>
      rows.flatMap((row, r) =>
        row.map((e, c) => ({ e, x: (c - (row.length - 1) / 2) * 2.4, z: -r * 3.2, seat: SEATS[(r + c) % SEATS.length] })),
      ),
    [rows],
  );
  const seats: Seat[] = placed.map(({ e, x, z, seat }) => {
    const hips = SIT_HIPS[e.pose];
    // Seat under the hips, which sit a little behind the feet (rotated with the scarecrow).
    const back = hips.z * SCALE;
    return { type: seat, position: [x + Math.sin(rot) * back, 0, z + Math.cos(rot) * back], rotationY: rot, height: (hips.y - SEAT_BELOW_HIPS) * SCALE };
  });
  return (
    <>
      <Seats scenery={scenery} seats={seats} />
      {placed.map(({ e, x, z }, i) => (
        <Scarecrow
          key={`${e.label}-${i}`}
          name={e.label}
          item={e.item}
          cosmetics={e.cosmetics}
          colorHex={e.colorHex}
          position={[x, 0, z]}
          rotationY={rot}
          selected={false}
          faded={false}
          searched={false}
          pose={e.pose}
          seed={(i * 0.37) % 1}
          reaction={e.react ? (started ? { key: 'grid', clip: e.react } : null) : cue}
        />
      ))}
    </>
  );
}

export default function ScarecrowPreview() {
  const q = new URLSearchParams(location.search);
  const rot = VIEWS[(q.get('view') ?? 'front') as keyof typeof VIEWS] ?? 0;
  const kind = q.get('lineup') ?? 'garments';
  const react = q.get('react') as ClipName | null;
  const row = q.get('row');
  const rows = useMemo(() => (row === null ? lineup(kind) : [lineup(kind)[Number(row)]]), [kind, row]);
  const [cue, setCue] = useState<ReactionCue | null>(null);
  const [started, setStarted] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => {
      setStarted(true);
      if (react) setCue({ key: 'preview', clip: react });
    }, 1000);
    return () => clearTimeout(t);
  }, [react]);
  const depth = (rows.length - 1) * 3.2;
  const width = Math.max(...rows.map((r) => r.length)) * 2.4;
  const dist = row !== null ? width * (rows[0].length > 3 ? 0.85 : 0.62) : Math.max(width * 0.7, depth + 5);
  return (
    <div style={{ position: 'fixed', inset: 0, background: '#1a1d24' }}>
      <Canvas
        camera={{ position: [0, 2.2 + depth * 0.45, dist], fov: 40 }}
        onCreated={({ camera }) => camera.lookAt(0, 0.9, -depth / 2)}
      >
        <color attach="background" args={['#262a33']} />
        <hemisphereLight args={['#ffffff', '#3a3020', 1.3]} />
        <directionalLight position={[3, 6, 6]} intensity={1.7} />
        <mesh rotation-x={-Math.PI / 2} position-y={-0.01}>
          <planeGeometry args={[60, 60]} />
          <meshStandardMaterial color="#4a4036" />
        </mesh>
        <Suspense fallback={null}>
          <Lineup rows={rows} rot={rot} cue={cue} started={started} />
          {q.get('clipcheck') && <ClipCheck />}
        </Suspense>
      </Canvas>
    </div>
  );
}
