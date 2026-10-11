'use client';

import { BRIGHTNESS_DEFAULT, BRIGHTNESS_MAX, BRIGHTNESS_MIN, setBrightness, useBrightness } from '@/lib/brightness';

/** Picture brightness for the town at night. Applies live, saved on this device. */
export function BrightnessSlider() {
  const value = useBrightness();
  return (
    <label className="brightness">
      <span className="brightness-head">
        <b>Brightness</b>
        <span className="hint"> How dark the town is at night.</span>
      </span>
      <span className="brightness-row">
        <span aria-hidden className="hint">Dim</span>
        <input
          type="range"
          min={BRIGHTNESS_MIN}
          max={BRIGHTNESS_MAX}
          step={0.05}
          value={value}
          onChange={(e) => setBrightness(Number(e.target.value))}
          aria-valuetext={`${Math.round(value * 100)}%`}
        />
        <span aria-hidden className="hint">Bright</span>
        <button type="button" className="btn small" onClick={() => setBrightness(BRIGHTNESS_DEFAULT)} disabled={value === BRIGHTNESS_DEFAULT}>
          Reset
        </button>
      </span>
    </label>
  );
}
