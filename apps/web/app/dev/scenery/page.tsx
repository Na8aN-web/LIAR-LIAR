'use client';

import dynamic from 'next/dynamic';

// Dev-only: every building and prop in scenery.glb, in daylight, labelled. /dev/scenery
const Preview = dynamic(() => import('@/components/scene/town/SceneryPreview'), { ssr: false });

export default function SceneryPreviewPage() {
  if (process.env.NODE_ENV !== 'development') return null;
  return <Preview />;
}
