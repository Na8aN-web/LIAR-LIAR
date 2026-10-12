'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Fog, Vector2, Vector3, type PerspectiveCamera } from 'three';
import { samplePath, pathLength, type CamKey, type CamPath, type V3 } from './paths';

// Trailer camera: free-fly (WASD + drag to look), smooth path playback, and high-resolution
// capture of exactly what the camera sees. Lives inside the canvas; the director panel talks to
// it through `api`.

export interface RigApi {
  /** The camera right now, as a keyframe. */
  pose: () => CamKey;
  setPose: (k: CamKey) => void;
  play: (path: CamPath, onDone?: () => void) => void;
  stop: () => void;
  playing: () => boolean;
  /** Renders one frame at width × height and downloads it as a PNG. */
  capture: (width: number, height: number, name: string) => void;
  /** World position of an object by name (e.g. the Wanted poster). */
  find: (name: string) => V3 | null;
}

const FOG_COLOR = '#0c0e1a';
const UP = new Vector3(0, 1, 0);

const typing = () => {
  const el = document.activeElement;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT');
};

export function TrailerRig({ api, start, ringR }: { api: React.MutableRefObject<RigApi | null>; start: CamKey; ringR: number }) {
  const camera = useThree((s) => s.camera) as PerspectiveCamera;
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const look = useRef({ yaw: 0, pitch: 0 });
  const keys = useRef(new Set<string>());
  const play = useRef<{ path: CamPath; t: number; done?: () => void } | null>(null);
  const tmp = useMemo(() => ({ dir: new Vector3(), right: new Vector3(), move: new Vector3() }), []);

  /** Points the camera at `t` and remembers the angles for free-fly. */
  const aim = (t: Vector3) => {
    camera.lookAt(t);
    camera.getWorldDirection(tmp.dir);
    look.current = { yaw: Math.atan2(tmp.dir.x, tmp.dir.z), pitch: Math.asin(Math.max(-1, Math.min(1, tmp.dir.y))) };
  };
  const setPose = (k: CamKey) => {
    camera.position.set(...k.p);
    camera.fov = k.fov;
    camera.updateProjectionMatrix();
    aim(new Vector3(...k.t));
  };

  // Fog far enough back to see the whole town from above (the game keeps it tighter).
  useEffect(() => {
    scene.fog = new Fog(FOG_COLOR, 22, ringR + 55);
    setPose(start);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    api.current = {
      pose: () => {
        camera.getWorldDirection(tmp.dir);
        const t = camera.position.clone().addScaledVector(tmp.dir, 6);
        return { p: camera.position.toArray() as V3, t: t.toArray() as V3, fov: camera.fov, dur: 3 };
      },
      setPose,
      play: (path, done) => {
        if (path.keys.length < 2) return;
        play.current = { path, t: 0, done };
      },
      stop: () => (play.current = null),
      playing: () => !!play.current,
      capture: (width, height, name) => {
        const size = gl.getSize(new Vector2());
        const ratio = gl.getPixelRatio();
        const aspect = camera.aspect;
        gl.setPixelRatio(1);
        gl.setSize(width, height, false);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        gl.render(scene, camera);
        const url = gl.domElement.toDataURL('image/png');
        gl.setPixelRatio(ratio);
        gl.setSize(size.x, size.y, false);
        camera.aspect = aspect;
        camera.updateProjectionMatrix();
        const a = document.createElement('a');
        a.href = url;
        a.download = name;
        a.click();
      },
      find: (name) => {
        const o = scene.getObjectByName(name);
        return o ? (o.getWorldPosition(new Vector3()).toArray() as V3) : null;
      },
    };
  });

  // Free-fly: drag to look, WASD / arrows to move, Q/E (or F/R) down/up, Shift faster, wheel = lens.
  useEffect(() => {
    const el = gl.domElement;
    let drag: { x: number; y: number } | null = null;
    const down = (e: PointerEvent) => {
      if (play.current) return;
      drag = { x: e.clientX, y: e.clientY };
      el.setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      if (!drag) return;
      look.current.yaw -= (e.clientX - drag.x) * 0.0035;
      look.current.pitch = Math.max(-1.45, Math.min(1.45, look.current.pitch - (e.clientY - drag.y) * 0.0035));
      drag = { x: e.clientX, y: e.clientY };
    };
    const up = () => (drag = null);
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      camera.fov = Math.max(12, Math.min(75, camera.fov + e.deltaY * 0.02));
      camera.updateProjectionMatrix();
    };
    const kd = (e: KeyboardEvent) => !typing() && keys.current.add(e.key.toLowerCase());
    const ku = (e: KeyboardEvent) => keys.current.delete(e.key.toLowerCase());
    const blur = () => keys.current.clear();
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('wheel', wheel, { passive: false });
    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);
    window.addEventListener('blur', blur);
    return () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('wheel', wheel);
      window.removeEventListener('keydown', kd);
      window.removeEventListener('keyup', ku);
      window.removeEventListener('blur', blur);
    };
  }, [gl, camera]);

  useFrame((_, dt) => {
    const delta = Math.min(dt, 0.1);
    const p = play.current;
    if (p) {
      p.t += delta;
      const s = samplePath(p.path, p.t);
      camera.position.copy(s.p);
      camera.fov = s.fov;
      camera.updateProjectionMatrix();
      aim(s.t);
      if (p.t >= pathLength(p.path)) {
        play.current = null;
        p.done?.();
      }
      return;
    }
    const k = keys.current;
    const { yaw, pitch } = look.current;
    tmp.dir.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
    tmp.right.crossVectors(tmp.dir, UP).normalize();
    tmp.move.set(0, 0, 0);
    if (k.has('w') || k.has('arrowup')) tmp.move.add(tmp.dir);
    if (k.has('s') || k.has('arrowdown')) tmp.move.sub(tmp.dir);
    if (k.has('d') || k.has('arrowright')) tmp.move.add(tmp.right);
    if (k.has('a') || k.has('arrowleft')) tmp.move.sub(tmp.right);
    if (k.has('e') || k.has('r')) tmp.move.y += 1;
    if (k.has('q') || k.has('f')) tmp.move.y -= 1;
    if (tmp.move.lengthSq()) camera.position.addScaledVector(tmp.move.normalize(), delta * (k.has('shift') ? 9 : 3));
    camera.position.y = Math.max(0.3, camera.position.y);
    camera.lookAt(tmp.dir.add(camera.position));
  });

  return null;
}
