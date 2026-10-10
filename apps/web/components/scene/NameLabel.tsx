'use client';

import { useEffect, useMemo } from 'react';
import { CanvasTexture, LinearFilter, SRGBColorSpace } from 'three';

interface Props {
  text: string;
  position: [number, number, number];
  highlight?: boolean;
  faded?: boolean;
}

const HEIGHT = 0.34;

/** Name tag drawn to a canvas texture on a sprite. Cheaper on phones than DOM labels. */
export function NameLabel({ text, position, highlight = false, faded = false }: Props) {
  const { texture, aspect } = useMemo(() => {
    const scale = 2;
    const fontPx = 28 * scale;
    const pad = 14 * scale;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;
    const font = `600 ${fontPx}px system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif`;
    ctx.font = font;
    const w = Math.ceil(ctx.measureText(text).width + pad * 2);
    const h = Math.ceil(fontPx * 1.6);
    canvas.width = w;
    canvas.height = h;
    ctx.font = font;
    ctx.fillStyle = highlight ? '#f2c14e' : 'rgba(0,0,0,0.6)';
    ctx.beginPath();
    ctx.roundRect(0, 0, w, h, h * 0.3);
    ctx.fill();
    ctx.fillStyle = highlight ? '#1b1305' : '#ece2cc';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, w / 2, h / 2 + 2);
    const tex = new CanvasTexture(canvas);
    tex.colorSpace = SRGBColorSpace;
    tex.minFilter = LinearFilter;
    tex.generateMipmaps = false;
    return { texture: tex, aspect: w / h };
  }, [text, highlight]);

  useEffect(() => () => texture.dispose(), [texture]);

  return (
    <sprite position={position} scale={[HEIGHT * aspect, HEIGHT, 1]} renderOrder={10}>
      <spriteMaterial map={texture} transparent opacity={faded ? 0.45 : 1} depthTest={false} depthWrite={false} fog={false} />
    </sprite>
  );
}
