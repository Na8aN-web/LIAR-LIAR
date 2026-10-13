'use client';

import { useEffect, useState } from 'react';
import { call } from '@/lib/socket';
import { useGame } from '@/lib/store';

/**
 * The room is about to close (server/src/timeouts.ts): idle for too long ("going cold", any
 * action or "We're still here" keeps it open), or open an hour without a game.
 */
export function ClosingBanner() {
  const closing = useGame((s) => s.view?.room.closing ?? null);
  const offset = useGame((s) => s.clockOffset);
  const toast = useGame((s) => s.showToast);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!closing) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [closing]);
  if (!closing) return null;
  const left = Math.max(0, Math.ceil((closing.at - (now + offset)) / 1000));
  const clock = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
  return (
    <div className="closing-banner" role="alert">
      {closing.why === 'idle' ? (
        <>
          <span>
            <b>This campfire&rsquo;s going cold…</b> Nothing&rsquo;s happened for a while. The room closes in <b>{clock}</b>.
          </span>
          <button
            className="btn small primary"
            onClick={async () => {
              const r = await call('room:stillHere');
              if (!r.ok) toast(r.error);
            }}
          >
            We&rsquo;re still here
          </button>
        </>
      ) : (
        <span>
          <b>This room has been open almost an hour.</b> It closes in <b>{clock}</b>: start the hunt, or make a new room.
        </span>
      )}
    </div>
  );
}
