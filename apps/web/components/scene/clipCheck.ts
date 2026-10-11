import { AnimationMixer, Group, LoopOnce, Vector3 } from 'three';
import { COSMETICS, DEFAULT_COSMETICS, ITEM_TYPES, NO_COSMETIC, type ItemType } from '@wtc/shared';
import { SCALE } from './Scarecrow';
import { SEAT_BELOW_HIPS, SIT_CLIPS, SIT_HIPS, createInstance, type ClipName, type ScarecrowModel, type SitPose } from './scarecrowModel';
import { SEAT_FIT, type SeatType } from './town/Town';

// Dev-only (/dev/scarecrow?clipcheck): poses every item through every sitting idle and
// reaction and measures how far any cloth vertex sinks into the seat under the scarecrow.
// Same placement as the game: the hips are held on the seat while a reaction plays.

const CLIPS: ClipName[] = ['sit-relaxed', 'sit-hunched', 'sit-leaning', 'despair-1', 'despair-2', 'victory'];
const SAMPLES = 24;

export interface ClipRow {
  item: ItemType;
  pose: SitPose;
  clip: ClipName;
  seat: SeatType;
  /** Deepest a cloth vertex goes into the seat, cm (0 = never touches). */
  depthCm: number;
  /** Share of samples where any vertex is inside the seat. */
  samplesHit: number;
}

export function runClipCheck(model: ScarecrowModel): ClipRow[] {
  const rows: ClipRow[] = [];
  const v = new Vector3();
  for (const item of ITEM_TYPES) {
    for (const pose of SIT_CLIPS) {
      const inst = createInstance(model, item, DEFAULT_COSMETICS);
      const scaled = new Group();
      scaled.scale.setScalar(SCALE);
      const offset = new Group();
      scaled.add(offset);
      offset.add(inst.root);
      const mixer = new AnimationMixer(inst.root);
      const hips = SIT_HIPS[pose];
      const seatTop = (hips.y - SEAT_BELOW_HIPS) * SCALE;
      const seatZ = hips.z * SCALE;
      // A sitting clip is the idle itself; a reaction is checked on its own (the in-game blend
      // passes between the two, so the extremes are these).
      const clips = CLIPS.filter((c) => !c.startsWith('sit-') || c === pose);
      for (const clip of clips) {
        mixer.stopAllAction();
        const action = mixer.clipAction(model.clips[clip]);
        action.setLoop(LoopOnce, 1).play();
        const dur = model.clips[clip].duration;
        const depth: Record<SeatType, number> = { log: 0, crate: 0, barrel: 0, stump: 0 };
        const hits: Record<SeatType, number> = { log: 0, crate: 0, barrel: 0, stump: 0 };
        for (let s = 0; s < SAMPLES; s++) {
          mixer.setTime((s / (SAMPLES - 1)) * dur * 0.999);
          // Hold the hips where the seat is, as the game does.
          scaled.updateMatrixWorld(true);
          const k = inst.hips.parent!.scale.y;
          offset.position.set(0, hips.y - inst.hips.position.y * k, hips.z - inst.hips.position.z * k);
          scaled.updateMatrixWorld(true);
          const pos = inst.item.geometry.getAttribute('position');
          const sampleDepth: Record<SeatType, number> = { log: 0, crate: 0, barrel: 0, stump: 0 };
          for (let i = 0; i < pos.count; i++) {
            inst.item.getVertexPosition(i, v);
            v.applyMatrix4(inst.item.matrixWorld);
            for (const seat of Object.keys(SEAT_FIT) as SeatType[]) {
              const [w, d] = SEAT_FIT[seat].footprint;
              const inside = Math.abs(v.x) < w / 2 && Math.abs(v.z - seatZ) < d / 2 && v.y < seatTop && v.y > 0;
              if (inside) sampleDepth[seat] = Math.max(sampleDepth[seat], seatTop - v.y);
            }
          }
          for (const seat of Object.keys(SEAT_FIT) as SeatType[]) {
            depth[seat] = Math.max(depth[seat], sampleDepth[seat]);
            if (sampleDepth[seat] > 0.005) hits[seat]++;
          }
        }
        for (const seat of Object.keys(SEAT_FIT) as SeatType[]) {
          rows.push({ item, pose, clip, seat, depthCm: Math.round(depth[seat] * 1000) / 10, samplesHit: hits[seat] / SAMPLES });
        }
      }
      mixer.stopAllAction();
    }
  }
  return rows;
}

export interface HatRow {
  hat: string;
  pose: SitPose;
  clip: ClipName;
  /** Most the hat moves away from (or into) the top of the head, cm, versus sitting still. */
  driftCm: number;
  /** Control: the same measure against the chest, which must move (proves the check works). */
  chestCm: number;
}

/**
 * Hats must stay on: in every sitting pose and reaction, the distance between the hat and
 * the top of the head (both as skinned) should stay what it is at rest.
 */
export function runHatCheck(model: ScarecrowModel): HatRow[] {
  const rows: HatRow[] = [];
  const v = new Vector3();
  const hats = COSMETICS.filter((c) => c.slot === 'hat').map((c) => c.id);
  const headTop = model.bind.rest
    .map((_, i) => i)
    .filter((i) => model.bind.dominant[i] === model.bind.headJoint && (model.bind.rest[i].y - model.bind.offset.y) / model.bind.unit > model.bind.head.max.y - model.bind.head.hh * 0.5);
  for (const hat of hats) {
    for (const pose of SIT_CLIPS) {
      const inst = createInstance(model, 'bandana', { hat, face: NO_COSMETIC });
      const mixer = new AnimationMixer(inst.root);
      const centroid = (mesh: typeof inst.body, idx: number[] | null) => {
        const c = new Vector3();
        const pos = mesh.geometry.getAttribute('position');
        const list = idx ?? Array.from({ length: pos.count }, (_, i) => i);
        for (const i of list) c.add(mesh.getVertexPosition(i, v).applyMatrix4(mesh.matrixWorld));
        return c.divideScalar(list.length);
      };
      const chest = model.bind.rest.map((_, i) => i).filter((i) => model.bind.body.skeleton.bones[model.bind.dominant[i]]?.name === 'mixamorigSpine2');
      const gap = () => {
        inst.root.updateMatrixWorld(true);
        const h = centroid(inst.cosmetics!, null);
        return [h.distanceTo(centroid(inst.body, headTop)), h.distanceTo(centroid(inst.body, chest))];
      };
      let ref: number[] | null = null;
      for (const clip of [pose, 'despair-1', 'despair-2', 'victory'] as ClipName[]) {
        mixer.stopAllAction();
        const action = mixer.clipAction(model.clips[clip]);
        action.setLoop(LoopOnce, 1).play();
        const dur = model.clips[clip].duration;
        let drift = 0;
        let control = 0;
        for (let s = 0; s < SAMPLES; s++) {
          mixer.setTime((s / (SAMPLES - 1)) * dur * 0.999);
          const g = gap();
          ref ??= g;
          drift = Math.max(drift, Math.abs(g[0] - ref[0]));
          control = Math.max(control, Math.abs(g[1] - ref[1]));
        }
        // Model units -> metres in the game (SCALE), -> cm.
        rows.push({ hat, pose, clip, driftCm: Math.round(drift * SCALE * 1000) / 10, chestCm: Math.round(control * SCALE * 1000) / 10 });
      }
    }
  }
  return rows;
}
