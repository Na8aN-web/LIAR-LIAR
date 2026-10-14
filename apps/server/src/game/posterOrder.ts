import type { PlayerId } from '@wtc/shared';
import type { Rng } from '../rng';

/**
 * Who is Wanted on each poster: picked at random each time, repeats allowed, so nobody can be
 * ruled out by elimination. Two fairness limits: never the same player twice in a row, and
 * nobody far more often than everyone else (at most one more poster than an even share, and
 * at least 2), because pure chance once made one player Wanted on 3 of 6 posters.
 */
export function randomOrder(ids: readonly PlayerId[], posters: number, rng: Rng): PlayerId[] {
  const cap = Math.max(2, Math.ceil(posters / Math.max(1, ids.length)) + 1);
  const times = new Map<PlayerId, number>();
  const order: PlayerId[] = [];
  for (let i = 0; i < posters; i++) {
    const prev = order[order.length - 1];
    let pool = ids.filter((id) => id !== prev && (times.get(id) ?? 0) < cap);
    if (!pool.length) pool = ids.filter((id) => id !== prev);
    if (!pool.length) pool = ids.slice();
    const id = pool[rng.int(pool.length)];
    order.push(id);
    times.set(id, (times.get(id) ?? 0) + 1);
  }
  return order;
}
