'use client';

import { useEffect, useState } from 'react';
import { usePortal } from '@/lib/portal';
import { kv } from '@/lib/portal/storage';

const KEY = 'wtc:privacy-noticed';

/**
 * Portals: a one-line notice for new players (we keep anonymous game stats and error reports),
 * linking the policy in its own tab. Never a popup; it goes once dismissed or after a while.
 */
export function PrivacyNotice() {
  const show = usePortal().features.privacyNotice;
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!show || kv.get(KEY)) return;
    setOpen(true);
    const t = setTimeout(() => dismiss(), 20_000);
    return () => clearTimeout(t);
  }, [show]);
  const dismiss = () => {
    kv.set(KEY, '1');
    setOpen(false);
  };
  if (!open) return null;
  return (
    <p className="privacy-notice" role="note">
      We keep anonymous game stats and error reports to improve the game.{' '}
      <a href="/privacy" target="_blank" rel="noopener noreferrer">
        Privacy policy
      </a>
      <button className="icon-btn" aria-label="Dismiss" onClick={dismiss}>
        ✕
      </button>
    </p>
  );
}
