'use client';

import { setQualitySetting, useQuality, useQualitySetting, type QualitySetting } from '@/lib/quality';

const OPTIONS: { id: QualitySetting; label: string }[] = [
  { id: 'auto', label: 'Auto' },
  { id: 'smooth', label: 'Smooth' },
  { id: 'pretty', label: 'Pretty' },
];

/** Graphics quality. Smooth is for cheap phones. Applies live, saved on this device. */
export function GraphicsSetting() {
  const setting = useQualitySetting();
  const quality = useQuality();
  return (
    <div className="brightness">
      <span className="brightness-head">
        <b>Graphics</b>
        <span className="hint">
          {' '}
          Laggy? Pick Smooth.{setting === 'auto' && ` Auto is using ${quality === 'smooth' ? 'Smooth' : 'Pretty'} on this device.`}
        </span>
      </span>
      <span className="chips" role="radiogroup" aria-label="Graphics quality" style={{ justifyContent: 'flex-start' }}>
        {OPTIONS.map((o) => (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={setting === o.id}
            className={`chip${setting === o.id ? ' on' : ''}`}
            onClick={() => setQualitySetting(o.id)}
          >
            {o.label}
          </button>
        ))}
      </span>
    </div>
  );
}
