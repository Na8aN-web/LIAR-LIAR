import { notFound } from 'next/navigation';

// Dev tools (/dev/scarecrow, /dev/scenery, /dev/sounds, /dev/style) don't exist in production:
// every route under /dev answers 404 there.
export default function DevLayout({ children }: { children: React.ReactNode }) {
  if (process.env.NODE_ENV === 'production') notFound();
  return children;
}
