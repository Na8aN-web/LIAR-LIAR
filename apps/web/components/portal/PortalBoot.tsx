'use client';

import { useEffect } from 'react';
import { PORTALS, type PortalId } from '@wtc/shared';
import { bootPortal, usePortal, usePortalReady } from '@/lib/portal';

/** True for a portal with its own pages (/play/<id>). */
export function isPortalId(id: unknown): id is Exclude<PortalId, 'web'> {
  return typeof id === 'string' && (PORTALS as string[]).includes(id);
}

/**
 * Wraps a portal's pages: starts the portal's SDK and save first, so names, settings and
 * progress come from the portal before anything reads them. The game shows its loading curtain
 * meanwhile (the SDK loads in parallel with the scene).
 */
export function PortalBoot({ portal, children }: { portal: Exclude<PortalId, 'web'>; children: React.ReactNode }) {
  // Ready once this portal (not the website default) has started.
  const started = usePortalReady();
  const current = usePortal();
  const ready = started && current.id === portal;
  useEffect(() => {
    void bootPortal(portal);
  }, [portal]);
  // A portal shows the game in a frame of its own size: the page never scrolls (see globals.css).
  useEffect(() => {
    document.documentElement.classList.add('portal');
    return () => document.documentElement.classList.remove('portal');
  }, []);
  if (!ready) return <div className="portal-boot" aria-busy="true" />;
  return <>{children}</>;
}
