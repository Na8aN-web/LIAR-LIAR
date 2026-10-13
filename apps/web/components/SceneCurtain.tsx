'use client';

import { useEffect, useState } from 'react';
import { useProgress } from '@react-three/drei';

// Covers the 3D scene while it loads, so it appears all at once instead of in pieces (fire
// first, a white flash, then the scarecrows). The first time in a browser session it counts
// down "Starting Wanted: True Colors 5, 4, 3, 2, 1"; later scenes just wait until loaded. If
// loading runs past the countdown it says so and shows how far along it is. Once everything
// is in, a tap skips the rest of the countdown.

const SEEN_KEY = 'wtc:intro-seen';
const COUNT_FROM = 5;
/** Give up waiting and show the scene anyway (a stuck file shouldn't lock anyone out). */
const MAX_WAIT_MS = 20_000;
/** A beat after loading, so the first frames (shader compile) happen behind the curtain. */
const SETTLE_MS = 400;
const FADE_MS = 700;

// Decided once per page load (effects can run twice in development).
let firstTime: boolean | null = null;
function firstTimeThisSession(): boolean {
  if (firstTime !== null) return firstTime;
  try {
    firstTime = !sessionStorage.getItem(SEEN_KEY);
    sessionStorage.setItem(SEEN_KEY, '1');
  } catch {
    firstTime = true;
  }
  return firstTime;
}

export function SceneCurtain() {
  // Rendered on the server too (so the scene never shows before the curtain), so the session
  // check happens after mounting: the server can't know it.
  const [countdown, setCountdown] = useState(true);
  const [n, setN] = useState(COUNT_FROM);
  useEffect(() => {
    if (firstTimeThisSession()) return;
    setCountdown(false);
    setN(0);
  }, []);
  const [loaded, setLoaded] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [gone, setGone] = useState(false);
  const { active, progress, total } = useProgress();

  // Ready: something was loaded and nothing is still loading. (Before the 3D code arrives, the
  // loader reports "nothing to do", which isn't ready.)
  const assetsIn = total > 0 && !active && progress >= 100;
  useEffect(() => {
    if (!assetsIn) return;
    const t = setTimeout(() => setLoaded(true), SETTLE_MS);
    return () => clearTimeout(t);
  }, [assetsIn]);
  useEffect(() => {
    const t = setTimeout(() => setLoaded(true), MAX_WAIT_MS);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (n <= 0) return;
    const t = setTimeout(() => setN((x) => x - 1), 1000);
    return () => clearTimeout(t);
  }, [n]);

  useEffect(() => {
    if (loaded && n <= 0) setLeaving(true);
  }, [loaded, n]);
  useEffect(() => {
    if (!leaving) return;
    const t = setTimeout(() => setGone(true), FADE_MS);
    return () => clearTimeout(t);
  }, [leaving]);

  if (gone) return null;
  const waiting = n <= 0 && !loaded;
  return (
    <div
      className={`scene-curtain${leaving ? ' leaving' : ''}`}
      role="status"
      aria-live="polite"
      onClick={() => loaded && setN(0)}
      style={{ transitionDuration: `${FADE_MS}ms` }}
    >
      <div className="curtain-inner">
        <span className="curtain-line">Starting</span>
        <span className="curtain-title">
          Wanted<small>True Colors</small>
        </span>
        {countdown && n > 0 ? (
          <span key={n} className="curtain-count">
            {n}
          </span>
        ) : (
          <span className="curtain-count small">{waiting || !leaving ? 'Almost there…' : ''}</span>
        )}
        <span className="curtain-bar" aria-hidden>
          <i style={{ width: `${loaded ? 100 : Math.round(progress)}%` }} />
        </span>
      </div>
    </div>
  );
}
