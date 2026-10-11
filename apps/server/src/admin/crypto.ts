import { createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

// Admin login: a password (scrypt hash) plus a 6-digit code from an authenticator app (TOTP,
// RFC 6238: Google Authenticator, 1Password, Authy, Microsoft Authenticator...).

// ---------------------------------------------------------------- password

const SCRYPT = { N: 1 << 15, r: 8, p: 1, keylen: 64, maxmem: 64 * 1024 * 1024 };

function scryptAsync(password: string, salt: Buffer, o: { N: number; r: number; p: number; keylen: number }) {
  return new Promise<Buffer>((resolve, reject) =>
    scrypt(password.normalize('NFKC'), salt, o.keylen, { N: o.N, r: o.r, p: o.p, maxmem: SCRYPT.maxmem }, (err, key) => (err ? reject(err) : resolve(key))),
  );
}

/** `scrypt$N$r$p$salt$hash` (base64url). Store this, never the password. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, SCRYPT);
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64url'), key.toString('base64url')].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [kind, N, r, p, salt, hash] = stored.split('$');
  if (kind !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64url');
  const key = await scryptAsync(password, Buffer.from(salt, 'base64url'), { N: Number(N), r: Number(r), p: Number(p), keylen: expected.length });
  return key.length === expected.length && timingSafeEqual(key, expected);
}

export const isPasswordHash = (v: unknown) => typeof v === 'string' && /^scrypt\$\d+\$\d+\$\d+\$[\w-]+\$[\w-]+$/.test(v);

// ---------------------------------------------------------------- TOTP

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const i = B32.indexOf(ch);
    if (i < 0) throw new Error('Bad base32');
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** A new 160-bit TOTP secret, base32 (what authenticator apps take). */
export const newTotpSecret = () => base32Encode(randomBytes(20));

const STEP_SECONDS = 30;
export const totpCounter = (nowMs: number) => Math.floor(nowMs / 1000 / STEP_SECONDS);

/** The 6-digit code for a time step. */
export function totpCode(secret: string, counter: number): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac('sha1', base32Decode(secret)).update(msg).digest();
  const offset = mac[mac.length - 1] & 15;
  const n = (mac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return String(n).padStart(6, '0');
}

/**
 * Checks a code against the current step and one either side (clock drift). Returns the step it
 * matched, or null. A step at or before `usedUpTo` is refused, so a code works only once.
 */
export function verifyTotp(secret: string, code: unknown, nowMs: number, usedUpTo = -1): number | null {
  if (typeof code !== 'string' || !/^\d{6}$/.test(code)) return null;
  const now = totpCounter(nowMs);
  for (const c of [now - 1, now, now + 1]) {
    if (c <= usedUpTo) continue;
    const expected = Buffer.from(totpCode(secret, c));
    if (timingSafeEqual(expected, Buffer.from(code))) return c;
  }
  return null;
}

/** What to put in an authenticator app's QR code. */
export function otpauthUrl(secret: string, account = 'admin', issuer = 'Wanted True Colors') {
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=${STEP_SECONDS}`;
}
