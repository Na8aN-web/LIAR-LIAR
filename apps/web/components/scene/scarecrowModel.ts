'use client';

import { useMemo } from 'react';
import { useGLTF } from '@react-three/drei';
import {
  AnimationClip,
  Box3,
  BufferGeometry,
  Float32BufferAttribute,
  Matrix4,
  Object3D,
  SkinnedMesh,
  Uint16BufferAttribute,
  Vector3,
  type Bone,
} from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { ItemType } from '@wtc/shared';
import { itemGeometries } from './items';

// The rigged scarecrow (see tools/build-character.mjs): one mesh, one skeleton, six clips.
// Loaded once. Every player gets a cheap clone (own bones, shared geometry) plus their item,
// which is skinned to the same skeleton so it follows the body.
export const SCARECROW_URL = '/models/scarecrow.glb';
/** Standing model height in its own units. */
export const MODEL_HEIGHT = 1.96;

export const SIT_CLIPS = ['sit-relaxed', 'sit-hunched', 'sit-leaning'] as const;
export type SitPose = (typeof SIT_CLIPS)[number];
export type ClipName = SitPose | 'despair-1' | 'despair-2' | 'victory';

/**
 * Hips joint in each sitting pose, model units (measured from the clips; feet at y=0, +z forward).
 * Seats go under it. Reactions put the hips at about REACTION_HIPS_Y.
 */
export const SIT_HIPS: Record<SitPose, { y: number; z: number }> = {
  'sit-relaxed': { y: 0.727, z: -0.077 },
  'sit-hunched': { y: 0.633, z: -0.297 },
  'sit-leaning': { y: 0.613, z: -0.024 },
};
/** Seat top sits this far below the hips joint (the seat of the trousers). */
export const SEAT_BELOW_HIPS = 0.1;
/** Top of the head when seated, model units. */
export const SEATED_TOP = 1.55;

export const BONES = { hips: 'mixamorigHips', neck: 'mixamorigNeck', head: 'mixamorigHead' } as const;

/**
 * Joints each item may follow. Torso only, so arms moving to the knees don't drag the cloth;
 * the poncho and bandana ride on the chest alone (mixing in the hips shears them when the
 * scarecrow hunches), the cloak hangs from the whole back.
 */
const ITEM_JOINTS: Record<ItemType, string[]> = {
  poncho: ['Spine2', 'Neck'],
  bandana: ['Spine2', 'Neck'],
  cloak: ['Hips', 'Spine', 'Spine1', 'Spine2'],
};
const joint = (name: string) => `mixamorig${name}`;

export interface ScarecrowModel {
  template: Object3D;
  clips: Record<ClipName, AnimationClip>;
  /** Items rebuilt in the body's bind space, with skin weights copied from the torso. */
  items: Record<ItemType, BufferGeometry>;
}

export interface ScarecrowInstance {
  root: Object3D;
  body: SkinnedMesh;
  item: SkinnedMesh;
  hips: Bone;
  neck: Bone;
  head: Bone;
}

const cache = new WeakMap<object, ScarecrowModel>();

function findBody(root: Object3D): SkinnedMesh {
  let body: SkinnedMesh | null = null;
  root.traverse((o) => {
    if (!body && (o as SkinnedMesh).isSkinnedMesh) body = o as SkinnedMesh;
  });
  if (!body) throw new Error('scarecrow.glb has no skinned mesh');
  return body;
}

/**
 * items.ts builds the items around the old static model: feet at y=0, centred on the
 * bounding box. Put them on the rig's bind pose the same way, then give every vertex
 * the averaged torso weights of its nearest body vertices.
 */
function skinItems(template: Object3D): Record<ItemType, BufferGeometry> {
  const body = findBody(template);
  const pos = body.geometry.getAttribute('position');
  const skinIndex = body.geometry.getAttribute('skinIndex');
  const skinWeight = body.geometry.getAttribute('skinWeight');
  const jointIndex = (names: string[]) => new Set(body.skeleton.bones.map((b, i) => (names.map(joint).includes(b.name) ? i : -1)).filter((i) => i >= 0));

  // Body vertices in bind space (where the skin puts them when every bone is at its bind
  // pose: bindMatrix * position), and the joint each mostly follows. Don't pose the
  // skeleton to get this: the hips' parent isn't a bone, so Skeleton.pose() would bake the
  // bind transform into the hips and break every clone.
  const rest: Vector3[] = [];
  const dominant: number[] = [];
  const box = new Box3();
  for (let i = 0; i < pos.count; i++) {
    const v = new Vector3().fromBufferAttribute(pos, i).applyMatrix4(body.bindMatrix);
    rest.push(v);
    box.expandByPoint(v);
    let best = 0;
    for (let k = 1; k < 4; k++) if (skinWeight.getComponent(i, k) > skinWeight.getComponent(i, best)) best = k;
    dominant.push(skinIndex.getComponent(i, best));
  }
  // Items are in model units (feet at 0, centred, MODEL_HEIGHT tall); bind space is in the
  // rig's own units. Map one onto the other by the bounding box.
  const offset = new Vector3((box.min.x + box.max.x) / 2, box.min.y, (box.min.z + box.max.z) / 2);
  const unit = (box.max.y - box.min.y) / MODEL_HEIGHT;
  const toLocal = new Matrix4().copy(body.bindMatrix).invert();

  const K = 8;
  const out = {} as Record<ItemType, BufferGeometry>;
  for (const [type, src] of Object.entries(itemGeometries()) as [ItemType, BufferGeometry][]) {
    const allowed = jointIndex(ITEM_JOINTS[type]);
    // Candidates: body vertices that mostly follow one of this item's joints.
    const candidates = dominant.map((j, i) => (allowed.has(j) ? i : -1)).filter((i) => i >= 0);
    const g = src.clone();
    const p = g.getAttribute('position');
    const idx = new Uint16Array(p.count * 4);
    const wts = new Float32Array(p.count * 4);
    const v = new Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).multiplyScalar(unit).add(offset);
      // K nearest candidates.
      const near: [number, number][] = [];
      for (const b of candidates) {
        const d = rest[b].distanceToSquared(v);
        if (near.length < K || d < near[near.length - 1][0]) {
          near.push([d, b]);
          near.sort((x, y) => x[0] - y[0]);
          if (near.length > K) near.pop();
        }
      }
      const acc = new Map<number, number>();
      for (const [, b] of near) {
        for (let k = 0; k < 4; k++) {
          const j = skinIndex.getComponent(b, k);
          const w = skinWeight.getComponent(b, k);
          if (w > 0 && allowed.has(j)) acc.set(j, (acc.get(j) ?? 0) + w);
        }
      }
      const top = [...acc.entries()].sort((x, y) => y[1] - x[1]).slice(0, 4);
      const sum = top.reduce((s, [, w]) => s + w, 0) || 1;
      top.forEach(([j, w], k) => {
        idx[i * 4 + k] = j;
        wts[i * 4 + k] = w / sum;
      });
      v.applyMatrix4(toLocal);
      p.setXYZ(i, v.x, v.y, v.z);
    }
    g.setAttribute('skinIndex', new Uint16BufferAttribute(idx, 4));
    g.setAttribute('skinWeight', new Float32BufferAttribute(wts, 4));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    out[type] = g;
  }
  return out;
}

/** Suspends until the model is loaded (drei caches the file; meshopt is decoded in JS). */
export function useScarecrowModel(): ScarecrowModel {
  const gltf = useGLTF(SCARECROW_URL);
  return useMemo(() => {
    const hit = cache.get(gltf);
    if (hit) return hit;
    const clips = Object.fromEntries(gltf.animations.map((c) => [c.name, c])) as Record<ClipName, AnimationClip>;
    const model: ScarecrowModel = { template: gltf.scene, clips, items: skinItems(gltf.scene) };
    cache.set(gltf, model);
    return model;
  }, [gltf]);
}

/** A per-player copy: own bones (so it animates on its own), shared geometry, plus its item. */
export function createInstance(model: ScarecrowModel, item: ItemType): ScarecrowInstance {
  const root = cloneSkinned(model.template);
  const body = findBody(root);
  const garment = new SkinnedMesh(model.items[item]);
  garment.position.copy(body.position);
  garment.quaternion.copy(body.quaternion);
  garment.scale.copy(body.scale);
  body.parent!.add(garment);
  garment.bind(body.skeleton, body.bindMatrix);
  // Skinned bounds don't follow the pose; culling a seated scarecrow by its bind pose
  // could drop a raised arm, and there are only 15 of them.
  body.frustumCulled = false;
  garment.frustumCulled = false;
  const bone = (name: string) => root.getObjectByName(name) as Bone;
  return { root, body, item: garment, hips: bone(BONES.hips), neck: bone(BONES.neck), head: bone(BONES.head) };
}

useGLTF.preload(SCARECROW_URL);
