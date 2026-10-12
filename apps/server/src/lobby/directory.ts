import type { LobbyListing } from '@wtc/shared';

// The Find a Lobby list. Everything about the list goes through this one interface, so it can
// later move to a shared store (e.g. Redis, when there's more than one game server) without the
// rest of the server changing: servers would write their rooms' rows, and read the whole list.

export interface LobbyDirectory {
  /** Sets one room's row; null removes it (private, locked, playing, full or closed). */
  set(roomKey: string, listing: LobbyListing | null): void;
  /** Every listed room: fullest first (people, then bots), then newest. */
  list(): LobbyListing[];
  /** The room behind a list id (to join from the list), or null if it's no longer listed. */
  roomFor(listingId: string): string | null;
  /** Called (at most a few times a second) when the list changed. */
  onChange(cb: () => void): () => void;
}

/** One server, rooms in memory: the list lives here too. */
export class MemoryLobbyDirectory implements LobbyDirectory {
  private readonly rows = new Map<string, { listing: LobbyListing; since: number }>();
  private readonly listeners = new Set<() => void>();
  private timer: NodeJS.Timeout | null = null;
  private seq = 0;

  constructor(private readonly throttleMs = 400) {}

  set(roomKey: string, listing: LobbyListing | null) {
    const before = this.rows.get(roomKey);
    if (!listing) {
      if (!before) return;
      this.rows.delete(roomKey);
    } else {
      if (before && JSON.stringify(before.listing) === JSON.stringify(listing)) return;
      this.rows.set(roomKey, { listing, since: before?.since ?? ++this.seq });
    }
    this.changed();
  }

  list(): LobbyListing[] {
    return [...this.rows.values()]
      .sort((a, b) => b.listing.players - b.listing.bots - (a.listing.players - a.listing.bots) || b.listing.players - a.listing.players || b.since - a.since)
      .map((r) => r.listing);
  }

  roomFor(listingId: string): string | null {
    for (const [key, r] of this.rows) if (r.listing.id === listingId) return key;
    return null;
  }

  onChange(cb: () => void) {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  /** Coalesces bursts (a room filling up) into one update. */
  private changed() {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      for (const cb of this.listeners) cb();
    }, this.throttleMs);
  }

  dispose() {
    if (this.timer) clearTimeout(this.timer);
    this.listeners.clear();
  }
}
