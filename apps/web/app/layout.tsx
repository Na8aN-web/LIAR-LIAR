import type { Metadata, Viewport } from 'next';
import { Libre_Baskerville, Rye, Special_Elite } from 'next/font/google';
import './globals.css';
import { ClientAudio } from '@/components/ClientAudio';
import { ErrorReporting } from '@/components/ErrorReporting';

// Rye: titles and big numbers only. Special Elite: telegrams (notifications). Libre Baskerville: everything else.
const rye = Rye({ weight: '400', subsets: ['latin'], variable: '--font-display', display: 'swap' });
const telegram = Special_Elite({ weight: '400', subsets: ['latin'], variable: '--font-telegram', display: 'swap' });
const body = Libre_Baskerville({ weight: ['400', '700'], subsets: ['latin'], variable: '--font-body', display: 'swap' });

export const metadata: Metadata = {
  title: 'Wanted: True Colors',
  description: 'A Wild West social deduction game for 6–15 players.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#0b0806',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${rye.variable} ${telegram.variable} ${body.variable}`}>
      <body>
        <ClientAudio />
        <ErrorReporting />
        {children}
      </body>
    </html>
  );
}
