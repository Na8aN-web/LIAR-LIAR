'use client';

import { useState } from 'react';
import { DoubleSide } from 'three';
import type { ThreeEvent } from '@react-three/fiber';
import type { ItemType } from '@wtc/shared';
import { NameLabel } from './NameLabel';

interface Props {
  name: string;
  item: ItemType;
  /** Null renders a dark silhouette (everyone but you). */
  colorHex: string | null;
  position: [number, number, number];
  rotationY: number;
  selected: boolean;
  faded: boolean;
  onSelect?: () => void;
}

const SILHOUETTE = '#0c0c12';
const SILHOUETTE_ITEM = '#14141c';
const STRAW = '#a07c4f';

/** Placeholder scarecrow: post, body, crossbar arms, head, hat and one colored item. Local +z faces front. */
export function Scarecrow({ name, item, colorHex, position, rotationY, selected, faded, onSelect }: Props) {
  const [hover, setHover] = useState(false);
  const body = colorHex ? STRAW : SILHOUETTE;
  const itemColor = colorHex ?? SILHOUETTE_ITEM;
  const opacity = faded ? 0.35 : 1;
  const mat = (color: string) => (
    <meshStandardMaterial color={color} roughness={1} transparent={faded} opacity={opacity} />
  );

  const click = (e: ThreeEvent<MouseEvent>) => {
    if (!onSelect || e.delta > 8) return; // ignore camera drags
    e.stopPropagation();
    onSelect();
  };

  return (
    <group
      position={position}
      rotation-y={rotationY}
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
      <mesh position-y={0.55}>
        <cylinderGeometry args={[0.06, 0.08, 1.1, 6]} />
        {mat(body === STRAW ? '#5a4128' : SILHOUETTE)}
      </mesh>
      <mesh position-y={1.35}>
        <capsuleGeometry args={[0.3, 0.65, 3, 8]} />
        {mat(body)}
      </mesh>
      <mesh position-y={1.68} rotation-z={Math.PI / 2}>
        <cylinderGeometry args={[0.05, 0.05, 1.5, 5]} />
        {mat(body)}
      </mesh>
      <mesh position-y={2.08}>
        <sphereGeometry args={[0.24, 8, 6]} />
        {mat(body)}
      </mesh>
      <mesh position-y={2.3}>
        <cylinderGeometry args={[0.44, 0.44, 0.04, 10]} />
        {mat(colorHex ? '#3b2a1a' : SILHOUETTE)}
      </mesh>
      <mesh position-y={2.46}>
        <cylinderGeometry args={[0.19, 0.25, 0.3, 8]} />
        {mat(colorHex ? '#3b2a1a' : SILHOUETTE)}
      </mesh>

      {item === 'poncho' && (
        <mesh position-y={1.5}>
          <coneGeometry args={[0.66, 0.75, 8, 1, true]} />
          <meshStandardMaterial color={itemColor} roughness={0.9} side={DoubleSide} transparent={faded} opacity={opacity} />
        </mesh>
      )}
      {item === 'cloak' && (
        <mesh position={[0, 1.3, -0.02]}>
          <cylinderGeometry args={[0.42, 0.62, 1.3, 10, 1, true, Math.PI / 2, Math.PI]} />
          <meshStandardMaterial color={itemColor} roughness={0.9} side={DoubleSide} transparent={faded} opacity={opacity} />
        </mesh>
      )}
      {item === 'bandana' && (
        <group position-y={1.86}>
          <mesh rotation-x={Math.PI / 2}>
            <torusGeometry args={[0.2, 0.07, 6, 12]} />
            <meshStandardMaterial color={itemColor} roughness={0.9} transparent={faded} opacity={opacity} />
          </mesh>
          <mesh position={[0, -0.12, 0.2]} rotation-x={Math.PI}>
            <coneGeometry args={[0.15, 0.26, 3]} />
            <meshStandardMaterial color={itemColor} roughness={0.9} transparent={faded} opacity={opacity} />
          </mesh>
        </group>
      )}

      {(selected || hover) && (
        <mesh rotation-x={-Math.PI / 2} position-y={0.03}>
          <ringGeometry args={[0.55, selected ? 0.72 : 0.62, 28]} />
          <meshBasicMaterial color="#f2c14e" transparent opacity={selected ? 1 : 0.5} />
        </mesh>
      )}

      <NameLabel text={name} position={[0, 2.95, 0]} highlight={selected} faded={faded} />
    </group>
  );
}
