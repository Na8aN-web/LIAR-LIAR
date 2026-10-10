import type { Metadata, Viewport } from 'next';
import { Rye } from 'next/font/google';
import './globals.css';

const rye = Rye({ weight: '400', subsets: ['latin'], variable: '--font-display' });

export const metadata: Metadata = {
  title: 'Wanted: True Colors',
  description: 'A Wild West social deduction game for 6–15 players.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#0b0a10',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={rye.variable}>
      <body>{children}</body>
    </html>
  );
}
