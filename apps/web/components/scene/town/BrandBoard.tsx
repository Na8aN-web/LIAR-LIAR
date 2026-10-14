'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { AdditiveBlending, CanvasTexture, SRGBColorSpace, type Group } from 'three';
import type { AdSlot } from '@/config/adSlots';
import { usePortal } from '@/lib/portal';
import { useCanvasFonts, type CanvasFonts } from '@/lib/canvasFonts';
import { NAILS, PAPER_URL, POSTER_H, POSTER_W, TORN_OUTLINE } from '../../poster/posterArt';
import { WARM, glowTexture } from './glow';
import { useBillboardSeen } from './useBillboardSeen';

// The 3042Official house poster: a permanent slot (see config/adSlots.ts, `reserved`), drawn
// like the Wanted posters so it belongs in town: weathered torn paper, the crew art as an old
// print, "THE 3042 GANG", a line of copy and the handle. Drawn on a canvas so it uses the game's
// own fonts.

const W = 640;
const H = 960;
const INK = '#2b1a0d';
const RED = '#7b1e1e';

function loadImage(url: string) {
  return new Promise<HTMLImageElement | null>((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

export function drawBrandPoster(g: CanvasRenderingContext2D, fonts: CanvasFonts, paper: HTMLImageElement | null, art: HTMLImageElement | null, copy: { title: string; line: string; handle: string }) {
  g.clearRect(0, 0, W, H);
  // Torn paper: the Wanted poster outline, stretched to this poster's shape.
  g.save();
  g.scale(W / POSTER_W, H / POSTER_H);
  const outline = new Path2D(TORN_OUTLINE);
  g.save();
  g.clip(outline);
  g.fillStyle = '#d9c293';
  g.fillRect(0, 0, POSTER_W, POSTER_H);
  if (paper) {
    g.globalAlpha = 0.8;
    g.drawImage(paper, 0, 0, POSTER_W, POSTER_H);
    g.globalAlpha = 1;
  }
  // Weathering: warm stain, darker edges, a few water marks.
  g.fillStyle = 'rgba(214,180,120,0.3)';
  g.fillRect(0, 0, POSTER_W, POSTER_H);
  const v = g.createRadialGradient(150, 210, 80, 150, 210, 270);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, 'rgba(90,50,15,0.6)');
  g.fillStyle = v;
  g.fillRect(0, 0, POSTER_W, POSTER_H);
  for (const [x, y, r] of [
    [60, 330, 26],
    [250, 120, 18],
    [228, 372, 22],
  ]) {
    const s = g.createRadialGradient(x, y, r * 0.6, x, y, r);
    s.addColorStop(0, 'rgba(120,80,30,0)');
    s.addColorStop(0.85, 'rgba(120,80,30,0.16)');
    s.addColorStop(1, 'rgba(120,80,30,0)');
    g.fillStyle = s;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
  g.restore();
  g.strokeStyle = 'rgba(70,40,15,0.55)';
  g.lineWidth = 1.2;
  g.stroke(outline);
  for (const [x, y] of NAILS) {
    g.fillStyle = '#1a120b';
    g.beginPath();
    g.arc(x, y, 3.6, 0, Math.PI * 2);
    g.fill();
  }
  g.restore();

  // Title.
  g.textAlign = 'center';
  g.textBaseline = 'alphabetic';
  g.fillStyle = INK;
  g.font = `40px ${fonts.display}`;
  g.fillText('— THE —', W / 2, 128);
  g.font = `98px ${fonts.display}`;
  g.fillText(copy.title, W / 2, 228, W - 90);

  // The crew, as an old print in a double rule.
  const size = 420;
  const ax = (W - size) / 2;
  const ay = 262;
  g.fillStyle = 'rgba(60,35,10,0.18)';
  g.fillRect(ax - 12, ay - 12, size + 24, size + 24);
  if (art) g.drawImage(art, ax, ay, size, size);
  g.strokeStyle = INK;
  g.lineWidth = 5;
  g.strokeRect(ax - 4, ay - 4, size + 8, size + 8);
  g.lineWidth = 1.5;
  g.strokeRect(ax - 12, ay - 12, size + 24, size + 24);

  // Copy and handle.
  g.fillStyle = INK;
  g.font = `italic 44px ${fonts.body}`;
  g.fillText(copy.line, W / 2, 762);
  if (!copy.handle) return;
  g.strokeStyle = 'rgba(43,26,13,0.6)';
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(150, 790);
  g.lineTo(W - 150, 790);
  g.stroke();
  g.fillStyle = RED;
  g.font = `52px ${fonts.display}`;
  g.fillText(copy.handle, W / 2, 858, W - 120);
}

/** A reserved house slot from config/adSlots.ts: the 3042 Gang poster on a framed board. */
export function BrandBoard({ slot }: { slot: AdSlot }) {
  const fonts = useCanvasFonts();
  // Portals: the gang art, without the social handle (no promoting outside platforms).
  const showHandle = usePortal().features.brandHandle;
  const [imgs, setImgs] = useState<{ paper: HTMLImageElement | null; art: HTMLImageElement | null } | null>(null);
  useEffect(() => {
    let live = true;
    Promise.all([loadImage(PAPER_URL), loadImage(slot.image)]).then(([paper, art]) => live && setImgs({ paper, art }));
    return () => {
      live = false;
    };
  }, [slot.image]);

  const texture = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    drawBrandPoster(c.getContext('2d')!, fonts, imgs?.paper ?? null, imgs?.art ?? null, {
      title: slot.house?.title ?? '',
      line: slot.house?.line ?? '',
      handle: showHandle ? (slot.house?.handle ?? '') : '',
    });
    const t = new CanvasTexture(c);
    t.colorSpace = SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  }, [fonts.ready, fonts.display, fonts.body, imgs, slot, showHandle]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => texture.dispose(), [texture]);

  const [w, h] = slot.size;
  const glow = glowTexture();
  const ref = useRef<Group>(null);
  useBillboardSeen(slot.id, ref);
  return (
    <group ref={ref} position={slot.position} rotation-y={slot.rotationY ?? 0} name={`ad:${slot.id}`}>
      {/* Weathered plank backing and two posts down to the ground. */}
      <mesh position-z={-0.05}>
        <boxGeometry args={[w + 0.3, h + 0.3, 0.08]} />
        <meshStandardMaterial color="#3a2616" roughness={1} />
      </mesh>
      {[-w * 0.38, w * 0.38].map((x) => (
        <mesh key={x} position={[x, -slot.position[1] / 2, -0.12]}>
          <boxGeometry args={[0.16, slot.position[1], 0.16]} />
          <meshStandardMaterial color="#2e1e10" roughness={1} />
        </mesh>
      ))}
      <mesh>
        <planeGeometry args={[w, h]} />
        <meshStandardMaterial map={texture} transparent alphaTest={0.05} roughness={1} emissive="#ffffff" emissiveMap={texture} emissiveIntensity={0.55} />
      </mesh>
      {/* A lamp above it, so it reads from across the square. */}
      <mesh position={[0, h / 2 + 0.28, 0.25]}>
        <boxGeometry args={[0.5, 0.12, 0.2]} />
        <meshStandardMaterial color="#ffd08a" emissive="#ffb35c" emissiveIntensity={2.5} />
      </mesh>
      <mesh position={[0, h * 0.05, 0.04]}>
        <planeGeometry args={[w * 1.5, h * 1.4]} />
        <meshBasicMaterial map={glow} color={WARM} blending={AdditiveBlending} transparent depthWrite={false} opacity={0.28} />
      </mesh>
    </group>
  );
}
