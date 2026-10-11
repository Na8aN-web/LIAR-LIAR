import { BufferGeometry, Float32BufferAttribute } from 'three';
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
      { y: 1.2, rx: 0.53, rz: 0.27, pointDrop: 0.12, zigzag: 0.035 },
    ],
    14,
  );
}

function cloak() {
  // Back half only, from the shoulders to the knees.
  return loft(
    [
      { y: 1.58, rx: 0.2, rz: 0.16 },
      { y: 1.5, rx: 0.32, rz: 0.2 },
      { y: 0.75, rx: 0.42, rz: 0.3, zigzag: 0.04 },
    ],
    10,
    Math.PI / 2,
    Math.PI,
  );
}

function bandana() {
  // A band over the collar plus a triangle hanging at the front.
  const band = loft(
    [
      { y: 1.67, rx: 0.2, rz: 0.19 },
      { y: 1.57, rx: 0.22, rz: 0.2 },
    ],
    12,
  );
  const pos = Array.from(band.getAttribute('position').array);
  const idx = Array.from(band.getIndex()!.array);
  const base = pos.length / 3;
  const z = CZ + 0.205;
  pos.push(CX - 0.12, 1.6, z, CX + 0.12, 1.6, z, CX, 1.4, z + 0.04);
  idx.push(base, base + 2, base + 1);
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

let cache: Record<ItemType, BufferGeometry> | null = null;

/** Built once and shared by every scarecrow; only materials are per player. */
export function itemGeometries(): Record<ItemType, BufferGeometry> {
  cache ??= { poncho: poncho(), cloak: cloak(), bandana: bandana() };
  return cache;
}
