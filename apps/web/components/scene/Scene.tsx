'use client';

import { useEffect, useMemo } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { colorInfo, type Phase } from '@wtc/shared';
import { useGame } from '@/lib/store';
import { Scarecrow } from './Scarecrow';

// Placeholder scene. Reads the client view only; swap models freely without touching game logic.

const SELECTABLE: Phase[] = ['investigation', 'vote'];
// Keep in sync with the desktop breakpoint and side panel width in globals.css.
const DESKTOP_MIN = 900;
const SIDE_PANEL_PX = 380;

export default function Scene() {
  const view = useGame((s) => s.view);
  const selectedId = useGame((s) => s.selectedId);
  const select = useGame((s) => s.select);

  const players = view?.players ?? [];
  const me = view?.you;
  const n = Math.max(players.length, 1);
  const radius = Math.max(3.2, n * 0.42);
  const myIndex = Math.max(0, players.findIndex((p) => p.id === me?.id));
  const canSelect = !!view && SELECTABLE.includes(view.phase);

  const lanterns = useMemo(
    () => [0.6, 2.2, 3.8, 5.3].map((a) => [Math.sin(a) * (radius + 2.4), 0, Math.cos(a) * (radius + 2.4)] as const),
    [radius],
  );

  return (
    <Canvas
      className="scene"
      dpr={[1, 1.75]}
      camera={{ position: [0, 6.2, radius + 6.5], fov: 50 }}
      gl={{ antialias: true, powerPreference: 'high-performance' }}
      onPointerMissed={() => select(null)}
    >
      <color attach="background" args={['#07080f']} />
      <fog attach="fog" args={['#0a0b14', radius + 3, radius + 22]} />
      <ambientLight intensity={0.25} />
      <hemisphereLight args={['#3a4a7a', '#1a1208', 0.6]} />
      <directionalLight position={[-8, 12, -6]} intensity={0.7} color="#9fb4ff" />

      {/* Moon */}
      <mesh position={[-14, 16, -30]}>
        <sphereGeometry args={[2, 16, 12]} />
        <meshBasicMaterial color="#e8e4d0" fog={false} />
      </mesh>

      {/* Ground */}
      <mesh rotation-x={-Math.PI / 2}>
        <circleGeometry args={[60, 32]} />
        <meshStandardMaterial color="#2b2118" roughness={1} />
      </mesh>

      {/* Placeholder ghost-town buildings */}
      {[...Array(7)].map((_, i) => {
        const a = (i / 7) * Math.PI * 2 + 0.4;
        const d = radius + 11 + (i % 3) * 2;
        const h = 3 + (i % 3) * 1.4;
        return (
          <mesh key={i} position={[Math.sin(a) * d, h / 2, Math.cos(a) * d]} rotation-y={a}>
            <boxGeometry args={[4 + (i % 2) * 2, h, 3]} />
            <meshStandardMaterial color="#17120f" roughness={1} />
          </mesh>
        );
      })}

      {lanterns.map(([x, , z], i) => (
        <group key={i} position={[x, 0, z]}>
          <mesh position-y={0.9}>
            <cylinderGeometry args={[0.05, 0.07, 1.8, 5]} />
            <meshStandardMaterial color="#1c1612" />
          </mesh>
          <mesh position-y={1.9}>
            <boxGeometry args={[0.22, 0.3, 0.22]} />
            <meshStandardMaterial color="#ffb35c" emissive="#ff9a3c" emissiveIntensity={2.2} />
          </mesh>
          <pointLight position-y={1.9} color="#ffae55" intensity={14} distance={11} decay={1.6} />
        </group>
      ))}

      {players.map((p, i) => {
        const a = ((i - myIndex) / n) * Math.PI * 2;
        const isMe = p.id === me?.id;
        return (
          <Scarecrow
            key={p.id}
            name={isMe ? `${p.name} (you)` : p.name}
            item={isMe ? me!.item : p.item}
            colorHex={isMe ? colorInfo(me!.color).hex : null}
            position={[Math.sin(a) * radius, 0, Math.cos(a) * radius]}
            rotationY={a + Math.PI}
            selected={selectedId === p.id}
            faded={!p.connected || p.away}
            onSelect={canSelect && !isMe ? () => select(p.id) : undefined}
          />
        );
      })}

      <CameraRig radius={radius} sidePanel={view?.phase !== 'lobby' && view?.phase !== 'ended'} />
      <OrbitControls
        makeDefault
        enablePan={false}
        enableDamping
        target={[0, 1.2, 0]}
        minDistance={5}
        maxDistance={radius + 14}
        minPolarAngle={0.55}
        maxPolarAngle={1.38}
      />
    </Canvas>
  );
}

/**
 * Frames the circle for the screen shape. On portrait phones the camera pulls back
 * and the image shifts up, so the circle sits above the bottom panel. On desktop
 * the image shifts left to center in the space beside the side panel.
 */
function CameraRig({ radius, sidePanel }: { radius: number; sidePanel: boolean }) {
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const controls = useThree((s) => s.controls) as { update?: () => void } | null;
  const portrait = size.width < size.height;

  useEffect(() => {
    const pull = portrait ? Math.min(1.9, 0.75 / (size.width / size.height)) : 1;
    camera.position.set(0, 6.2 * pull, (radius + 6.5) * pull);
    camera.lookAt(0, 1.2, 0);
    controls?.update?.();
  }, [camera, controls, radius, portrait]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const cam = camera as import('three').PerspectiveCamera;
    const { width: w, height: h } = size;
    if (portrait) cam.setViewOffset(w, h, 0, h * 0.2, w, h);
    else if (sidePanel && w >= DESKTOP_MIN) cam.setViewOffset(w, h, SIDE_PANEL_PX / 2, 0, w, h);
    else cam.clearViewOffset();
    cam.updateProjectionMatrix();
  }, [camera, size, portrait, sidePanel]);

  return null;
}
