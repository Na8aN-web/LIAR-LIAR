'use client';

import { useEffect, useMemo, useRef } from 'react';
import { AdditiveBlending, CanvasTexture, SRGBColorSpace, TextureLoader, type Group, type Texture } from 'three';
import { AD_ASPECTS, type AdSlot } from '@/config/adSlots';
import { useCanvasFonts, type CanvasFonts } from '@/lib/canvasFonts';
import { usePortal } from '@/lib/portal';
import { WARM, glowTexture } from './glow';
import { useBillboardImage } from '@/lib/serverStatus';
import { useBillboardSeen } from './useBillboardSeen';

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

/** Portals allow no outside sponsors: the boards show the town's own signs instead. */
const TOWN_SIGNS: Record<string, [string, string]> = {
  hotel: ['GRAND HOTEL', 'Rooms by the night'],
  church: ['SUNDAY SERVICE', 'All welcome'],
  store: ['GENERAL STORE', 'Dry goods & tack'],
  dancehall: ['DANCE HALL', 'Fiddle every Saturday'],
  livery: ['LIVERY STABLE', 'Horses fed & shod'],
  assay: ['ASSAY OFFICE', 'Gold weighed fair'],
  opera: ['OPERA HOUSE', 'Tonight: the show'],
  barber: ['BARBER', 'Shave & a haircut'],
  bank: ['FIRST BANK', 'Est. 1871'],
  barn: ['FEED & GRAIN', 'Oats by the sack'],
  saloon: ['SALOON', 'Cold drinks'],
  sheriff: ['SHERIFF', 'Law & order'],
};

function townSign(slot: AdSlot, fonts: CanvasFonts): Texture {
  const [title, line] = TOWN_SIGNS[slot.lot] ?? ['WELCOME', 'Rest your horse'];
  const ratio = AD_ASPECTS[slot.aspect];
  const W = 1024;
  const H = Math.round(W / ratio);
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  // Painted boards: warm cream on dark wood, a double border, a title and a line.
  g.fillStyle = '#d9c08d';
  g.fillRect(0, 0, W, H);
  for (let y = 0; y < H; y += 46) {
    g.fillStyle = y % 92 ? 'rgba(120,80,40,0.08)' : 'rgba(255,240,210,0.08)';
    g.fillRect(0, y, W, 2);
  }
  g.strokeStyle = '#5a1f14';
  g.lineWidth = 14;
  g.strokeRect(22, 22, W - 44, H - 44);
  g.lineWidth = 4;
  g.strokeRect(46, 46, W - 92, H - 92);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const portrait = ratio < 1;
  const size = Math.min(portrait ? 120 : 150, (W - 140) / (title.length * 0.62));
  g.fillStyle = '#3a1a0c';
  g.font = `${size}px ${fonts.display}`;
  g.fillText(title, W / 2, H * (portrait ? 0.42 : 0.44), W - 120);
  g.fillStyle = '#6b2a1a';
  g.font = `italic ${Math.round(size * 0.42)}px ${fonts.body}`;
  g.fillText(line, W / 2, H * (portrait ? 0.6 : 0.72), W - 160);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/**
 * One ad slot from config/adSlots.ts, in its lot's frame. The art is self-lit (night town,
 * no real light to spare) and each board gets a lamp glow, so it reads from across the square.
 */
export function AdBoard({ slot }: { slot: AdSlot }) {
  // The admins can replace the art from the dashboard without a redeploy.
  const image = useBillboardImage(slot.id, slot.image);
  const sponsors = usePortal().features.sponsorBoards;
  const fonts = useCanvasFonts();
  const sign = useMemo(() => (sponsors ? null : townSign(slot, fonts)), [sponsors, slot, fonts.ready, fonts.display, fonts.body]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => sign?.dispose(), [sign]);
  const map = useMemo(() => sign ?? adTexture(image), [sign, image]);
  const ref = useRef<Group>(null);
  useBillboardSeen(slot.id, ref);
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
    <group ref={ref} position={slot.position}>
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
