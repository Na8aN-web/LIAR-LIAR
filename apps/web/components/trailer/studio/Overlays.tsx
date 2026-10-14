'use client';

import { useMemo, type CSSProperties, type ReactNode } from 'react';
import { colorInfo, type ColorId } from '@wtc/shared';
import { WantedPoster } from '../../WantedPoster';
import { EyeIcon } from '../../ui/EyeIcon';
import { POSTER_H, POSTER_W } from '../../poster/posterArt';
import type { V3 } from '../paths';
import {
  isTall,
  SEARCH,
  TITLE_LAND,
  clamp01,
  easeInCubic,
  easeOutBack,
  easeOutCubic,
  lookAt,
  rng,
  smooth,
  typeDelay,
  type Format,
  type Ink,
  type Place,
  type Plan,
  type Resolved,
} from './script';

// Everything drawn over the 3D scene, in output pixels (W × H), as a pure function of the
// trailer time t. The studio scales this layer down to fit the preview; the renderer draws it
// at 1:1, so preview and the finished file match.

export interface Frame {
  W: number;
  H: number;
  format: Format;
  /** Grid unit: 1% of the frame's short side. */
  u: number;
  safe: { left: number; top: number; right: number; bottom: number };
}

export interface OverlayCtx {
  plan: Plan;
  t: number;
  frame: Frame;
  /** World point to frame pixels (null before the scene is up). */
  project: (p: V3) => { x: number; y: number; visible: boolean } | null;
  head: (id: string) => V3 | null;
  chest: (id: string) => V3 | null;
  colorOf: (id: string) => ColorId;
  nameOf: (id: string) => string;
  posterAt: V3 | null;
}

/** Title-safe area. 9:16 keeps clear of TikTok / Reels / Shorts captions (bottom) and buttons (right). */
export function makeFrame(W: number, H: number, format: Format): Frame {
  const u = Math.min(W, H) / 100;
  const safe =
    format === '9:16'
      ? { left: W * 0.06, right: W * 0.15, top: H * 0.1, bottom: H * 0.22 }
      : // 16:9, and 2:3 (portals' portrait previews: no app chrome over them).
        { left: W * 0.06, right: W * 0.06, top: H * 0.07, bottom: H * 0.08 };
  return { W, H, format, u, safe };
}

const INK: Record<Ink, CSSProperties> = {
  cream: { color: '#f6ead0', textShadow: '0 0.05em 0 #2a120a, 0 0.1em 0.25em rgba(0,0,0,0.75)' },
  brass: {
    color: 'transparent',
    backgroundImage: 'linear-gradient(180deg, #fff3c4 0%, #f0c35a 42%, #b07a24 70%, #6e4512 100%)',
    WebkitBackgroundClip: 'text',
    backgroundClip: 'text',
    // A shadow would show through the transparent letters; the drop-shadow filter does it instead.
    textShadow: 'none',
    filter: 'drop-shadow(0 0.05em 0 #2a120a) drop-shadow(0 0.08em 0.18em rgba(0,0,0,0.8))',
  },
  oxblood: {
    color: '#b3352b',
    textShadow: '0.03em 0 0 #f6ead0, -0.03em 0 0 #f6ead0, 0 0.03em 0 #f6ead0, 0 -0.03em 0 #f6ead0, 0 0.12em 0.25em rgba(0,0,0,0.8)',
  },
};

// ---------------------------------------------------------------- shared bits

/** A burst of dust puffs from a point, `age` seconds after impact. */
function Dust({ x, y, spread, age, seed, u, count = 16 }: { x: number; y: number; spread: number; age: number; seed: number; u: number; count?: number }) {
  if (age < 0 || age > 1.1) return null;
  const r = rng(seed);
  return (
    <>
      {Array.from({ length: count }, (_, i) => {
        const a = (i / count) * Math.PI * 2 + r() * 0.6;
        const speed = (0.6 + r()) * spread;
        const k = easeOutCubic(age / 0.9);
        const size = (6 + r() * 9) * u * (0.5 + k);
        const px = x + Math.cos(a) * speed * k;
        const py = y + Math.sin(a) * speed * k * 0.45 - k * 2 * u;
        return (
          <div
            key={i}
            className="ts-puff"
            style={{ left: px - size / 2, top: py - size / 2, width: size, height: size, opacity: (1 - age / 1.1) * 0.55 }}
          />
        );
      })}
    </>
  );
}

function fitSize(text: string, want: number, maxWidth: number, perChar = 0.8) {
  const longest = Math.max(4, ...text.split(/\s+/).map((w) => w.length));
  return Math.min(want, maxWidth / (longest * perChar));
}

/** Seconds into the event, and its length. */
const local = (e: Resolved, t: number) => ({ l: t - e.t, total: e.end - e.t });

// ---------------------------------------------------------------- titles

function Title({ e, c }: { e: Extract<Resolved, { type: 'title' }>; c: OverlayCtx }) {
  const { l, total } = local(e, c.t);
  const { u, safe, W, H } = c.frame;
  const how = e.in ?? 'slam';
  const exit = e.out ?? 'fade';
  const ink = e.color ?? (how === 'stamp' ? 'oxblood' : 'cream');
  const safeW = W - safe.left - safe.right;
  const font = how === 'type' ? 'var(--font-telegram), monospace' : 'var(--font-display), serif';
  // Stamps carry a border and a tilt, so they get less of the width.
  const fs = fitSize(e.text, (how === 'type' ? 7 : 11) * u * (e.size ?? 1), safeW * (how === 'stamp' ? 0.78 : 0.94), how === 'type' ? 0.62 : 0.8);
  const land = TITLE_LAND[how];

  // Entrance.
  let scale = 1;
  let x = 0;
  let opacity = 1;
  let rot = how === 'stamp' ? -5 : 0;
  if (how === 'slam') {
    const k = l / land;
    if (k < 1) {
      scale = 4 - 3 * easeInCubic(k);
      opacity = clamp01(k * 3);
    } else {
      const s = l - land;
      scale = 1 + 0.07 * Math.exp(-9 * s) * Math.cos(28 * s);
    }
  } else if (how === 'slide') {
    const from = e.from === 'right' ? 1 : -1;
    x = from * (1 - easeOutBack(l / land)) * W * 0.9;
  } else if (how === 'stamp') {
    const k = l / land;
    if (k < 1) {
      scale = 1.9 - 0.9 * easeInCubic(k);
      opacity = clamp01(k * 2);
      rot = -12 + 7 * k;
    }
  }
  // Exit.
  let burn = -1;
  if (exit === 'fade') opacity *= 1 - smooth((l - (total - 0.35)) / 0.35);
  if (exit === 'slide') x += easeInCubic((l - (total - 0.3)) / 0.3) * W * (e.from === 'right' ? -1.1 : 1.1);
  if (exit === 'burn' && l > total - 0.6) burn = clamp01((l - (total - 0.6)) / 0.6);
  if (opacity <= 0.001) return null;

  // Typewriter: characters so far.
  let shown = e.text;
  let caret = false;
  if (how === 'type') {
    let n = 0;
    let visible = 0;
    for (const ch of e.text) {
      if (ch.trim() && typeDelay(e.text, visible) > l) break;
      if (ch.trim()) visible++;
      n++;
    }
    shown = e.text.slice(0, n);
    caret = n < e.text.length || Math.floor(l * 2.5) % 2 === 0;
  }

  const pos = e.pos ?? 'center';
  const top: Record<Place, number> = {
    top: safe.top + 2 * u,
    upper: safe.top + (H - safe.top - safe.bottom) * 0.22,
    center: safe.top + (H - safe.top - safe.bottom) * 0.5,
    lower: safe.top + (H - safe.top - safe.bottom) * 0.72,
    bottom: H - safe.bottom - 2 * u,
  };
  const anchor = pos === 'top' ? '0%' : pos === 'bottom' ? '-100%' : '-50%';
  const subAge = l - land - 0.12;
  const burnMask = burn >= 0 ? `linear-gradient(to top, transparent ${burn * 115 - 15}%, #000 ${burn * 115}%)` : undefined;
  const isStamp = how === 'stamp';

  return (
    <div
      className="ts-title"
      style={{
        left: safe.left,
        width: safeW,
        top: top[pos],
        transform: `translate(${x}px, ${anchor}) scale(${scale}) rotate(${rot}deg)`,
        opacity,
        WebkitMaskImage: burnMask,
        maskImage: burnMask,
      }}
    >
      <div
        className={`ts-title-text${isStamp ? ' stamp' : ''}`}
        style={{
          fontFamily: font,
          fontSize: fs,
          ...INK[ink],
          ...(isStamp ? { borderColor: ink === 'oxblood' ? '#b3352b' : '#f6ead0', color: ink === 'oxblood' ? '#b3352b' : undefined } : null),
          ...(burn > 0 ? { filter: `drop-shadow(0 0 ${0.3 * fs * burn}px rgba(255,120,40,${0.9 * burn}))` } : null),
        }}
      >
        {shown}
        {how === 'type' && <span className="ts-caret" style={{ opacity: caret ? 1 : 0 }}>▌</span>}
      </div>
      {e.sub && subAge > 0 && (
        <div className="ts-title-sub" style={{ fontSize: Math.max(2.4 * u, fs * 0.26), opacity: smooth(subAge / 0.25) }}>
          {e.sub}
        </div>
      )}
      {burn > 0 && <Embers seed={e.i * 7 + 3} amount={burn} width={safeW} u={u} />}
      {how === 'slam' && <Dust x={safeW / 2} y={fs * 0.55} spread={safeW * 0.45} age={l - land} seed={e.i * 13 + 1} u={u} />}
    </div>
  );
}

function Embers({ seed, amount, width, u }: { seed: number; amount: number; width: number; u: number }) {
  const r = rng(seed);
  return (
    <>
      {Array.from({ length: 26 }, (_, i) => {
        const x0 = r() * width;
        const start = r() * 0.6;
        const k = clamp01((amount - start) / 0.4);
        if (k <= 0 || k >= 1) return null;
        const size = (0.5 + r()) * u;
        return <div key={i} className="ts-ember" style={{ left: x0 + Math.sin(k * 6 + i) * 2 * u, top: -k * 12 * u + 6 * u, width: size, height: size, opacity: 1 - k }} />;
      })}
    </>
  );
}

// ---------------------------------------------------------------- poster slam

function PosterSlam({ e, c }: { e: Extract<Resolved, { type: 'posterSlam' }>; c: OverlayCtx }) {
  const { l, total } = local(e, c.t);
  const { W, H, u } = c.frame;
  if (e.fullScreen === false) return null;
  const h = Math.min(H * 0.72, ((W * 0.82) / POSTER_W) * POSTER_H);
  const w = (h / POSTER_H) * POSTER_W;
  const LAND = 0.22;
  const settleFrom = total - 0.6;
  let scale = 1;
  let rot = -2;
  let opacity = 1;
  let cx = W / 2;
  let cy = H / 2;
  if (l < LAND) {
    const k = l / LAND;
    scale = 3.4 - 2.4 * easeInCubic(k);
    rot = -14 + 12 * k;
    opacity = clamp01(k * 4);
  } else if (l < settleFrom) {
    const s = l - LAND;
    scale = 1 + 0.05 * Math.exp(-8 * s) * Math.cos(26 * s);
  } else {
    // Onto the wall: shrink toward where the poster hangs in the town, and hand over to it.
    const k = smooth((l - settleFrom) / 0.6);
    const target = c.posterAt ? c.project(c.posterAt) : null;
    const tx = target?.visible ? target.x : W / 2;
    const ty = target?.visible ? target.y : H * 0.35;
    cx = W / 2 + (tx - W / 2) * k;
    cy = H / 2 + (ty - H / 2) * k;
    scale = 1 - 0.88 * k;
    opacity = 1 - smooth((k - 0.6) / 0.4);
  }
  const color = e.color ?? c.colorOf(c.plan.wantedId);
  return (
    <>
      <div className="ts-dim" style={{ opacity: (l < settleFrom ? clamp01(l / 0.15) : 1 - smooth((l - settleFrom) / 0.5)) * 0.55 }} />
      <div className="ts-poster" style={{ left: cx - w / 2, top: cy - h / 2, width: w, height: h, opacity, transform: `scale(${scale}) rotate(${rot}deg)` }}>
        <WantedPoster color={color} pot={e.pot ?? 100} className="ts-poster-svg" />
      </div>
      <Dust x={W / 2} y={H / 2 + h * 0.45} spread={w * 0.9} age={l - LAND} seed={e.i * 31 + 5} u={u} count={22} />
    </>
  );
}

// ---------------------------------------------------------------- search reveal

function Chip({ color, k, glow, dim, u }: { color: ColorId; k: number; glow: number; dim: boolean; u: number }) {
  const info = colorInfo(color);
  const s = easeOutBack(k);
  if (k <= 0) return <div className="ts-chip" style={{ visibility: 'hidden', fontSize: 2.2 * u }} />;
  return (
    <div
      className={`ts-chip${glow > 0 ? ' glow' : ''}`}
      style={{
        fontSize: 2.2 * u,
        transform: `scale(${s * (1 + 0.12 * glow)})`,
        opacity: dim ? 1 - 0.55 * glow : 1,
        boxShadow: glow > 0 ? `0 0 ${2.5 * u * glow}px ${0.6 * u * glow}px ${info.hex}, 0 0 0 ${0.35 * u}px rgba(255,240,200,${glow})` : undefined,
      }}
    >
      <i style={{ background: info.hex }} />
      <span>{info.name}</span>
    </div>
  );
}

export function searchChips(plan: Plan, e: Extract<Resolved, { type: 'searchReveal' }>, colorOf: (id: string) => ColorId): ColorId[][] {
  if (e.chips?.length) return e.chips;
  const target = plan.byRef(e.target)!;
  const real = colorOf(target);
  const pool = plan.cast.map((m) => colorOf(m.id)).filter((x) => x !== real);
  const r = rng(e.i * 97 + 11);
  const pick = (n: number, avoid: ColorId[]) => {
    const left = pool.filter((x) => !avoid.includes(x));
    const out: ColorId[] = [];
    while (out.length < n && left.length) out.push(left.splice(Math.floor(r() * left.length), 1)[0]);
    return out;
  };
  const shuffle = (a: ColorId[]) => a.map((x) => ({ x, k: r() })).sort((p, q) => p.k - q.k).map((p) => p.x);
  const first = pick(3, []);
  return [shuffle([real, ...first]), shuffle([real, ...pick(3, first)])];
}

function SearchReveal({ e, c }: { e: Extract<Resolved, { type: 'searchReveal' }>; c: OverlayCtx }) {
  const { l, total } = local(e, c.t);
  const { W, H, safe } = c.frame;
  // Bigger on tall frames: they're watched on phones.
  const u = c.frame.u * (isTall(c.frame.format) ? 1.35 : 1);
  const target = c.plan.byRef(e.target);
  const rows = useMemo(() => (target ? searchChips(c.plan, e, c.colorOf) : []), [target, e, c.plan, c.colorOf]);
  if (!target) return null;
  const real = c.colorOf(target);
  const out = 1 - smooth((l - (total - 0.4)) / 0.4);
  const cardIn = easeOutBack((l - 0.35) / 0.4);
  const second = SEARCH.second;
  const tapTimes = [SEARCH.tap, second];
  const pressDur = SEARCH.press - SEARCH.tap;
  const pressed = tapTimes.some((tt) => l >= tt + pressDur - 0.02 && l < tt + pressDur + 0.12);
  const left = l < SEARCH.press ? 3 : l < second + pressDur ? 2 : 1;
  const glowAt = second + 0.35 + 4 * SEARCH.chipStep + 0.1;
  const glow = smooth((l - glowAt) / 0.3) * (0.85 + 0.15 * Math.sin((l - glowAt) * 9));

  const cardW = Math.min(W - safe.left - safe.right, 66 * u);
  const cardH = 11 * u;
  const cardX = safe.left + (W - safe.left - safe.right - cardW) / 2;
  const cardY = H - safe.bottom - cardH - 2 * u + (1 - clamp01(cardIn)) * 16 * u;
  const btnX = cardX + cardW - 31 * u;
  const btnY = cardY + 2 * u;

  // Tap indicator: comes in, presses the button, lifts off.
  const tap = (() => {
    for (const tt of tapTimes) {
      const s = l - (tt - 0.25);
      if (s < 0 || s > 0.75) continue;
      const press = clamp01((s - 0.25) / pressDur);
      const lift = clamp01((s - 0.25 - pressDur - 0.1) / 0.25);
      return { s, ring: 1 - 0.35 * press + 0.2 * lift, opacity: clamp01(s / 0.15) * (1 - lift), ripple: s - 0.25 - pressDur };
    }
    return null;
  })();

  return (
    <div style={{ opacity: out }}>
      <div className="ts-card" style={{ left: cardX, top: cardY, width: cardW, height: cardH, fontSize: 3 * u }}>
        <span className="ts-card-name">{c.nameOf(target)}</span>
        {/* As in the game: a plain eye once they've been searched, never a count. */}
        <span className="ts-eye" style={{ fontSize: 2.2 * u, visibility: l < SEARCH.press ? 'hidden' : 'visible' }}>
          <EyeIcon />
        </span>
        <span className={`ts-search-btn${pressed ? ' pressed' : ''}`} style={{ left: btnX - cardX, width: 29 * u, height: cardH - 4 * u, fontSize: 2.3 * u }}>
          SEARCH · {left} LEFT
        </span>
      </div>
      {tap && (
        <>
          <div className="ts-tap" style={{ left: btnX + 14.5 * u - 3 * u * tap.ring, top: btnY + 3.5 * u - 3 * u * tap.ring, width: 6 * u * tap.ring, height: 6 * u * tap.ring, opacity: tap.opacity }} />
          {tap.ripple > 0 && tap.ripple < 0.5 && (
            <div
              className="ts-ripple"
              style={{ left: btnX + 14.5 * u - 6 * u * (0.5 + tap.ripple * 3), top: btnY + 3.5 * u - 6 * u * (0.5 + tap.ripple * 3), width: 12 * u * (0.5 + tap.ripple * 3), height: 12 * u * (0.5 + tap.ripple * 3), opacity: 1 - tap.ripple / 0.5 }}
            />
          )}
        </>
      )}
      {rows.map((row, ri) => {
        const start = ri === 0 ? SEARCH.chip0 : second + 0.35;
        if (l < start - 0.05) return null;
        const y = cardY - (rows.length - ri) * 6.2 * u - 1.5 * u;
        return (
          <div key={ri} className="ts-chip-row" style={{ left: safe.left, width: W - safe.left - safe.right, top: y, gap: 1.1 * u }}>
            <span className="ts-row-tag" style={{ fontSize: 1.7 * u }}>{ri === 0 ? '1st' : '2nd'}</span>
            {row.map((col, k) => (
              <Chip key={col} color={col} k={(l - start - k * SEARCH.chipStep) / 0.2} glow={col === real ? glow : 0} dim={col !== real} u={u} />
            ))}
          </div>
        );
      })}
      {glow > 0.05 && (
        <div className="ts-real-tag" style={{ left: safe.left, width: W - safe.left - safe.right, top: cardY - (rows.length + 1) * 6.2 * u, fontSize: Math.min(2.8 * u, (W - safe.left - safe.right) / 26), opacity: glow }}>
          Shows up every time. That&rsquo;s their real color.
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- bubbles, telegrams, stamps

function Bubble({ e, c }: { e: Extract<Resolved, { type: 'bubble' }>; c: OverlayCtx }) {
  const { l, total } = local(e, c.t);
  const id = c.plan.byRef(e.who);
  const h = id ? c.head(id) : null;
  const p = h ? c.project([h[0], h[1] + 0.85, h[2]]) : null;
  if (!p?.visible) return null;
  const { u, W, safe } = c.frame;
  const s = easeOutBack(l / 0.2) * (1 - smooth((l - (total - 0.2)) / 0.2));
  if (s <= 0.01) return null;
  const fs = 3.2 * u;
  const maxW = Math.min(46 * u, W - safe.left - safe.right);
  const x = Math.max(safe.left + maxW / 2, Math.min(W - safe.right - maxW / 2, p.x));
  return (
    <div className="ts-bubble-wrap" style={{ left: x - maxW / 2, top: Math.max(safe.top, p.y), width: maxW, transform: `translateY(-100%) scale(${s})`, transformOrigin: `${p.x - (x - maxW / 2)}px 100%` }}>
      <div className="ts-bubble" style={{ fontSize: fs }}>
        <b>{c.nameOf(id!)}</b> {e.text}
        <i className="ts-tail" style={{ left: Math.max(2 * u, Math.min(maxW - 4 * u, p.x - (x - maxW / 2))) - 1.5 * u, borderWidth: `${2 * u}px ${1.5 * u}px 0` }} />
      </div>
    </div>
  );
}

function Telegram({ e, c }: { e: Extract<Resolved, { type: 'telegram' }>; c: OverlayCtx }) {
  const { l, total } = local(e, c.t);
  const { u, W, safe } = c.frame;
  const w = Math.min(W - safe.left - safe.right, 74 * u);
  const y = (1 - easeOutBack(l / 0.45)) * -40 * u + easeInCubic((l - (total - 0.35)) / 0.35) * -45 * u;
  return (
    <div className="ts-telegram" style={{ left: safe.left + (W - safe.left - safe.right - w) / 2, top: safe.top + 2 * u + y, width: w, fontSize: 3.3 * u, padding: `${1.6 * u}px ${2.6 * u}px ${2 * u}px` }}>
      <div className="ts-telegram-head" style={{ fontSize: 1.7 * u }}>
        <span>WESTERN TELEGRAPH</span>
        <span>{e.tag ?? 'OFFER'}</span>
      </div>
      <b>{e.title}</b>
      {e.body && <span style={{ fontSize: 2.5 * u }}>{e.body}</span>}
    </div>
  );
}

function Stamp({ text, x, y, l, u, ink = 'oxblood', size = 1, seed }: { text: string; x: number; y: number; l: number; u: number; ink?: Ink; size?: number; seed: number }) {
  if (l < 0) return null;
  const k = clamp01(l / 0.13);
  const scale = (2.4 - 1.4 * easeInCubic(k)) * size;
  return (
    <>
      <div className={`ts-stamp ${ink}`} style={{ left: x, top: y, fontSize: 9 * u, opacity: clamp01(k * 2), transform: `translate(-50%, -50%) rotate(-9deg) scale(${scale})` }}>
        {text}
      </div>
      <Dust x={x} y={y} spread={14 * u} age={l - 0.13} seed={seed} u={u} count={12} />
    </>
  );
}

function anchorOf(c: OverlayCtx, ref: string | undefined) {
  const id = c.plan.byRef(ref);
  const chest = id ? c.chest(id) : null;
  const p = chest ? c.project(chest) : null;
  return p?.visible ? p : { x: c.frame.W / 2, y: c.frame.H / 2, visible: true };
}

function StampEvent({ e, c }: { e: Extract<Resolved, { type: 'stamp' }>; c: OverlayCtx }) {
  const { l, total } = local(e, c.t);
  const p = anchorOf(c, e.on);
  return (
    <div style={{ opacity: 1 - smooth((l - (total - 0.3)) / 0.3) }}>
      <Stamp text={e.text} x={p.x} y={p.y} l={l} u={c.frame.u} ink={e.color} seed={e.i * 17} />
    </div>
  );
}

function Vote({ e, c }: { e: Extract<Resolved, { type: 'vote' }>; c: OverlayCtx }) {
  const { l, total } = local(e, c.t);
  const { u, W, H, safe } = c.frame;
  const target = c.plan.byRef(e.target);
  const panelIn = easeOutBack((l - 0.15) / 0.4) * (1 - easeInCubic((l - 2.2) / 0.35));
  const w = Math.min(W - safe.left - safe.right, 76 * u);
  const pick = Math.floor(clamp01((l - 0.5) / 0.9) * 6);
  const order = c.plan.cast.filter((m) => m.id !== c.plan.cast[0].id).map((m) => m.id);
  const pointer = l < 1.4 ? order[pick % order.length] : target;
  const stampL = l - 1.55;
  const p = anchorOf(c, e.target);
  return (
    <div style={{ opacity: 1 - smooth((l - (total - 0.3)) / 0.3) }}>
      {panelIn > 0.01 && (
        <div className="ts-vote" style={{ left: safe.left + (W - safe.left - safe.right - w) / 2, top: H - safe.bottom - 22 * u + (1 - panelIn) * 30 * u, width: w, fontSize: 2.6 * u }}>
          <div className="ts-vote-head" style={{ fontSize: 5 * u }}>{e.title ?? 'NAME THE OUTLAW'}</div>
          <div className="ts-vote-names" style={{ gap: 1 * u }}>
            {order.slice(0, 6).map((id) => (
              <span key={id} className={id === pointer ? 'on' : ''} style={{ padding: `${0.8 * u}px ${1.6 * u}px` }}>
                {c.nameOf(id)}
              </span>
            ))}
          </div>
        </div>
      )}
      <Stamp text="ACCUSED" x={p.x} y={p.y} l={stampL} u={u} seed={e.i * 19} />
    </div>
  );
}

// ---------------------------------------------------------------- payout, escape, color change, freeze

function Payout({ e, c }: { e: Extract<Resolved, { type: 'payout' }>; c: OverlayCtx }) {
  const { l, total } = local(e, c.t);
  const { u, W, H, safe } = c.frame;
  const amount = e.amount ?? 100;
  const shown = Math.round(amount * easeOutCubic((l - 0.15) / 1.1));
  const out = 1 - smooth((l - (total - 0.35)) / 0.35);
  const r = rng(e.i * 41 + 9);
  const cx = W / 2;
  const cy = safe.top + (H - safe.top - safe.bottom) * 0.42;
  const coins = Array.from({ length: 42 }, () => ({ a: -Math.PI / 2 + (r() - 0.5) * 2.4, v: (40 + r() * 70) * u, spin: 4 + r() * 10, delay: r() * 0.25, size: (3 + r() * 2.5) * u }));
  return (
    <div style={{ opacity: out }}>
      {coins.map((co, i) => {
        const s = l - co.delay;
        if (s < 0 || s > 2.2) return null;
        const x = cx + Math.cos(co.a) * co.v * s;
        const y = cy + Math.sin(co.a) * co.v * s + 0.5 * 140 * u * s * s;
        return <div key={i} className="ts-coin" style={{ left: x - co.size / 2, top: y - co.size / 2, width: co.size, height: co.size, transform: `scaleX(${Math.cos(s * co.spin)})` }} />;
      })}
      <div className="ts-bounty" style={{ left: safe.left, width: W - safe.left - safe.right, top: cy - 10 * u, transform: `scale(${easeOutBack(l / 0.3)})` }}>
        <div style={{ fontSize: 3.2 * u, letterSpacing: '0.3em' }}>{e.label ?? 'BOUNTY CLAIMED'}</div>
        <div className="ts-bounty-num" style={{ fontSize: 16 * u, ...INK.brass }}>${shown}</div>
      </div>
    </div>
  );
}

function Escape({ e, c }: { e: Extract<Resolved, { type: 'escape' }>; c: OverlayCtx }) {
  const { l, total } = local(e, c.t);
  const p = anchorOf(c, e.who ?? c.plan.wantedId);
  return (
    <div style={{ opacity: 1 - smooth((l - (total - 0.3)) / 0.3) }}>
      <Stamp text="ESCAPED" x={p.x} y={p.y - 4 * c.frame.u} l={l} u={c.frame.u} ink="brass" seed={e.i * 23} />
    </div>
  );
}

function ColorFlash({ e, c }: { e: Extract<Resolved, { type: 'colorChange' }>; c: OverlayCtx }) {
  const { l } = local(e, c.t);
  if (l > 0.9) return null;
  const p = anchorOf(c, e.who);
  const { u } = c.frame;
  const id = c.plan.byRef(e.who);
  const hex = id ? colorInfo(c.colorOf(id)).hex : '#fff';
  const k = clamp01(l / 0.9);
  const ring = 4 * u + easeOutCubic(k) * 22 * u;
  const r = rng(e.i * 53 + 7);
  return (
    <>
      <div className="ts-flash-ring" style={{ left: p.x - ring, top: p.y - ring, width: ring * 2, height: ring * 2, borderColor: hex, borderWidth: (1 - k) * 1.6 * u, opacity: 1 - k }} />
      <div className="ts-flash-core" style={{ left: p.x - 9 * u, top: p.y - 9 * u, width: 18 * u, height: 18 * u, opacity: Math.max(0, 1 - Math.abs(l - 0.25) / 0.2) }} />
      {Array.from({ length: 10 }, (_, i) => {
        const a = (i / 10) * Math.PI * 2 + r();
        const d = easeOutCubic(k) * (12 + r() * 10) * u;
        const s = (1 + r()) * u;
        return <div key={i} className="ts-spark" style={{ left: p.x + Math.cos(a) * d - s / 2, top: p.y + Math.sin(a) * d - s / 2, width: s, height: s, background: hex, opacity: 1 - k }} />;
      })}
    </>
  );
}

function Freeze({ e, c }: { e: Extract<Resolved, { type: 'freeze' }>; c: OverlayCtx }) {
  const { l, total } = local(e, c.t);
  const id = c.plan.byRef(e.who);
  const h = id ? c.head(id) : null;
  const p = h ? c.project(h) : null;
  const { u, W, safe } = c.frame;
  const out = 1 - smooth((l - (total - 0.15)) / 0.15);
  const flash = Math.max(0, 1 - l / 0.12) * 0.5;
  if (!p?.visible) return <div className="ts-flash" style={{ background: '#fff', opacity: flash }} />;
  const right = p.x < W * 0.55;
  const labelX = right ? Math.min(W - safe.right - 30 * u, p.x + 9 * u) : Math.max(safe.left, p.x - 9 * u - 34 * u);
  const labelY = p.y - 6 * u;
  const k = clamp01((l - 0.35) / 0.12);
  return (
    <>
      <div className="ts-flash" style={{ background: '#fff', opacity: flash }} />
      {l > 0.35 && (
        <div style={{ opacity: out }}>
          <svg className="ts-callout-line" width={W} height={c.frame.H}>
            <line x1={p.x} y1={p.y} x2={right ? labelX : labelX + 34 * u} y2={labelY + 3 * u} stroke="#f6ead0" strokeWidth={0.4 * u} strokeDasharray={`${1.2 * u} ${0.8 * u}`} />
            <circle cx={p.x} cy={p.y} r={1.1 * u} fill="none" stroke="#f6ead0" strokeWidth={0.4 * u} />
          </svg>
          <div className="ts-callout" style={{ left: labelX, top: labelY, fontSize: 3.6 * u, opacity: clamp01(k * 2), transform: `scale(${2 - easeInCubic(k)}) rotate(-3deg)` }}>
            {e.label}
          </div>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------- film effects, end card

const GRAIN: string[] = [];
function grainTiles(): string[] {
  if (GRAIN.length || typeof document === 'undefined') return GRAIN;
  const r = rng(42);
  for (let v = 0; v < 6; v++) {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 256;
    const ctx = cv.getContext('2d')!;
    const img = ctx.createImageData(256, 256);
    for (let i = 0; i < img.data.length; i += 4) {
      const g = Math.floor(r() * 255);
      img.data[i] = img.data[i + 1] = img.data[i + 2] = g;
      img.data[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    GRAIN.push(cv.toDataURL('image/png'));
  }
  return GRAIN;
}

function Effects({ c }: { c: OverlayCtx }) {
  const { W, H, u } = c.frame;
  const look = lookAt(c.plan, c.t);
  const f = Math.round(c.t * c.plan.fps);
  const r = rng(f * 7 + 1);
  const tiles = look.grain > 0 ? grainTiles() : [];
  const flashes: ReactNode[] = [];
  const dusts: ReactNode[] = [];
  for (const e of c.plan.events) {
    if (c.t < e.t || c.t >= e.end) continue;
    const { l, total } = local(e, c.t);
    if (e.type === 'flash') {
      const k = l < 0.03 ? l / 0.03 : 1 - (l - 0.03) / Math.max(0.01, total - 0.03);
      flashes.push(<div key={e.i} className="ts-flash" style={{ background: e.color === 'black' ? '#000' : '#fff', opacity: clamp01(k) }} />);
    }
    if (e.type === 'dust') {
      const rr = rng(e.i * 61 + 3);
      const p = l / total;
      dusts.push(
        <div key={e.i} className="ts-dust" style={{ opacity: Math.sin(Math.PI * clamp01(p)) }}>
          {Array.from({ length: 18 }, (_, i) => {
            const y = rr() * H;
            const size = (45 + rr() * 50) * u;
            const x = -size + (W + size * 2) * clamp01(p * (0.9 + rr() * 0.5) - rr() * 0.2);
            return <div key={i} className="ts-puff big" style={{ left: x - size / 2, top: y - size / 2, width: size, height: size }} />;
          })}
        </div>,
      );
    }
  }
  const bar = look.letterbox * H;
  return (
    <>
      {look.vignette > 0 && <div className="ts-vignette" style={{ opacity: look.vignette }} />}
      {look.grain > 0 && tiles.length > 0 && (
        <div className="ts-grain" style={{ backgroundImage: `url(${tiles[f % tiles.length]})`, backgroundPosition: `${Math.floor(r() * 256)}px ${Math.floor(r() * 256)}px`, backgroundSize: `${Math.max(128, 2.4 * u * 10)}px`, opacity: look.grain }} />
      )}
      {dusts}
      {bar > 0.5 && (
        <>
          <div className="ts-bar" style={{ top: 0, height: bar }} />
          <div className="ts-bar" style={{ bottom: 0, height: bar }} />
        </>
      )}
      {flashes}
    </>
  );
}

function EndCard({ e, c }: { e: Extract<Resolved, { type: 'endCard' }>; c: OverlayCtx }) {
  const { l } = local(e, c.t);
  const { u, W, H, safe, format } = c.frame;
  const card = c.plan.endCard;
  const tall = isTall(format);
  const titleSize = fitSize(card.title.toUpperCase(), (tall ? 19 : 17) * u, (W - safe.left - safe.right) * 0.95, 0.85);
  const k = clamp01(l / 0.18);
  const scale = l < 0.18 ? 2.6 - 1.6 * easeInCubic(k) : 1 + 0.04 * Math.exp(-8 * (l - 0.18)) * Math.cos(26 * (l - 0.18));
  const fade = (d: number) => ({ opacity: smooth((l - d) / 0.35), transform: `translateY(${(1 - easeOutCubic((l - d) / 0.45)) * 3 * u}px)` });
  return (
    <div className="ts-end" style={{ opacity: smooth(l / 0.3) }}>
      <div className="ts-end-inner" style={{ top: safe.top, bottom: safe.bottom, left: safe.left, right: safe.right, gap: (tall ? 2.2 : 1.6) * u }}>
        <div style={{ transform: `scale(${scale})`, opacity: clamp01(k * 2) }}>
          <div className="ts-end-title" style={{ fontSize: titleSize, ...INK.brass }}>{card.title.toUpperCase()}</div>
          <div className="ts-end-sub" style={{ fontSize: titleSize * 0.42, ...INK.cream }}>{card.subtitle}</div>
        </div>
        <div className="ts-end-tagline" style={{ fontSize: 3.6 * u, ...fade(0.45) }}>{card.tagline}</div>
        <div className="ts-end-url" style={{ fontSize: 3.4 * u, ...fade(0.7) }}>{card.url}</div>
        {card.discord && <div className="ts-end-line" style={{ fontSize: 2.6 * u, ...fade(0.85) }}>Discord: {card.discord}</div>}
        <div className="ts-end-credit" style={{ fontSize: 2.2 * u, ...fade(1.05) }}>{card.credit}</div>
      </div>
      <Dust x={W / 2} y={safe.top + (H - safe.top - safe.bottom) * 0.32} spread={W * 0.4} age={l - 0.18} seed={e.i * 71} u={u} count={20} />
    </div>
  );
}

// ---------------------------------------------------------------- the layer

export function SafeZones({ frame }: { frame: Frame }) {
  const { safe, W, H, format } = frame;
  return (
    <div className="ts-safe" aria-hidden>
      <div style={{ left: safe.left, top: safe.top, width: W - safe.left - safe.right, height: H - safe.top - safe.bottom }} />
      {format === '9:16' && (
        <>
          <span className="ts-safe-zone" style={{ left: 0, right: 0, bottom: 0, height: safe.bottom }}>captions</span>
          <span className="ts-safe-zone" style={{ right: 0, top: H * 0.35, width: safe.right, bottom: safe.bottom }}>buttons</span>
          <span className="ts-safe-zone" style={{ left: 0, right: 0, top: 0, height: safe.top }}>top bar</span>
        </>
      )}
    </div>
  );
}

export function Overlays({ c }: { c: OverlayCtx }) {
  const { t, plan } = c;
  const items: ReactNode[] = [];
  for (const e of plan.events) {
    if (t < e.t || t >= e.end) continue;
    const key = `${e.type}-${e.i}`;
    switch (e.type) {
      case 'title':
        items.push(<Title key={key} e={e} c={c} />);
        break;
      case 'posterSlam':
        items.push(<PosterSlam key={key} e={e} c={c} />);
        break;
      case 'searchReveal':
        items.push(<SearchReveal key={key} e={e} c={c} />);
        break;
      case 'bubble':
        items.push(<Bubble key={key} e={e} c={c} />);
        break;
      case 'telegram':
        items.push(<Telegram key={key} e={e} c={c} />);
        break;
      case 'vote':
        items.push(<Vote key={key} e={e} c={c} />);
        break;
      case 'stamp':
        items.push(<StampEvent key={key} e={e} c={c} />);
        break;
      case 'payout':
        items.push(<Payout key={key} e={e} c={c} />);
        break;
      case 'escape':
        items.push(<Escape key={key} e={e} c={c} />);
        break;
      case 'colorChange':
        items.push(<ColorFlash key={key} e={e} c={c} />);
        break;
      case 'freeze':
        items.push(<Freeze key={key} e={e} c={c} />);
        break;
      case 'endCard':
        items.push(<EndCard key={key} e={e} c={c} />);
        break;
    }
  }
  return (
    <>
      {items}
      <Effects c={c} />
    </>
  );
}

/** How hard the camera shakes at t: explicit shakes plus every slam and stamp landing. */
export function shakeAt(plan: Plan, t: number): number {
  let s = 0;
  const hit = (at: number, strength: number, len = 0.35) => {
    const d = t - at;
    if (d >= 0 && d < len) s = Math.max(s, strength * (1 - d / len) ** 2);
  };
  for (const e of plan.events) {
    if (e.type === 'shake' && t >= e.t && t < e.end) s = Math.max(s, (e.strength ?? 0.6) * (1 - (t - e.t) / (e.end - e.t)));
    if (e.type === 'title' && (e.in ?? 'slam') === 'slam') hit(e.t + TITLE_LAND.slam, 0.55);
    if (e.type === 'title' && e.in === 'stamp') hit(e.t + TITLE_LAND.stamp, 0.3, 0.25);
    if (e.type === 'posterSlam') hit(e.t + 0.22, 0.7, 0.4);
    if (e.type === 'vote') hit(e.t + 1.55 + 0.13, 0.6);
    if (e.type === 'stamp' || e.type === 'escape') hit(e.t + 0.13, 0.45);
    if (e.type === 'endCard') hit(e.t + 0.18, 0.5);
  }
  return s;
}

/** Desaturation of the scene at t (freeze frames). */
export function desatAt(plan: Plan, t: number): number {
  let d = 0;
  for (const e of plan.events) {
    if (e.type !== 'freeze' || t < e.t || t >= e.end) continue;
    const l = t - e.t;
    d = Math.max(d, Math.min(clamp01(l / 0.12), 1 - clamp01((l - (e.end - e.t - 0.15)) / 0.15)));
  }
  return d;
}
