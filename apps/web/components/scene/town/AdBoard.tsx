'use client';

import { useEffect, useMemo } from 'react';
import { AdditiveBlending, SRGBColorSpace, TextureLoader, type Texture } from 'three';
import type { AdSlot } from '@/config/adSlots';
import { WARM, glowTexture } from './glow';

const cache = new Map<string, Texture>();
function adTexture(url: string): Texture {
  let t = cache.get(url);
  if (!t) {
    t = new TextureLoader().load(url);
    t.colorSpace = SRGBColorSpace;
    t.anisotropy = 4;
    cache.set(url, t);
  }
  return t;
}

const WOOD = '#3a2616';

/**
 * One ad slot from config/adSlots.ts, in its lot's frame. The art is self-lit (night town,
 * no real light to spare) and each board gets a lamp glow, so it reads from across the square.
 */
export function AdBoard({ slot }: { slot: AdSlot }) {
  const map = useMemo(() => adTexture(slot.image), [slot.image]);
  const [w, h] = slot.size;
  const glow = glowTexture();
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' && !slot.image) console.warn(`ad slot ${slot.id} has no image`);
  }, [slot]);

  const art = (
    // In front of the frame's face (z=0.03), never on it: coplanar faces flicker in stripes.
    <mesh position-z={slot.kind === 'wall' ? 0.03 : 0.045} name={`ad:${slot.id}`}>
      <planeGeometry args={[w, h]} />
      <meshStandardMaterial map={map} roughness={0.95} emissive="#ffffff" emissiveMap={map} emissiveIntensity={slot.kind === 'door' ? 0.5 : 0.62} />
    </mesh>
  );

  return (
    <group position={slot.position}>
      {slot.kind === 'wall' ? (
        // Painted straight on the boards: no frame, slightly worn.
        art
      ) : (
        <>
          <mesh>
            <boxGeometry args={[w + 0.16, h + 0.16, 0.06]} />
            <meshStandardMaterial color={WOOD} roughness={1} />
          </mesh>
          {art}
        </>
      )}
      {slot.kind === 'rooftop' && (
        <>
          {/* Legs down to the roof and a catwalk with two lamps. */}
          {[-w * 0.35, w * 0.35].map((x) => (
            <mesh key={x} position={[x, -h / 2 - 0.9, -0.1]}>
              <boxGeometry args={[0.12, 1.8, 0.12]} />
              <meshStandardMaterial color={WOOD} roughness={1} />
            </mesh>
          ))}
          <mesh position={[0, -h / 2 - 0.1, 0.25]}>
            <boxGeometry args={[w + 0.2, 0.06, 0.5]} />
            <meshStandardMaterial color={WOOD} roughness={1} />
          </mesh>
          {[-w * 0.3, w * 0.3].map((x) => (
            <group key={`l${x}`} position={[x, h / 2 + 0.22, 0.4]}>
              <mesh>
                <boxGeometry args={[0.3, 0.1, 0.16]} />
                <meshStandardMaterial color="#ffd08a" emissive="#ffb35c" emissiveIntensity={2.5} />
              </mesh>
            </group>
          ))}
        </>
      )}
      {/* Wash of lamplight over the art. */}
      <mesh position={[0, h * 0.1, 0.06]}>
        <planeGeometry args={[w * 1.5, h * 1.6]} />
        <meshBasicMaterial map={glow} color={WARM} blending={AdditiveBlending} transparent depthWrite={false} opacity={slot.kind === 'door' ? 0.22 : 0.3} />
      </mesh>
    </group>
  );
}
