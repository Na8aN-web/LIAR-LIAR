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

/**
 * A repeat search of the same player by the same searcher narrows things down by one: of the
 * colors still possible after their earlier searches (`possible`, which includes the real one),
 * one fewer survives this time, and the rest of the result is fresh decoys from outside that set.
 * So with 3 decoys: 4 possible after the first search, 3 after the second, 2 after the third,
 * then the real color alone. Still `count` decoys every time, never the searcher's own color.
 */
export function narrowedResult(
  gameColors: readonly ColorId[],
  real: ColorId,
  inspectorColor: ColorId,
  possible: readonly ColorId[],
  rng: Rng,
  count = 2,
): ColorId[] {
  const keep = Math.max(1, possible.length - 1);
  const survivors = shuffle(
    possible.filter((c) => c !== real && c !== inspectorColor),
    rng,
  ).slice(0, keep - 1);
  const outside = (c: ColorId) => c !== real && c !== inspectorColor && !possible.includes(c);
  let pool = gameColors.filter(outside);
  if (pool.length < count + 1 - keep) pool = pool.concat(COLOR_IDS.filter((c) => outside(c) && !gameColors.includes(c)));
  const fresh = shuffle(pool, rng).slice(0, count + 1 - keep);
  return shuffle([real, ...survivors, ...fresh], rng);
}
