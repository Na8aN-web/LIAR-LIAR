'use client';

import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';

export interface PerfSample {
  fps: number;
  /** Worst frame in the last second, in ms. */
  worstMs: number;
  drawCalls: number;
  triangles: number;
  dpr: number;
}

declare global {
  interface Window {
    __perf?: PerfSample;
  }
}

/**
 * Add ?perf to the page URL to show FPS, draw calls and triangles (works on a real phone).
 * Also exposes the latest sample on window.__perf for automated checks.
 */
export function PerfProbe() {
  const gl = useThree((s) => s.gl);
  const frames = useRef(0);
  const worst = useRef(0);
  const last = useRef(performance.now());
  const windowStart = useRef(performance.now());
  const box = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!new URLSearchParams(location.search).has('perf')) return;
    const el = document.createElement('div');
    el.style.cssText =
      'position:fixed;left:8px;bottom:8px;z-index:100;font:12px/1.3 monospace;color:#9f9;background:rgba(0,0,0,.7);padding:4px 6px;border-radius:4px;pointer-events:none;white-space:pre';
    document.body.appendChild(el);
    box.current = el;
    return () => el.remove();
  }, []);

  useFrame(() => {
    const now = performance.now();
    worst.current = Math.max(worst.current, now - last.current);
    last.current = now;
    frames.current++;
    const elapsed = now - windowStart.current;
    if (elapsed < 1000) return;
    const sample: PerfSample = {
      fps: Math.round((frames.current * 1000) / elapsed),
      worstMs: Math.round(worst.current),
      drawCalls: gl.info.render.calls,
      triangles: gl.info.render.triangles,
      dpr: gl.getPixelRatio(),
    };
    window.__perf = sample;
    if (box.current) {
      box.current.textContent = `${sample.fps} fps (worst ${sample.worstMs} ms)\n${sample.drawCalls} draws  ${sample.triangles.toLocaleString()} tris  dpr ${sample.dpr}`;
    }
    frames.current = 0;
    worst.current = 0;
    windowStart.current = now;
  });

  return null;
}
