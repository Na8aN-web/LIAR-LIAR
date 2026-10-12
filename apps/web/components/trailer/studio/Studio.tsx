'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import dynamic from 'next/dynamic';
import { advance, useThree, type RootState } from '@react-three/fiber';
import { useProgress } from '@react-three/drei';
import {
  DEFAULT_SETTINGS,
  ITEM_TYPES,
  NO_COSMETIC,
  colorInfo,
  randomCosmetics,
  type ColorId,
  type InspectLogEntry,
  type PlayerView,
  type Reaction,
} from '@wtc/shared';
import { useGame } from '@/lib/store';
import { SEATED_HEIGHT } from '../../scene/Scarecrow';
import type { SceneTrailer } from '../../scene/Scene';
import { ringRadius } from '../../scene/town/Town';
import type { CamPath, V3 } from '../paths';
import { sampleShot, shotPath, type CamWorld, type SeatInfo } from './cameras';
import { Overlays, SafeZones, desatAt, makeFrame, shakeAt, type OverlayCtx } from './Overlays';
import { SEARCH, compile, parseScript, sceneTimeAt, smooth, type Format, type Plan, type TrailerScript } from './script';
import { analyseMusic, musicUrl, playCue, renderSoundtrack, type MusicInfo } from './sound';
import { StudioRig, type FrameCam, type StudioRigApi } from './StudioRig';
import { Timeline } from './Timeline';
import './studio.css';

// The trailer studio (dev builds only, /dev/trailer/studio): plays a trailer script on the real
// game scene. Preview runs in real time; the renderer (tools/render-trailer.mjs) opens the same
// page with ?render=1 and steps it one frame at a time at the output resolution. See TRAILER.md.

const Scene = dynamic(() => import('../../scene/Scene'), { ssr: false });

type Res = '1080p' | '4K';
type Layer = 'full' | 'scene' | 'overlay';

export function outputSize(format: Format, res: Res | string): { W: number; H: number } {
  const m = /^(\d+)x(\d+)$/.exec(res);
  if (m) return { W: Number(m[1]), H: Number(m[2]) };
  const long = res === '4K' ? 3840 : 1920;
  const short = res === '4K' ? 2160 : 1080;
  return format === '9:16' ? { W: short, H: long } : { W: long, H: short };
}

interface Params {
  script: string;
  render: boolean;
  format: Format | null;
  res: string;
  layer: Layer;
}

function readParams(): Params {
  const q = new URLSearchParams(typeof location === 'undefined' ? '' : location.search);
  const f = q.get('format');
  const layer = q.get('layer');
  return {
    script: q.get('script') ?? 'main',
    render: q.get('render') === '1',
    format: f === '9x16' || f === '9:16' ? '9:16' : f === '16x9' || f === '16:9' ? '16:9' : null,
    res: q.get('res') ?? '1080p',
    layer: layer === 'scene' || layer === 'overlay' ? layer : 'full',
  };
}

// ---------------------------------------------------------------- the made-up game at time t

interface GameAt {
  view: PlayerView;
  colors: Record<string, ColorId>;
  sig: string;
}

function gameAt(plan: Plan, t: number): GameAt {
  const colors: Record<string, ColorId> = Object.fromEntries(plan.cast.map((c) => [c.id, c.color]));
  let posterIndex = -1;
  let posterColor: ColorId | null = null;
  let pot = 100;
  let reactions: { key: string; byPlayer: Record<string, Reaction> } | null = null;
  const log: InspectLogEntry[] = [];
  const wanted = plan.wantedId;
  const despair = (i: number): Reaction => (i % 2 ? 'despair-1' : 'despair-2');
  for (const e of plan.events) {
    if (e.type === 'colorChange' && t >= e.t + 0.25) {
      const id = plan.byRef(e.who);
      if (id) {
        const taken = new Set(Object.values(colors));
        colors[id] = e.to ?? (['purple', 'cyan', 'magenta', 'lime', 'sky', 'white', 'maroon'] as ColorId[]).find((c) => !taken.has(c)) ?? colors[id];
      }
    }
    // The town's poster changes when the slammed poster lands on the wall.
    if (e.type === 'posterSlam' && t >= e.end - 0.15) {
      posterIndex++;
      posterColor = e.color ?? colors[wanted];
      pot = e.pot ?? 100;
      reactions = null;
    }
    const all = (fn: (id: string, i: number) => Reaction) => Object.fromEntries(plan.cast.map((c, i) => [c.id, fn(c.id, i)]));
    if (t >= e.t) {
      if (e.type === 'caught' || (e.type === 'payout' && !reactions)) reactions = { key: `e${e.i}`, byPlayer: all((id, i) => (id === wanted ? despair(i) : 'victory')) };
      if (e.type === 'escape') {
        const who = plan.byRef(e.who) ?? wanted;
        reactions = { key: `e${e.i}`, byPlayer: all((id, i) => (id === who ? 'victory' : despair(i))) };
      }
      if (e.type === 'react') {
        const who = plan.byRef(e.who);
        if (who) reactions = { key: `e${e.i}`, byPlayer: { [who]: e.reaction } };
      }
    }
    if (e.type === 'search' && t >= e.t) log.push({ id: `l${e.i}`, poster: Math.max(0, posterIndex), inspectorId: plan.byRef(e.searcher)!, targetId: plan.byRef(e.target)!, at: e.t * 1000 });
    if (e.type === 'searchReveal') {
      const target = plan.byRef(e.target)!;
      const searcher = plan.byRef(e.searcher) ?? plan.cast[0].id;
      for (const [k, at] of [SEARCH.press, SEARCH.second + SEARCH.press - SEARCH.tap].entries()) {
        if (t >= e.t + at) log.push({ id: `l${e.i}-${k}`, poster: Math.max(0, posterIndex), inspectorId: searcher, targetId: target, at: (e.t + at) * 1000 });
      }
    }
  }
  const you = plan.cast[0];
  const view = {
    code: 'TRAIL',
    serverNow: t * 1000,
    devMode: true,
    minPlayers: 6,
    maxPlayers: 15,
    you: { id: you.id, name: you.name, color: colors[you.id], item: ITEM_TYPES[0], isHost: true },
    players: plan.cast.map((c, i) => {
      let s = 3042 + i * 977;
      const cos = randomCosmetics((k) => {
        s = (s * 1103515245 + 12345) & 0x7fffffff;
        return s % k;
      });
      return {
        id: c.id,
        name: c.name,
        item: ITEM_TYPES[i % ITEM_TYPES.length],
        cosmetics: c.hatless ? { ...cos, hat: NO_COSMETIC } : cos,
        seat: i,
        isHost: i === 0,
        isBot: false,
        connected: true,
        away: false,
      };
    }),
    settings: DEFAULT_SETTINGS,
    phase: posterIndex < 0 ? 'lobby' : reactions ? 'payout' : 'investigation',
    phaseEndsAt: null,
    game:
      posterIndex < 0
        ? null
        : {
            posterIndex,
            posterCount: 9,
            posterColor: posterColor!,
            pot,
            youAreWanted: false,
            inspectLimit: 3,
            extraInspects: 0,
            inspectsUsed: 0,
            purchasesUsed: 0,
            log,
            myResults: {},
            boughtEntryIds: [],
            offersOut: [],
            offersIn: [],
            colorChanges: [],
            swapLimit: 0,
            swapsUsed: 0,
            swappedThisPayout: false,
            myColorHistory: [],
            myVote: null,
            votesCast: 0,
            scores: {},
            scoreDeltas: {},
            myScore: 100,
            myCorrectVotes: 0,
            myHeldEscapeBonus: 0,
            myRounds: [],
            reactions,
          },
    replay: null,
    practice: false,
    locked: false,
    room: { name: 'Trailer', visibility: 'private', autoFill: { enabled: false, afterSec: 120 }, fillOfferAt: null },
  } as unknown as PlayerView;
  const sig = JSON.stringify([posterIndex, posterColor, pot, reactions?.key, log.length, colors]);
  return { view, colors, sig };
}

/** Scarecrow opacity: the escaped outlaw fades into the fog until the next poster lands. */
function fadesAt(plan: Plan, t: number): Record<string, number> {
  const out: Record<string, number> = Object.fromEntries(plan.cast.map((c) => [c.id, 1]));
  for (const e of plan.events) {
    if (e.type === 'posterSlam' && t >= e.end) for (const k of Object.keys(out)) out[k] = 1;
    if (e.type === 'escape' && t >= e.t) {
      const id = plan.byRef(e.who) ?? plan.wantedId;
      out[id] = 1 - smooth((t - e.t - 0.5) / 1.6);
    }
  }
  return out;
}

// ---------------------------------------------------------------- page

export function Studio() {
  const [params] = useState(readParams);
  const render = params.render;
  const [scriptName, setScriptName] = useState(params.script);
  const [scripts, setScripts] = useState<string[]>([]);
  const [script, setScript] = useState<TrailerScript | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const mtime = useRef<string | null>(null);
  const [formatPick, setFormatPick] = useState<Format | null>(params.format);
  const [res, setRes] = useState<string>(render ? params.res : '1080p');
  const [safeOn, setSafeOn] = useState(true);
  const [shadows, setShadows] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [ui, setUi] = useState(true);
  const [t, setT] = useState(0);
  const [music, setMusic] = useState<MusicInfo | null>(null);
  const [seats, setSeats] = useState<Map<string, SeatInfo>>(new Map());
  const rig = useRef<StudioRigApi | null>(null);
  const rootState = useRef<RootState | null>(null);
  const frameCam = useRef<FrameCam | null>(null);
  const fades = useRef<Record<string, number>>({});
  const tRef = useRef(0);
  const lastScene = useRef(0);
  const sig = useRef('');
  const audioEl = useRef<HTMLAudioElement | null>(null);
  const [colors, setColors] = useState<Record<string, ColorId>>({});
  const [posterAt, setPosterAt] = useState<V3 | null>(null);

  // ---------------------------------------------------------------- script loading (+ live reload)
  const load = useCallback(
    async (name: string, quiet = false) => {
      try {
        const r = await fetch(`/dev/trailer/api/script?name=${encodeURIComponent(name)}`, { cache: 'no-store' });
        if (!r.ok) throw new Error(`${name}.json: ${r.status === 404 ? 'not found in trailers/' : r.statusText}`);
        const m = r.headers.get('x-mtime');
        if (quiet && m === mtime.current) return;
        mtime.current = m;
        setScript(parseScript(await r.text()));
        setLoadError(null);
      } catch (err) {
        setLoadError((err as Error).message);
      }
    },
    [],
  );
  useEffect(() => {
    void load(scriptName);
    if (render) return;
    const id = setInterval(() => void load(scriptName, true), 1500);
    return () => clearInterval(id);
  }, [scriptName, load, render]);
  useEffect(() => {
    if (render) return;
    fetch('/dev/trailer/api/scripts', { cache: 'no-store' })
      .then((r) => r.json())
      .then((l: string[]) => setScripts(l))
      .catch(() => {});
  }, [render]);

  const plan = useMemo(() => (script ? compile(script) : null), [script]);
  const format: Format = formatPick ?? script?.format ?? '16:9';
  const { W, H } = outputSize(format, res);
  const frame = useMemo(() => makeFrame(W, H, format), [W, H, format]);

  useEffect(() => {
    if (!plan?.script.music?.file || render) return setMusic(null);
    let live = true;
    analyseMusic(plan.script.music.file)
      .then((m) => live && setMusic(m))
      .catch(() => live && setMusic(null));
    return () => {
      live = false;
    };
  }, [plan?.script.music?.file, render]);

  // ---------------------------------------------------------------- stage size
  const area = useRef<HTMLDivElement>(null);
  const [areaSize, setAreaSize] = useState({ w: 1280, h: 720 });
  useEffect(() => {
    if (render) return;
    const el = area.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setAreaSize({ w: el.clientWidth - 24, h: el.clientHeight - 24 }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [render, ui]);
  const stage = render ? { w: W, h: H } : (() => {
    const k = Math.min(areaSize.w / W, areaSize.h / H);
    return { w: Math.max(1, Math.round(W * k)), h: Math.max(1, Math.round(H * k)) };
  })();
  const scale = stage.w / W;

  // ---------------------------------------------------------------- camera
  const radius = Math.max(3.2, (plan?.cast.length ?? 8) * 0.42);
  const ringR = ringRadius(radius);
  const world: CamWorld = useMemo(() => ({ radius, ringR, seats, poster: posterAt }), [radius, ringR, seats, posterAt]);
  const seatOf = useCallback((ref?: string) => (plan && ref ? (seats.get(plan.byRef(ref) ?? '') ?? null) : null), [plan, seats]);
  const paths = useMemo(() => {
    if (!plan) return [] as CamPath[];
    return plan.shots.map((s) => {
      const dur = sceneTimeAt(plan, s.end) - sceneTimeAt(plan, s.t);
      const spec = format === '9:16' && s.vertical ? s.vertical : s.camera;
      return shotPath(spec, world, dur, format, seatOf, format === '9:16' && !!s.vertical && 'keys' in s.vertical);
    });
  }, [plan, world, format, seatOf]);
  const revealPaths = useMemo(() => {
    const out = new Map<number, CamPath>();
    if (!plan) return out;
    for (const e of plan.events) if (e.type === 'searchReveal' && e.camera !== false) out.set(e.i, shotPath({ preset: 'pushIn', target: e.target }, world, 1.3, format, seatOf));
    return out;
  }, [plan, world, format, seatOf]);

  const camAt = useCallback(
    (time: number): FrameCam | null => {
      if (!plan || !paths.length) return null;
      const st = sceneTimeAt(plan, time);
      let s = plan.shots.findIndex((x) => time >= x.t && time < x.end);
      if (s < 0) s = time < plan.shots[0].t ? 0 : plan.shots.length - 1;
      let sample = sampleShot(paths[s], st - sceneTimeAt(plan, plan.shots[s].t));
      for (const e of plan.events) {
        const p = revealPaths.get(e.i);
        if (p && time >= e.t && time < e.end) sample = sampleShot(p, sceneTimeAt(plan, time) - sceneTimeAt(plan, e.t));
      }
      return { p: sample.p, t: sample.t, fov: sample.fov, shake: shakeAt(plan, time), time };
    },
    [plan, paths, revealPaths],
  );

  // ---------------------------------------------------------------- one frame
  const renderFrame = useCallback(
    /** draw = false: simulate only (the renderer fast-forwarding to its chunk), no pixels. */
    (time: number, exact: boolean, draw = true) => {
      if (!plan) return;
      const g = gameAt(plan, time);
      if (g.sig !== sig.current) {
        sig.current = g.sig;
        flushSync(() => {
          useGame.getState().setView(g.view);
          setColors(g.colors);
        });
      }
      frameCam.current = camAt(time);
      fades.current = fadesAt(plan, time);
      const st = sceneTimeAt(plan, time);
      const state = rootState.current;
      if (state) {
        // Exact (render): the clock follows the timeline. Preview scrubbing: no time jumps.
        const delta = st - lastScene.current;
        if (!exact && (delta < 0 || delta > 0.1)) state.clock.elapsedTime = st;
        lastScene.current = st;
        if (draw) advance(st, true, state);
        else {
          // Everything that moves runs in useFrame; skip only the drawing.
          const real = state.gl.render;
          state.gl.render = () => {};
          try {
            advance(st, true, state);
          } finally {
            state.gl.render = real;
          }
        }
      }
      tRef.current = time;
      if (draw) flushSync(() => setT(time));
    },
    [plan, camAt],
  );

  // Find the poster on the wall once the town is up (for the poster slam and its camera move).
  useEffect(() => {
    if (posterAt) return;
    const id = setInterval(() => {
      const p = rig.current?.find('wanted-poster');
      if (p) setPosterAt(p);
    }, 300);
    return () => clearInterval(id);
  }, [posterAt]);

  // ---------------------------------------------------------------- preview loop
  const startedAt = useRef<{ wall: number; t: number } | null>(null);
  useEffect(() => {
    if (render || !plan) return;
    let raf = 0;
    let prev = tRef.current;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      let time = tRef.current;
      if (playing) {
        const a = audioEl.current;
        const start = plan.script.music?.start ?? 0;
        if (a && !a.paused && a.readyState >= 2) time = a.currentTime - start;
        else if (startedAt.current) time = startedAt.current.t + (performance.now() - startedAt.current.wall) / 1000;
        if (time >= plan.duration) {
          time = plan.duration - 1 / plan.fps;
          setPlaying(false);
        }
        // Sound effects that fall in this frame.
        for (const c of plan.cues) if (c.t > prev && c.t <= time) playCue(c.name, c.gain, plan.script.sfxVolume ?? 1);
      }
      prev = time;
      renderFrame(time, false);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [render, plan, playing, renderFrame]);

  // Music follows play / pause / seek.
  useEffect(() => {
    const a = audioEl.current;
    if (!a || !plan?.script.music) return;
    a.volume = Math.min(1, plan.script.music.volume ?? 0.8);
    if (playing) {
      a.currentTime = (plan.script.music.start ?? 0) + tRef.current;
      void a.play().catch(() => {});
    } else a.pause();
  }, [playing, plan]);

  const play = () => {
    if (!plan) return;
    if (tRef.current >= plan.duration - 0.05) tRef.current = 0;
    startedAt.current = { wall: performance.now(), t: tRef.current };
    playCue('click', 0); // unlocks audio on the first press
    setPlaying(true);
  };
  const pause = () => setPlaying(false);
  const seek = useCallback(
    (time: number) => {
      if (!plan) return;
      const x = Math.max(0, Math.min(plan.duration - 1 / plan.fps, time));
      tRef.current = x;
      startedAt.current = { wall: performance.now(), t: x };
      const a = audioEl.current;
      if (a && plan.script.music) a.currentTime = (plan.script.music.start ?? 0) + x;
      if (!playing) renderFrame(x, false);
    },
    [plan, playing, renderFrame],
  );

  // ---------------------------------------------------------------- render-mode API (tools/render-trailer.mjs)
  // Installed once; reads the latest state through a ref, so React updates can't disturb a frame.
  const latest = useRef({ plan, renderFrame, posterAt, seats, W, H, format, scriptName, loadError });
  latest.current = { plan, renderFrame, posterAt, seats, W, H, format, scriptName, loadError };
  const framesStarted = useRef(false);
  /** The next frame the scene hasn't simulated yet (frames must run in order). */
  const nextFrame = useRef(0);
  useEffect(() => {
    if (!render) return;
    document.documentElement.classList.add('studio-render');
    document.documentElement.classList.toggle('studio-transparent', params.layer === 'overlay');
    let raf = 0;
    // Until the first frame is asked for: keep rendering frame 0 so models load and shaders compile.
    const tick = () => {
      if (framesStarted.current) return;
      raf = requestAnimationFrame(tick);
      if (latest.current.plan && rootState.current) latest.current.renderFrame(0, true);
    };
    raf = requestAnimationFrame(tick);
    const nextPaint = () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
    (window as unknown as { __trailerStudio: unknown }).__trailerStudio = {
      error: () => {
        const { loadError: err, plan: p } = latest.current;
        return err ?? (p?.errors.length ? p.errors.join('\n') : null);
      },
      ready: () => {
        const { plan: p, posterAt: poster, seats: st } = latest.current;
        return !!p && !!rig.current?.ready() && !!poster && st.size > 0 && document.fonts.status === 'loaded' && !useProgress.getState().active;
      },
      info: () => {
        const { plan: p, W: w, H: h, format: f, scriptName: n } = latest.current;
        return p ? { frames: p.frames, fps: p.fps, duration: p.duration, W: w, H: h, format: f, title: p.script.title ?? n, music: !!p.script.music?.file } : null;
      },
      /** Runs the frames up to n-1 without drawing, so a render starting at n matches a full render. */
      preroll: async (n: number) => {
        framesStarted.current = true;
        cancelAnimationFrame(raf);
        const { plan: p, renderFrame: rf } = latest.current;
        for (let i = nextFrame.current; i < n; i++) rf(i / p!.fps, true, false);
        nextFrame.current = Math.max(nextFrame.current, n);
      },
      frame: async (i: number) => {
        framesStarted.current = true;
        cancelAnimationFrame(raf);
        const { plan: p, renderFrame: rf } = latest.current;
        rf(i / p!.fps, true);
        nextFrame.current = i + 1;
        await nextPaint();
      },
      soundtrack: async (withMusic: boolean) => {
        const p = latest.current.plan!;
        const bytes = await renderSoundtrack({
          duration: p.duration,
          cues: p.cues,
          music: p.script.music ?? null,
          withMusic,
          sfxVolume: p.script.sfxVolume ?? 1,
          ambience: p.script.ambience ?? 0.25,
        });
        let str = '';
        for (let i = 0; i < bytes.length; i += 0x8000) str += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        return btoa(str);
      },
    };
    return () => cancelAnimationFrame(raf);
  }, [render, params.layer]);

  // ---------------------------------------------------------------- recording (dev server runs the renderer)
  const [job, setJob] = useState<{ id: string; frame: number; frames: number; state: string; message: string; outputs: string[] } | null>(null);
  const [recLayers, setRecLayers] = useState(false);
  const [recPng, setRecPng] = useState(false);
  const [recAlpha, setRecAlpha] = useState(false);
  const record = useCallback(async () => {
    if (job && job.state === 'running') return;
    const r = await fetch('/dev/trailer/api/render', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ script: scriptName, format, res, layers: recLayers, png: recPng, alpha: recAlpha }),
    });
    const j = await r.json();
    if (!r.ok) return setJob({ id: '', frame: 0, frames: 0, state: 'error', message: j.error ?? 'Failed to start', outputs: [] });
    setJob({ id: j.id, frame: 0, frames: 0, state: 'running', message: 'Starting…', outputs: [] });
  }, [job, scriptName, format, res, recLayers, recPng, recAlpha]);
  useEffect(() => {
    if (!job || job.state !== 'running' || !job.id) return;
    const id = setInterval(async () => {
      const r = await fetch(`/dev/trailer/api/render?id=${job.id}`, { cache: 'no-store' });
      if (r.ok) setJob(await r.json());
    }, 700);
    return () => clearInterval(id);
  }, [job]);

  // ---------------------------------------------------------------- keys
  useEffect(() => {
    if (render) return;
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT')) return;
      if (!plan) return;
      const k = e.key.toLowerCase();
      if (k === ' ') {
        e.preventDefault();
        if (playing) pause();
        else play();
      } else if (k === 'arrowright' || k === 'arrowleft') {
        e.preventDefault();
        const step = e.shiftKey ? 1 : 1 / plan.fps;
        seek(tRef.current + (k === 'arrowright' ? step : -step));
      } else if (k === 'home') seek(0);
      else if (k === 'g') setSafeOn((v) => !v);
      else if (k === 'h') setUi((v) => !v);
      else if (k === 'r') void record();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // ---------------------------------------------------------------- scene hookup
  const seatsKey = useRef('');
  const onSeats = useCallback((s: Map<string, { position: V3; head: V3 }>) => {
    const key = JSON.stringify([...s]);
    if (key === seatsKey.current) return;
    seatsKey.current = key;
    setSeats(new Map([...s].map(([id, v]) => [id, { position: v.position, head: v.head }])));
  }, []);
  const trailer: SceneTrailer = useMemo(
    () => ({
      colors: Object.fromEntries(Object.entries(colors).map(([id, c]) => [id, colorInfo(c).hex])),
      labels: false,
      glowId: null,
      onSeats,
      canvas: { frameloop: 'never', shadows, dpr: render ? 1 : Math.min(2, typeof window === 'undefined' ? 1 : window.devicePixelRatio), exposure: plan?.look.exposure ?? 1 },
      rig: (
        <>
          <StudioRig api={rig} frame={frameCam} fades={fades} ringR={ringR} shadows={shadows} />
          <StateGrab into={rootState} />
        </>
      ),
    }),
    [colors, shadows, render, plan?.look.exposure, ringR, onSeats],
  );

  const overlayCtx: OverlayCtx | null = plan
    ? {
        plan,
        t,
        frame,
        project: (p) => {
          const r = rig.current?.project(p);
          return r ? { x: (r.x * W) / stage.w, y: (r.y * H) / stage.h, visible: r.visible } : null;
        },
        head: (id) => seats.get(id)?.head ?? null,
        chest: (id) => {
          const s = seats.get(id);
          return s ? [s.position[0], SEATED_HEIGHT * 0.55, s.position[2]] : null;
        },
        colorOf: (id) => colors[id] ?? plan.cast.find((c) => c.id === id)?.color ?? 'red',
        nameOf: (id) => plan.cast.find((c) => c.id === id)?.name ?? '?',
        posterAt,
      }
    : null;

  const desat = plan ? desatAt(plan, t) : 0;
  const layer = render ? params.layer : 'full';
  const fmtTime = (x: number) => `${Math.floor(x / 60)}:${(x % 60).toFixed(2).padStart(5, '0')}`;
  const activeShot = plan?.shots.find((s) => t >= s.t && t < s.end);

  return (
    <div className={`studio${render ? ` render layer-${layer}` : ''}`} style={!ui && !render ? { gridTemplateColumns: '1fr' } : undefined}>
      <div className="studio-stage-area" ref={area} style={render ? { padding: 0 } : undefined}>
        <div className="studio-stage" style={{ width: stage.w, height: stage.h }}>
          <div
            className="studio-canvas"
            style={{ visibility: layer === 'overlay' ? 'hidden' : undefined, filter: desat > 0 ? `grayscale(${desat}) contrast(${1 + 0.18 * desat}) brightness(${1 - 0.08 * desat})` : undefined }}
          >
            {plan && <Scene trailer={trailer} />}
          </div>
          {overlayCtx && layer !== 'scene' && (
            <div className="studio-overlay" style={{ width: W, height: H, transform: `scale(${scale})` }}>
              <Overlays c={overlayCtx} />
              {!render && safeOn && <SafeZones frame={frame} />}
            </div>
          )}
        </div>
      </div>

      {!render && plan && ui && (
        <Timeline
          plan={plan}
          t={t}
          music={music}
          onSeek={seek}
          onChange={async (next) => {
            const r = await fetch(`/dev/trailer/api/script?name=${encodeURIComponent(scriptName)}`, { method: 'PUT', body: JSON.stringify(next, null, 2) + '\n' });
            if (r.ok) {
              mtime.current = r.headers.get('x-mtime');
              setScript(next);
            }
          }}
        />
      )}

      {!render && ui && (
        <aside className="studio-panel">
          <section>
            <h4>Trailer studio</h4>
            <div className="row">
              <select value={scriptName} onChange={(e) => setScriptName(e.target.value)} aria-label="Script">
                {[...new Set([scriptName, ...scripts])].map((s) => (
                  <option key={s} value={s}>
                    trailers/{s}.json
                  </option>
                ))}
              </select>
            </div>
            {plan && (
              <div className="hint">
                {plan.script.title ?? scriptName} · {plan.duration}s · {plan.fps} fps · {plan.events.length} events · {plan.shots.length} shots
              </div>
            )}
            {loadError && <div className="err">{loadError}</div>}
            {plan?.errors.map((e) => (
              <div key={e} className="err">
                {e}
              </div>
            ))}
            <div className="hint">Edits to the JSON file show up here within a second or two.</div>
          </section>

          <section>
            <h4>Playback</h4>
            <div className="row">
              {playing ? <button onClick={pause}>Pause</button> : <button onClick={play}>Play</button>}
              <button onClick={() => seek(0)}>⏮</button>
              <span className="studio-time">
                {fmtTime(t)} / {plan ? fmtTime(plan.duration) : '–'} · f{Math.round(t * (plan?.fps ?? 60))}
              </span>
            </div>
            {activeShot?.label && <div className="hint">Shot: {activeShot.label}</div>}
            <div className="hint">Space play · ←/→ frame (Shift: 1 s) · Home start · G safe zones · H hide · R record</div>
          </section>

          <section>
            <h4>Frame</h4>
            <div className="row">
              {(['16:9', '9:16'] as Format[]).map((f) => (
                <button key={f} className={format === f ? 'on' : ''} onClick={() => setFormatPick(f)}>
                  {f}
                </button>
              ))}
              {(['1080p', '4K'] as Res[]).map((r) => (
                <button key={r} className={res === r ? 'on' : ''} onClick={() => setRes(r)}>
                  {r}
                </button>
              ))}
            </div>
            <div className="hint">
              Output {W}×{H}. Preview is scaled to fit; the file is rendered off-screen at full size.
            </div>
            <label>
              <input type="checkbox" checked={safeOn} onChange={(e) => setSafeOn(e.target.checked)} /> Safe zones (preview only)
            </label>
            <label>
              <input type="checkbox" checked={shadows} onChange={(e) => setShadows(e.target.checked)} /> Shadows
            </label>
          </section>

          <section>
            <h4>Record</h4>
            <label>
              <input type="checkbox" checked={recLayers} onChange={(e) => setRecLayers(e.target.checked)} /> Layers too (scene plate + transparent overlays)
            </label>
            <label>
              <input type="checkbox" checked={recAlpha} onChange={(e) => setRecAlpha(e.target.checked)} disabled={!recLayers} /> Overlays as ProRes 4444 video (alpha)
            </label>
            <label>
              <input type="checkbox" checked={recPng} onChange={(e) => setRecPng(e.target.checked)} /> Keep a PNG sequence
            </label>
            <div className="row">
              <button className="rec" onClick={() => void record()} disabled={job?.state === 'running'}>
                ● Record {format} {res}
              </button>
            </div>
            {job && (
              <>
                <div className="studio-progress">
                  <i style={{ width: `${job.frames ? (100 * job.frame) / job.frames : 0}%` }} />
                </div>
                <div className={job.state === 'error' ? 'err' : 'hint'}>
                  {job.message}
                  {job.frames ? ` (${job.frame}/${job.frames})` : ''}
                </div>
                {job.outputs.map((o) => (
                  <div key={o} className="hint">
                    {o}
                  </div>
                ))}
              </>
            )}
            <div className="hint">Renders frame by frame at a steady {plan?.fps ?? 60} fps into out/trailers/. Same as: pnpm trailer:render {scriptName} --format {format} --res {res}</div>
          </section>
        </aside>
      )}
      {!render && plan?.script.music?.file && <audio ref={audioEl} src={musicUrl(plan.script.music.file)} preload="auto" />}
    </div>
  );
}

/** Hands the canvas's root state out, so the studio can advance the frame loop itself. */
function StateGrab({ into }: { into: React.MutableRefObject<RootState | null> }) {
  const get = useThree((s) => s.get);
  useEffect(() => {
    const state = get();
    // The studio owns time: advance(t) sets the clock. A stopped THREE.Clock with autoStart would
    // restart itself on the next frame and add wall-clock time to every delta.
    state.clock.autoStart = false;
    state.clock.stop();
    into.current = state;
  }, [get, into]);
  return null;
}
