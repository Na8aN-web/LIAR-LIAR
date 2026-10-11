import { BufferGeometry, Float32BufferAttribute, IcosahedronGeometry } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { ItemType } from '@wtc/shared';

// Low-poly colored items, built in code and fitted to scarecrow.glb.
// Units are the model's own: feet at y=0, head top at y≈1.96, front facing +z.
// Measured from the mesh: torso centred near x=-0.02, z=-0.03; shoulders ≈ y 1.50;
// straw collar y 1.60–1.72; arms reach x≈±0.5 by y 1.20.

const CX = -0.02;
const CZ = -0.03;

interface Ring {
  y: number;
  rx: number;
  rz: number;
  /** Extra drop at the front and back (poncho points). */
  pointDrop?: number;
  /** Alternate vertices drop by this much (ragged hem). */
  zigzag?: number;
}

/** Stack of elliptical rings joined into a tube. thetaLength < 2π gives an open shape (cloak). */
function loft(rings: Ring[], segments: number, thetaStart = 0, thetaLength = Math.PI * 2): BufferGeometry {
  const closed = thetaLength >= Math.PI * 2 - 1e-6;
  const cols = closed ? segments : segments + 1;
  const pos: number[] = [];
  for (const r of rings) {
    for (let i = 0; i < cols; i++) {
      const t = thetaStart + (i / segments) * thetaLength;
      const front = Math.abs(Math.cos(t)); // 1 at front/back, 0 at the sides
      const y = r.y - (r.pointDrop ?? 0) * front ** 2 - (i % 2 ? (r.zigzag ?? 0) : 0);
      pos.push(CX + r.rx * Math.sin(t), y, CZ + r.rz * Math.cos(t));
    }
  }
  const idx: number[] = [];
  for (let k = 0; k < rings.length - 1; k++) {
    for (let i = 0; i < segments; i++) {
      const a = k * cols + i;
      const b = k * cols + ((i + 1) % cols);
      const c = (k + 1) * cols + i;
      const d = (k + 1) * cols + ((i + 1) % cols);
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function poncho() {
  // Neck sits just under the straw collar so the straw pokes out on top.
  return loft(
    [
      { y: 1.63, rx: 0.16, rz: 0.15 },
      { y: 1.52, rx: 0.33, rz: 0.21 },
      { y: 1.23, rx: 0.53, rz: 0.27, pointDrop: 0.07, zigzag: 0.035 },
    ],
    14,
  );
}

function cloak() {
  // Back half only, a short cape from the shoulders to the waist. It stops above the seat
  // so it can't sink into a log or crate when the scarecrow sits.
  return loft(
    [
      { y: 1.58, rx: 0.2, rz: 0.16 },
      { y: 1.5, rx: 0.33, rz: 0.21 },
      { y: 1.14, rx: 0.4, rz: 0.27, zigzag: 0.035 },
    ],
    12,
    Math.PI / 2,
    Math.PI,
  );
}

/** A curved kerchief panel hanging at the front: a triangle subdivided so it can bulge over the chest. */
function kerchief(): BufferGeometry {
  const rows = 5;
  const top = 1.63;
  const height = 0.36;
  const halfW = 0.21;
  const pos: number[] = [];
  const idx: number[] = [];
  const at = (r: number, c: number) => (r * (r + 1)) / 2 + c; // row r has r+1 points, tip first
  for (let r = 0; r <= rows; r++) {
    const t = r / rows; // 0 at the tip, 1 at the top edge
    const y = top - height * (1 - t);
    for (let c = 0; c <= r; c++) {
      const u = r === 0 ? 0 : (c / r) * 2 - 1;
      const x = CX + u * halfW * t;
      // Hangs out over the chest, most at the middle.
      const z = CZ + 0.195 + 0.06 * (1 - t) + 0.03 * (1 - u * u) * t;
      pos.push(x, y, z);
    }
  }
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c <= r; c++) {
      idx.push(at(r, c), at(r + 1, c), at(r + 1, c + 1));
      if (c < r) idx.push(at(r, c), at(r + 1, c + 1), at(r, c + 1));
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g.toNonIndexed();
}

/** One tail of the knot: a tapering strip hanging from the back of the neck. */
function tail(side: number): BufferGeometry {
  const steps = 4;
  const pos: number[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = CX + side * (0.02 + 0.08 * t);
    const y = 1.62 - 0.24 * t;
    const z = CZ - 0.21 - 0.03 * t;
    const w = 0.04 * (1 - 0.55 * t);
    // The strip turns a little as it falls.
    const a = side * 0.5 * t;
    pos.push(x - w * Math.cos(a), y, z - w * Math.sin(a), x + w * Math.cos(a), y, z + w * Math.sin(a));
  }
  const idx: number[] = [];
  for (let i = 0; i < steps; i++) idx.push(i * 2, i * 2 + 2, i * 2 + 1, i * 2 + 1, i * 2 + 2, i * 2 + 3);
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g.toNonIndexed();
}

function bandana() {
  // A wide band over the straw collar, a big kerchief at the front, and a knot with two
  // hanging tails at the back, so it reads from across the fire.
  const band = loft(
    [
      // Rolled cloth: fuller in the middle than at the edges.
      { y: 1.685, rx: 0.19, rz: 0.18 },
      { y: 1.645, rx: 0.215, rz: 0.2 },
      { y: 1.6, rx: 0.205, rz: 0.19 },
    ],
    16,
  ).toNonIndexed();
  const knot = new IcosahedronGeometry(0.05, 0);
  knot.scale(1.3, 0.9, 0.8);
  knot.translate(CX, 1.64, CZ - 0.205);
  const parts = [band, kerchief(), knot, tail(-1), tail(1)].map((g) => {
    g.deleteAttribute('normal');
    g.deleteAttribute('uv');
    return g;
  });
  const g = mergeGeometries(parts)!;
  g.computeVertexNormals();
  return g;
}

let cache: Record<ItemType, BufferGeometry> | null = null;

/** Built once and shared by every scarecrow; only materials are per player. */
export function itemGeometries(): Record<ItemType, BufferGeometry> {
  cache ??= { poncho: poncho(), cloak: cloak(), bandana: bandana() };
  return cache;
}
