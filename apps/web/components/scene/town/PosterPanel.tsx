'use client';

import { useEffect, useMemo, useState } from 'react';
import { CanvasTexture, DoubleSide, SRGBColorSpace } from 'three';
import { colorInfo, type ColorId } from '@wtc/shared';
import { useCanvasFonts } from '@/lib/canvasFonts';
import { PAPER_URL, POSTER_H, POSTER_W, drawPoster } from '../../poster/posterArt';

/** Poster size on the wall, in building-local units (buildings are scaled up in the scene). */
export const POSTER_PANEL_W = 0.88;
export const POSTER_PANEL_H = (POSTER_PANEL_W * POSTER_H) / POSTER_W;

let paperImage: HTMLImageElement | null = null;
let paperReady: Promise<HTMLImageElement> | null = null;
function loadPaper() {
  paperReady ??= new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      paperImage = img;
      resolve(img);
    };
    img.onerror = () => resolve(img);
    img.src = PAPER_URL;
  });
  return paperReady;
}

/**
 * The Wanted poster nailed to a wall, drawn from the same artwork as the UI poster
 * (poster/posterArt.ts). Redraws whenever the poster changes. `color` null = "???".
 */
export function PosterPanel({
  color,
  pot,
  number,
  of,
  position,
}: {
  color: ColorId | null;
  pot: number;
  number: number | null;
  of: number | null;
  position: [number, number, number];
}) {
  const fonts = useCanvasFonts();
  const [paperLoaded, setPaperLoaded] = useState(!!paperImage);
  useEffect(() => {
    if (!paperLoaded) loadPaper().then(() => setPaperLoaded(true));
  }, [paperLoaded]);

  const texture = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = Math.round((512 * POSTER_H) / POSTER_W);
    const info = color ? colorInfo(color) : null;
    drawPoster(
      canvas.getContext('2d')!,
      { colorHex: info?.hex ?? null, colorName: info?.name ?? null, pot, number, of },
      fonts,
      paperImage,
    );
    const t = new CanvasTexture(canvas);
    t.colorSpace = SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  }, [color, pot, number, of, fonts.ready, fonts.display, fonts.body, paperLoaded]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => texture.dispose(), [texture]);

  return (
    <mesh position={position} rotation-z={0.03}>
      <planeGeometry args={[POSTER_PANEL_W, POSTER_PANEL_H]} />
      {/* Self-lit a little so it reads under the porch at night (no real light). */}
      <meshStandardMaterial map={texture} transparent alphaTest={0.05} roughness={1} side={DoubleSide} emissive="#ffffff" emissiveIntensity={0.42} emissiveMap={texture} />
    </mesh>
  );
}

/** An empty poster spot for later: a sun-faded patch where a poster used to hang, and its nails. */
export function EmptyPosterSpot({ position }: { position: [number, number, number] }) {
  const nail = (x: number, y: number) => (
    <mesh position={[x, y, 0.012]}>
      <circleGeometry args={[0.018, 6]} />
      <meshBasicMaterial color="#2a1d12" />
    </mesh>
  );
  return (
    <group position={position} name="poster-spot">
      <mesh>
        <planeGeometry args={[POSTER_PANEL_W * 0.95, POSTER_PANEL_H * 0.95]} />
        <meshBasicMaterial color="#c8a978" transparent opacity={0.16} depthWrite={false} />
      </mesh>
      {nail(-POSTER_PANEL_W * 0.4, POSTER_PANEL_H * 0.42)}
      {nail(POSTER_PANEL_W * 0.4, POSTER_PANEL_H * 0.42)}
    </group>
  );
}
