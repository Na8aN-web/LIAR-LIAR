import type { PlayerId, PosterMode } from '@wtc/shared';
import { shuffle, type Rng } from '../rng';

/**
 * Decides who is Wanted on each poster. Returns one player id per poster.
 * This is the single swap point for poster-order experiments.
 */
export type PosterOrderFn = (playerIds: readonly PlayerId[], rng: Rng) => PlayerId[];

export const posterOrders: Record<PosterMode, PosterOrderFn> = {
  // Spec default: everyone is Wanted exactly once. Late posters can be solved by elimination.
  everyoneOnce: (ids, rng) => shuffle(ids, rng),

  // Same game length, but each poster picks independently, so elimination doesn't work.
  randomRepeats: (ids, rng) => ids.map(() => ids[rng.int(ids.length)]),
};
