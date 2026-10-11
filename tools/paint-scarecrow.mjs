// Paints the scarecrow's body with vertex colors, after the Meshy concept art
// (dark patched shirt, rope belt, brown trousers, burlap head, straw tufts at the collar,
// cuffs and trouser hems, wooden hands and shins, boots).
//
// Why vertex colors: the source model (apps/scarecrow.glb, Meshy's untextured "white mesh")
// and the Mixamo FBX files have no textures, UVs or colors at all, so there is nothing to
// restore. When a textured export arrives this step can be replaced by its texture.
//
// Regions come from the rig: the joint each vertex follows, plus height and distance from
// the limb's axis in the rest pose (model units, feet at y=0, 1.96 tall, +z forward).

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));

export const BODY_TONES = {
  shirt: '#2f2d2a',
  shirtPatch: '#4a4035',
  trousers: '#4b3424',
  trousersPatch: '#5e4630',
  rope: '#8c6d42',
  burlap: '#86683f',
  straw: '#a8873f',
  wood: '#5e4129',
  boot: '#2f241c',
};

/** Small deterministic 3D value noise, 0..1. */
function noise3(x, y, z) {
  const h = (i, j, k) => {
    let n = i * 374761393 + j * 668265263 + k * 2147483647;
    n = (n ^ (n >> 13)) * 1274126177;
    return ((n ^ (n >> 16)) >>> 0) / 4294967295;
  };
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const s = (t) => t * t * (3 - 2 * t);
  const fx = s(x - xi), fy = s(y - yi), fz = s(z - zi);
  const lerp = (a, b, t) => a + (b - a) * t;
  const c = (dx, dy, dz) => h(xi + dx, yi + dy, zi + dz);
  return lerp(
    lerp(lerp(c(0, 0, 0), c(1, 0, 0), fx), lerp(c(0, 1, 0), c(1, 1, 0), fx), fy),
    lerp(lerp(c(0, 0, 1), c(1, 0, 1), fx), lerp(c(0, 1, 1), c(1, 1, 1), fx), fy),
    fz,
  );
}

/** Distance from p to the segment a-b, and how far along it (0 at a, 1 at b). */
function segment(p, a, b) {
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const ap = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
  const len2 = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2 || 1;
  const t = (ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / len2;
  const c = Math.max(0, Math.min(1, t));
  const d = Math.hypot(ap[0] - ab[0] * c, ap[1] - ab[1] * c, ap[2] - ab[2] * c);
  return { d, t };
}

/**
 * @param rest   per-vertex rest positions, model units ([x, y, z][])
 * @param joint  per-vertex dominant joint name (without the "mixamorig:" prefix)
 * @param J      joint rest positions by name, model units
 * @returns linear RGB, 3 floats per vertex
 */
export function paintBody(rest, joint, J) {
  const out = new Float32Array(rest.length * 3);
  if (process.env.PAINT_DEBUG) return debugJoints(rest, joint);
  const neck = J.Neck;
  const counts = {};
  for (let i = 0; i < rest.length; i++) {
    const p = rest[i];
    const [x, y, z] = p;
    const j = joint[i];
    const side = x >= J.Hips[0] ? 'Left' : 'Right';
    let tone;
    // Bands measured on the mesh (rest pose): the straw ruff sits between 1.615 and 1.71
    // around the neck; cuff straw pokes out in the last 7 cm before the wrist, further out
    // than the sleeve; past the wrist is a thin wooden hand; trouser hems end at 0.32 with
    // spikes out to 0.40; a bit of wooden stick shows down to 0.28; boots below that.
    const hand = segment(p, J[`${side}ForeArm`], J[`${side}Hand`]);
    const wrist = J[`${side}Hand`];
    const armLen = Math.hypot(...[0, 1, 2].map((n) => wrist[n] - J[`${side}ForeArm`][n]));
    // Signed distance along the forearm from the wrist (negative = before the wrist).
    const pastWrist = (hand.t - 1) * armLen;
    const shin = segment(p, J[`${side}Leg`], J[`${side}Foot`]);
    const neckD = Math.hypot(x - neck[0], z - neck[2]);
    if (j === 'Head' || (j === 'Neck' && y > J.Head[1] - 0.005)) {
      tone = 'burlap';
    } else if (y > J.Neck[1] - 0.03 && y < J.Head[1] && neckD < 0.22) {
      tone = 'straw';
    } else if (/Hand/.test(j) && j !== `${side}Hand`) {
      tone = 'wood'; // fingers
    } else if (/Hand|ForeArm/.test(j) && hand.t >= 1 && pastWrist > 0.012) {
      tone = 'wood';
    } else if (/Hand|ForeArm/.test(j) && pastWrist > -0.075 && hand.d > 0.085) {
      tone = 'straw';
    } else if (/Hand/.test(j)) {
      tone = 'wood';
    } else if (/Arm|Shoulder|Spine|Neck/.test(j)) {
      tone = 'shirt';
    } else if (j === 'Hips' || /UpLeg/.test(j)) {
      // Rope belt round the waist, shirt tails below it, then trousers.
      const beltTop = J.Hips[1] + 0.05;
      tone = y > beltTop ? 'shirt' : y > beltTop - 0.05 ? 'rope' : y > J.Hips[1] - 0.12 ? 'shirt' : 'trousers';
    } else if (/Leg|Foot|Toe/.test(j)) {
      if (y > 0.4) tone = 'trousers';
      else if (y > 0.32) tone = shin.d > 0.08 ? 'straw' : 'trousers';
      else if (y > 0.28) tone = 'wood';
      else tone = 'boot';
    } else {
      tone = 'shirt';
    }
    counts[tone] = (counts[tone] ?? 0) + 1;
    // Patched cloth: big soft blotches of a second fabric on the shirt and trousers.
    if ((tone === 'shirt' || tone === 'trousers') && noise3(x * 9 + 3, y * 9, z * 9) > 0.72) tone = tone === 'shirt' ? 'shirtPatch' : 'trousersPatch';
    const c = hex(BODY_TONES[tone]);
    // Grain: a little brightness variation so flat areas don't look plastic.
    const g = 0.86 + 0.24 * noise3(x * 40, y * 40, z * 40);
    out[i * 3] = c[0] * g;
    out[i * 3 + 1] = c[1] * g;
    out[i * 3 + 2] = c[2] * g;
  }
  console.log('paint        ', Object.entries(counts).map(([k, n]) => k + ' ' + n).join(', '));
  return out;
}

/** PAINT_DEBUG=1: one color per joint, to see which joint owns which part of the mesh. */
function debugJoints(rest, joint) {
  const names = [...new Set(joint)].sort();
  console.log(names.map((n, i) => `${i}:${n}`).join(' '));
  const out = new Float32Array(rest.length * 3);
  joint.forEach((n, i) => {
    const h = (names.indexOf(n) * 0.618) % 1;
    const c = [0, 2 / 3, 1 / 3].map((o) => 0.5 + 0.5 * Math.cos(2 * Math.PI * (h + o)));
    out.set(c, i * 3);
  });
  return out;
}
