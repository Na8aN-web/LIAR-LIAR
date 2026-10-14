import type { InspectLogEntry, PlayerId } from './types';

/**
 * Who has been searched this poster: the plain eye over their scarecrow and on their card.
 * Deliberately a yes/no, never a count: counts made everyone pile onto the most-searched player.
 */
export function searchedThisPoster(log: readonly Pick<InspectLogEntry, 'poster' | 'targetId'>[], posterIndex: number): Set<PlayerId> {
  return new Set(log.filter((e) => e.poster === posterIndex).map((e) => e.targetId));
}
