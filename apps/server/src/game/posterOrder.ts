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

  // Same game length, picked at random so elimination doesn't work, but fair: nobody is Wanted
  // twice in a row, and nobody more than twice a game (pure chance made one player Wanted on
  // 3 of 6 posters in a playtest, which felt broken).
  randomRepeats: (ids, rng) => {
    const cap = 2; // one poster per player, so 2 always leaves enough of the pool
    const times = new Map<PlayerId, number>();
    const order: PlayerId[] = [];
    for (let i = 0; i < ids.length; i++) {
      const prev = order[order.length - 1];
      let pool = ids.filter((id) => id !== prev && (times.get(id) ?? 0) < cap);
      if (!pool.length) pool = ids.filter((id) => id !== prev);
      if (!pool.length) pool = ids.slice();
      const id = pool[rng.int(pool.length)];
      order.push(id);
      times.set(id, (times.get(id) ?? 0) + 1);
    }
    return order;
  },
};
