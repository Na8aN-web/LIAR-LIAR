'use client';

import dynamic from 'next/dynamic';

// Trailer mode: dev builds only. The production build replaces this whole page with nothing
// (NODE_ENV is fixed at build time), and /dev answers 404 there anyway (app/dev/layout.tsx).
const Trailer = process.env.NODE_ENV === 'production' ? null : dynamic(() => import('@/components/trailer/Trailer').then((m) => m.Trailer), { ssr: false });

export default function TrailerPage() {
  return Trailer ? <Trailer /> : null;
}
