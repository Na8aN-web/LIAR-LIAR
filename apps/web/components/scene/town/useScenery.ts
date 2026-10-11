'use client';

import { useMemo } from 'react';
import { useGLTF } from '@react-three/drei';
import { Matrix4, type BufferGeometry, type Material, type Mesh, type Object3D } from 'three';

// Town scenery built by tools/build-scenery.mjs: one root node per building ("building_saloon")
// and per prop ("prop_barrel"). Buildings face +z with their front edge at the origin;
// props stand on the ground, centred.
export const SCENERY_URL = '/models/scenery.glb';

export interface PropPart {
  geometry: BufferGeometry;
  material: Material;
  /** Part transform relative to the prop root (includes the dequantization scale). */
  matrix: Matrix4;
}

export interface Scenery {
  building: (name: string) => Object3D;
  prop: (name: string) => PropPart[];
}

export function useScenery(): Scenery {
  const gltf = useGLTF(SCENERY_URL);
  return useMemo(() => {
    gltf.scene.updateMatrixWorld(true);
    const roots = new Map<string, Object3D>();
    for (const c of gltf.scene.children) roots.set(c.name, c);
    const partsCache = new Map<string, PropPart[]>();
    return {
      // Clones share geometry and materials with the loaded file.
      building: (name) => {
        const root = roots.get(`building_${name}`);
        if (!root) throw new Error(`scenery.glb has no building_${name}`);
        const copy = root.clone(true);
        copy.position.set(0, 0, 0);
        return copy;
      },
      prop: (name) => {
        const hit = partsCache.get(name);
        if (hit) return hit;
        const root = roots.get(`prop_${name}`);
        if (!root) throw new Error(`scenery.glb has no prop_${name}`);
        const inv = new Matrix4().copy(root.matrixWorld).invert();
        const parts: PropPart[] = [];
        root.traverse((o) => {
          const m = o as Mesh;
          if (!m.isMesh) return;
          parts.push({ geometry: m.geometry, material: m.material as Material, matrix: new Matrix4().multiplyMatrices(inv, m.matrixWorld) });
        });
        partsCache.set(name, parts);
        return parts;
      },
    };
  }, [gltf]);
}

useGLTF.preload(SCENERY_URL);
