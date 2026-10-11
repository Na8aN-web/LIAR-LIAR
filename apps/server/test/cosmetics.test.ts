import { afterEach, describe, expect, it } from 'vitest';
import { COSMETICS, COSMETIC_TONES, NEUTRAL_ITEM_HEX, NEUTRAL_SHADE, PALETTE, type PlayerView } from '@wtc/shared';
import { Room } from '../src/room';
import { secureRng } from '../src/rng';

// Cosmetics and the neutral garment must never look like a player color. "Far" means at
// least as far (CIEDE2000) as the two closest palette colors are from each other.
const MIN_DISTANCE = 16;

function lab(hex: string): [number, number, number] {
  const lin = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  const [r, g, b] = lin;
  const x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047;
  const y = r * 0.2126 + g * 0.7152 + b * 0.0722;
  const z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

/** CIEDE2000 color difference. */
function deltaE(c1: string, c2: string): number {
  const [L1, a1, b1] = lab(c1);
  const [L2, a2, b2] = lab(c2);
  const rad = Math.PI / 180;
  const Cb = (Math.hypot(a1, b1) + Math.hypot(a2, b2)) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cb ** 7 / (Cb ** 7 + 25 ** 7)));
  const a1p = a1 * (1 + G);
  const a2p = a2 * (1 + G);
  const C1p = Math.hypot(a1p, b1);
  const C2p = Math.hypot(a2p, b2);
  const hue = (x: number, y: number) => {
    const v = Math.atan2(y, x) / rad;
    return v < 0 ? v + 360 : v;
  };
  const h1 = hue(a1p, b1);
  const h2 = hue(a2p, b2);
  let dh = h2 - h1;
  if (C1p * C2p === 0) dh = 0;
  else if (dh > 180) dh -= 360;
  else if (dh < -180) dh += 360;
  const dL = L2 - L1;
  const dC = C2p - C1p;
  const dH = 2 * Math.sqrt(C1p * C2p) * Math.sin((dh * rad) / 2);
  const Lb = (L1 + L2) / 2;
  const Cbp = (C1p + C2p) / 2;
  let hb = h1 + h2;
  if (C1p * C2p !== 0) {
    hb = Math.abs(h1 - h2) > 180 ? (h1 + h2 + 360) / 2 : (h1 + h2) / 2;
    if (hb >= 360) hb -= 360;
  }
  const T = 1 - 0.17 * Math.cos((hb - 30) * rad) + 0.24 * Math.cos(2 * hb * rad) + 0.32 * Math.cos((3 * hb + 6) * rad) - 0.2 * Math.cos((4 * hb - 63) * rad);
  const dTh = 30 * Math.exp(-(((hb - 275) / 25) ** 2));
  const Rc = 2 * Math.sqrt(Cbp ** 7 / (Cbp ** 7 + 25 ** 7));
  const Sl = 1 + (0.015 * (Lb - 50) ** 2) / Math.sqrt(20 + (Lb - 50) ** 2);
  const Sc = 1 + 0.045 * Cbp;
  const Sh = 1 + 0.015 * Cbp * T;
  const Rt = -Math.sin(2 * dTh * rad) * Rc;
  return Math.sqrt((dL / Sl) ** 2 + (dC / Sc) ** 2 + (dH / Sh) ** 2 + Rt * (dC / Sc) * (dH / Sh));
}

const nearestPalette = (hex: string) =>
  PALETTE.map((c) => ({ id: c.id, d: deltaE(hex, c.hex) })).sort((a, b) => a.d - b.d)[0];

describe('cosmetic and neutral tones', () => {
  it('the palette itself is no closer than the threshold (sanity check of the bar)', () => {
    let min = Infinity;
    for (const a of PALETTE) for (const b of PALETTE) if (a.id !== b.id) min = Math.min(min, deltaE(a.hex, b.hex));
    expect(min).toBeGreaterThanOrEqual(15);
  });

  it.each(Object.entries(COSMETIC_TONES))('tone %s (%s) is far from every palette color', (_, hex) => {
    const n = nearestPalette(hex);
    expect(n.d, `closest palette color is ${n.id}`).toBeGreaterThanOrEqual(MIN_DISTANCE);
  });

  it("other players' garment color is far from every palette color, in every shade it's drawn", () => {
    // Shading multiplies linear light, like the shader does.
    const shade = (hex: string, k: number) => {
      const lin = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
      const srgb = (v: number) => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);
      return (
        '#' +
        [1, 3, 5]
          .map((i) => Math.round(255 * srgb(Math.min(1, lin(parseInt(hex.slice(i, i + 2), 16) / 255) * k))))
          .map((v) => v.toString(16).padStart(2, '0'))
          .join('')
      );
    };
    for (let k = NEUTRAL_SHADE.min; k <= NEUTRAL_SHADE.max + 1e-9; k += 0.05) {
      const n = nearestPalette(shade(NEUTRAL_ITEM_HEX, k));
      expect(n.d, `shade x${k.toFixed(2)}: closest palette color is ${n.id}`).toBeGreaterThanOrEqual(MIN_DISTANCE);
    }
  });

  it("other players' garment is clearly different from every cosmetic tone", () => {
    for (const [name, hex] of Object.entries(COSMETIC_TONES)) {
      expect(deltaE(NEUTRAL_ITEM_HEX, hex), `tone ${name}`).toBeGreaterThanOrEqual(12);
    }
  });

  it('every cosmetic is drawn only with cosmetic tones', () => {
    for (const c of COSMETICS) {
      expect(c.tones.length).toBeGreaterThan(0);
      for (const t of c.tones) expect(Object.keys(COSMETIC_TONES)).toContain(t);
    }
  });
});

describe('choosing cosmetics in the lobby', () => {
  const rooms: Room[] = [];
  afterEach(() => rooms.splice(0).forEach((r) => r.dispose()));

  function room() {
    const sent: { socketId: string; event: string; payload: unknown }[] = [];
    const r = new Room('COSMO', {
      send: (socketId, event, ...args) => sent.push({ socketId, event, payload: args[0] }),
      rng: secureRng,
      devMode: true,
      minPlayers: 2,
    });
    rooms.push(r);
    const ids = [0, 1, 2].map((i) => {
      const res = r.addPlayer(`P${i}`, `sock${i}`);
      if (!res.ok) throw new Error(res.error);
      return res.seat.id;
    });
    return { r, ids, sent };
  }
  const flush = () => new Promise((res) => setTimeout(res, 0));

  it('accepts catalog items and shows them to everyone', async () => {
    const { r, ids, sent } = room();
    expect(r.setLook(ids[1], { cosmetics: { hat: 'top-hat', face: 'eye-patch' } }).ok).toBe(true);
    await flush();
    for (const sock of ['sock0', 'sock1', 'sock2']) {
      const last = sent.filter((s) => s.event === 'view' && s.socketId === sock).at(-1)!.payload as PlayerView;
      expect(last.players.find((p) => p.id === ids[1])!.cosmetics).toEqual({ hat: 'top-hat', face: 'eye-patch' });
    }
  });

  it('rejects unknown items and unknown slots', () => {
    const { r, ids } = room();
    expect(r.setLook(ids[0], { cosmetics: { hat: 'golden-crown' } }).ok).toBe(false);
    expect(r.setLook(ids[0], { cosmetics: { hat: 'eye-patch' } }).ok).toBe(false); // wrong slot
    expect(r.setLook(ids[0], { cosmetics: { cape: 'none' } }).ok).toBe(false);
    expect(r.setLook(ids[0], { cosmetics: 'top-hat' }).ok).toBe(false);
    expect(r.setLook(ids[0], { cosmetics: { hat: 'none', face: 'none' } }).ok).toBe(true);
  });

  it('gives every new player a look from the catalog', () => {
    const { r } = room();
    for (const s of r.seats.values()) {
      expect(s.cosmetics.hat === 'none' || COSMETICS.some((c) => c.slot === 'hat' && c.id === s.cosmetics.hat)).toBe(true);
      expect(s.cosmetics.face === 'none' || COSMETICS.some((c) => c.slot === 'face' && c.id === s.cosmetics.face)).toBe(true);
    }
  });

  it('is locked once the game starts', () => {
    const { r, ids } = room();
    expect(r.start(ids[0]).ok).toBe(true);
    expect(r.setLook(ids[1], { cosmetics: { hat: 'bowler' } }).ok).toBe(false);
  });
});
