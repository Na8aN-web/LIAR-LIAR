import type { IncomingMessage } from 'node:http';
import { timingSafeEqual } from 'node:crypto';

// Abuse limits and connection checks. Everything here is about the edges: who may connect,
// how often they may act. Game rules are enforced in room.ts and game/engine.ts.

/**
 * Token-bucket rate limiter: each key gets `burst` tokens that refill at `perSecond`.
 * Cheap enough to check on every event; idle buckets are dropped by `prune()`.
 */
export class RateLimiter {
  private buckets = new Map<string, { tokens: number; at: number }>();
  constructor(
    readonly burst: number,
    readonly perSecond: number,
  ) {}

  /** Spends one token for `key`. False = over the limit (nothing is spent). */
  take(key: string, now = Date.now()): boolean {
    const b = this.buckets.get(key) ?? { tokens: this.burst, at: now };
    b.tokens = Math.min(this.burst, b.tokens + ((now - b.at) / 1000) * this.perSecond);
    b.at = now;
    this.buckets.set(key, b);
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  }

  /** Whether `key` has a token left, without spending it. */
  peek(key: string, now = Date.now()): boolean {
    const b = this.buckets.get(key);
    return !b || Math.min(this.burst, b.tokens + ((now - b.at) / 1000) * this.perSecond) >= 1;
  }

  /** Drops buckets that have refilled completely (nothing to remember). */
  prune(now = Date.now()) {
    for (const [k, b] of this.buckets) if (b.tokens + ((now - b.at) / 1000) * this.perSecond >= this.burst) this.buckets.delete(k);
  }

  get size() {
    return this.buckets.size;
  }
}

/** All limits in one place. Generous for real play, tight for scripts. */
export const LIMITS = {
  /** Any event on one connection. */
  events: { burst: 40, perSecond: 10 },
  /** Chat lines per connection (the room also enforces a short gap between lines per seat). */
  chat: { burst: 6, perSecond: 0.5 },
  /** New rooms (and practice games) per IP. */
  roomCreate: { burst: 5, perSecond: 1 / 60 },
  /**
   * Failed join and resume attempts (wrong code or token) per IP and per connection: room codes
   * and tokens can't be brute-forced. Successful ones are free, so a whole table on one Wi-Fi
   * can always reconnect.
   */
  joinPerIp: { burst: 20, perSecond: 1 / 15 },
  joinPerSocket: { burst: 8, perSecond: 1 / 15 },
  /** Buy offers per connection. */
  offers: { burst: 6, perSecond: 1 / 10 },
  /** Lobby color list and color picks: polling these is how lobby colors could be probed. */
  colorProbe: { burst: 6, perSecond: 1 / 3 },
  /** New connections per IP (a whole table on one Wi-Fi must still fit). */
  connectPerIp: { burst: 50, perSecond: 1 },
  /** Open connections per IP at once. */
  maxSocketsPerIp: 40,
  /** Rooms alive at once on this server. */
  maxRooms: 2000,
  /** Largest message a client may send, bytes. */
  maxPayloadBytes: 8 * 1024,
};

/**
 * The connecting client's IP. Behind a proxy or tunnel every socket comes from the proxy, so
 * with `trustProxy` the first X-Forwarded-For (or Cloudflare's header) is used instead. Only
 * enable trustProxy when a proxy you control sits in front: otherwise clients can fake it.
 */
export function clientIp(req: IncomingMessage, trustProxy: boolean): string {
  if (trustProxy) {
    const cf = req.headers['cf-connecting-ip'];
    if (typeof cf === 'string' && cf) return cf.trim();
    const xff = req.headers['x-forwarded-for'];
    const first = (Array.isArray(xff) ? xff[0] : xff)?.split(',')[0]?.trim();
    if (first) return first;
  }
  return req.socket.remoteAddress ?? 'unknown';
}

export interface OriginPolicy {
  /**
   * Origins allowed (e.g. https://wanted.example.com, or https://*.example.com for subdomains).
   * Empty = same host only. Localhost is always allowed (it can only be the player's own machine).
   */
  allowed: string[];
  /** Require https origins (production), except localhost. */
  requireHttps: boolean;
  trustProxy: boolean;
}

const isLocal = (host: string) => /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(host);

/**
 * Whether a connection may open, judged by its Origin header. Browsers always send it on
 * WebSocket and CORS requests, and pages can't fake it, so this stops other websites from
 * driving players' browsers against the server. (A script outside a browser can send any
 * Origin, which is why every action is also validated and rate limited.)
 */
export function originAllowed(req: IncomingMessage, policy: OriginPolicy): boolean {
  const origin = req.headers.origin;
  if (!origin) return false;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (policy.requireHttps && url.protocol !== 'https:' && !isLocal(url.host)) return false;
  if (isLocal(url.host)) return true;
  if (policy.allowed.length) {
    return policy.allowed.some((a) => {
      const wild = a.match(/^(https?):\/\/\*\.(.+)$/);
      return wild ? url.protocol === `${wild[1]}:` && url.hostname.endsWith(`.${wild[2]}`) : a === url.origin;
    });
  }
  const fwd = policy.trustProxy ? req.headers['x-forwarded-host'] : undefined;
  const host = (Array.isArray(fwd) ? fwd[0] : fwd)?.split(',')[0]?.trim() || req.headers.host;
  return !!host && url.host.toLowerCase() === host.toLowerCase();
}

/** Constant-time comparison for session tokens. */
export function sameToken(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** A browser id from the handshake: random, URL-safe, 16-64 chars. Anything else is ignored. */
export function browserIdOf(auth: unknown): string | null {
  const id = (auth as { browserId?: unknown } | null)?.browserId;
  return typeof id === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(id) ? id : null;
}
