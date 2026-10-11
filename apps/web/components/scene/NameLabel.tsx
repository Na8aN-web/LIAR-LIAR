'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { CanvasTexture, LinearFilter, SRGBColorSpace, Vector3, type Sprite } from 'three';
import { useCanvasFonts } from '@/lib/canvasFonts';

interface Props {
  name: string;
  position: [number, number, number];
  /** Larger, for the hovered or selected scarecrow. */
  expanded?: boolean;
  /** Gold highlight for the selected scarecrow. */
  highlight?: boolean;
  /** Times inspected this poster. 0 hides the eye badge. */
  eyeCount?: number;
  faded?: boolean;
}

/** Tag height on screen in CSS pixels: 17px on phones, up to 25px on wide screens. */
const tagPx = (width: number) => 17 + Math.max(0, Math.min(8, (width - 400) / 120));
const EXPANDED_SCALE = 1.35;
/** Far tags shrink a little (down to 75%) as a depth cue. */
const depthFactor = (d: number) => Math.max(0.75, Math.min(1, 16 / d));

/** Same name as everywhere else in the UI; only very long names are shortened. */
export function tagName(name: string): string {
  return name.length > 12 ? `${name.slice(0, 11)}…` : name;
}

function drawEye(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = r * 0.28;
  ctx.beginPath();
  ctx.moveTo(cx - r, cy);
  ctx.quadraticCurveTo(cx, cy - r * 1.1, cx + r, cy);
  ctx.quadraticCurveTo(cx, cy + r * 1.1, cx - r, cy);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.38, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** Name tag drawn to a canvas texture on a sprite: a wood plaque (brass when selected) with a brass eye plate. */
export function NameLabel({ name, position, expanded = false, highlight = false, eyeCount = 0, faded = false }: Props) {
  const ref = useRef<Sprite>(null);
  const text = tagName(name);

  const fonts = useCanvasFonts();
  const { texture, aspect } = useMemo(() => {
    const s = 2;
    const fontPx = 26 * s;
    const pad = 12 * s;
    const h = Math.ceil(fontPx * 1.6);
    const font = `700 ${fontPx}px ${fonts.body}`;
    const numberFont = `${Math.round(fontPx * 1.05)}px ${fonts.display}`;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;
    ctx.font = font;
    const textW = ctx.measureText(text).width;
    const badge = eyeCount > 0 ? `${eyeCount}` : '';
    ctx.font = numberFont;
    const badgeW = badge ? h * 0.95 + ctx.measureText(badge).width + pad * 0.5 : 0;
    const w = Math.ceil(textW + pad * 2 + badgeW);
    canvas.width = w;
    canvas.height = h;
    ctx.textBaseline = 'middle';

    // Plaque: dark wood, or brass when selected.
    const plaque = ctx.createLinearGradient(0, 0, 0, h);
    if (highlight) {
      plaque.addColorStop(0, '#f1d78f');
      plaque.addColorStop(0.5, '#c9a24a');
      plaque.addColorStop(1, '#7c5d1f');
    } else {
      plaque.addColorStop(0, 'rgba(92,59,34,0.94)');
      plaque.addColorStop(1, 'rgba(34,20,11,0.94)');
    }
    ctx.fillStyle = plaque;
    ctx.beginPath();
    ctx.roundRect(0, 0, w, h, h * 0.12);
    ctx.fill();
    ctx.strokeStyle = highlight ? '#4d3a12' : 'rgba(18,10,5,0.9)';
    ctx.lineWidth = 2 * s;
    ctx.stroke();

    if (badge) {
      // Brass plate: times searched this poster.
      const brass = ctx.createLinearGradient(0, 0, 0, h);
      brass.addColorStop(0, '#f1d78f');
      brass.addColorStop(0.5, '#c9a24a');
      brass.addColorStop(1, '#7c5d1f');
      ctx.fillStyle = brass;
      ctx.beginPath();
      ctx.roundRect(3 * s, 3 * s, badgeW - 3 * s, h - 6 * s, h * 0.1);
      ctx.fill();
      ctx.strokeStyle = '#4d3a12';
      ctx.lineWidth = 1.5 * s;
      ctx.stroke();
      drawEye(ctx, h * 0.5, h / 2, h * 0.22, '#2a1a06');
      ctx.fillStyle = '#2a1a06';
      ctx.font = numberFont;
      ctx.textAlign = 'left';
      ctx.fillText(badge, h * 0.82, h / 2 + 3);
    }

    ctx.font = font;
    ctx.fillStyle = highlight ? '#2a1a06' : '#f3e6c4';
    ctx.textAlign = 'center';
    ctx.fillText(text, badgeW + (w - badgeW) / 2, h / 2 + 2);

    const tex = new CanvasTexture(canvas);
    tex.colorSpace = SRGBColorSpace;
    tex.minFilter = LinearFilter;
    tex.generateMipmaps = false;
    return { texture: tex, aspect: w / h };
  }, [text, highlight, eyeCount, fonts.ready, fonts.body, fonts.display]);

  useEffect(() => () => texture.dispose(), [texture]);

  const world = useMemo(() => new Vector3(), []);
  useFrame(({ camera, size }) => {
    const sprite = ref.current;
    if (!sprite) return;
    sprite.getWorldPosition(world);
    const d = camera.position.distanceTo(world);
    const fov = 'fov' in camera ? (camera as { fov: number }).fov : 50;
    // World units per CSS pixel at this distance, then scale to the target pixel height.
    const unitsPerPx = (2 * d * Math.tan((fov * Math.PI) / 360)) / size.height;
    const h = tagPx(size.width) * unitsPerPx * depthFactor(d) * (expanded ? EXPANDED_SCALE : 1);
    sprite.scale.set(h * aspect, h, 1);
  });

  return (
    <sprite ref={ref} position={position} renderOrder={expanded ? 20 : 10}>
      <spriteMaterial map={texture} transparent opacity={faded ? 0.45 : 1} depthTest={false} depthWrite={false} fog={false} />
    </sprite>
  );
}
