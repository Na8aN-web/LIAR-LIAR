'use client';

import { useEffect, useState } from 'react';

// Canvas text (3D name tags) can't use CSS variables directly. Read the real
// family names next/font assigned, and re-render once the fonts have loaded.

export interface CanvasFonts {
  display: string;
  body: string;
}

const FALLBACK: CanvasFonts = { display: 'Georgia, serif', body: 'Georgia, serif' };

function read(): CanvasFonts {
  if (typeof document === 'undefined') return FALLBACK;
  const css = getComputedStyle(document.documentElement);
  const display = css.getPropertyValue('--font-display').trim();
  const body = css.getPropertyValue('--font-body').trim();
  return { display: display || FALLBACK.display, body: body || FALLBACK.body };
}

let cached: CanvasFonts | null = null;
let ready = false;
const waiters = new Set<() => void>();

function load() {
  if (cached) return;
  cached = read();
  Promise.all([
    document.fonts.load(`28px ${cached.display}`),
    document.fonts.load(`700 28px ${cached.body}`),
  ])
    .catch(() => undefined)
    .then(() => {
      ready = true;
      waiters.forEach((w) => w());
    });
}

/** Font families for canvas drawing, plus a flag that flips once they're loaded. */
export function useCanvasFonts(): CanvasFonts & { ready: boolean } {
  const [, force] = useState(0);
  useEffect(() => {
    load();
    if (ready) return;
    const w = () => force((n) => n + 1);
    waiters.add(w);
    return () => {
      waiters.delete(w);
    };
  }, []);
  return { ...(cached ?? FALLBACK), ready };
}
