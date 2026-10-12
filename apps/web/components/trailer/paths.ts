import { CatmullRomCurve3, Vector3 } from 'three';

// Camera paths for trailer mode: keyframes (where the camera is, what it looks at, lens), played
// back along smooth curves through them. Saved in this browser and exportable as JSON.

export type V3 = [number, number, number];

export interface CamKey {
  /** Camera position. */
  p: V3;
  /** Point it looks at. */
  t: V3;
  /** Vertical field of view, degrees. */
  fov: number;
  /** Seconds to travel here from the previous key (ignored on the first). */
  dur: number;
}

export interface CamPath {
  name: string;
  keys: CamKey[];
  /** Built from the scene (not editable, not saved). */
  preset?: boolean;
}

export const pathLength = (path: CamPath) => path.keys.slice(1).reduce((a, k) => a + k.dur, 0);
const smooth = (x: number) => x * x * (3 - 2 * x);

/** The camera at `time` seconds into a path: smooth in and out, curving through every key. */
export function samplePath(path: CamPath, time: number): { p: Vector3; t: Vector3; fov: number } {
  const keys = path.keys;
  if (keys.length === 1) return { p: new Vector3(...keys[0].p), t: new Vector3(...keys[0].t), fov: keys[0].fov };
  const total = pathLength(path) || 1;
  // Ease the whole move (slow start, slow stop); keys keep their relative timing.
  const along = smooth(Math.min(1, Math.max(0, time / total))) * total;
  let i = 1;
  let acc = 0;
  while (i < keys.length - 1 && acc + keys[i].dur < along) acc += keys[i++].dur;
  const f = keys[i].dur ? Math.min(1, (along - acc) / keys[i].dur) : 1;
  const u = (i - 1 + f) / (keys.length - 1);
  const pos = new CatmullRomCurve3(keys.map((k) => new Vector3(...k.p)), false, 'centripetal');
  const tgt = new CatmullRomCurve3(keys.map((k) => new Vector3(...k.t)), false, 'centripetal');
  return { p: pos.getPoint(u), t: tgt.getPoint(u), fov: keys[i - 1].fov + (keys[i].fov - keys[i - 1].fov) * f };
}

export interface SceneInfo {
  /** Radius of the circle of seats. */
  radius: number;
  /** Radius of the ring of buildings. */
  ringR: number;
  seats: Map<string, { position: V3; head: V3 }>;
  /** World position of the Wanted poster on the wall, if found. */
  poster: V3 | null;
}

const FIRE: V3 = [0, 1.2, 0];

/** Ready-made moves built from the current scene. */
export function presetPaths(info: SceneInfo, focusId: string | null): CamPath[] {
  const { radius, ringR } = info;
  const out: CamPath[] = [];

  // Orbit the fire: a full slow circle at seated-head height and a bit above.
  const orbit: CamKey[] = [];
  const steps = 8;
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    const r = radius + 4.2;
    orbit.push({ p: [Math.sin(a) * r, 3.4, Math.cos(a) * r], t: FIRE, fov: 42, dur: i ? 2.2 : 0 });
  }
  out.push({ name: 'Orbit the fire', keys: orbit, preset: true });

  // Push in on a scarecrow: from behind the fire, wide, to a close-up of their face.
  const seat = (focusId && info.seats.get(focusId)) || info.seats.values().next().value;
  if (seat) {
    const [x, , z] = seat.position;
    const head = seat.head;
    const len = Math.hypot(x, z) || 1;
    const inward: V3 = [-x / len, 0, -z / len];
    const at = (d: number, h: number): V3 => [x + inward[0] * d, h, z + inward[2] * d];
    /** `d` toward the fire and `across` to the scarecrow's left. */
    const side = (d: number, across: number, h: number): V3 => [x + inward[0] * d - inward[2] * across, h, z + inward[2] * d + inward[0] * across];
    out.push({
      name: 'Push in on a scarecrow',
      preset: true,
      keys: [
        { p: at(radius * 2 + 2, 3.2), t: [head[0], head[1] + 0.2, head[2]], fov: 45, dur: 0 },
        { p: at(radius + 0.8, 2.3), t: [head[0], head[1] + 0.15, head[2]], fov: 38, dur: 3 },
        // Medium three-quarter shot: hat, body and pose together. They sit hunched with hats tipped
        // over their eyes, so a tight close-up is all hat brim from any angle.
        { p: side(2.4, 2.1, head[1] - 0.15), t: [head[0], head[1] - 0.4, head[2]], fov: 38, dur: 3 },
      ],
    });
  }

  // Pull back to reveal the town: from just above the flames up and out over the rooftops.
  out.push({
    name: 'Pull back to reveal the town',
    preset: true,
    keys: [
      { p: [0.6, 1.6, 1.8], t: [0, 1.0, 0], fov: 50, dur: 0 },
      { p: [0, 4.5, radius + 3], t: [0, 1.2, 0], fov: 46, dur: 3 },
      { p: [0, ringR * 0.75, ringR + 6], t: [0, 1.5, -2], fov: 46, dur: 4.5 },
    ],
  });

  // The Wanted poster on the wall: drift up to it.
  if (info.poster) {
    const [px, py, pz] = info.poster;
    const len = Math.hypot(px, pz) || 1;
    const out1: V3 = [px - (px / len) * 2.2, py + 0.1, pz - (pz / len) * 2.2];
    const out2: V3 = [px - (px / len) * 7, py + 1.5, pz - (pz / len) * 7];
    out.push({
      name: 'The Wanted poster',
      preset: true,
      keys: [
        { p: out2, t: [px, py, pz], fov: 45, dur: 0 },
        { p: out1, t: [px, py, pz], fov: 34, dur: 3.5 },
      ],
    });
  }
  return out;
}

// ---------------------------------------------------------------- saved paths

const KEY = 'wtc:trailer-paths';

export function loadPaths(): CamPath[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((p) => p && typeof p.name === 'string' && Array.isArray(p.keys)) : [];
  } catch {
    return [];
  }
}

export function savePaths(paths: CamPath[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(paths.filter((p) => !p.preset)));
  } catch {
    /* ignore */
  }
}
