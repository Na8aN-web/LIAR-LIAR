'use client';

import dynamic from 'next/dynamic';

// Trailer studio: dev builds only (see app/dev/trailer/page.tsx and TRAILER.md).
const Studio = process.env.NODE_ENV === 'production' ? null : dynamic(() => import('@/components/trailer/studio/Studio').then((m) => m.Studio), { ssr: false });

export default function StudioPage() {
  return Studio ? <Studio /> : null;
}
