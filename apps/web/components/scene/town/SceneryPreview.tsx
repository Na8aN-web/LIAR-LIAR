'use client';

import { Suspense, useMemo } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import anchors from '../sceneryAnchors.json';
import { NameLabel } from '../NameLabel';
import { PropInstances } from './PropInstances';
import { EmptyPosterSpot, PosterPanel } from './PosterPanel';
import { useScenery } from './useScenery';

// Dev-only: lay out every building and prop from scenery.glb in a grid, in daylight, labelled.
function Grid() {
  const scenery = useScenery();
  const buildings = Object.keys(anchors.buildings);
  const props = Object.keys(anchors.props);
  const objs = useMemo(() => buildings.map((b) => scenery.building(b)), [scenery]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      {buildings.map((b, i) => (
        <group key={b} position={[(i - (buildings.length - 1) / 2) * 13, 0, -14]}>
          <primitive object={objs[i]} />
          <NameLabel name={b} position={[0, 11, 0]} />
          {anchors.posterSpots
            .filter((s) => s.building === b)
            .map((s) =>
              s.active ? (
                <PosterPanel key={s.id} color="red" pot={150} number={3} of={10} position={s.position as [number, number, number]} />
              ) : (
                <EmptyPosterSpot key={s.id} position={s.position as [number, number, number]} />
              ),
            )}
        </group>
      ))}
      {props.map((p, i) => {
        const x = ((i % 8) - 3.5) * 5;
        const z = Math.floor(i / 8) * 6;
        return (
          <group key={p}>
            <PropInstances scenery={scenery} name={p} placements={[{ position: [x, 0, z] }]} />
            <NameLabel name={p} position={[x, 4.5, z]} />
          </group>
        );
      })}
    </>
  );
}

export default function SceneryPreview() {
  return (
    <div style={{ position: 'fixed', inset: 0 }}>
      <Canvas camera={{ position: [0, 26, 40], fov: 45 }} onCreated={({ camera }) => {
        // ?focus=sheriff zooms on that building's front.
        const f = new URLSearchParams(location.search).get('focus');
        const i = Object.keys(anchors.buildings).indexOf(f ?? '');
        if (i >= 0) {
          const x = (i - (Object.keys(anchors.buildings).length - 1) / 2) * 13;
          camera.position.set(x, 3.5, -4);
          camera.lookAt(x, 2.6, -15);
        }
      }}>
        <color attach="background" args={['#9ab0c8']} />
        <hemisphereLight args={['#ffffff', '#776655', 2.2]} />
        <directionalLight position={[20, 40, 25]} intensity={2.2} />
        <mesh rotation-x={-Math.PI / 2}>
          <planeGeometry args={[200, 200]} />
          <meshStandardMaterial color="#b49a74" />
        </mesh>
        <Suspense fallback={null}>
          <Grid />
        </Suspense>
        {!new URLSearchParams(typeof location !== 'undefined' ? location.search : '').get('focus') && <OrbitControls target={[0, 2, 0]} />}
      </Canvas>
    </div>
  );
}
