// Identity cosmetics: hats and head details that make scarecrows easy to tell apart.
// Purely visual and public (everyone sees everyone's), separate from the colored item.
//
// Data-driven: to add an item, add an entry to COSMETICS (and its shape to the web
// registry in apps/web/components/scene/cosmetics.ts). Items may only use COSMETIC_TONES:
// earthy, natural colors that are each measurably far from all 20 palette colors, so a
// hat can never be mistaken for a player's color (checked in apps/server/test/cosmetics.test.ts).

/** Earthy tones cosmetics are built from. Never any palette color (min CIEDE2000 distance 16). */
export const COSMETIC_TONES = {
  /** Dull, weathered straw (hat, button thread). Kept brownish so it never reads as Yellow. */
  straw: '#9a8360',
  /** Weathered brown felt (battered cowboy hat). */
  felt: '#4a3a2c',
  /** Soot black (top hat, eye patch). */
  soot: '#26221e',
  /** Charcoal felt (bowler). */
  charcoal: '#3b3a37',
  /** Dark leather (hat bands, straps). */
  leather: '#433528',
  /** Near-black band. */
  band: '#2b2420',
  /** Dark twine (stitches). */
  thread: '#2a1d14',
} as const;

export type CosmeticTone = keyof typeof COSMETIC_TONES;

/**
 * Other players' garments on your screen: dark, desaturated jute with a visible weave, so it
 * reads as "unknown" rather than as a color. One tone for everyone (their real colors never
 * reach the client), far from every palette color and every cosmetic tone.
 */
export const NEUTRAL_ITEM_HEX = '#66644d';
/** The neutral garment's brightness never leaves this range (fixed shading x weave, not scene
 *  light), and every shade in it is still far from the palette (tested). */
export const NEUTRAL_SHADE = { min: 0.55, max: 1.15 } as const;

export const COSMETIC_SLOTS = ['hat', 'face'] as const;
export type CosmeticSlot = (typeof COSMETIC_SLOTS)[number];

export interface CosmeticDef {
  id: string;
  slot: CosmeticSlot;
  name: string;
  /** Every tone the item is drawn with. */
  tones: CosmeticTone[];
}

/** 'none' is always valid for every slot. */
export const NO_COSMETIC = 'none';

export const COSMETICS: CosmeticDef[] = [
  { id: 'straw-hat', slot: 'hat', name: 'Straw hat', tones: ['straw', 'leather'] },
  { id: 'cowboy-hat', slot: 'hat', name: 'Battered cowboy hat', tones: ['felt', 'band'] },
  { id: 'top-hat', slot: 'hat', name: 'Top hat', tones: ['soot', 'leather'] },
  { id: 'bowler', slot: 'hat', name: 'Bowler', tones: ['charcoal', 'band'] },
  { id: 'stitched-grin', slot: 'face', name: 'Stitched grin', tones: ['thread'] },
  { id: 'stitched-scar', slot: 'face', name: 'Cross-stitch scar', tones: ['thread'] },
  { id: 'button-eye', slot: 'face', name: 'Button eye', tones: ['soot', 'straw'] },
  { id: 'eye-patch', slot: 'face', name: 'Eye patch', tones: ['soot', 'band'] },
];

export type Cosmetics = Record<CosmeticSlot, string>;

export const DEFAULT_COSMETICS: Cosmetics = { hat: NO_COSMETIC, face: NO_COSMETIC };

export function cosmeticsFor(slot: CosmeticSlot): CosmeticDef[] {
  return COSMETICS.filter((c) => c.slot === slot);
}

export function isCosmeticId(slot: CosmeticSlot, id: unknown): id is string {
  return id === NO_COSMETIC || COSMETICS.some((c) => c.slot === slot && c.id === id);
}

/** Checks a partial update from a client: known slots, known ids only. */
export function parseCosmetics(v: unknown): Partial<Cosmetics> | null {
  if (!v || typeof v !== 'object') return null;
  const out: Partial<Cosmetics> = {};
  for (const [k, id] of Object.entries(v)) {
    if (!(COSMETIC_SLOTS as readonly string[]).includes(k)) return null;
    if (!isCosmeticId(k as CosmeticSlot, id)) return null;
    out[k as CosmeticSlot] = id;
  }
  return out;
}

/** A random look. Most scarecrows get a hat and a head detail, so the circle is easy to tell apart. */
export function randomCosmetics(int: (n: number) => number): Cosmetics {
  const pick = (slot: CosmeticSlot, noneChance: number) => {
    const list = cosmeticsFor(slot);
    return int(100) < noneChance ? NO_COSMETIC : list[int(list.length)].id;
  };
  return { hat: pick('hat', 15), face: pick('face', 30) };
}
