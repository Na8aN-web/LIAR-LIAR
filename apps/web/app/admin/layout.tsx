import type { Metadata } from 'next';
import './admin.css';

// The admin dashboard. Not linked from anywhere; never indexed. Access is checked by the game
// server (password + authenticator code, and Cloudflare Access at launch): this page holds no
// data or secrets of its own.
export const metadata: Metadata = {
  title: 'Sheriff’s office · Wanted: True Colors',
  robots: { index: false, follow: false, nocache: true },
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return children;
}
