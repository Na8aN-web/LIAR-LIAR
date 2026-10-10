import { COLOR_IDS, type ColorId } from '@wtc/shared';
import { shuffle, type Rng } from '../rng';

/**
 * An inspect result: the target's real color plus `count` decoys (spec: 2), in random order.
 * Decoys come from other players' colors in this game, never the real color
 * or the inspector's own color. Drawn fresh on every inspect.
 */
export function inspectResult(
  gameColors: readonly ColorId[],
  real: ColorId,
  inspectorColor: ColorId,
  rng: Rng,
  count = 2,
): ColorId[] {
  const excluded = (c: ColorId) => c === real || c === inspectorColor;
  let pool = gameColors.filter((c) => !excluded(c));
  // Only in tiny games: top up from unused palette colors.
  if (pool.length < count) {
    pool = pool.concat(COLOR_IDS.filter((c) => !excluded(c) && !gameColors.includes(c)));
  }
  const decoys = shuffle(pool, rng).slice(0, count);
  return shuffle([real, ...decoys], rng);
}
