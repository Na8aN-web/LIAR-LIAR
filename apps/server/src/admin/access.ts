import { createPublicKey, verify, type KeyObject } from 'node:crypto';

/**
 * Cloudflare Access (optional, recommended at launch): Cloudflare checks who you are before
 * /admin is even reachable, then sends a signed token (JWT) with every request. With
 * CF_ACCESS_TEAM_DOMAIN and CF_ACCESS_AUD set, the admin API refuses any request without a valid
 * token, so someone who reaches the server some other way still can't get in.
 * See SECURITY.md, "Admin dashboard".
 */
export interface AccessConfig {
  /** e.g. https://yourteam.cloudflareaccess.com */
  teamDomain: string;
  /** The Access application's "Application Audience (AUD) Tag". */
  aud: string;
}

type Jwk = { kty?: string; kid?: string; n?: string; e?: string; alg?: string };
type Jwks = { keys: Jwk[] };
export type FetchJwks = (url: string) => Promise<Jwks>;

const b64json = (part: string) => JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));

export class AccessVerifier {
  private keys = new Map<string, KeyObject>();
  private fetchedAt = 0;
  private readonly teamDomain: string;

  constructor(
    private readonly cfg: AccessConfig,
    private readonly fetchJwks: FetchJwks = async (url) => (await fetch(url, { signal: AbortSignal.timeout(5000) })).json() as Promise<Jwks>,
  ) {
    this.teamDomain = cfg.teamDomain.replace(/\/+$/, '');
    if (!/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/i.test(this.teamDomain)) throw new Error('CF_ACCESS_TEAM_DOMAIN must look like https://yourteam.cloudflareaccess.com');
  }

  /** Cloudflare's signing keys, cached for 10 minutes (refetched early for an unknown key id). */
  private async key(kid: string): Promise<KeyObject | null> {
    const stale = Date.now() - this.fetchedAt > 10 * 60_000;
    if (stale || !this.keys.has(kid)) {
      // Unknown key ids can trigger at most one refetch a minute.
      if (stale || Date.now() - this.fetchedAt > 60_000) {
        try {
          const jwks = await this.fetchJwks(`${this.teamDomain}/cdn-cgi/access/certs`);
          this.keys = new Map(jwks.keys.filter((k) => k.kid && k.kty === 'RSA').map((k) => [k.kid!, createPublicKey({ key: k as Record<string, string>, format: 'jwk' })]));
          this.fetchedAt = Date.now();
        } catch {
          // Keep the old keys if Cloudflare can't be reached.
        }
      }
    }
    return this.keys.get(kid) ?? null;
  }

  /** The signed-in email when the token is valid; null otherwise. */
  async verify(token: unknown, nowMs = Date.now()): Promise<{ email: string } | null> {
    if (typeof token !== 'string' || token.length > 8192) return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    try {
      const header = b64json(parts[0]);
      if (header.alg !== 'RS256' || typeof header.kid !== 'string') return null;
      const key = await this.key(header.kid);
      if (!key) return null;
      const ok = verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), key, Buffer.from(parts[2], 'base64url'));
      if (!ok) return null;
      const claims = b64json(parts[1]);
      const now = nowMs / 1000;
      const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
      if (claims.iss !== this.teamDomain || !aud.includes(this.cfg.aud)) return null;
      if (typeof claims.exp !== 'number' || claims.exp < now - 30) return null;
      if (typeof claims.nbf === 'number' && claims.nbf > now + 30) return null;
      return { email: typeof claims.email === 'string' ? claims.email : '' };
    } catch {
      return null;
    }
  }
}
