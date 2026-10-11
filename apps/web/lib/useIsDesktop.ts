'use client';

import { useEffect, useState } from 'react';

/** Matches the CSS desktop breakpoint (min-width: 900px). Used for collapsed-by-default on phones. */
export const DESKTOP_QUERY = '(min-width: 900px)';

export function isDesktopNow(): boolean {
  return typeof window !== 'undefined' && window.matchMedia(DESKTOP_QUERY).matches;
}

export function useIsDesktop(): boolean {
  const [desktop, setDesktop] = useState(isDesktopNow);
  useEffect(() => {
    const mq = window.matchMedia(DESKTOP_QUERY);
    const on = () => setDesktop(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return desktop;
}
