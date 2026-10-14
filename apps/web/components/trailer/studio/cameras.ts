import { Vector3 } from 'three';
import { SEATED_HEIGHT } from '../../scene/Scarecrow';
import { presetPaths, samplePath, type CamKey, type CamPath, type V3 } from '../paths';
import { isTall, type CameraSpec, type Format } from './script';

// Camera moves for trailer shots, built from where everyone sits. Each preset is stretched to
// the shot's length; 9:16 pulls wide shots back so the circle still fits the tall frame.

export interface SeatInfo {
  position: V3;
  head: V3;
}

export interface CamWorld {
  radius: number;
  ringR: number;
  seats: Map<string, SeatInfo>;
  poster: V3 | null;
}

const FIRE: V3 = [0, 1.2, 0];

/** Points around a scarecrow: `d` toward the fire, `across` to its left, at height h. */
function around(seat: SeatInfo) {
  const [x, , z] = seat.position;
  const len = Math.hypot(x, z) || 1;
  const ix = -x / len;
  const iz = -z / len;
  return (d: number, across: number, h: number): V3 => [x + ix * d - iz * across, h, z + iz * d + ix * across];
}

/** The face: a little above where the head turns, since they sit hunched forward. */
const face = (s: SeatInfo): V3 => [s.position[0], SEATED_HEIGHT - 0.22, s.position[2]];

function stretch(keys: CamKey[], dur: number): CamKey[] {
  const total = keys.slice(1).reduce((a, k) => a + k.dur, 0) || 1;
  return keys.map((k, i) => ({ ...k, dur: i ? (k.dur / total) * dur : 0 }));
}

function build(spec: CameraSpec, w: CamWorld, dur: number, seatOf: (ref?: string) => SeatInfo | null): CamKey[] {
  if ('keys' in spec) return spec.keys.length ? spec.keys : [{ p: [0, 6.6, w.radius + 6.5], t: [0, 1.6, 0], fov: 50, dur: 0 }];
  const r = w.radius;
  switch (spec.preset) {
    case 'home':
      return [
        { p: [0, 6.6, r + 6.5], t: [0, 1.6, 0], fov: 50, dur: 0 },
        { p: [0, 6.3, r + 6.0], t: [0, 1.6, 0], fov: 49, dur: 1 },
      ];
    case 'wide':
      return [
        { p: [-2, 9.5, r + 14], t: [0, 1.2, 0], fov: 44, dur: 0 },
        { p: [2, 9, r + 13], t: [0, 1.2, 0], fov: 44, dur: 1 },
      ];
    case 'orbit':
    case 'circleSlow': {
      const sweep = Math.min(Math.PI * 2, dur * (spec.preset === 'orbit' ? 0.35 : 0.18));
      const R = spec.preset === 'orbit' ? r + 4.2 : r + 2.6;
      const h = spec.preset === 'orbit' ? 3.4 : 2.4;
      const steps = 6;
      return Array.from({ length: steps + 1 }, (_, i) => {
        const a = -sweep / 2 + (i / steps) * sweep;
        return { p: [Math.sin(a) * R, h, Math.cos(a) * R] as V3, t: FIRE, fov: 42, dur: i ? 1 : 0 };
      });
    }
    case 'lowAngle': {
      return [
        { p: [r + 2.5, 0.5, r + 3], t: [0, 2.2, 0], fov: 48, dur: 0 },
        { p: [r + 1.2, 0.6, r + 3.6], t: [0, 2.4, 0], fov: 46, dur: 1 },
      ];
    }
    case 'revealTown':
    case 'poster': {
      const name = spec.preset === 'revealTown' ? 'Pull back to reveal the town' : 'The Wanted poster';
      const p = presetPaths({ radius: r, ringR: w.ringR, seats: w.seats, poster: w.poster }, null).find((x) => x.name === name);
      return p ? p.keys : build({ preset: 'wide' }, w, dur, seatOf);
    }
    case 'pushIn': {
      const s = seatOf(spec.target);
      if (!s) return build({ preset: 'home' }, w, dur, seatOf);
      const at = around(s);
      const f = face(s);
      // From across the fire down to a low, front-on shot: they sit hunched, so the camera looks
      // up a little to see the face.
      return [
        { p: at(r * 2 + 2.5, 0, 3.4), t: [f[0], f[1] - 0.3, f[2]], fov: 44, dur: 0 },
        { p: at(r + 0.4, 0.5, 2.0), t: [f[0], f[1] - 0.2, f[2]], fov: 38, dur: 1.2 },
        { p: at(2.7, 0.3, 1.3), t: [f[0], f[1] - 0.6, f[2]], fov: 40, dur: 1 },
      ];
    }
    case 'closeUp': {
      const s = seatOf(spec.target);
      if (!s) return build({ preset: 'home' }, w, dur, seatOf);
      const at = around(s);
      const f = face(s);
      return [
        { p: at(2.9, 0.7, 1.35), t: [f[0], f[1] - 0.55, f[2]], fov: 38, dur: 0 },
        { p: at(2.5, 0.25, 1.25), t: [f[0], f[1] - 0.55, f[2]], fov: 36, dur: 1 },
      ];
    }
    case 'overShoulder': {
      const from = seatOf(spec.from);
      const to = seatOf(spec.target);
      if (!from || !to) return build({ preset: 'home' }, w, dur, seatOf);
      const behind = around(from);
      const f = face(to);
      return [
        { p: behind(-1.3, 0.75, SEATED_HEIGHT + 0.35), t: f, fov: 34, dur: 0 },
        { p: behind(-0.9, 0.6, SEATED_HEIGHT + 0.3), t: f, fov: 31, dur: 1 },
      ];
    }
  }
}

const WIDE = new Set(['home', 'wide', 'orbit', 'circleSlow', 'revealTown', 'lowAngle']);

/** 9:16: keep wide shots' framing by backing away from the subject and widening the lens a little. */
function vertical(keys: CamKey[], wide: boolean): CamKey[] {
  return keys.map((k) => {
    const p = new Vector3(...k.p);
    const t = new Vector3(...k.t);
    const back = wide ? 1.5 : 1.12;
    const np = t.clone().add(p.sub(t).multiplyScalar(back));
    np.y = Math.max(0.35, np.y);
    return { ...k, p: np.toArray() as V3, fov: Math.min(75, k.fov + (wide ? 8 : 5)) };
  });
}

export function shotPath(spec: CameraSpec, w: CamWorld, dur: number, format: Format, seatOf: (ref?: string) => SeatInfo | null, custom9x16 = false): CamPath {
  let keys = stretch(build(spec, w, dur, seatOf), Math.max(0.01, dur));
  // Hand-made 9:16 keys are used as they are.
  if (isTall(format) && !custom9x16) keys = vertical(keys, 'preset' in spec ? WIDE.has(spec.preset) : true);
  return { name: 'shot', keys };
}

export function sampleShot(path: CamPath, time: number) {
  return samplePath(path, time);
}
