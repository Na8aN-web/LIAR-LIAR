import {
  BoxGeometry,
  BufferGeometry,
  CatmullRomCurve3,
  CylinderGeometry,
  Euler,
  Float32BufferAttribute,
  LatheGeometry,
  Matrix4,
  Quaternion,
  SRGBColorSpace,
  TorusGeometry,
  TubeGeometry,
  Vector2,
  Vector3,
  Color,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { COSMETICS, COSMETIC_TONES, NO_COSMETIC, type CosmeticTone } from '@wtc/shared';

// Shapes for the cosmetics catalog (packages/shared/src/cosmetics.ts), built in code around
// the measured head of the rigged scarecrow. Each builder returns parts in model units (feet
// at y=0, +z = face) with a catalog tone each; scarecrowModel.ts merges a look into one mesh and
// skins it to the head with the head's own weights, so hats and stitches move with the head.
//
// To add an item: add it to COSMETICS in the shared catalog, then a builder here under its id.

export interface HeadFrame {
  /** Head vertices in model units (bind pose). */
  verts: Vector3[];
  min: Vector3;
  max: Vector3;
  center: Vector3;
  /** Half width (x) and half height (y) of the head. */
  hw: number;
  hh: number;
}

export interface Part {
  geometry: BufferGeometry;
  tone: CosmeticTone;
}

type Builder = (head: HeadFrame) => Part[];

/** Front surface of the head (max z) near (x, y). */
function surfaceZ(head: HeadFrame, x: number, y: number): number {
  for (const r of [0.012, 0.025, 0.05]) {
    let best = -Infinity;
    for (const v of head.verts) if (Math.abs(v.x - x) < r && Math.abs(v.y - y) < r && v.z > best) best = v.z;
    if (best > -Infinity) return best;
  }
  return head.max.z;
}

/** A point on the face at (x, y), lifted `lift` off the surface, with the surface's sideways slope. */
function onFace(head: HeadFrame, x: number, y: number, lift = 0.004) {
  const d = 0.012;
  const z = surfaceZ(head, x, y);
  const slope = (surfaceZ(head, x + d, y) - surfaceZ(head, x - d, y)) / (2 * d);
  return { p: new Vector3(x, y, z + lift), yaw: Math.atan(-slope) };
}

/** Distance from the head's centre axis to its surface, in a direction, at a height. */
function radiusAt(head: HeadFrame, angle: number, y: number): number {
  const dir = new Vector3(Math.sin(angle), 0, Math.cos(angle));
  let best = 0;
  for (const v of head.verts) {
    if (Math.abs(v.y - y) > 0.02) continue;
    const dx = v.x - head.center.x;
    const dz = v.z - head.center.z;
    const along = dx * dir.x + dz * dir.z;
    const across = Math.abs(dx * dir.z - dz * dir.x);
    if (along > 0 && across < 0.02 && along > best) best = along;
  }
  return best || head.hw;
}

const place = (g: BufferGeometry, p: Vector3, rot = new Euler()) =>
  g.applyMatrix4(new Matrix4().compose(p, new Quaternion().setFromEuler(rot), new Vector3(1, 1, 1)));

/** A stitch: a short dark bar across the seam, standing on the surface. */
function stitch(head: HeadFrame, x: number, y: number, angle: number, length: number): BufferGeometry {
  const { p, yaw } = onFace(head, x, y, 0.003);
  // Bold enough to read from across the fire (a few pixels at the default camera).
  return place(new BoxGeometry(0.032, length, 0.02), p, new Euler(0, yaw, angle));
}

/** A seam line across the face through the given (x, y) points. */
function seam(head: HeadFrame, pts: [number, number][]): BufferGeometry {
  const curve = new CatmullRomCurve3(pts.map(([x, y]) => onFace(head, x, y, 0.002).p));
  return new TubeGeometry(curve, pts.length * 4, 0.017, 5, false);
}

// ---------------------------------------------------------------- hats

/** Where a hat sits: centred over the head, its crown taking in the top part of the head. */
function hatBase(head: HeadFrame, sink: number) {
  return new Vector3(head.center.x, head.max.y - sink * head.hh * 2, head.center.z - 0.01);
}

/** Rotationally symmetric hat from a (radius, height) profile, from the crown top outward. */
function lathe(profile: [number, number][], segments = 20): BufferGeometry {
  return new LatheGeometry(profile.map(([r, y]) => new Vector2(r, y)), segments);
}

/** Hat band: a short open cylinder around the crown. */
function band(radius: number, y0: number, y1: number): BufferGeometry {
  const g = new CylinderGeometry(radius, radius, y1 - y0, 20, 1, true);
  g.translate(0, (y0 + y1) / 2, 0);
  return g;
}

function finishHat(head: HeadFrame, parts: Part[], sink: number, tilt: number): Part[] {
  const base = hatBase(head, sink);
  const m = new Matrix4().compose(base, new Quaternion().setFromEuler(new Euler(tilt, 0, 0)), new Vector3(1, 1, 1));
  for (const p of parts) p.geometry.applyMatrix4(m);
  return parts;
}

const BUILDERS: Record<string, Builder> = {
  'straw-hat': (head) => {
    const R = head.hw * 1.05;
    const brim = head.hw * 2.15;
    const crownH = head.hh * 0.9;
    const hat = lathe([
      [0, crownH],
      [R * 0.85, crownH],
      [R * 0.98, crownH * 0.9],
      [R, 0.02],
      [brim, -0.01],
      [brim * 1.01, -0.025],
      [R * 1.02, -0.005],
    ]);
    // A soft wave in the brim, so it doesn't look machined.
    const pos = hat.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const r = Math.hypot(x, z);
      if (r > R * 1.1) pos.setY(i, pos.getY(i) + 0.012 * Math.sin(Math.atan2(z, x) * 5) * ((r - R) / (brim - R)));
    }
    return finishHat(head, [{ geometry: hat, tone: 'straw' }, { geometry: band(R * 1.02, 0.015, 0.06), tone: 'leather' }], 0.3, -0.12);
  },

  'cowboy-hat': (head) => {
    const R = head.hw * 1.04;
    const brim = head.hw * 1.95;
    const crownH = head.hh * 1.05;
    const hat = lathe(
      [
        [0, crownH * 0.85],
        [R * 0.8, crownH],
        [R * 0.97, crownH * 0.9],
        [R, 0.02],
        [brim, 0.0],
        [brim * 1.01, -0.018],
        [R * 1.02, -0.005],
      ],
      24,
    );
    const pos = hat.getAttribute('position');
    // Battered: a crease down the crown, the brim curled up at the sides and dipped at the
    // front, and a few dents. Deterministic so every screen shows the same hat.
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5);
    for (let i = 0; i < pos.count; i++) {
      let x = pos.getX(i);
      let y = pos.getY(i);
      const z = pos.getZ(i);
      const r = Math.hypot(x, z);
      if (r <= R * 1.05 && y > crownH * 0.55) y -= 0.05 * Math.max(0, 1 - (x / (R * 0.55)) ** 2) * ((y - crownH * 0.55) / (crownH * 0.45));
      if (r > R * 1.05) {
        const t = (r - R) / (brim - R);
        y += 0.07 * t * t * (x / r) ** 2 - 0.035 * t * Math.max(0, z / r);
      }
      x += rnd() * 0.006;
      y += rnd() * 0.006;
      pos.setXYZ(i, x, y, z);
    }
    hat.computeVertexNormals();
    return finishHat(head, [{ geometry: hat, tone: 'felt' }, { geometry: band(R * 1.02, 0.015, 0.05), tone: 'band' }], 0.32, -0.16);
  },

  'top-hat': (head) => {
    const R = head.hw * 0.98;
    const brim = head.hw * 1.6;
    const crownH = head.hh * 1.75;
    const hat = lathe([
      [0, crownH],
      [R * 1.08, crownH],
      [R, 0.02],
      [brim, 0.01],
      [brim * 1.02, -0.012],
      [R * 1.02, -0.005],
    ]);
    // Brim rolled up at the sides.
    const pos = hat.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const r = Math.hypot(x, pos.getZ(i));
      if (r > R * 1.1) pos.setY(i, pos.getY(i) + 0.03 * ((r - R) / (brim - R)) ** 2 * (x / r) ** 2);
    }
    hat.computeVertexNormals();
    return finishHat(head, [{ geometry: hat, tone: 'soot' }, { geometry: band(R * 1.015, 0.02, 0.085), tone: 'leather' }], 0.26, -0.1);
  },

  bowler: (head) => {
    const R = head.hw * 1.03;
    const brim = head.hw * 1.4;
    const h = head.hh * 0.95;
    const dome: [number, number][] = [];
    for (let i = 0; i <= 6; i++) {
      const a = (i / 6) * (Math.PI / 2);
      dome.push([R * Math.sin(a), 0.02 + h * Math.cos(a)]);
    }
    const hat = lathe([...dome, [brim * 0.97, 0.0], [brim, 0.018], [brim * 1.01, 0.004], [R * 1.02, -0.006]]);
    return finishHat(head, [{ geometry: hat, tone: 'charcoal' }, { geometry: band(R * 1.02, 0.015, 0.045), tone: 'band' }], 0.3, -0.08);
  },

  // ---------------------------------------------------------------- head details

  'stitched-grin': (head) => {
    const { x: cx, y: cy } = head.center;
    const y0 = cy - head.hh * 0.32;
    const pts: [number, number][] = [];
    for (let i = 0; i <= 6; i++) {
      const u = i / 6 - 0.5;
      pts.push([cx + u * head.hw * 1.05, y0 + 0.05 * head.hh * 4 * u * u]);
    }
    const parts: Part[] = [{ geometry: seam(head, pts), tone: 'thread' }];
    for (let i = 0; i < 7; i++) {
      const u = (i + 0.5) / 7 - 0.5;
      parts.push({ geometry: stitch(head, cx + u * head.hw * 1.0, y0 + 0.05 * head.hh * 4 * u * u, u * 0.5, head.hh * 0.3), tone: 'thread' });
    }
    return parts;
  },

  'stitched-scar': (head) => {
    const { x: cx, y: cy } = head.center;
    const a: [number, number] = [cx - head.hw * 0.55, cy + head.hh * 0.42];
    const b: [number, number] = [cx + head.hw * 0.15, cy - head.hh * 0.5];
    const parts: Part[] = [{ geometry: seam(head, [a, [(a[0] + b[0]) / 2 - 0.01, (a[1] + b[1]) / 2], b]), tone: 'thread' }];
    const along = Math.atan2(b[1] - a[1], b[0] - a[0]);
    for (let i = 1; i <= 5; i++) {
      const t = i / 6;
      const x = a[0] + (b[0] - a[0]) * t;
      const y = a[1] + (b[1] - a[1]) * t;
      // Cross-stitches: two bars making an X over the seam.
      for (const d of [Math.PI / 4, -Math.PI / 4]) parts.push({ geometry: stitch(head, x, y, along + d, head.hh * 0.28), tone: 'thread' });
    }
    return parts;
  },

  'button-eye': (head) => {
    const { x: cx, y: cy } = head.center;
    const r = head.hw * 0.55;
    const { p, yaw } = onFace(head, cx + head.hw * 0.36, cy + head.hh * 0.14, 0.006);
    const rot = new Euler(Math.PI / 2, yaw, 0, 'YXZ');
    const disc = place(new CylinderGeometry(r, r, 0.02, 16), p, rot);
    const rim = place(new TorusGeometry(r * 0.9, 0.01, 4, 16), p.clone().add(new Vector3(0, 0, 0.01)), new Euler(0, yaw, 0));
    const parts: Part[] = [
      { geometry: disc, tone: 'soot' },
      { geometry: rim, tone: 'soot' },
    ];
    // Sewn on with a pale X of straw thread, so it reads against the black button.
    for (const d of [Math.PI / 4, -Math.PI / 4]) {
      parts.push({ geometry: place(new BoxGeometry(0.022, r * 1.15, 0.012), p.clone().add(new Vector3(0, 0, 0.014)), new Euler(0, yaw, d)), tone: 'straw' });
    }
    return parts;
  },

  'eye-patch': (head) => {
    const { x: cx, y: cy } = head.center;
    const ex = cx - head.hw * 0.36;
    const ey = cy + head.hh * 0.14;
    const { p, yaw } = onFace(head, ex, ey, 0.006);
    const patch = new CylinderGeometry(head.hw * 0.62, head.hw * 0.55, 0.024, 14);
    patch.scale(1, 1, 0.85);
    place(patch, p, new Euler(Math.PI / 2, yaw, 0, 'YXZ'));
    // The strap runs round the head on a slant, through the patch.
    const pts: Vector3[] = [];
    const tilt = 0.45 * head.hh;
    for (let i = 0; i < 28; i++) {
      const a = (i / 28) * Math.PI * 2;
      // Higher on the far side of the head, through the patch at the front.
      const y = ey + tilt * (Math.sin(a) * 0.6 - (1 - Math.cos(a)) * 0.25);
      const r = radiusAt(head, a, y) + 0.006;
      pts.push(new Vector3(head.center.x + Math.sin(a) * r, y, head.center.z + Math.cos(a) * r));
    }
    const strap = new TubeGeometry(new CatmullRomCurve3(pts, true), 56, 0.016, 4, true);
    return [
      { geometry: patch, tone: 'soot' },
      { geometry: strap, tone: 'band' },
    ];
  },
};

// A catalog item without a shape would silently render nothing: say so in development.
if (process.env.NODE_ENV !== 'production') {
  const missing = COSMETICS.filter((c) => !BUILDERS[c.id]).map((c) => c.id);
  if (missing.length) console.warn('Cosmetics with no shape in cosmetics.ts:', missing);
}

const linear = (hex: string) => new Color().setStyle(hex, SRGBColorSpace);

/** One cosmetic as a geometry with vertex colors (model units), or null for none. */
export function buildCosmetic(head: HeadFrame, id: string): BufferGeometry | null {
  const b = id === NO_COSMETIC ? undefined : BUILDERS[id];
  if (!b) return null;
  const geos = b(head).map(({ geometry, tone }) => {
    const g = geometry.index ? geometry.toNonIndexed() : geometry;
    g.deleteAttribute('uv');
    g.deleteAttribute('normal');
    g.computeVertexNormals();
    const c = linear(COSMETIC_TONES[tone]);
    const colors = new Float32Array(g.getAttribute('position').count * 3);
    for (let i = 0; i < colors.length; i += 3) {
      colors[i] = c.r;
      colors[i + 1] = c.g;
      colors[i + 2] = c.b;
    }
    g.setAttribute('color', new Float32BufferAttribute(colors, 3));
    return g;
  });
  return mergeGeometries(geos);
}
