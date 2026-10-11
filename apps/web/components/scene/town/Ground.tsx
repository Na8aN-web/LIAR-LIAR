'use client';

import { useEffect, useMemo } from 'react';
import { useTexture } from '@react-three/drei';
import {
  BufferGeometry,
  CanvasTexture,
  DodecahedronGeometry,
  DoubleSide,
  Float32BufferAttribute,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  RepeatWrapping,
  SRGBColorSpace,
  Vector2,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// The town-square floor: ambientCG Ground111 dirt (color + normal map, tiled) so it catches the
// firelight, an ash-and-scorch patch around the fire, scattered stones, dry grass tufts and faint
// wheel ruts out toward the streets. Every detail is one draw call (instanced or merged).

/** Metres per texture tile. */
const TILE = 3.2;

/** Deterministic pseudo-random, so every screen shows the same ground. */
function rng(seed: number) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
}

function canvasTexture(size: number, draw: (g: CanvasRenderingContext2D, size: number) => void) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d')!, size);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

/** Ash in the middle, scorched earth fading out in a ragged ring. */
function scorchTexture() {
  return canvasTexture(256, (g, n) => {
    const r = rng(41);
    const c = n / 2;
    const grad = g.createRadialGradient(c, c, 0, c, c, c);
    grad.addColorStop(0, 'rgba(70,66,62,1)'); // grey ash
    grad.addColorStop(0.3, 'rgba(22,17,13,0.97)');
    grad.addColorStop(0.6, 'rgba(14,9,6,0.75)');
    grad.addColorStop(1, 'rgba(18,12,8,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, n, n);
    // Ragged edge and specks of pale ash.
    for (let i = 0; i < 260; i++) {
      const a = r() * Math.PI * 2;
      const d = (0.25 + r() * 0.75) * c * 0.95;
      g.fillStyle = r() < 0.7 ? `rgba(14,10,6,${0.12 + r() * 0.25})` : `rgba(120,112,104,${0.08 + r() * 0.15})`;
      g.beginPath();
      g.arc(c + Math.cos(a) * d, c + Math.sin(a) * d, 2 + r() * 9, 0, Math.PI * 2);
      g.fill();
    }
  });
}

/** A rut: a soft dark stripe, broken up along its length. */
function rutTexture() {
  return canvasTexture(128, (g, n) => {
    const r = rng(7);
    for (let y = 0; y < n; y += 2) {
      const w = n * (0.28 + r() * 0.12);
      const a = 0.4 + 0.35 * r();
      const grad = g.createLinearGradient((n - w) / 2, 0, (n + w) / 2, 0);
      grad.addColorStop(0, 'rgba(20,14,9,0)');
      grad.addColorStop(0.5, `rgba(20,14,9,${a})`);
      grad.addColorStop(1, 'rgba(20,14,9,0)');
      g.fillStyle = grad;
      g.fillRect(0, y, n, 2);
    }
  });
}

/** A tuft of dry grass: a fan of thin bent blades. */
function tuftGeometry(): BufferGeometry {
  const r = rng(5);
  const blades: BufferGeometry[] = [];
  for (let i = 0; i < 9; i++) {
    const h = 0.18 + r() * 0.2;
    const w = 0.025;
    const lean = (r() - 0.5) * 0.5;
    const pos = [-w, 0, 0, w, 0, 0, lean * 0.6, h * 0.6, 0.01, lean, h, 0.02];
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(pos, 3));
    g.setIndex([0, 1, 2, 1, 3, 2]);
    g.rotateY((i / 9) * Math.PI * 2 + r());
    g.translate((r() - 0.5) * 0.08, 0, (r() - 0.5) * 0.08);
    blades.push(g);
  }
  const g = mergeGeometries(blades)!;
  g.computeVertexNormals();
  return g;
}

interface Props {
  /** Outer radius of the floor. */
  radius: number;
  /** Radius of the seat circle (stones and grass keep out of it). */
  circleRadius: number;
  /** Directions (degrees, 0 = +z) the wheel ruts run toward. */
  rutAngles: number[];
  /** Ruts run from here to `rutTo` (distance from the centre). */
  rutFrom: number;
  rutTo: number;
  /** How many stones and tufts to scatter. */
  stones?: number;
  tufts?: number;
}

export function Ground({ radius, circleRadius, rutAngles, rutFrom, rutTo, stones = 46, tufts = 70 }: Props) {
  const [color, normal] = useTexture(['/textures/dirt-color.webp', '/textures/dirt-normal.webp']);
  useMemo(() => {
    for (const t of [color, normal]) {
      t.wrapS = t.wrapT = RepeatWrapping;
      t.repeat.set((radius * 2) / TILE, (radius * 2) / TILE);
      t.anisotropy = 4;
    }
    color.colorSpace = SRGBColorSpace;
  }, [color, normal, radius]);

  const scorch = useMemo(() => scorchTexture(), []);
  const rut = useMemo(() => rutTexture(), []);
  useEffect(() => () => scorch.dispose(), [scorch]);
  useEffect(() => () => rut.dispose(), [rut]);

  // Ruts: two parallel tracks per direction, merged into one mesh.
  const ruts = useMemo(() => {
    const parts: BufferGeometry[] = [];
    const len = rutTo - rutFrom;
    for (const a of rutAngles) {
      const rad = (a * Math.PI) / 180;
      for (const side of [-0.75, 0.75]) {
        const p = new PlaneGeometry(0.42, len, 1, 1);
        p.rotateX(-Math.PI / 2);
        p.translate(side, 0, -(rutFrom + len / 2));
        p.rotateY(rad + Math.PI);
        parts.push(p);
      }
    }
    return parts.length ? mergeGeometries(parts) : null;
  }, [rutAngles, rutFrom, rutTo]);

  // Stones and tufts: scattered between the seats and the ring of buildings, clear of the circle.
  const scatter = useMemo(() => {
    const r = rng(1234);
    const place = (n: number, min: number, max: number) =>
      Array.from({ length: n }, () => {
        const a = r() * Math.PI * 2;
        const d = min + Math.sqrt(r()) * (max - min);
        return { x: Math.sin(a) * d, z: Math.cos(a) * d, s: r(), rot: r() * Math.PI * 2 };
      });
    return {
      stones: place(stones, circleRadius + 1.6, radius * 0.92),
      tufts: place(tufts, circleRadius + 2.2, radius * 0.98),
      // A few stones and wisps of grass just past the hearth, inside the circle.
      hearth: place(8, 1.4, Math.max(1.6, circleRadius - 1.2)),
    };
  }, [stones, tufts, circleRadius, radius]);

  const stoneMesh = useMemo(() => {
    const all = [...scatter.stones, ...scatter.hearth];
    const mesh = new InstancedMesh(new DodecahedronGeometry(1, 0), new MeshStandardMaterial({ color: '#6a625a', roughness: 1, flatShading: true }), all.length);
    const m = new Matrix4();
    const q = new Quaternion();
    all.forEach((p, i) => {
      const size = 0.05 + p.s * 0.14;
      q.setFromAxisAngle(new Vector3(0.3, 1, 0.2).normalize(), p.rot);
      m.compose(new Vector3(p.x, size * 0.3, p.z), q, new Vector3(size * 1.2, size * 0.6, size));
      mesh.setMatrixAt(i, m);
    });
    mesh.instanceMatrix.needsUpdate = true;
    return mesh;
  }, [scatter]);

  const tuftMesh = useMemo(() => {
    const mesh = new InstancedMesh(tuftGeometry(), new MeshStandardMaterial({ color: '#a08a52', roughness: 1, side: DoubleSide }), scatter.tufts.length);
    const m = new Matrix4();
    const q = new Quaternion();
    scatter.tufts.forEach((p, i) => {
      const size = 1.3 + p.s * 1.2;
      q.setFromAxisAngle(new Vector3(0, 1, 0), p.rot);
      m.compose(new Vector3(p.x, 0, p.z), q, new Vector3(size, size, size));
      mesh.setMatrixAt(i, m);
    });
    mesh.instanceMatrix.needsUpdate = true;
    return mesh;
  }, [scatter]);
  useEffect(
    () => () => {
      stoneMesh.dispose();
      tuftMesh.dispose();
    },
    [stoneMesh, tuftMesh],
  );

  const normalScale = useMemo(() => new Vector2(1.4, 1.4), []);
  return (
    <group name="ground">
      <mesh rotation-x={-Math.PI / 2} position-y={-0.01}>
        <circleGeometry args={[radius, 64]} />
        <meshStandardMaterial map={color} normalMap={normal} normalScale={normalScale} color="#a8968a" roughness={1} />
      </mesh>
      {/* Ash and scorch around the fire. */}
      <mesh rotation-x={-Math.PI / 2} position-y={0.004}>
        <circleGeometry args={[2.6, 32]} />
        <meshStandardMaterial map={scorch} transparent depthWrite={false} roughness={1} polygonOffset polygonOffsetFactor={-1} />
      </mesh>
      {ruts && (
        <mesh geometry={ruts} position-y={0.003}>
          <meshStandardMaterial map={rut} transparent depthWrite={false} roughness={1} polygonOffset polygonOffsetFactor={-1} />
        </mesh>
      )}
      <primitive object={stoneMesh} />
      <primitive object={tuftMesh} />
    </group>
  );
}
