'use client';

import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  DodecahedronGeometry,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  ShaderMaterial,
  Vector3,
  type Group,
  type PointLight,
  type Points,
} from 'three';
import { glowTexture } from './glow';

// The campfire in the middle of the circle: the scene's main light. One real point light
// that flickers, flames drawn by a small shader on camera-facing quads, a few rising embers,
// a stone ring and crossed logs. No textures beyond the shared glow.

export const FIRE_COLOR = '#ff9a48';
/** Fire light strength at brightness 1 (decay 1, so it still reaches the building fronts). */
const FIRE_INTENSITY = 26;
const STONES = 11;
const RING_R = 0.85;
const EMBERS = 28;

const flameVertex = /* glsl */ `
varying vec2 vUv;
#include <fog_pars_vertex>
void main() {
  vUv = uv;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const flameFragment = /* glsl */ `
uniform float uTime;
uniform float uSeed;
varying vec2 vUv;
#include <fog_pars_fragment>
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; }
  return v;
}
void main() {
  float y = vUv.y;
  float x = vUv.x * 2.0 - 1.0;
  float n = fbm(vec2(x * 2.6 + uSeed, y * 3.4 - uTime * 2.4));
  // Teardrop that narrows and wavers more as it rises.
  float width = mix(0.78, 0.06, pow(y, 0.8));
  float d = abs(x + (n - 0.5) * 0.7 * y) / width;
  float h = y + (n - 0.5) * 0.55;
  float body = (1.0 - smoothstep(0.45, 1.0, d)) * (1.0 - smoothstep(0.5, 0.92, h)) * smoothstep(0.0, 0.1, y);
  float core = (1.0 - smoothstep(0.0, 0.55, d)) * (1.0 - smoothstep(0.12, 0.5, h));
  vec3 col = mix(vec3(0.85, 0.2, 0.04), vec3(1.0, 0.6, 0.16), smoothstep(0.0, 0.7, body));
  col = mix(col, vec3(1.0, 0.92, 0.66), core * body);
  gl_FragColor = vec4(col * body * 1.5, body);
  #include <fog_fragment>
}`;

function useFlameMaterial(seed: number) {
  return useMemo(
    () =>
      new ShaderMaterial({
        uniforms: { uTime: { value: 0 }, uSeed: { value: seed }, fogColor: { value: new Color() }, fogNear: { value: 1 }, fogFar: { value: 1000 } },
        vertexShader: flameVertex,
        fragmentShader: flameFragment,
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        fog: true,
      }),
    [seed],
  );
}

/** Stone ring + crossed logs, instanced (2 draw calls). */
function Hearth() {
  const stones = useMemo(() => {
    const mesh = new InstancedMesh(new DodecahedronGeometry(0.2, 0), new MeshStandardMaterial({ color: '#5d5853', roughness: 1, flatShading: true }), STONES);
    const m = new Matrix4();
    const q = new Quaternion();
    for (let i = 0; i < STONES; i++) {
      const a = (i / STONES) * Math.PI * 2;
      const s = 0.8 + ((i * 37) % 7) / 14;
      q.setFromAxisAngle(new Vector3(0.3, 1, 0.2).normalize(), i * 1.7);
      m.compose(new Vector3(Math.sin(a) * RING_R, 0.08, Math.cos(a) * RING_R), q, new Vector3(s * 1.2, s * 0.8, s));
      mesh.setMatrixAt(i, m);
    }
    return mesh;
  }, []);
  const logs = useMemo(() => {
    const geo = new DodecahedronGeometry(1, 0);
    // A stretched dodecahedron reads as a rough split log at this size.
    const mesh = new InstancedMesh(geo, new MeshStandardMaterial({ color: '#3b2615', roughness: 1, flatShading: true, emissive: '#4a1a04', emissiveIntensity: 0.6 }), 4);
    const m = new Matrix4();
    const q = new Quaternion();
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + 0.4;
      // Leaning in toward the centre, teepee style.
      q.setFromAxisAngle(new Vector3(Math.cos(a), 0, -Math.sin(a)), -0.55).multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), a));
      m.compose(new Vector3(Math.sin(a) * 0.32, 0.22, Math.cos(a) * 0.32), q, new Vector3(0.09, 0.09, 0.42));
      mesh.setMatrixAt(i, m);
    }
    return mesh;
  }, []);
  return (
    <>
      <primitive object={stones} />
      <primitive object={logs} />
    </>
  );
}

function Embers({ count = EMBERS }: { count?: number }) {
  const ref = useRef<Points>(null);
  const { geometry, state } = useMemo(() => {
    const g = new BufferGeometry();
    const pos = new Float32Array(count * 3);
    g.setAttribute('position', new BufferAttribute(pos, 3));
    const st = Array.from({ length: count }, (_, i) => ({ life: (i / count) * 2.4, speed: 0.6 + ((i * 53) % 10) / 12, phase: i * 2.1 }));
    return { geometry: g, state: st };
  }, [count]);
  useFrame((_, dt) => {
    const pos = geometry.getAttribute('position') as BufferAttribute;
    state.forEach((s, i) => {
      s.life = (s.life + dt * s.speed) % 2.4;
      const y = 0.4 + s.life * 1.3;
      const r = 0.12 + s.life * 0.12;
      pos.setXYZ(i, Math.sin(s.phase + s.life * 2.2) * r, y, Math.cos(s.phase * 1.3 + s.life * 1.7) * r);
    });
    pos.needsUpdate = true;
  });
  return (
    <points ref={ref} geometry={geometry} frustumCulled={false}>
      <pointsMaterial color="#ffb060" size={0.06} sizeAttenuation transparent opacity={0.9} blending={AdditiveBlending} depthWrite={false} />
    </points>
  );
}

/**
 * `embers` (how many rise) and `glow` (light and halo strength) are for stills like the
 * thumbnail studio; the game and the menu use the defaults.
 */
export function Campfire({ embers = EMBERS, glow = 1 }: { embers?: number; glow?: number } = {}) {
  const light = useRef<PointLight>(null);
  const flames = useRef<Group>(null);
  const halo = useRef<Group>(null);
  const mats = [useFlameMaterial(0), useFlameMaterial(3.7), useFlameMaterial(8.1)];
  const tex = glowTexture();
  const t = useRef(0);

  useFrame(({ camera }, dt) => {
    t.current += dt;
    const time = t.current;
    for (const m of mats) m.uniforms.uTime.value = time;
    // Flicker: a slow breath plus quick, uneven crackle.
    const f = 0.82 + 0.1 * Math.sin(time * 1.7) + 0.06 * Math.sin(time * 11.3 + 1.2) + 0.05 * Math.sin(time * 23.1) * Math.sin(time * 3.3);
    if (light.current) {
      light.current.intensity = FIRE_INTENSITY * f * glow;
      light.current.position.set(Math.sin(time * 5.1) * 0.05, 1.05 + Math.sin(time * 7.3) * 0.05, Math.cos(time * 4.3) * 0.05);
    }
    if (halo.current) halo.current.scale.setScalar(0.92 + f * 0.12);
    // Flames always face the camera (turn about the vertical only).
    if (flames.current) flames.current.rotation.y = Math.atan2(camera.position.x, camera.position.z);
  });

  return (
    <group name="campfire">
      <pointLight ref={light} color={FIRE_COLOR} intensity={FIRE_INTENSITY * glow} distance={42} decay={1} position={[0, 1.05, 0]} />
      <Hearth />
      <group ref={flames} position-y={0.12}>
        <mesh material={mats[0]} position={[0, 0.62, 0]}>
          <planeGeometry args={[1.05, 1.35]} />
        </mesh>
        <mesh material={mats[1]} position={[-0.2, 0.45, 0.05]} scale={0.7}>
          <planeGeometry args={[1, 1.35]} />
        </mesh>
        <mesh material={mats[2]} position={[0.22, 0.42, -0.05]} scale={0.62}>
          <planeGeometry args={[1, 1.35]} />
        </mesh>
      </group>
      {embers > 0 && <Embers count={embers} />}
      {/* Halo around the flames and a warm pool on the ground. */}
      <group ref={halo}>
        <sprite position-y={0.7} scale={[3.2, 3.2, 1]}>
          <spriteMaterial map={tex} color={FIRE_COLOR} blending={AdditiveBlending} transparent depthWrite={false} opacity={Math.min(1, 0.55 * glow)} />
        </sprite>
        <mesh rotation-x={-Math.PI / 2} position-y={0.02}>
          <planeGeometry args={[9, 9]} />
          <meshBasicMaterial map={tex} color={FIRE_COLOR} blending={AdditiveBlending} transparent depthWrite={false} opacity={Math.min(0.8, 0.28 * glow)} />
        </mesh>
      </group>
    </group>
  );
}
