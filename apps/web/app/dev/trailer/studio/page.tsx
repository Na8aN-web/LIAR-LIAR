'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';

// Trailer studio: dev builds only (see app/dev/trailer/page.tsx and TRAILER.md).
// ?mode=thumbnail opens Thumbnail mode (a YouTube still) instead of the trailer timeline.
const dev = process.env.NODE_ENV !== 'production';
const Studio = dev ? dynamic(() => import('@/components/trailer/studio/Studio').then((m) => m.Studio), { ssr: false }) : null;
const Thumbnail = dev ? dynamic(() => import('@/components/trailer/thumbnail/Thumbnail').then((m) => m.Thumbnail), { ssr: false }) : null;

export default function StudioPage() {
  const [mode, setMode] = useState<'trailer' | 'thumbnail' | null>(null);
  useEffect(() => setMode(new URLSearchParams(location.search).get('mode') === 'thumbnail' ? 'thumbnail' : 'trailer'), []);
  if (!Studio || !Thumbnail || !mode) return null;
  return mode === 'thumbnail' ? <Thumbnail /> : <Studio />;
}
