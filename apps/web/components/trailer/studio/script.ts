import { COLOR_IDS, type ColorId } from '@wtc/shared';
import type { CamKey, V3 } from '../paths';

// Trailer scripts: one JSON file describes a whole trailer (shots, game events, titles, effects,
// music). This module parses a script and compiles it into a plan the studio can play at any
// time t, so preview, scrubbing and frame-by-frame rendering all show exactly the same thing.
// The format is documented in TRAILER.md.

/** Seconds, or a musical position: "beat:16", "bar:4", "beat:16+0.25" (needs music.bpm). */
export type TimeRef = number | string;

export type Format = '16:9' | '9:16';
export type TitleIn = 'slam' | 'slide' | 'stamp' | 'type';
export type TitleOut = 'fade' | 'slide' | 'burn' | 'none';
export type Ink = 'cream' | 'brass' | 'oxblood';
export type Place = 'center' | 'top' | 'upper' | 'lower' | 'bottom';

export interface MusicSpec {
  /** A public path ("/audio/music-westernmusic.mp3") or a file in the repo ("trailers/music/theme.mp3"). */
  file: string;
  volume?: number;
  /** Seconds into the song where the trailer starts. */
  start?: number;
  bpm?: number;
  /** Time of the first beat in the song (seconds, before `start` is applied). */
  offset?: number;
  beatsPerBar?: number;
  /** Seconds of fade-out at the end of the trailer. */
  fadeOut?: number;
}

export interface CastSpec {
  players?: number;
  names?: string[];
  colors?: ColorId[];
  /** Who's on the Wanted poster: a name or an id (p0, p1…). */
  wanted?: string;
  /** Hats off for these (names or ids), true for everyone. Close-up subjects lose theirs anyway unless hats is "keep". */
  hatless?: string[] | boolean;
  hats?: 'auto' | 'keep';
}

export interface Look {
  /** Film grain, 0–1. */
  grain?: number;
  /** Dark corners, 0–1. */
  vignette?: number;
  /** Letterbox bars as a fraction of the frame height (each bar), e.g. 0.1. */
  letterbox?: number;
  /** Scene brightness (tone-mapping exposure). */
  exposure?: number;
}

export interface EndCardText {
  title?: string;
  subtitle?: string;
  tagline?: string;
  url?: string;
  discord?: string;
  credit?: string;
}

export type CameraSpec =
  | {
      preset: 'home' | 'wide' | 'orbit' | 'pushIn' | 'closeUp' | 'revealTown' | 'poster' | 'overShoulder' | 'lowAngle' | 'circleSlow';
      /** Who the camera is about (name or id), for pushIn / closeUp / overShoulder. */
      target?: string;
      /** For overShoulder: whose shoulder. */
      from?: string;
    }
  | { keys: CamKey[] };

export interface Shot {
  at: TimeRef;
  camera: CameraSpec;
  /** A different camera for 9:16, if the 16:9 one doesn't work there. */
  vertical?: CameraSpec;
  label?: string;
}

interface Base {
  at: TimeRef;
  /** Seconds the event shows (where it applies). */
  dur?: number;
}

export type TrailerEvent =
  | (Base & { type: 'title'; text: string; sub?: string; in?: TitleIn; out?: TitleOut; pos?: Place; size?: number; color?: Ink; from?: 'left' | 'right' })
  | (Base & { type: 'posterSlam'; color?: ColorId; pot?: number; fullScreen?: boolean })
  | (Base & { type: 'searchReveal'; target: string; searcher?: string; chips?: ColorId[][]; camera?: boolean })
  | (Base & { type: 'search'; searcher: string; target: string })
  | (Base & { type: 'bubble'; who: string; text: string })
  | (Base & { type: 'telegram'; tag?: string; title: string; body?: string; sound?: 'offer' | 'telegram' })
  | (Base & { type: 'vote'; target: string; title?: string })
  | (Base & { type: 'stamp'; text: string; on?: string; color?: Ink })
  | (Base & { type: 'payout'; amount?: number; label?: string })
  | (Base & { type: 'escape'; who?: string })
  | (Base & { type: 'caught' })
  | (Base & { type: 'react'; who: string; reaction: 'victory' | 'despair-1' | 'despair-2' })
  | (Base & { type: 'colorChange'; who: string; to?: ColorId })
  | (Base & { type: 'freeze'; who: string; label: string })
  | (Base & { type: 'slowmo'; speed?: number; ramp?: number })
  | (Base & { type: 'shake'; strength?: number })
  | (Base & { type: 'flash'; color?: 'white' | 'black' })
  | (Base & { type: 'dust' })
  | (Base & { type: 'look'; grain?: number; vignette?: number; letterbox?: number })
  | (Base & { type: 'endCard' })
  | (Base & { type: 'sfx'; name: string; gain?: number });

export interface TrailerScript {
  title?: string;
  format?: Format;
  /** Seconds. */
  duration: number;
  fps?: number;
  music?: MusicSpec | null;
  /** Synthesized sound effects volume (0–2). */
  sfxVolume?: number;
  /** Campfire crackle under everything (0 = off). */
  ambience?: number;
  cast?: CastSpec;
  look?: Look;
  shots: Shot[];
  events: TrailerEvent[];
  endCard?: EndCardText;
}

// ---------------------------------------------------------------- defaults

export const DEFAULT_END_CARD: Required<EndCardText> = {
  title: 'Wanted',
  subtitle: 'True Colors',
  tagline: 'FREE IN YOUR BROWSER',
  url: 'wantedtruecolors.com',
  discord: 'discord.gg/wanted',
  credit: 'A 3042Official game',
};

/** Default seconds per event type when `dur` is left out. */
export const DEFAULT_DUR: Record<TrailerEvent['type'], number> = {
  title: 2.2,
  posterSlam: 2.2,
  searchReveal: 6,
  search: 0.1,
  bubble: 2.2,
  telegram: 2.6,
  vote: 3,
  stamp: 1.6,
  payout: 2.6,
  escape: 2.6,
  caught: 0.1,
  react: 0.1,
  colorChange: 1,
  freeze: 2,
  slowmo: 1.5,
  shake: 0.4,
  flash: 0.25,
  dust: 1,
  look: 0.6,
  endCard: 4,
  sfx: 0.1,
};

const NAMES = ['Hank', 'Dolly', 'Silas', 'June', 'Boone', 'Pearl', 'Clem', 'Etta', 'Rio', 'Mags', 'Tex', 'Wyatt', 'Hattie', 'Dusty', 'Abe'];
const COLORS: ColorId[] = (['red', 'blue', 'yellow', 'green', 'pink', 'orange', 'teal', 'tan', 'lime', 'maroon', 'cyan', 'brown', 'purple', 'white', 'black'] as ColorId[]).filter((c) =>
  (COLOR_IDS as string[]).includes(c),
);

// ---------------------------------------------------------------- deterministic randomness

/** Small seeded PRNG (mulberry32): the same script always looks the same. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
export const smooth = (x: number) => {
  const k = clamp01(x);
  return k * k * (3 - 2 * k);
};
export const easeOutCubic = (x: number) => 1 - (1 - clamp01(x)) ** 3;
export const easeInCubic = (x: number) => clamp01(x) ** 3;
export const easeOutBack = (x: number) => {
  const k = clamp01(x) - 1;
  return 1 + 2.4 * k ** 3 + 1.4 * k ** 2;
};

// ---------------------------------------------------------------- music time

export function beatLength(music?: MusicSpec | null): number | null {
  return music?.bpm ? 60 / music.bpm : null;
}

/** Trailer time (seconds) of beat n (0-based), counting from the first beat at or after the trailer start. */
export function beatTime(music: MusicSpec | null | undefined, n: number): number {
  const len = beatLength(music);
  if (!len || !music) return n;
  const first = (music.offset ?? 0) - (music.start ?? 0);
  // First beat at or after t=0.
  const k0 = Math.ceil(-first / len - 1e-9);
  return first + (k0 + n) * len;
}

/** Every beat inside [0, duration). */
export function beatsIn(music: MusicSpec | null | undefined, duration: number): number[] {
  const len = beatLength(music);
  if (!len) return [];
  const out: number[] = [];
  for (let n = 0; ; n++) {
    const t = beatTime(music, n);
    if (t >= duration) break;
    out.push(t);
  }
  return out;
}

/** Nearest beat number to t (fractions allowed in steps of 1/div). */
export function nearestBeat(music: MusicSpec | null | undefined, t: number, div = 1): number | null {
  const len = beatLength(music);
  if (!len) return null;
  const n = (t - beatTime(music, 0)) / len;
  return Math.round(n * div) / div;
}

export function resolveTime(ref: TimeRef, music?: MusicSpec | null): number {
  if (typeof ref === 'number') return ref;
  const m = /^\s*(beat|bar)\s*:\s*(-?[\d.]+)\s*(?:([+-])\s*([\d.]+))?\s*$/.exec(ref);
  if (!m) {
    const n = Number(ref);
    if (Number.isFinite(n)) return n;
    throw new Error(`Bad time "${ref}". Use seconds, "beat:16" or "bar:4+0.25".`);
  }
  if (!music?.bpm) throw new Error(`"${ref}" needs music.bpm in the script.`);
  const per = m[1] === 'bar' ? (music.beatsPerBar ?? 4) : 1;
  const extra = m[3] ? (m[3] === '-' ? -1 : 1) * Number(m[4]) : 0;
  return beatTime(music, Number(m[2]) * per) + extra;
}

// ---------------------------------------------------------------- cast

export interface CastMember {
  id: string;
  name: string;
  color: ColorId;
  hatless: boolean;
}

export function makeCast(script: TrailerScript): { cast: CastMember[]; byRef: (ref: string | undefined) => string | null; wantedId: string } {
  const spec = script.cast ?? {};
  const n = Math.max(6, Math.min(12, spec.players ?? 8));
  const cast: CastMember[] = Array.from({ length: n }, (_, i) => ({
    id: `p${i}`,
    name: spec.names?.[i] ?? NAMES[i % NAMES.length],
    color: spec.colors?.[i] ?? COLORS[i % COLORS.length],
    hatless: false,
  }));
  const byRef = (ref: string | undefined): string | null => {
    if (!ref) return null;
    const r = ref.trim().toLowerCase();
    return cast.find((c) => c.id === r || c.name.toLowerCase() === r)?.id ?? null;
  };
  // Hats: everyone listed, plus close-up subjects (unless hats are kept).
  const off = new Set<string>();
  if (spec.hatless === true) cast.forEach((c) => off.add(c.id));
  if (Array.isArray(spec.hatless)) spec.hatless.forEach((h) => byRef(h) && off.add(byRef(h)!));
  if (spec.hats !== 'keep') {
    for (const s of script.shots) {
      const cam = s.camera as { preset?: string; target?: string };
      if (cam.preset === 'closeUp' || cam.preset === 'pushIn') byRef(cam.target) && off.add(byRef(cam.target)!);
    }
    for (const e of script.events) {
      if (e.type === 'searchReveal' || e.type === 'freeze') byRef(e.type === 'searchReveal' ? e.target : e.who) && off.add(byRef(e.type === 'searchReveal' ? e.target : e.who)!);
      if (e.type === 'bubble') byRef(e.who) && off.add(byRef(e.who)!);
    }
  }
  cast.forEach((c) => (c.hatless = off.has(c.id)));
  const wantedId = byRef(spec.wanted) ?? cast[Math.min(3, n - 1)].id;
  return { cast, byRef, wantedId };
}

// ---------------------------------------------------------------- the compiled plan

export type Resolved = TrailerEvent & { t: number; end: number; i: number };

export interface Cue {
  t: number;
  name: string;
  gain: number;
}

export interface Plan {
  script: TrailerScript;
  duration: number;
  fps: number;
  frames: number;
  cast: CastMember[];
  wantedId: string;
  byRef: (ref: string | undefined) => string | null;
  /** Sorted by time; `i` is the index in script.shots. */
  shots: { t: number; end: number; camera: CameraSpec; vertical?: CameraSpec; label?: string; i: number }[];
  events: Resolved[];
  cues: Cue[];
  /** Scene time at each frame (slow motion and freezes stretch it). */
  sceneTimes: Float64Array;
  look: Required<Look>;
  endCard: Required<EndCardText>;
  errors: string[];
}

/** Search reveal timing (seconds from the event's start). */
export const SEARCH = { tap: 0.9, press: 1.15, chip0: 1.5, chipStep: 0.22, second: 3.3 };

/** Seconds in a slam/stamp title before it lands (impact sound, dust, shake). */
export const TITLE_LAND: Record<TitleIn, number> = { slam: 0.2, slide: 0.32, stamp: 0.14, type: 0 };

function titleCues(e: Extract<Resolved, { type: 'title' }>, out: Cue[]) {
  const how = e.in ?? 'slam';
  if (how === 'slam') out.push({ t: e.t + TITLE_LAND.slam, name: 'impact', gain: 1 });
  if (how === 'slide') out.push({ t: e.t, name: 'whoosh', gain: 0.8 });
  if (how === 'stamp') out.push({ t: e.t + TITLE_LAND.stamp, name: 'stamp', gain: 1.1 });
  if (how === 'type') {
    const n = Math.min(60, e.text.replace(/\s/g, '').length);
    for (let i = 0; i < n; i++) out.push({ t: e.t + typeDelay(e.text, i), name: 'typekey', gain: 0.7 });
  }
  const exit = e.out ?? 'fade';
  if (exit === 'slide') out.push({ t: e.end - 0.3, name: 'whoosh', gain: 0.6 });
  if (exit === 'burn') out.push({ t: e.end - 0.6, name: 'burn', gain: 0.8 });
}

/** Typewriter: seconds until the i-th visible character appears. */
export function typeDelay(text: string, i: number): number {
  return 0.05 + i * 0.055;
}

function eventCues(e: Resolved, out: Cue[]) {
  switch (e.type) {
    case 'title':
      return titleCues(e, out);
    case 'posterSlam':
      out.push({ t: e.t, name: 'whoosh', gain: 0.7 }, { t: e.t + 0.22, name: 'poster', gain: 1.2 }, { t: e.t + 0.22, name: 'thud', gain: 0.9 });
      return;
    case 'searchReveal':
      out.push({ t: e.t + SEARCH.press, name: 'click', gain: 1.4 }, { t: e.t + SEARCH.press + 0.1, name: 'crow', gain: 0.8 });
      for (let k = 0; k < 4; k++) out.push({ t: e.t + SEARCH.chip0 + k * SEARCH.chipStep, name: 'pop', gain: 0.9 });
      out.push({ t: e.t + SEARCH.second + SEARCH.press - SEARCH.tap, name: 'click', gain: 1.4 });
      for (let k = 0; k < 4; k++) out.push({ t: e.t + SEARCH.second + 0.35 + k * SEARCH.chipStep, name: 'pop', gain: 0.9 });
      out.push({ t: e.t + SEARCH.second + 0.35 + 4 * SEARCH.chipStep + 0.1, name: 'reveal', gain: 1 });
      return;
    case 'search':
      out.push({ t: e.t, name: 'crow', gain: 0.8 });
      return;
    case 'bubble':
      out.push({ t: e.t, name: 'pop', gain: 0.7 });
      return;
    case 'telegram':
      out.push({ t: e.t, name: 'whoosh', gain: 0.5 }, { t: e.t + 0.25, name: e.sound ?? (e.tag === 'OFFER' ? 'offer' : 'telegram'), gain: 1 });
      return;
    case 'vote':
      out.push({ t: e.t, name: 'townBell', gain: 1 }, { t: e.t + 1.55, name: 'stamp', gain: 1.3 }, { t: e.t + 1.55, name: 'thud', gain: 0.8 });
      return;
    case 'stamp':
      out.push({ t: e.t + 0.12, name: 'stamp', gain: 1.3 });
      return;
    case 'payout':
      out.push({ t: e.t, name: 'chaching', gain: 1 }, { t: e.t + 0.1, name: 'coins', gain: 1.2 }, { t: e.t + 0.5, name: 'coins', gain: 0.9 }, { t: e.t + 0.4, name: 'victory', gain: 0.8 });
      return;
    case 'escape':
      out.push({ t: e.t + 0.12, name: 'stamp', gain: 1.2 }, { t: e.t + 0.3, name: 'despair', gain: 0.9 }, { t: e.t + 0.5, name: 'wind', gain: 0.8 });
      return;
    case 'caught':
      out.push({ t: e.t, name: 'victory', gain: 1 });
      return;
    case 'react':
      out.push({ t: e.t, name: e.reaction === 'victory' ? 'victory' : 'despair', gain: 0.9 });
      return;
    case 'colorChange':
      out.push({ t: e.t, name: 'whoosh', gain: 0.6 }, { t: e.t + 0.25, name: 'sparkle', gain: 0.9 }, { t: e.t + 0.25, name: 'rustle', gain: 1 });
      return;
    case 'freeze':
      out.push({ t: e.t, name: 'freeze', gain: 1 }, { t: e.t + 0.35, name: 'stamp', gain: 1.1 }, { t: e.end, name: 'unfreeze', gain: 0.8 });
      return;
    case 'flash':
      out.push({ t: e.t, name: 'hit', gain: 0.8 });
      return;
    case 'dust':
      out.push({ t: e.t, name: 'whoosh', gain: 0.8 });
      return;
    case 'endCard':
      out.push({ t: e.t, name: 'impact', gain: 1 }, { t: e.t + 0.1, name: 'gameEnd', gain: 0.8 });
      return;
    case 'sfx':
      out.push({ t: e.t, name: e.name, gain: e.gain ?? 1 });
      return;
    default:
      return;
  }
}

/** Speed of scene time at trailer time t: slow motion ramps, freezes stop it. */
function speedAt(events: Resolved[], t: number): number {
  let s = 1;
  for (const e of events) {
    if (t < e.t || t >= e.end) continue;
    if (e.type === 'freeze') {
      // Snap to a stop, hold, then catch up quickly at the end.
      const out = e.end - t;
      return out < 0.12 ? 1 - out / 0.12 : 0;
    }
    if (e.type === 'slowmo') {
      const ramp = Math.min(e.ramp ?? 0.3, (e.end - e.t) / 2);
      const target = e.speed ?? 0.3;
      const k = Math.min(1, (t - e.t) / (ramp || 1e-6), (e.end - t) / (ramp || 1e-6));
      s = Math.min(s, 1 + (target - 1) * smooth(k));
    }
  }
  return s;
}

export function compile(script: TrailerScript): Plan {
  const errors: string[] = [];
  const fps = script.fps ?? 60;
  const duration = Math.max(0.5, script.duration);
  const frames = Math.round(duration * fps);
  const music = script.music ?? null;
  const time = (ref: TimeRef, what: string) => {
    try {
      return resolveTime(ref, music);
    } catch (err) {
      errors.push(`${what}: ${(err as Error).message}`);
      return 0;
    }
  };
  const { cast, byRef, wantedId } = makeCast(script);

  const events: Resolved[] = script.events
    .map((e, i) => {
      const t = time(e.at, `event ${i + 1} (${e.type})`);
      return { ...e, t, end: t + (e.dur ?? DEFAULT_DUR[e.type] ?? 1), i } as Resolved;
    })
    .sort((a, b) => a.t - b.t || a.i - b.i);
  for (const e of events) {
    for (const key of ['who', 'target', 'searcher', 'on'] as const) {
      const ref = (e as unknown as Record<string, string | undefined>)[key];
      if (ref && !byRef(ref)) errors.push(`event ${e.i + 1} (${e.type}): nobody called "${ref}" in the cast`);
    }
  }

  const shotList = script.shots
    .map((s, i) => ({ ...s, t: time(s.at, `shot ${i + 1}`), i }))
    .sort((a, b) => a.t - b.t);
  const shots = shotList.map((s, k) => ({ t: s.t, end: shotList[k + 1]?.t ?? duration, camera: s.camera, vertical: s.vertical, label: s.label, i: s.i }));
  if (!shots.length) shots.push({ t: 0, end: duration, camera: { preset: 'home' }, vertical: undefined, label: undefined, i: -1 });

  const cues: Cue[] = [];
  for (const e of events) eventCues(e, cues);
  cues.sort((a, b) => a.t - b.t);

  // Scene time: integrate the speed curve at 4× the frame rate.
  const sceneTimes = new Float64Array(frames + 1);
  const sub = 4;
  let st = 0;
  for (let f = 0; f <= frames; f++) {
    sceneTimes[f] = st;
    for (let k = 0; k < sub; k++) st += speedAt(events, (f + (k + 0.5) / sub) / fps) / (fps * sub);
  }

  return {
    script,
    duration,
    fps,
    frames,
    cast,
    wantedId,
    byRef,
    shots,
    events,
    cues,
    sceneTimes,
    look: { grain: 0, vignette: 0.35, letterbox: 0, exposure: 1, ...script.look },
    endCard: { ...DEFAULT_END_CARD, ...script.endCard },
    errors,
  };
}

/** Scene time at trailer time t (interpolated between frames). */
export function sceneTimeAt(plan: Plan, t: number): number {
  const f = Math.max(0, Math.min(plan.frames, t * plan.fps));
  const i = Math.floor(f);
  const a = plan.sceneTimes[i];
  const b = plan.sceneTimes[Math.min(plan.frames, i + 1)];
  return a + (b - a) * (f - i);
}

export const activeAt = (plan: Plan, t: number) => plan.events.filter((e) => t >= e.t && t < e.end);

/** Letterbox / grain / vignette at time t: the script's look, changed by "look" events (eased). */
export function lookAt(plan: Plan, t: number): Required<Look> {
  let cur = { ...plan.look };
  for (const e of plan.events) {
    if (e.type !== 'look' || t < e.t) continue;
    const k = smooth((t - e.t) / Math.max(0.01, e.end - e.t));
    cur = {
      ...cur,
      grain: e.grain !== undefined ? cur.grain + (e.grain - cur.grain) * k : cur.grain,
      vignette: e.vignette !== undefined ? cur.vignette + (e.vignette - cur.vignette) * k : cur.vignette,
      letterbox: e.letterbox !== undefined ? cur.letterbox + (e.letterbox - cur.letterbox) * k : cur.letterbox,
    };
  }
  return cur;
}

/** Validates the parts of a script the compiler can't (shape and names). */
export function parseScript(text: string): TrailerScript {
  const s = JSON.parse(text) as TrailerScript;
  if (!s || typeof s !== 'object') throw new Error('A trailer script is a JSON object.');
  if (typeof s.duration !== 'number') throw new Error('The script needs "duration" (seconds).');
  if (!Array.isArray(s.shots)) s.shots = [];
  if (!Array.isArray(s.events)) s.events = [];
  return s;
}

export type { V3 };
