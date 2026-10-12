import anchors from '../sceneryAnchors.json';

// Where everything stands in the town square. Angles are degrees around the centre:
// 0° = the default camera side, 180° = straight across (the sheriff's office and its poster).

export const DEG = Math.PI / 180;
/** Town-kit buildings are ~4 m tall; scarecrows are 2.5 m. Scale the buildings to match. */
export const BUILDING_SCALE = 1.5;

/**
 * Ring radius for a given scarecrow-circle radius. Large enough that the farthest camera
 * (maxDistance in Scene) stays inside the ring, so no building ever sits between camera and fire.
 */
export function ringRadius(circleRadius: number) {
  return Math.max(24, circleRadius + 14);
}

export type BuildingModel = keyof typeof anchors.buildings;

export interface Lot {
  id: string;
  model: BuildingModel;
  /** Painted name board, or none (the sheriff, saloon and church have theirs in the model). */
  sign?: string;
}

/**
 * Lots in order of increasing angle, starting with the sheriff at 180°. Repeated models get
 * their own sign so the street doesn't read as copies. Gaps between lots are equal alleys.
 */
export const LOTS: Lot[] = [
  { id: 'sheriff', model: 'sheriff' },
  // The hotel (rooftop and door ads) sits next to the sheriff, facing the default camera.
  { id: 'hotel', model: 'store', sign: 'HOTEL' },
  { id: 'church', model: 'church' },
  { id: 'store', model: 'store', sign: 'GENERAL STORE' },
  { id: 'dancehall', model: 'saloon', sign: 'DANCE HALL' },
  { id: 'livery', model: 'barn', sign: 'LIVERY' },
  { id: 'assay', model: 'store', sign: 'ASSAY OFFICE' },
  { id: 'opera', model: 'saloon', sign: 'OPERA HOUSE' },
  { id: 'barber', model: 'store', sign: 'BARBER' },
  { id: 'bank', model: 'store', sign: 'BANK' },
  { id: 'barn', model: 'barn' },
  { id: 'saloon', model: 'saloon' },
];

/** Where each model's name board goes (building-local, unscaled; front edge at z=0, facade behind). */
export const SIGN_SPOTS: Partial<Record<BuildingModel, { position: [number, number, number]; width: number }>> = {
  store: { position: [0, 3.55, -1.45], width: 3.2 },
  // Covers the model's own SALOON board on the upper storey.
  saloon: { position: [-1.98, 3.37, -1.41], width: 2.6 },
  barn: { position: [1.2, 2.9, -0.99], width: 2.6 },
};

export interface PlacedLot extends Lot {
  angle: number;
  /** Half the lot's width as an angle, degrees. */
  halfAngle: number;
}

/** Lays the lots around the ring with equal alleys between them, sheriff fixed at 180°. */
export function placeLots(R: number): { lots: PlacedLot[]; alleys: number[] } {
  const half = LOTS.map((l) => (anchors.buildings[l.model].width * BUILDING_SCALE) / 2 / R / DEG);
  const used = half.reduce((s, h) => s + 2 * h, 0);
  const gap = (360 - used) / LOTS.length;
  const lots: PlacedLot[] = [];
  const alleys: number[] = [];
  let a = 180;
  LOTS.forEach((l, i) => {
    lots.push({ ...l, angle: a % 360, halfAngle: half[i] });
    const next = half[(i + 1) % LOTS.length];
    alleys.push((a + half[i] + gap / 2) % 360);
    a += half[i] + gap + next;
  });
  return { lots, alleys };
}

export const polar = (angleDeg: number, r: number, y = 0): [number, number, number] => [
  Math.sin(angleDeg * DEG) * r,
  y,
  Math.cos(angleDeg * DEG) * r,
];
/** Facing the centre of the square. */
export const facing = (angleDeg: number) => angleDeg * DEG + Math.PI;
/** Running along the ring (for fences). */
export const along = (angleDeg: number) => angleDeg * DEG;
