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
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { type Cosmetics, type ItemType } from '@wtc/shared';
import { buildCosmetic, type HeadFrame } from './cosmetics';
import { itemGeometries } from './items';

// The rigged scarecrow (see tools/build-character.mjs): one mesh, one skeleton, six clips.
// Loaded once. Every player gets a cheap clone (own bones, shared geometry) plus their item,
// which is skinned to the same skeleton so it follows the body.
export const SCARECROW_URL = '/models/scarecrow.glb';
/** Standing model height in its own units. */
export const MODEL_HEIGHT = 1.96;

export const SIT_CLIPS = ['sit-relaxed', 'sit-hunched', 'sit-leaning', 'sit-talking'] as const;
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
  // Retargeted from a separately rigged file (see tools/build-character.mjs).
  'sit-talking': { y: 0.557, z: -0.001 },
};
/** Seat top sits this far below the hips joint (the seat of the trousers). */
export const SEAT_BELOW_HIPS = 0.1;
/** Top of the head when seated, model units. */
export const SEATED_TOP = 1.55;

export const BONES = { hips: 'mixamorigHips', neck: 'mixamorigNeck', head: 'mixamorigHead' } as const;

/**
 * Joints each item may follow, and how many nearby body vertices its weights are averaged
 * over (more = smoother bending). Torso and collarbones only: arms moving to the knees would
 * tear the cloth apart. The bandana rides on the chest (with the neck too it shears when the
 * head leans); the poncho sits on the chest and
 * shoulders; the short cape hangs from the whole back (it ends above the seat).
 */
const ITEM_SKIN: Record<ItemType, { joints: string[]; k: number }> = {
  poncho: { joints: ['Spine1', 'Spine2', 'Neck', 'LeftShoulder', 'RightShoulder'], k: 16 },
  bandana: { joints: ['Spine2'], k: 8 },
  cloak: { joints: ['Spine', 'Spine1', 'Spine2', 'Neck', 'LeftShoulder', 'RightShoulder'], k: 16 },
};
const joint = (name: string) => `mixamorig${name}`;

export interface ScarecrowModel {
  template: Object3D;
  clips: Record<ClipName, AnimationClip>;
  /** Items rebuilt in the body's bind space, with skin weights copied from the torso. */
  items: Record<ItemType, BufferGeometry>;
  bind: BindSpace;
  /** Cosmetics geometry per look (hat + head detail), built on first use. */
  cosmetics: Map<string, BufferGeometry | null>;
}

/** The body's bind pose, measured once: where every vertex sits and which joint it follows. */
interface BindSpace {
  body: SkinnedMesh;
  /** Bind-space positions (rig units). */
  rest: Vector3[];
  dominant: number[];
  /** model units -> bind space: bind = model * unit + offset. */
  offset: Vector3;
  unit: number;
  toLocal: Matrix4;
  jointIndex: (names: string[]) => Set<number>;
  head: HeadFrame;
  headJoint: number;
}

export interface ScarecrowInstance {
  root: Object3D;
  body: SkinnedMesh;
  item: SkinnedMesh;
  /** Hat and head detail, or null for none. */
  cosmetics: SkinnedMesh | null;
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
 * Body vertices in bind space (where the skin puts them when every bone is at its bind pose:
 * bindMatrix * position), and the joint each mostly follows. Don't pose the skeleton to get
 * this: the hips' parent isn't a bone, so Skeleton.pose() would bake the bind transform into
 * the hips and break every clone.
 */
function measureBind(template: Object3D): BindSpace {
  const body = findBody(template);
  const pos = body.geometry.getAttribute('position');
  const skinIndex = body.geometry.getAttribute('skinIndex');
  const skinWeight = body.geometry.getAttribute('skinWeight');
  const jointIndex = (names: string[]) =>
    new Set(body.skeleton.bones.map((b, i) => (names.map(joint).includes(b.name) ? i : -1)).filter((i) => i >= 0));
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
  // Items and cosmetics are designed in model units (feet at 0, centred, MODEL_HEIGHT tall);
  // bind space is in the rig's own units. Map one onto the other by the bounding box.
  const offset = new Vector3((box.min.x + box.max.x) / 2, box.min.y, (box.min.z + box.max.z) / 2);
  const unit = (box.max.y - box.min.y) / MODEL_HEIGHT;
  const headJoint = body.skeleton.bones.findIndex((b) => b.name === BONES.head);

  // The head in model units, for fitting hats and face details.
  const verts = rest.filter((_, i) => dominant[i] === headJoint).map((v) => v.clone().sub(offset).divideScalar(unit));
  const hb = new Box3().setFromPoints(verts);
  const head: HeadFrame = {
    verts,
    min: hb.min,
    max: hb.max,
    center: hb.getCenter(new Vector3()),
    hw: (hb.max.x - hb.min.x) / 2,
    hh: (hb.max.y - hb.min.y) / 2,
  };
  return { body, rest, dominant, offset, unit, toLocal: new Matrix4().copy(body.bindMatrix).invert(), jointIndex, head, headJoint };
}

/** Moves a model-units geometry into the body's bind space and gives it skin attributes. */
function toBindSpace(bind: BindSpace, src: BufferGeometry, weigh: (v: Vector3) => [number, number][]): BufferGeometry {
  const g = src.clone();
  const p = g.getAttribute('position');
  const idx = new Uint16Array(p.count * 4);
  const wts = new Float32Array(p.count * 4);
  const v = new Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i).multiplyScalar(bind.unit).add(bind.offset);
    weigh(v).forEach(([j, w], k) => {
      idx[i * 4 + k] = j;
      wts[i * 4 + k] = w;
    });
    v.applyMatrix4(bind.toLocal);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.setAttribute('skinIndex', new Uint16BufferAttribute(idx, 4));
  g.setAttribute('skinWeight', new Float32BufferAttribute(wts, 4));
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

/**
 * Items: every vertex takes the averaged weights of its K nearest body vertices that follow
 * one of the item's joints (only those joints' weights count), so the cloth bends with the
 * torso the way the straw under it does.
 */
function skinItems(bind: BindSpace): Record<ItemType, BufferGeometry> {
  const { body, rest, dominant } = bind;
  const skinIndex = body.geometry.getAttribute('skinIndex');
  const skinWeight = body.geometry.getAttribute('skinWeight');
  const out = {} as Record<ItemType, BufferGeometry>;
  for (const [type, src] of Object.entries(itemGeometries()) as [ItemType, BufferGeometry][]) {
    const { joints, k: K } = ITEM_SKIN[type];
    const allowed = bind.jointIndex(joints);
    const candidates = dominant.map((j, i) => (allowed.has(j) ? i : -1)).filter((i) => i >= 0);
    out[type] = toBindSpace(bind, src, (v) => {
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
      return top.map(([j, w]) => [j, w / sum]);
    });
  }
  return out;
}

const lookKey = (c: Cosmetics) => `${c.hat}|${c.face}`;

/** Averaged skin weights of some body vertices, top four joints, normalised. */
function averageWeights(bind: BindSpace, verts: number[]): [number, number][] {
  const skinIndex = bind.body.geometry.getAttribute('skinIndex');
  const skinWeight = bind.body.geometry.getAttribute('skinWeight');
  const acc = new Map<number, number>();
  for (const b of verts) {
    for (let k = 0; k < 4; k++) {
      const w = skinWeight.getComponent(b, k);
      if (w > 0) acc.set(skinIndex.getComponent(b, k), (acc.get(skinIndex.getComponent(b, k)) ?? 0) + w);
    }
  }
  const top = [...acc.entries()].sort((x, y) => y[1] - x[1]).slice(0, 4);
  const sum = top.reduce((s, [, w]) => s + w, 0) || 1;
  return top.map(([j, w]) => [j, w / sum]);
}

/**
 * One merged mesh for a look's hat and head detail, cached per look. Not skinned to the head
 * bone alone: the head's own vertices are partly weighted to the neck, so a hat on the bone
 * alone drifts off the visible head when the neck bends. Instead the hat takes the averaged
 * weights of the head-top vertices it sits on (one set for the whole hat, so it stays rigid),
 * and each face-detail vertex takes the weights of the head surface right under it.
 */
export function cosmeticGeometry(model: ScarecrowModel, look: Cosmetics): BufferGeometry | null {
  const key = lookKey(look);
  if (!model.cosmetics.has(key)) {
    const { bind } = model;
    const headVerts = bind.rest.map((_, i) => i).filter((i) => bind.dominant[i] === bind.headJoint);
    const parts: BufferGeometry[] = [];
    const hat = buildCosmetic(bind.head, look.hat);
    if (hat) {
      // The crown rests on the top of the head: the head vertices in its top quarter.
      const topY = bind.head.max.y - bind.head.hh * 0.5;
      const cap = headVerts.filter((i) => (bind.rest[i].y - bind.offset.y) / bind.unit > topY);
      const w = averageWeights(bind, cap.length ? cap : headVerts);
      parts.push(toBindSpace(bind, hat, () => w));
    }
    const face = buildCosmetic(bind.head, look.face);
    if (face) {
      parts.push(
        toBindSpace(bind, face, (v) => {
          const near = headVerts
            .map((i) => [bind.rest[i].distanceToSquared(v), i] as [number, number])
            .sort((a, b) => a[0] - b[0])
            .slice(0, 6)
            .map(([, i]) => i);
          return averageWeights(bind, near);
        }),
      );
    }
    model.cosmetics.set(key, parts.length ? mergeGeometries(parts) : null);
  }
  return model.cosmetics.get(key)!;
}

/** Suspends until the model is loaded (drei caches the file; meshopt is decoded in JS). */
export function useScarecrowModel(): ScarecrowModel {
  const gltf = useGLTF(SCARECROW_URL);
  return useMemo(() => {
    const hit = cache.get(gltf);
    if (hit) return hit;
    const clips = Object.fromEntries(gltf.animations.map((c) => [c.name, c])) as Record<ClipName, AnimationClip>;
    const bind = measureBind(gltf.scene);
    const model: ScarecrowModel = { template: gltf.scene, clips, items: skinItems(bind), bind, cosmetics: new Map() };
    cache.set(gltf, model);
    return model;
  }, [gltf]);
}

/**
 * A per-player copy: own bones (so it animates on its own), shared geometry, plus its item
 * and cosmetics, all skinned to the same skeleton.
 */
export function createInstance(model: ScarecrowModel, item: ItemType, look: Cosmetics): ScarecrowInstance {
  const root = cloneSkinned(model.template);
  const body = findBody(root);
  const attach = (geometry: BufferGeometry) => {
    const m = new SkinnedMesh(geometry);
    m.position.copy(body.position);
    m.quaternion.copy(body.quaternion);
    m.scale.copy(body.scale);
    body.parent!.add(m);
    m.bind(body.skeleton, body.bindMatrix);
    // Skinned bounds don't follow the pose; culling a seated scarecrow by its bind pose
    // could drop a raised arm, and there are only 15 of them.
    m.frustumCulled = false;
    return m;
  };
  body.frustumCulled = false;
  const garment = attach(model.items[item]);
  const extra = cosmeticGeometry(model, look);
  const bone = (name: string) => root.getObjectByName(name) as Bone;
  return {
    root,
    body,
    item: garment,
    cosmetics: extra && attach(extra),
    hips: bone(BONES.hips),
    neck: bone(BONES.neck),
    head: bone(BONES.head),
  };
}

useGLTF.preload(SCARECROW_URL);
