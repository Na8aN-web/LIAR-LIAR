'use client';

import dynamic from 'next/dynamic';

// Dev-only preview of the scarecrow model and items: /dev/scarecrow?view=front|side|back
const Preview = dynamic(() => import('@/components/scene/ScarecrowPreview'), { ssr: false });

export default function ScarecrowPreviewPage() {
  if (process.env.NODE_ENV !== 'development') return null;
  return <Preview />;
}
