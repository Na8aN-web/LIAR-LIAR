'use client';

import { useEffect, useMemo } from 'react';
import { Euler, Group, InstancedMesh, Matrix4, Quaternion, Vector3, type Material } from 'three';
import type { Scenery } from './useScenery';

export interface Placement {
  position: [number, number, number];
  /** Rotation about Y, radians. */
  rotationY?: number;
  /** Uniform, or per axis [x, y, z] in the prop's own frame. */
  scale?: number | [number, number, number];
}

/**
 * Instanced copies get their own copy of each material. Scenery materials are shared with the
 * (non-instanced) buildings, and one material drawn both ways makes three.js switch shader
 * programs on every draw, every frame.
 */
const instancedMaterials = new WeakMap<Material, Material>();
function instancedMaterial(m: Material): Material {
  let c = instancedMaterials.get(m);
  if (!c) {
    c = m.clone();
    instancedMaterials.set(m, c);
  }
  return c;
}

/**
 * Every copy of a prop in one InstancedMesh per part, so 8 barrels cost the same
 * draw calls as 1. Geometry and materials are shared with the loaded scenery file.
 */
export function PropInstances({ scenery, name, placements }: { scenery: Scenery; name: string; placements: Placement[] }) {
  const group = useMemo(() => {
    const g = new Group();
    g.name = `instances:${name}`;
    if (!placements.length) return g;
    const parts = scenery.prop(name);
    const m = new Matrix4();
    const q = new Quaternion();
    for (const part of parts) {
      const mesh = new InstancedMesh(part.geometry, instancedMaterial(part.material), placements.length);
      placements.forEach((p, i) => {
        const s = p.scale ?? 1;
        const sv = typeof s === 'number' ? new Vector3(s, s, s) : new Vector3(...s);
        q.setFromEuler(new Euler(0, p.rotationY ?? 0, 0));
        m.compose(new Vector3(...p.position), q, sv).multiply(part.matrix);
        mesh.setMatrixAt(i, m);
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      g.add(mesh);
    }
    return g;
  }, [scenery, name, placements]);

  // Instanced meshes are ours; geometry/materials belong to the shared file, so don't dispose those.
  useEffect(() => () => group.children.forEach((c) => (c as InstancedMesh).dispose()), [group]);

  return <primitive object={group} />;
}
