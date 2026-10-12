'use client';

import { useEffect, useRef, useState } from 'react';
import { beatLength, beatTime, nearestBeat, type MusicSpec, type Plan, type TrailerScript } from './script';
import type { MusicInfo } from './sound';

// The studio's timeline: the music's waveform with beat and bar lines, the shots, and every
// event as a marker. Drag a marker to move it: it snaps to the nearest beat (hold Alt for free
// placement, Shift for half beats) and the script file is saved. Click anywhere else to seek.

const LANES = { shot: 6, title: 34, moment: 62, fx: 90 } as const;
const KIND: Record<string, keyof typeof LANES> = {
  title: 'title',
  posterSlam: 'moment',
  searchReveal: 'moment',
  search: 'moment',
  bubble: 'moment',
  telegram: 'moment',
  vote: 'moment',
  stamp: 'moment',
  payout: 'moment',
  escape: 'moment',
  caught: 'moment',
  react: 'moment',
  colorChange: 'moment',
  freeze: 'moment',
  endCard: 'moment',
  slowmo: 'fx',
  shake: 'fx',
  flash: 'fx',
  dust: 'fx',
  look: 'fx',
  sfx: 'fx',
};

interface Drag {
  kind: 'event' | 'shot';
  index: number;
  x0: number;
  t0: number;
  t: number;
  label: string;
}

export function Timeline({ plan, t, music, onSeek, onChange }: { plan: Plan; t: number; music: MusicInfo | null; onSeek: (t: number) => void; onChange: (s: TrailerScript) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(800);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [scrubbing, setScrubbing] = useState(false);
  const pps = width / plan.duration;

  // The beat grid: the script's tempo, or the detected one (shown dashed) if the script has none.
  const scriptMusic = plan.script.music ?? null;
  const grid: MusicSpec | null = scriptMusic?.bpm ? scriptMusic : music && scriptMusic ? { ...scriptMusic, bpm: music.bpm, offset: music.offset } : null;
  const detected = !scriptMusic?.bpm && !!grid;

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const cv = canvas.current;
    if (!cv) return;
    const dpr = window.devicePixelRatio || 1;
    const h = cv.clientHeight;
    cv.width = width * dpr;
    cv.height = h * dpr;
    const ctx = cv.getContext('2d')!;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, h);
    // Waveform.
    if (music) {
      const start = scriptMusic?.start ?? 0;
      ctx.fillStyle = 'rgba(224, 176, 74, 0.28)';
      const mid = h * 0.62;
      for (let x = 0; x < width; x++) {
        const a = Math.floor((start + x / pps) * 100);
        const b = Math.max(a + 1, Math.floor((start + (x + 1) / pps) * 100));
        let m = 0;
        for (let i = a; i < b && i < music.peaks.length; i++) m = Math.max(m, music.peaks[i]);
        const y = m * h * 0.36;
        ctx.fillRect(x, mid - y, 1, y * 2);
      }
    }
    // Beats and bars.
    if (grid) {
      const per = grid.beatsPerBar ?? 4;
      ctx.setLineDash(detected ? [3, 3] : []);
      for (let n = 0; ; n++) {
        const bt = beatTime(grid, n);
        if (bt > plan.duration) break;
        const x = Math.round(bt * pps) + 0.5;
        ctx.strokeStyle = n % per === 0 ? 'rgba(243, 230, 196, 0.45)' : 'rgba(243, 230, 196, 0.13)';
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
        if (n % per === 0) {
          ctx.fillStyle = 'rgba(243, 230, 196, 0.5)';
          ctx.font = '9px monospace';
          ctx.fillText(`${n / per + 1}`, x + 2, h - 3);
        }
      }
      ctx.setLineDash([]);
    }
    // Seconds.
    ctx.fillStyle = 'rgba(168, 149, 122, 0.8)';
    ctx.font = '9px monospace';
    for (let s = 0; s <= plan.duration; s += plan.duration > 30 ? 5 : 1) ctx.fillText(`${s}s`, s * pps + 2, h - 14);
  }, [width, music, plan, pps, grid, detected, scriptMusic?.start]);

  const snap = (time: number, e: { altKey: boolean; shiftKey: boolean }): { t: number; at: number | string } => {
    const clamped = Math.max(0, Math.min(plan.duration, time));
    if (!e.altKey && scriptMusic?.bpm && beatLength(scriptMusic)) {
      const div = e.shiftKey ? 2 : 1;
      const n = nearestBeat(scriptMusic, clamped, div)!;
      const at = Math.max(0, n);
      return { t: beatTime(scriptMusic, 0) + at * beatLength(scriptMusic)!, at: `beat:${+at.toFixed(2)}` };
    }
    const r = Math.round(clamped * plan.fps) / plan.fps;
    return { t: r, at: +r.toFixed(3) };
  };

  const startDrag = (ev: React.PointerEvent, kind: Drag['kind'], index: number, time: number, label: string) => {
    ev.stopPropagation();
    (ev.target as HTMLElement).setPointerCapture(ev.pointerId);
    setDrag({ kind, index, x0: ev.clientX, t0: time, t: time, label });
  };
  const moveDrag = (ev: React.PointerEvent) => {
    if (drag) setDrag({ ...drag, t: snap(drag.t0 + (ev.clientX - drag.x0) / pps, ev).t });
    else if (scrubbing) onSeek(xToT(ev));
  };
  const endDrag = (ev: React.PointerEvent) => {
    setScrubbing(false);
    if (!drag) return;
    const moved = Math.abs(ev.clientX - drag.x0) > 3;
    const s = snap(drag.t0 + (ev.clientX - drag.x0) / pps, ev);
    setDrag(null);
    if (!moved) return onSeek(drag.t0);
    const next: TrailerScript = structuredClone(plan.script);
    if (drag.kind === 'event') next.events[drag.index].at = s.at;
    else next.shots[drag.index].at = s.at;
    onChange(next);
  };
  const xToT = (ev: React.PointerEvent) => {
    const r = box.current!.getBoundingClientRect();
    return ((ev.clientX - r.left) / r.width) * plan.duration;
  };

  return (
    <div
      className="studio-timeline"
      ref={box}
      onPointerDown={(ev) => {
        (ev.target as HTMLElement).setPointerCapture?.(ev.pointerId);
        setScrubbing(true);
        onSeek(xToT(ev));
      }}
      onPointerMove={moveDrag}
      onPointerUp={endDrag}
      title={detected ? `No tempo in the script: showing a detected ${grid!.bpm} BPM (offset ${grid!.offset?.toFixed(3)} s). Add "bpm" and "offset" to music to snap to it.` : undefined}
    >
      <canvas ref={canvas} />
      {plan.shots.map((s) =>
        s.i < 0 ? null : (
          <span
            key={`s${s.i}`}
            className={`tl-marker shot${drag?.kind === 'shot' && drag.index === s.i ? ' drag' : ''}`}
            style={{ left: (drag?.kind === 'shot' && drag.index === s.i ? drag.t : s.t) * pps, top: LANES.shot, transform: 'none' }}
            onPointerDown={(ev) => startDrag(ev, 'shot', s.i, s.t, s.label ?? 'shot')}
          >
            🎥 {s.label ?? ('preset' in s.camera ? s.camera.preset : 'keys')}
          </span>
        ),
      )}
      {plan.events.map((e) => {
        const lane = KIND[e.type] ?? 'fx';
        const dragging = drag?.kind === 'event' && drag.index === e.i;
        const label = e.type === 'title' ? e.text : e.type === 'bubble' ? `💬 ${e.text}` : e.type;
        return (
          <span
            key={`e${e.i}`}
            className={`tl-marker ${lane}${dragging ? ' drag' : ''}`}
            style={{ left: (dragging ? drag.t : e.t) * pps, top: LANES[lane] + (e.i % 2) * 12 }}
            title={`${e.type} at ${typeof e.at === 'string' ? e.at : `${e.t.toFixed(2)}s`} (${e.t.toFixed(2)}s)`}
            onPointerDown={(ev) => startDrag(ev, 'event', e.i, e.t, label)}
          >
            {label}
          </span>
        );
      })}
      <div className="tl-head" style={{ left: t * pps }} />
    </div>
  );
}
