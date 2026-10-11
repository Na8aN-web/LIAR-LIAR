import { DoubleSide, MeshBasicMaterial } from 'three';
import { NEUTRAL_ITEM_HEX, NEUTRAL_SHADE } from '@wtc/shared';

/** Fixed shading from a light that's part of the material, not the scene. */
const LIGHT = { min: 0.7, max: 1.04 };
/** Weave: alternating over/under threads, brightness per thread. */
const WEAVE = { min: 0.8, max: 1.1 };
/** Thread pairs per model unit (the scarecrow is ~2 units tall): ~4 cm cells in the game. */
const WEAVE_FREQ = 26;

// Together they must stay inside NEUTRAL_SHADE, the range the palette test checks.
if (LIGHT.min * WEAVE.min < NEUTRAL_SHADE.min - 1e-6 || LIGHT.max * WEAVE.max > NEUTRAL_SHADE.max + 1e-6) {
  throw new Error('neutral garment shading leaves NEUTRAL_SHADE');
}

/**
 * Everyone else's garment: dark undyed jute with a visible weave, so it reads as "unknown",
 * not as a color. Unlit and not tone-mapped, so no light or brightness setting can tint it:
 * the screen shows exactly NEUTRAL_ITEM_HEX times shading and weave, which stay within
 * NEUTRAL_SHADE (checked to be far from every palette color: apps/server/test/cosmetics.test.ts).
 *
 * `unit` converts the garment's bind-space positions (rig units) to model units, so the weave
 * is the same size on every garment and sticks to the cloth as it moves.
 */
export function neutralItemMaterial(unit: number): MeshBasicMaterial {
  const m = new MeshBasicMaterial({ color: NEUTRAL_ITEM_HEX, side: DoubleSide, toneMapped: false });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.lightRange = { value: [LIGHT.min, LIGHT.max] };
    shader.uniforms.weaveRange = { value: [WEAVE.min, WEAVE.max] };
    shader.uniforms.weaveScale = { value: WEAVE_FREQ / unit };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vShadeNormal;\nvarying vec3 vWeavePos;\nuniform float weaveScale;')
      .replace(
        '#include <fog_vertex>',
        [
          '#include <fog_vertex>',
          // Pre-skinning position: the pattern is fixed to the cloth, not the world.
          'vWeavePos = position * weaveScale;',
          // transformedNormal exists for skinned meshes (the basic material computes it for skinning).
          '#ifdef USE_SKINNING',
          '  vShadeNormal = normalize(transformedNormal);',
          '#else',
          '  vShadeNormal = normalize(normalMatrix * normal);',
          '#endif',
        ].join('\n'),
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec3 vShadeNormal;\nvarying vec3 vWeavePos;\nuniform vec2 lightRange;\nuniform vec2 weaveRange;',
      )
      .replace(
        '#include <color_fragment>',
        [
          '#include <color_fragment>',
          'vec3 shadeN = normalize(vShadeNormal) * (gl_FrontFacing ? 1.0 : -1.0);',
          'float shadeK = clamp(dot(shadeN, normalize(vec3(0.35, 0.75, 0.55))) * 0.5 + 0.5, 0.0, 1.0);',
          // Plain weave: threads run around (u) and down (v) the garment, crossing over and
          // under in a checker; each thread is rounded, darker at its edges.
          'float wu = vWeavePos.x + vWeavePos.z;',
          'float wv = vWeavePos.y;',
          'float over = mod(floor(wu) + floor(wv), 2.0);',
          'float across = over > 0.5 ? fract(wv) : fract(wu);',
          'float thread = sin(across * 3.14159);',
          'float weave = mix(weaveRange.x, weaveRange.y, thread);',
          'diffuseColor.rgb *= mix(lightRange.x, lightRange.y, shadeK) * weave;',
        ].join('\n'),
      );
  };
  m.customProgramCacheKey = () => 'neutral-item-weave';
  return m;
}
