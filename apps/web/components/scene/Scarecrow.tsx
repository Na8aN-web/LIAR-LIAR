'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimationMixer, Color, DoubleSide, LoopOnce, LoopRepeat, MeshStandardMaterial, Quaternion, Vector3, type AnimationAction, type Bone } from 'three';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import { DEFAULT_COSMETICS, type Cosmetics, type ItemType } from '@wtc/shared';
import { NameLabel } from './NameLabel';
import { neutralItemMaterial } from './neutralMaterial';
import { MODEL_HEIGHT, SEATED_TOP, SIT_HIPS, createInstance, useScarecrowModel, type ClipName, type SitPose } from './scarecrowModel';

/** A server-decided reaction to play once (payout or end of game). `key` changes per event. */
export interface ReactionCue {
  key: string;
  clip: ClipName;
}

/** Someone inspected this scarecrow: turn the head toward `target` (world space), then back. */
export interface LookCue {
  key: string;
  target: [number, number, number];
}

interface Props {
  name: string;
  item: ItemType;
  /** Hat and head detail (public). */
  cosmetics?: Cosmetics;
  /** Your own color. Null for everyone else: their item renders one neutral color (the client never has their colors). */
  colorHex: string | null;
  position: [number, number, number];
  rotationY: number;
  selected: boolean;
  faded: boolean;
  /** Times inspected this poster (public log). */
  eyeCount: number;
  onSelect?: () => void;
  /** Sitting idle, fixed for the whole game. */
  pose: SitPose;
  /** 0..1, stable per player: where the idle starts and how fast it runs. */
  seed: number;
  reaction?: ReactionCue | null;
  look?: LookCue | null;
  /** Name plate above the head (off on the homepage). */
  label?: boolean;
}

/** World height of a standing scarecrow. */
export const HEIGHT = 2.5;
export const SCALE = HEIGHT / MODEL_HEIGHT;
/** Top of a seated scarecrow's head, world units. */
export const SEATED_HEIGHT = SEATED_TOP * SCALE;


/** Light response of cosmetics (linear multiplier on their tones). */
const COSMETIC_LIGHT = new Color(0.7, 0.7, 0.7);

const FADE_IN = 0.45;
const FADE_OUT = 0.7;
const LOOK_IN = 0.9;
const LOOK_HOLD = 1.8;
const LOOK_OUT = 1.1;
const LOOK_MAX = 1.15; // ~66°: further than that and the neck would twist unnaturally
const UP = new Vector3(0, 1, 0);

const noRaycast = () => null;
const smooth = (t: number) => t * t * (3 - 2 * t);

/**
 * One player's scarecrow, seated: a clone of the rigged model with its own bones and
 * mixer, plus their item skinned to the torso. Clicks and hover go to an invisible capsule,
 * so the pointer never raycasts the skinned mesh. Local +z faces front.
 */
export function Scarecrow({ name, item, cosmetics = DEFAULT_COSMETICS, colorHex, position, rotationY, selected, faded, eyeCount, onSelect, pose, seed, reaction, look, label = true }: Props) {
  const model = useScarecrowModel();
  const [hover, setHover] = useState(false);
  const inst = useMemo(
    () => createInstance(model, item, cosmetics),
    [model, item, cosmetics.hat, cosmetics.face], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const mixer = useMemo(() => new AnimationMixer(inst.root), [inst]);

  // Materials: the painted body (not secret), your color on your item, undyed burlap on
  // everyone else's, and earthy cosmetics (public) drawn from their vertex colors.
  // The body's clothes are vertex colors baked by tools/paint-scarecrow.mjs.
  const bodyMat = useMemo(() => new MeshStandardMaterial({ vertexColors: true, roughness: 1 }), []);
  const itemMat = useMemo(
    () => (colorHex ? new MeshStandardMaterial({ color: colorHex, roughness: 0.9, side: DoubleSide }) : neutralItemMaterial(model.bind.unit)),
    [colorHex, model],
  );
  // Cosmetics take a little less light than the body, so the fire can't wash the straw hat
  // toward Tan or Yellow on screen (same hue, just darker; the tones themselves are tested).
  const extraMat = useMemo(() => new MeshStandardMaterial({ vertexColors: true, color: COSMETIC_LIGHT, roughness: 0.95, side: DoubleSide }), []);
  useEffect(() => {
    inst.body.material = bodyMat;
    inst.item.material = itemMat;
    inst.body.raycast = noRaycast;
    inst.item.raycast = noRaycast;
    if (inst.cosmetics) {
      inst.cosmetics.material = extraMat;
      inst.cosmetics.raycast = noRaycast;
    }
  }, [inst, bodyMat, itemMat, extraMat]);
  useEffect(() => {
    for (const m of [bodyMat, itemMat, extraMat]) {
      m.transparent = faded;
      m.opacity = faded ? 0.35 : 1;
      m.needsUpdate = true;
    }
  }, [faded, bodyMat, itemMat, extraMat]);
  useEffect(() => () => bodyMat.dispose(), [bodyMat]);
  useEffect(() => () => extraMat.dispose(), [extraMat]);
  useEffect(() => () => itemMat.dispose(), [itemMat]);

  // Sitting idle: starts at a random point, runs at a slightly different speed per player.
  const base = useRef<AnimationAction | null>(null);
  useEffect(() => {
    const a = mixer.clipAction(model.clips[pose]);
    a.setLoop(LoopRepeat, Infinity).play();
    a.time = seed * a.getClip().duration;
    a.timeScale = 0.9 + ((seed * 7919) % 1) * 0.2;
    base.current = a;
    return () => {
      a.stop();
      base.current = null;
    };
  }, [mixer, model, pose, seed]);
  useEffect(() => () => {
    mixer.stopAllAction();
  }, [mixer]);

  // Reactions: fade in over the idle, play once, fade back to sitting.
  const react = useRef<{ action: AnimationAction; startAt: number; started: boolean } | null>(null);
  const lastReaction = useRef<string | null>(null);
  const clock = useRef(0);
  useEffect(() => {
    if (!reaction || lastReaction.current === reaction.key) return;
    lastReaction.current = reaction.key;
    react.current?.action.stop();
    const action = mixer.clipAction(model.clips[reaction.clip]);
    action.setLoop(LoopOnce, 1);
    action.clampWhenFinished = true;
    action.timeScale = 0.95 + ((seed * 104729) % 1) * 0.1;
    // A small stagger so the circle doesn't move as one.
    react.current = { action, startAt: clock.current + 0.1 + ((seed * 31) % 1) * 0.45, started: false };
  }, [reaction, mixer, model, seed]);

  // Head turn toward an inspector.
  const lookState = useRef<{ startAt: number; target: Vector3 } | null>(null);
  const lastLook = useRef<string | null>(null);
  useEffect(() => {
    if (!look || lastLook.current === look.key) return;
    lastLook.current = look.key;
    lookState.current = { startAt: clock.current, target: new Vector3(...look.target) };
  }, [look]);

  const modelGroup = useRef<import('three').Group>(null);
  const outer = useRef<import('three').Group>(null);
  const tmp = useMemo(() => ({ v: new Vector3(), q: new Quaternion(), pq: new Quaternion(), axis: new Vector3() }), []);
  const hips = SIT_HIPS[pose];

  useFrame((_, dt) => {
    const delta = Math.min(dt, 0.1);
    clock.current += delta;
    const now = clock.current;

    // Blend weights: reaction over the idle.
    let w = 0;
    const r = react.current;
    if (r) {
      if (!r.started && now >= r.startAt) {
        r.action.reset().play();
        r.started = true;
      }
      if (r.started) {
        const t = r.action.time;
        const dur = r.action.getClip().duration;
        w = Math.min(1, t / FADE_IN) * Math.min(1, Math.max(0, (dur - t) / FADE_OUT));
        if (t >= dur - 1e-3) {
          r.action.stop();
          react.current = null;
          w = 0;
        }
      }
      r.action.setEffectiveWeight(w);
    }
    base.current?.setEffectiveWeight(1 - w);
    mixer.update(delta);

    // Keep the seat of the trousers on the seat: reactions put the hips a little higher or
    // further forward than the idle does, so slide the whole body to keep them planted.
    if (modelGroup.current && inst.hips.parent) {
      const k = inst.hips.parent.scale.y;
      modelGroup.current.position.y = hips.y - inst.hips.position.y * k;
      modelGroup.current.position.z = hips.z - inst.hips.position.z * k;
    }

    // Head turn: yaw about world up, split between neck and head.
    const l = lookState.current;
    if (l && outer.current) {
      const t = now - l.startAt;
      const total = LOOK_IN + LOOK_HOLD + LOOK_OUT;
      if (t >= total) {
        lookState.current = null;
      } else {
        const k = t < LOOK_IN ? smooth(t / LOOK_IN) : t < LOOK_IN + LOOK_HOLD ? 1 : smooth(1 - (t - LOOK_IN - LOOK_HOLD) / LOOK_OUT);
        tmp.v.copy(l.target);
        outer.current.worldToLocal(tmp.v);
        const yaw = Math.max(-LOOK_MAX, Math.min(LOOK_MAX, Math.atan2(tmp.v.x, tmp.v.z))) * k;
        turn(inst.neck, yaw * 0.4, tmp);
        turn(inst.head, yaw * 0.6, tmp);
      }
    }
  });

  const click = (e: ThreeEvent<MouseEvent>) => {
    if (!onSelect || e.delta > 8) return; // ignore camera drags
    e.stopPropagation();
    onSelect();
  };

  return (
    <group ref={outer} position={position} rotation-y={rotationY}>
      <group scale={SCALE}>
        <group ref={modelGroup}>
          <primitive object={inst.root} />
        </group>
      </group>

      {/* Hit area for clicks and hover, around the seated body. */}
      <mesh
        position={[0, SEATED_HEIGHT / 2, 0.1]}
        onClick={click}
        onPointerOver={(e) => {
          if (!onSelect) return;
          e.stopPropagation();
          setHover(true);
          document.body.style.cursor = 'pointer';
        }}
        onPointerOut={() => {
          setHover(false);
          document.body.style.cursor = '';
        }}
      >
        <capsuleGeometry args={[0.6, SEATED_HEIGHT - 1.0, 2, 8]} />
        <meshBasicMaterial colorWrite={false} depthWrite={false} />
      </mesh>

      {(selected || hover) && (
        <mesh rotation-x={-Math.PI / 2} position={[0, 0.03, 0.15]} raycast={noRaycast}>
          <ringGeometry args={[0.75, selected ? 0.93 : 0.83, 28]} />
          <meshBasicMaterial color="#f2c14e" transparent opacity={selected ? 1 : 0.5} />
        </mesh>
      )}

      {label && (
      <NameLabel
        name={name}
        position={[0, SEATED_HEIGHT + 0.35, 0]}
        expanded={selected || hover}
        highlight={selected}
        eyeCount={eyeCount}
        faded={faded}
      />
      )}
    </group>
  );
}

/** Rotates a bone by `angle` about world up, after the animation has posed it. */
function turn(bone: Bone, angle: number, tmp: { q: Quaternion; pq: Quaternion; axis: Vector3 }) {
  if (!bone.parent || angle === 0) return;
  bone.parent.updateWorldMatrix(true, false);
  bone.parent.getWorldQuaternion(tmp.pq);
  tmp.axis.copy(UP).applyQuaternion(tmp.pq.invert());
  tmp.q.setFromAxisAngle(tmp.axis, angle);
  bone.quaternion.premultiply(tmp.q);
}
