'use client';

import { useEffect, useState } from 'react';
import { AudioSettings } from '@/components/ui/AudioSettings';
import { SFX_NAMES, measureSfx, playSfx, type Sfx } from '@/lib/audio/sfx';
import { setMood, type Mood } from '@/lib/audio/soundscape';

// Dev-only: audition every sound effect and soundscape mood. /dev/sounds
const MOODS: Mood[] = ['menu', 'lobby', 'investigation', 'tension', 'payout', 'ended'];

type Stats = Record<string, { peak: number; rmsDb: number; seconds: number }>;

export default function Sounds() {
  const [stats, setStats] = useState<Stats>({});
  const [mood, pickMood] = useState<Mood | null>(null);
  useEffect(() => {
    (async () => {
      const out: Stats = {};
      for (const n of SFX_NAMES) out[n] = await measureSfx(n);
      setStats(out);
      (window as unknown as { __sfx: Stats }).__sfx = out;
    })();
  }, []);
  if (process.env.NODE_ENV !== 'development') return null;
  return (
    <main className="paper" style={{ padding: 20, maxWidth: 760, margin: '20px auto' }}>
      <h1>Sounds</h1>
      <p className="muted">Tap once anywhere first (browsers only allow sound after a gesture).</p>
      <h2>Effects</h2>
      <table style={{ width: '100%' }}>
        <tbody>
          {SFX_NAMES.map((n: Sfx) => (
            <tr key={n}>
              <td>
                <button className="btn small" onClick={() => playSfx(n)}>
                  {n}
                </button>
              </td>
              <td className="muted small-text">
                {stats[n] ? `${stats[n].seconds.toFixed(2)} s · peak ${stats[n].peak.toFixed(2)} · ${stats[n].rmsDb.toFixed(0)} dB RMS` : '…'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <h2>Soundscape</h2>
      <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
        {MOODS.map((m) => (
          <button
            key={m}
            className={`btn small${mood === m ? ' primary' : ''}`}
            onClick={() => {
              setMood(m);
              pickMood(m);
            }}
          >
            {m}
          </button>
        ))}
      </div>
      <h2>Volumes</h2>
      <AudioSettings />
    </main>
  );
}
