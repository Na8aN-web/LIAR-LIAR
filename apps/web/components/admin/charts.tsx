'use client';

import type { ReactNode } from 'react';
import { int, shortDay } from './api';

// Small, dependency-free charts in HTML/CSS (crisp text at any size, readable on phones).

export const PALETTE = { ink: 'var(--adm-ink)', red: 'var(--adm-red)', sage: 'var(--adm-sage)', brass: 'var(--adm-brass)', sky: 'var(--adm-sky)', plum: 'var(--adm-plum)', sand: 'var(--adm-sand)' };

export interface Series {
  key: string;
  label: string;
  color: string;
  values: number[];
}

export function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <ul className="adm-legend">
      {items.map((i) => (
        <li key={i.label}>
          <i style={{ background: i.color }} />
          {i.label}
        </li>
      ))}
    </ul>
  );
}

/** One column per day; several series stack. */
export function Columns({ days, series, height = 150, format = int }: { days: string[]; series: Series[]; height?: number; format?: (n: number) => string }) {
  const totals = days.map((_, i) => series.reduce((a, s) => a + (s.values[i] ?? 0), 0));
  const max = Math.max(1, ...totals);
  const ticks = days.length > 1 ? [0, Math.floor((days.length - 1) / 2), days.length - 1] : [0];
  return (
    <figure className="adm-columns">
      {series.length > 1 && <Legend items={series} />}
      <div className="adm-columns-plot" style={{ height }}>
        <span className="adm-columns-max">{format(max)}</span>
        {days.map((d, i) => (
          <div key={d} className="adm-col" title={`${shortDay(d)}: ${series.map((s) => `${s.label} ${format(s.values[i] ?? 0)}`).join(', ')}`}>
            {series.map((s) => (
              <div key={s.key} className="adm-col-seg" style={{ height: `${((s.values[i] ?? 0) / max) * 100}%`, background: s.color }} />
            ))}
          </div>
        ))}
      </div>
      <div className="adm-columns-axis">
        {ticks.map((t) => (
          <span key={t} style={{ left: `${((t + 0.5) / days.length) * 100}%` }}>
            {shortDay(days[t])}
          </span>
        ))}
      </div>
    </figure>
  );
}

/** Labelled horizontal bars (sources, devices, countries, settings). */
export function Bars({ rows, format = int, color = PALETTE.red, max }: { rows: { label: ReactNode; value: number; sub?: ReactNode; color?: string }[]; format?: (n: number) => string; color?: string; max?: number }) {
  const top = max ?? Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="adm-bars">
      {rows.map((r, i) => (
        <li key={i}>
          <span className="adm-bar-label">{r.label}</span>
          <span className="adm-bar-track">
            <span className="adm-bar-fill" style={{ width: `${Math.max(0.5, (r.value / top) * 100)}%`, background: r.color ?? color }} />
          </span>
          <span className="adm-bar-value">
            {format(r.value)}
            {r.sub && <small>{r.sub}</small>}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** A thin share bar split into parts (e.g. mobile vs desktop). */
export function Split({ parts }: { parts: { label: string; value: number; color: string }[] }) {
  const total = parts.reduce((a, p) => a + p.value, 0) || 1;
  return (
    <div className="adm-split">
      <div className="adm-split-bar">
        {parts.map((p) => (
          <span key={p.label} style={{ width: `${(p.value / total) * 100}%`, background: p.color }} title={`${p.label}: ${int(p.value)}`} />
        ))}
      </div>
      <Legend items={parts.map((p) => ({ label: `${p.label} ${Math.round((p.value / total) * 100)}%`, color: p.color }))} />
    </div>
  );
}
