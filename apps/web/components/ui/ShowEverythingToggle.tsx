'use client';

import { setShowEverything, setTutorialStatus, useShowEverything } from '@/lib/tutorial';

/** Settings: experienced players switch off the first-game tutorial (everything visible). */
export function ShowEverythingToggle() {
  const on = useShowEverything();
  return (
    <label className="streamer-toggle">
      <span className="brightness-head">
        <b>Show everything</b>
        <span className="hint"> Skip the first-game tutorial: every button and tab from the start.</span>
      </span>
      <span className="switch-row">
        <input
          type="checkbox"
          role="switch"
          checked={on}
          onChange={(e) => {
            setShowEverything(e.target.checked);
            if (e.target.checked) setTutorialStatus('done');
          }}
        />
        <span>{on ? 'On' : 'Off'}</span>
      </span>
    </label>
  );
}
