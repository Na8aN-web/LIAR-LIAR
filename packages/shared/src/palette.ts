// The 20 item colors. Every color is held by at most one player at a time.
// 20 colors leave at least 5 free in a full 15-player game, so swaps always have options.
// Picked for a dark night scene: no black, no navy, and no two near-identical hues.
// Tune hex values here after phone playtests; ids are what the server uses.
export const PALETTE = [
  { id: 'red', name: 'Red', hex: '#e53935' },
  { id: 'maroon', name: 'Maroon', hex: '#9c2448' },
  { id: 'orange', name: 'Orange', hex: '#fb8c00' },
  { id: 'tan', name: 'Tan', hex: '#e8c39e' },
  { id: 'brown', name: 'Brown', hex: '#8b5a2b' },
  { id: 'yellow', name: 'Yellow', hex: '#fdd835' },
  { id: 'olive', name: 'Olive', hex: '#8f9a2c' },
  { id: 'lime', name: 'Lime', hex: '#9be22d' },
  { id: 'green', name: 'Green', hex: '#2e9d42' },
  { id: 'mint', name: 'Mint', hex: '#7ff2c4' },
  { id: 'teal', name: 'Teal', hex: '#0f8f80' },
  { id: 'cyan', name: 'Cyan', hex: '#2fd6f0' },
  { id: 'sky', name: 'Sky', hex: '#8cb8ff' },
  { id: 'blue', name: 'Blue', hex: '#2f5ff5' },
  { id: 'lavender', name: 'Lavender', hex: '#c7b3ff' },
  { id: 'purple', name: 'Purple', hex: '#8a2be2' },
  { id: 'magenta', name: 'Magenta', hex: '#e0218a' },
  { id: 'pink', name: 'Pink', hex: '#ff9cc2' },
  { id: 'white', name: 'White', hex: '#f5f5f5' },
  { id: 'gray', name: 'Gray', hex: '#8e8e96' },
] as const;

export type ColorId = (typeof PALETTE)[number]['id'];

export const COLOR_IDS: ColorId[] = PALETTE.map((c) => c.id);

const byId = new Map<string, (typeof PALETTE)[number]>(PALETTE.map((c) => [c.id, c]));

export function isColorId(v: unknown): v is ColorId {
  return typeof v === 'string' && byId.has(v);
}

export function colorInfo(id: ColorId) {
  return byId.get(id)!;
}
