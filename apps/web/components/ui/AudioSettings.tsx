'use client';

import { setAudioSettings, useAudioSettings, type AudioSettings as Settings } from '@/lib/audio/settings';
import { playSfx } from '@/lib/audio/sfx';

const SLIDERS: { key: 'music' | 'effects' | 'ambience'; label: string; hint: string }[] = [
  { key: 'music', label: 'Music', hint: 'The score. Quieter while you search, tense near the end.' },
  { key: 'effects', label: 'Effects', hint: 'Telegrams, stamps, coins and the clock.' },
  { key: 'ambience', label: 'Ambience', hint: 'Fire, wind and the odd crow.' },
];

/** Mute switch plus a volume slider per bus. Saved on this device; applies live. */
export function AudioSettings() {
  const s = useAudioSettings();
  return (
    <div className="audio-settings">
      <label className="sound-switch">
        <span className="grow">
          <b>Sound</b>
          <span className="hint"> Starts with your first tap (browsers require it).</span>
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={!s.muted}
          className={`btn small${s.muted ? '' : ' primary'}`}
          onClick={() => setAudioSettings({ muted: !s.muted })}
        >
          {s.muted ? 'Muted' : 'On'}
        </button>
      </label>
      {SLIDERS.map(({ key, label, hint }) => (
        <label key={key} className={`brightness volume${s.muted ? ' off' : ''}`}>
          <span className="brightness-head">
            <b>{label}</b>
            <span className="hint"> {hint}</span>
          </span>
          <span className="brightness-row">
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={s[key]}
              disabled={s.muted}
              onChange={(e) => setAudioSettings({ [key]: Number(e.target.value) } as Partial<Settings>)}
              // A sample of the effects volume when you let go.
              onPointerUp={() => key === 'effects' && playSfx('telegram')}
              aria-valuetext={`${Math.round(s[key] * 100)}%`}
            />
            <span className="volume-value">{Math.round(s[key] * 100)}</span>
          </span>
        </label>
      ))}
    </div>
  );
}
