'use client';

import { Suspense, useEffect, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { PALETTE } from '@wtc/shared';
import { SCALE, Scarecrow, type LookCue, type ReactionCue } from './Scarecrow';
import { SEAT_BELOW_HIPS, SIT_HIPS, type ClipName } from './scarecrowModel';

// Dev-only: the three sitting poses and each item on the real Scarecrow component, plus an
// everyone-else item, from a fixed camera. ?view=side|back turns them, ?react=victory|despair-1|despair-2
// plays a reaction after a second, ?look=1 turns heads toward the camera's left.
const ANGLES = { front: 0, side: Math.PI / 2, back: Math.PI } as const;

export default function ScarecrowPreview() {
  const q = new URLSearchParams(location.search);
  const rot = ANGLES[(q.get('view') ?? 'front') as keyof typeof ANGLES] ?? 0;
  const react = q.get('react') as ClipName | null;
  const [cue, setCue] = useState<ReactionCue | null>(null);
  const [look, setLook] = useState<LookCue | null>(null);
  useEffect(() => {
    const t = setTimeout(() => {
      if (react) setCue({ key: 'preview', clip: react });
      if (q.get('look')) setLook({ key: 'preview', target: [-8, 1.5, 4] });
    }, 1000);
    return () => clearTimeout(t);
  }, [react]); // eslint-disable-line react-hooks/exhaustive-deps

  const lineup = [
    { name: 'relaxed · poncho', item: 'poncho', color: PALETTE.find((c) => c.id === 'red')!.hex, pose: 'sit-relaxed' },
    { name: 'hunched · cloak', item: 'cloak', color: PALETTE.find((c) => c.id === 'blue')!.hex, pose: 'sit-hunched' },
    { name: 'leaning · bandana', item: 'bandana', color: PALETTE.find((c) => c.id === 'yellow')!.hex, pose: 'sit-leaning' },
    { name: 'someone else', item: 'poncho', color: null, pose: 'sit-relaxed' },
  ] as const;
  return (
    <div style={{ position: 'fixed', inset: 0, background: '#1a1d24' }}>
      <Canvas camera={{ position: [0, 1.8, 8], fov: 40 }} onCreated={({ camera }) => camera.lookAt(0, 1.1, 0)}>
        <color attach="background" args={['#1a1d24']} />
        <hemisphereLight args={['#ffffff', '#3a3020', 1.2]} />
        <directionalLight position={[3, 5, 6]} intensity={1.6} />
        <Suspense fallback={null}>
          {lineup.map((s, i) => {
            const x = (i - 1.5) * 2.1;
            const hips = SIT_HIPS[s.pose];
            const h = (hips.y - SEAT_BELOW_HIPS) * SCALE;
            const z = hips.z * SCALE;
            return (
              <group key={s.name}>
                <group rotation-y={rot} position={[x, 0, 0]}>
                  <mesh position={[0, h / 2, z]}>
                    <boxGeometry args={[0.7, h, 0.7]} />
                    <meshStandardMaterial color="#5a3d22" />
                  </mesh>
                </group>
                <Scarecrow
                  name={s.name}
                  item={s.item}
                  colorHex={s.color}
                  position={[x, 0, 0]}
                  rotationY={rot}
                  selected={false}
                  faded={false}
                  eyeCount={i}
                  pose={s.pose}
                  seed={i * 0.23}
                  reaction={cue}
                  look={look}
                />
              </group>
            );
          })}
        </Suspense>
      </Canvas>
    </div>
  );
}
