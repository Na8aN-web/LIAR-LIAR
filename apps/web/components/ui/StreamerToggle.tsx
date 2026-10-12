'use client';

import { setStreamerMode, useStreamerMode } from '@/lib/streamer';

/** Settings: streamer mode, for playing on stream without showing your color or the room code. */
export function StreamerToggle() {
  const on = useStreamerMode();
  return (
    <label className="streamer-toggle">
      <span className="brightness-head">
        <b>Streamer mode</b>
        <span className="hint">
          {' '}
          Hides your color (badge, glow, your scarecrow&rsquo;s item), the room code and the outlaw banner, so viewers can&rsquo;t see them. Also add a stream delay of
          1&ndash;2 minutes in your streaming app, so viewers in your game can&rsquo;t act on what they see.
        </span>
      </span>
      <span className="switch-row">
        <input type="checkbox" role="switch" checked={on} onChange={(e) => setStreamerMode(e.target.checked)} />
        <span>{on ? 'On' : 'Off'}</span>
      </span>
    </label>
  );
}
