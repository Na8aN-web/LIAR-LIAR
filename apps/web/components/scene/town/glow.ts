'use client';

import { CanvasTexture, SRGBColorSpace } from 'three';

// One soft radial gradient, reused for lantern halos, ground light pools and facade spill.
// This is how most of the "lighting" is faked: additive glowing quads instead of real lights.
let tex: CanvasTexture | null = null;

export function glowTexture(): CanvasTexture {
  if (tex) return tex;
  const size = 128;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  grad.addColorStop(0.6, 'rgba(255,255,255,0.15)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  return tex;
}

export const WARM = '#ffae55';
