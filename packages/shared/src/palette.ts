// The 15 item colors. Every color can be taken by one player only.
// Tune hex values here after phone playtests; ids are what the server uses.
export const PALETTE = [
  { id: 'red', name: 'Red', hex: '#e53935' },
  { id: 'orange', name: 'Orange', hex: '#fb8c00' },
  { id: 'yellow', name: 'Yellow', hex: '#fdd835' },
  { id: 'lime', name: 'Lime', hex: '#9be22d' },
  { id: 'green', name: 'Green', hex: '#2e9d42' },
  { id: 'teal', name: 'Teal', hex: '#0f8f80' },
  { id: 'cyan', name: 'Cyan', hex: '#2fd6f0' },
  { id: 'blue', name: 'Blue', hex: '#2f5ff5' },
  // Replaces navy, which was too close to blue/black on a night scene.
  { id: 'lavender', name: 'Lavender', hex: '#b9a3ff' },
  { id: 'purple', name: 'Purple', hex: '#8a2be2' },
  { id: 'magenta', name: 'Magenta', hex: '#e0218a' },
  { id: 'pink', name: 'Pink', hex: '#ff9cc2' },
  { id: 'brown', name: 'Brown', hex: '#8b5a2b' },
  { id: 'white', name: 'White', hex: '#f5f5f5' },
  { id: 'black', name: 'Black', hex: '#1a1a1a' },
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
