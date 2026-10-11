'use client';

import { setMuted, useMuted } from '@/lib/sound';

/** Labelled on/off switch for the telegraph clicks that play with each telegram. */
export function SoundToggle() {
  const muted = useMuted();
  return (
    <label className="sound-switch">
      <span className="grow">
        <b>Telegraph sounds</b>
        <span className="hint"> Clicks when a telegram arrives (offers, searches, new posters).</span>
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={!muted}
        className={`btn small${muted ? '' : ' primary'}`}
        onClick={() => setMuted(!muted)}
      >
        {muted ? 'Off' : 'On'}
      </button>
    </label>
  );
}
