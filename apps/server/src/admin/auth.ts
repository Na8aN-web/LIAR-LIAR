import { createHash, randomBytes } from 'node:crypto';
import { RateLimiter } from '../security';
import { verifyPassword, verifyTotp } from './crypto';

/** What the admin login needs (from apps/server/.env.local, written by `pnpm admin:setup`). */
export interface AdminCredentials {
  passwordHash: string;
  totpSecret: string;
}

export const ADMIN_LIMITS = {
  /** Failed logins per IP: 5, then one more every 3 minutes. */
  loginPerIp: { burst: 5, perSecond: 1 / 180 },
  /** Failed logins from everywhere together: a backstop against many IPs at once. */
  loginGlobal: { burst: 50, perSecond: 50 / 3600 },
  /** Admin API calls per session. */
  requests: { burst: 60, perSecond: 10 },
  /** A session ends after this long, or after this long without use. */
  sessionMs: 12 * 3600_000,
  idleMs: 60 * 60_000,
  maxSessions: 10,
};

interface Session {
  createdAt: number;
  seenAt: number;
}

const hash = (token: string) => createHash('sha256').update(token).digest('base64url');

/**
 * Password + authenticator code, rate limited. Sessions live in memory as hashes of random
 * tokens (a server restart signs everyone out). Each code works once.
 */
export class AdminAuth {
  private readonly sessions = new Map<string, Session>();
  private usedStep = -1;
  private readonly perIp: RateLimiter;
  private readonly global: RateLimiter;
  readonly requests: RateLimiter;

  constructor(
    private readonly creds: AdminCredentials,
    private readonly limits = ADMIN_LIMITS,
  ) {
    this.perIp = new RateLimiter(limits.loginPerIp.burst, limits.loginPerIp.perSecond);
    this.global = new RateLimiter(limits.loginGlobal.burst, limits.loginGlobal.perSecond);
    this.requests = new RateLimiter(limits.requests.burst, limits.requests.perSecond);
  }

  async login(ip: string, password: unknown, code: unknown, now = Date.now()): Promise<{ ok: true; token: string } | { ok: false; status: number; error: string }> {
    if (!this.perIp.peek(ip, now) || !this.global.peek('all', now)) return { ok: false, status: 429, error: 'Too many tries. Wait a few minutes.' };
    const pw = typeof password === 'string' && password.length <= 256 ? password : '';
    // Both checks always run, so the time taken doesn't say which one failed.
    const passwordOk = await verifyPassword(pw, this.creds.passwordHash).catch(() => false);
    const step = verifyTotp(this.creds.totpSecret, code, now, this.usedStep);
    if (!passwordOk || step === null) {
      this.perIp.take(ip, now);
      this.global.take('all', now);
      return { ok: false, status: 401, error: 'Wrong password or code.' };
    }
    this.usedStep = step;
    const token = randomBytes(32).toString('base64url');
    this.sessions.set(hash(token), { createdAt: now, seenAt: now });
    // Oldest sessions go first past the cap.
    while (this.sessions.size > this.limits.maxSessions) this.sessions.delete(this.sessions.keys().next().value!);
    return { ok: true, token };
  }

  /** Whether a session token is signed in (and still fresh). Using it keeps it alive. */
  check(token: string | undefined, now = Date.now()): boolean {
    if (!token || token.length > 100) return false;
    const key = hash(token);
    const s = this.sessions.get(key);
    if (!s) return false;
    if (now - s.createdAt > this.limits.sessionMs || now - s.seenAt > this.limits.idleMs) {
      this.sessions.delete(key);
      return false;
    }
    s.seenAt = now;
    return true;
  }

  logout(token: string | undefined) {
    if (token) this.sessions.delete(hash(token));
  }

  prune(now = Date.now()) {
    this.perIp.prune(now);
    this.global.prune(now);
    this.requests.prune(now);
  }
}
