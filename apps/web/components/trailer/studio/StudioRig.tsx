'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import {
  DirectionalLight,
  Fog,
  Mesh,
  PCFSoftShadowMap,
  PointLight,
  Vector3,
  type Material,
  type Object3D,
  type PerspectiveCamera,
  type Texture,
} from 'three';
import type { V3 } from '../paths';

// Inside the canvas: puts the camera where the studio says for this frame, shakes it, renders at
// trailer quality (shadows, sharpest texture filtering), fades scarecrows out, and projects
// world points to frame pixels for the overlays. The studio drives time; this just follows.

export interface FrameCam {
  p: Vector3;
  t: Vector3;
  fov: number;
  /** Camera shake strength (0–1) and trailer time for its noise. */
  shake: number;
  time: number;
}

export interface StudioRigApi {
  project: (p: V3) => { x: number; y: number; visible: boolean };
  find: (name: string) => V3 | null;
  /** Models and textures in, shaders compiled. */
  ready: () => boolean;
}

const FOG_COLOR = '#0c0e1a';

/** Smooth pseudo-noise from a few sines: no jumps between frames. */
const wobble = (t: number, a: number, b: number, c: number) => Math.sin(t * a) * 0.5 + Math.sin(t * b + 1.3) * 0.3 + Math.sin(t * c + 2.1) * 0.2;

export function StudioRig({
  api,
  frame,
  fades,
  ringR,
  shadows,
}: {
  api: React.MutableRefObject<StudioRigApi | null>;
  /** Written by the studio before every rendered frame. */
  frame: React.MutableRefObject<FrameCam | null>;
  /** Scarecrow opacity by player id (1 = solid). */
  fades: React.MutableRefObject<Record<string, number>>;
  ringR: number;
  shadows: boolean;
}) {
  const camera = useThree((s) => s.camera) as PerspectiveCamera;
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const size = useThree((s) => s.size);
  const tmp = useMemo(() => ({ v: new Vector3(), right: new Vector3(), up: new Vector3() }), []);
  const tuned = useRef({ count: -1, frames: 0 });
  const readyAt = useRef<number | null>(null);

  useEffect(() => {
    scene.fog = new Fog(FOG_COLOR, 24, ringR + 55);
  }, [scene, ringR]);

  useEffect(() => {
    gl.shadowMap.enabled = shadows;
    gl.shadowMap.type = PCFSoftShadowMap;
    tuned.current.count = -1;
  }, [gl, shadows]);

  useEffect(() => {
    api.current = {
      project: (p) => {
        tmp.v.set(...p).project(camera);
        return { x: ((tmp.v.x + 1) / 2) * size.width, y: ((1 - tmp.v.y) / 2) * size.height, visible: tmp.v.z < 1 && tmp.v.z > -1 };
      },
      find: (name) => {
        const o = scene.getObjectByName(name);
        return o ? (o.getWorldPosition(new Vector3()).toArray() as V3) : null;
      },
      ready: () => readyAt.current !== null && performance.now() - readyAt.current > 300,
    };
  });

  /** Shadows and texture filtering for everything in the scene (re-run as models stream in). */
  const tune = () => {
    let count = 0;
    const maxAniso = gl.capabilities.getMaxAnisotropy();
    scene.traverse((o: Object3D) => {
      count++;
      if (o instanceof PointLight || o instanceof DirectionalLight) {
        o.castShadow = shadows && (o instanceof DirectionalLight || o.distance > 30 || o.intensity > 20);
        if (o.castShadow) {
          o.shadow.mapSize.set(2048, 2048);
          o.shadow.bias = -0.0006;
          o.shadow.normalBias = 0.03;
          if (o instanceof DirectionalLight) {
            const c = o.shadow.camera;
            c.left = c.bottom = -ringR - 6;
            c.right = c.top = ringR + 6;
            c.near = 1;
            c.far = 120;
            c.updateProjectionMatrix();
          } else {
            o.shadow.camera.near = 0.2;
            o.shadow.camera.far = 45;
          }
        }
      }
      if (o instanceof Mesh) {
        const mats = (Array.isArray(o.material) ? o.material : [o.material]) as (Material & { map?: Texture | null; transparent: boolean })[];
        const solid = mats.every((m) => !m.transparent && m.type !== 'MeshBasicMaterial' && m.type !== 'ShaderMaterial');
        o.castShadow = shadows && solid;
        o.receiveShadow = shadows && solid;
        for (const m of mats) {
          for (const key of ['map', 'normalMap', 'roughnessMap'] as const) {
            const tex = (m as unknown as Record<string, Texture | null | undefined>)[key];
            if (tex && tex.anisotropy !== maxAniso) {
              tex.anisotropy = maxAniso;
              tex.needsUpdate = true;
            }
          }
        }
      }
    });
    if (count !== tuned.current.count) {
      // New objects: recompile with shadows on.
      scene.traverse((o) => {
        if (o instanceof Mesh) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m: Material) => (m.needsUpdate = true));
      });
    }
    return count;
  };

  /** Escape: fades a scarecrow's own materials (cloned once, so nobody else fades with it). */
  const applyFades = () => {
    for (const [id, opacity] of Object.entries(fades.current)) {
      const root = scene.getObjectByName(`scarecrow:${id}`);
      if (!root) continue;
      // Untouched until it first fades; restored exactly when it's back to solid.
      if (opacity >= 0.999 && !root.userData.fading) continue;
      root.userData.fading = opacity < 0.999;
      root.visible = opacity > 0.01;
      root.traverse((o) => {
        if (!(o instanceof Mesh)) return;
        if (!o.userData.fadeOwn) {
          o.material = Array.isArray(o.material) ? o.material.map((m: Material) => m.clone()) : o.material.clone();
          o.userData.fadeOwn = true;
          o.userData.fadeBase = (Array.isArray(o.material) ? o.material : [o.material]).map((m: Material) => ({ t: m.transparent, o: m.opacity, d: m.depthWrite }));
        }
        const base = o.userData.fadeBase as { t: boolean; o: number; d: boolean }[];
        (Array.isArray(o.material) ? o.material : [o.material]).forEach((m: Material, i: number) => {
          const solid = opacity >= 0.999;
          m.transparent = solid ? base[i].t : true;
          m.opacity = solid ? base[i].o : base[i].o * opacity;
          m.depthWrite = solid ? base[i].d : false;
        });
      });
    }
  };

  useFrame(() => {
    // Shadows/filtering: on the first frames and whenever the scene grows.
    tuned.current.frames++;
    if (tuned.current.frames % 30 === 1) {
      const count = scene.children.length ? tune() : 0;
      if (count === tuned.current.count && count > 50 && readyAt.current === null) readyAt.current = performance.now();
      tuned.current.count = count;
    }
    applyFades();

    const f = frame.current;
    if (!f) return;
    camera.position.copy(f.p);
    camera.fov = f.fov;
    camera.lookAt(f.t);
    if (f.shake > 0.001) {
      // Shake: a few centimetres of jitter plus a touch of roll, scaled by distance to the subject.
      const d = Math.min(12, f.p.distanceTo(f.t));
      const amp = f.shake * 0.012 * d;
      tmp.right.setFromMatrixColumn(camera.matrix, 0);
      tmp.up.setFromMatrixColumn(camera.matrix, 1);
      camera.position.addScaledVector(tmp.right, wobble(f.time, 61, 47, 83) * amp).addScaledVector(tmp.up, wobble(f.time, 53, 71, 37) * amp);
      camera.rotateZ(wobble(f.time, 43, 29, 67) * f.shake * 0.012);
    }
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
  });

  return null;
}
