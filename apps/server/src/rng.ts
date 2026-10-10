import { randomBytes, randomInt } from 'node:crypto';

export interface Rng {
  /** Integer in [0, n). */
  int(n: number): number;
}

export const secureRng: Rng = { int: (n) => randomInt(n) };

export function shuffle<T>(items: readonly T[], rng: Rng): T[] {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function pick<T>(items: readonly T[], rng: Rng): T {
  return items[rng.int(items.length)];
}

/** Random float in [0, 1). */
export function chance(rng: Rng): number {
  return rng.int(1_000_000) / 1_000_000;
}

export function makeId(bytes = 9): string {
  return randomBytes(bytes).toString('base64url');
}
