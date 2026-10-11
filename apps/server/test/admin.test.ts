import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { COLOR_IDS } from '@wtc/shared';
import { AccessVerifier } from '../src/admin/access';
import { hashPassword, newTotpSecret, totpCode, totpCounter } from '../src/admin/crypto';
import { anonId } from '../src/analytics/events';
import { FileStore } from '../src/store/file';
import { sleep, startServer, until } from './helpers/net';

// The admin API: login (password + authenticator code), rate limits, CSRF header, audit log,
// actions, and above all: no secrets about a game while it's running.

const PASSWORD = 'correct horse battery staple';
const SECRET = newTotpSecret();
let passwordHash = '';
const dirs: string[] = [];
let cleanup: (() => Promise<void>) | null = null;

beforeAll(async () => {
  passwordHash = await hashPassword(PASSWORD);
});
afterEach(async () => {
  await cleanup?.();
  cleanup = null;
});
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

const NO_LIMITS = { events: { burst: 1000, perSecond: 1000 }, colorProbe: { burst: 1000, perSecond: 1000 } };
/** A code for a step this server hasn't seen (each code works once; now-1..now+1 are accepted). */
let nextStep = 0;
const freshCode = () => totpCode(SECRET, Math.min(++nextStep, totpCounter(Date.now()) + 1));

async function setup(extra: Parameters<typeof startServer>[0] = {}) {
  nextStep = totpCounter(Date.now()) - 2;
  const dir = mkdtempSync(join(tmpdir(), 'wtc-admin-'));
  dirs.push(dir);
  const store = new FileStore(dir);
  await store.init();
  const t = await startServer({ store, admin: { credentials: { passwordHash, totpSecret: SECRET } }, limits: NO_LIMITS, ...extra });
  cleanup = t.close;
  const base = `http://localhost:${t.port}/admin/api`;
  let cookie = '';
  const api = async (path: string, init: { method?: string; body?: unknown; headers?: Record<string, string>; raw?: Buffer; type?: string } = {}) => {
    const res = await fetch(base + path, {
      method: init.method ?? (init.body !== undefined || init.raw ? 'POST' : 'GET'),
      headers: {
        'x-wtc-admin': '1',
        ...(cookie ? { cookie } : {}),
        ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(init.type ? { 'content-type': init.type } : {}),
        ...init.headers,
      },
      body: init.raw ?? (init.body !== undefined ? JSON.stringify(init.body) : undefined),
    });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];
    return { status: res.status, body: (await res.json().catch(() => null)) as any, headers: res.headers };
  };
  const login = () => api('/login', { body: { password: PASSWORD, code: freshCode() } });
  return { ...t, store, api, login, setCookie: (c: string) => (cookie = c) };
}

/** Host + 5 bots, game started (dev server: bots allowed). */
async function gameInProgress(x: Awaited<ReturnType<typeof setup>>) {
  const a = await x.connect('A');
  const created = await x.call(a, 'room:create', { name: 'Ada' });
  for (let i = 0; i < 5; i++) await x.call(a, 'lobby:addBot');
  expect((await x.call(a, 'game:start')).ok).toBe(true);
  await until(a, (v) => v.phase === 'poster');
  await x.call(a, 'dev:skipPhase');
  await until(a, (v) => v.phase === 'investigation');
  const target = a.latest!.players.find((p) => p.id !== a.latest!.you.id)!;
  expect((await x.call(a, 'game:inspect', { targetId: target.id })).ok).toBe(true);
  return { a, code: created.code as string };
}

/** Keys and values that would mean a secret leaked. */
const SECRET_KEYS = new Set(['color', 'colors', 'wantedId', 'votes', 'myVote', 'result', 'results', 'myResults', 'colorHistory', 'replay', 'log', 'token', 'browserId', 'finished']);
function leaks(value: unknown, path = '$'): string[] {
  const out: string[] = [];
  if (typeof value === 'string' && (COLOR_IDS as readonly string[]).includes(value)) out.push(`${path} = color "${value}"`);
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (SECRET_KEYS.has(k) && v !== null && !(Array.isArray(v) && !v.length)) out.push(`${path}.${k}`);
      out.push(...leaks(v, `${path}.${k}`));
    }
  }
  return out;
}

describe('admin API: no secrets while a game runs', () => {
  it('Live and room pages show only public information until the game ends, then the replay', async () => {
    const x = await setup();
    expect((await x.login()).status).toBe(200);
    const { a, code } = await gameInProgress(x);

    const live = await x.api('/live');
    expect(live.status).toBe(200);
    expect(live.body.rooms.list[0].code).toBe(code);
    expect(live.body.rooms.list[0].phase).toBe('investigation');
    expect(live.body.rooms.list[0].players).toHaveLength(6);
    expect(leaks(live.body)).toEqual([]);

    const room = await x.api(`/rooms/${code}`);
    expect(room.status).toBe(200);
    expect(room.body.room.host).toBe('Ada');
    expect(room.body.finished).toBeNull();
    expect(leaks(room.body)).toEqual([]);

    // Every phase of the game: still nothing.
    for (let guard = 0; guard < 60 && a.latest!.phase !== 'ended'; guard++) {
      if (a.latest!.phase === 'vote') await x.call(a, 'game:vote', { targetId: a.latest!.players.find((p) => p.id !== a.latest!.you.id)!.id });
      const mid = await x.api(`/rooms/${code}`);
      expect(leaks(mid.body), `phase ${a.latest!.phase}`).toEqual([]);
      expect(leaks((await x.api('/live')).body)).toEqual([]);
      await x.call(a, 'dev:skipPhase');
      await sleep(20);
    }
    await until(a, (v) => v.phase === 'ended');

    // Over: the secrets are there for the admins, and viewing them is logged.
    const after = await x.api(`/rooms/${code}`);
    // The leak check itself works: it flags the replay now that it's allowed.
    expect(leaks(after.body).length).toBeGreaterThan(0);
    expect(after.body.finished.replay.colors).toBeTruthy();
    expect(Object.keys(after.body.finished.replay.colors)).toHaveLength(6);
    expect(after.body.finished.replay.posters[0].wantedId).toBeTruthy();
    expect(after.body.finished.names[a.latest!.you.id]).toBe('Ada');
    await sleep(50);
    expect((await x.store.audit()).some((e) => e.action === 'view_game_secrets')).toBe(true);
  });
});

describe('admin API: login', () => {
  it('needs the password and a fresh authenticator code, and rate-limits failures', async () => {
    const x = await setup();
    expect((await x.api('/session')).body).toEqual({ configured: true, signedIn: false, access: false });
    expect((await x.api('/live')).status).toBe(401);
    expect((await x.api('/login', { body: { password: PASSWORD, code: '000000' } })).status).toBe(401);
    expect((await x.api('/login', { body: { password: 'wrong password!!', code: freshCode() } })).status).toBe(401);
    // A code works once.
    const code = freshCode();
    expect((await x.api('/login', { body: { password: PASSWORD, code } })).status).toBe(200);
    expect((await x.api('/session')).body.signedIn).toBe(true);
    x.setCookie('');
    expect((await x.api('/login', { body: { password: PASSWORD, code } })).status).toBe(401);
    // Five failures from one IP, then even the right answer waits.
    for (let i = 0; i < 3; i++) await x.api('/login', { body: { password: 'nope nope nope', code: '123456' } });
    const blocked = await x.api('/login', { body: { password: PASSWORD, code: freshCode() } });
    expect(blocked.status).toBe(429);
    await sleep(50);
    const audit = await x.store.audit();
    expect(audit.filter((e) => e.action === 'login' && !e.ok).length).toBeGreaterThanOrEqual(5);
    expect(JSON.stringify(audit)).not.toContain(PASSWORD);
  });

  it('sets a locked-down cookie, refuses requests without the admin header, and logs out', async () => {
    const x = await setup();
    const res = await x.login();
    const cookie = res.headers.get('set-cookie')!;
    expect(cookie).toMatch(/^__Host-wtc_admin=/);
    for (const flag of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/']) expect(cookie).toContain(flag);
    // A form or image on another site can't add the header: refused even with the cookie.
    expect((await x.api('/live', { headers: { 'x-wtc-admin': '0' } })).status).toBe(403);
    expect((await x.api('/logout', { method: 'POST', body: {} })).status).toBe(200);
    expect((await x.api('/live')).status).toBe(401);
  });

  it('is locked when no login is set up', async () => {
    const x = await setup({ admin: {} });
    expect((await x.api('/session')).body.configured).toBe(false);
    expect((await x.api('/login', { body: { password: PASSWORD, code: freshCode() } })).status).toBe(503);
  });
});

describe('admin API: actions', () => {
  it('closes rooms, bans by anonymous id, broadcasts, maintenance, default settings: all audited', async () => {
    const x = await setup();
    await x.login();
    const { a, code } = await gameInProgress(x);
    const closed = new Promise((r) => a.once('roomClosed', r));
    expect((await x.api(`/rooms/${code}/close`, { body: { reason: 'Testing' } })).status).toBe(200);
    expect(await closed).toEqual({ reason: 'Testing' });
    expect(x.server.rooms.has(code)).toBe(false);

    // Broadcast reaches everyone connected.
    const b = await x.connect('B');
    const heard = new Promise((r) => b.once('announcement', r));
    expect((await x.api('/broadcast', { body: { text: 'Server restarts in 5 minutes' } })).status).toBe(200);
    expect(((await heard) as { text: string }).text).toBe('Server restarts in 5 minutes');

    // Maintenance: new rooms refused, everyone told.
    const status = new Promise((r) => b.once('status', r));
    await x.api('/maintenance', { body: { on: true } });
    expect(((await status) as { maintenance: { on: boolean } }).maintenance.on).toBe(true);
    expect((await x.call(b, 'room:create', { name: 'Bo' })).ok).toBe(false);
    await x.api('/maintenance', { body: { on: false } });
    expect((await x.call(b, 'room:create', { name: 'Bo' })).ok).toBe(true);

    // Default settings: validated like a host's, used by new rooms.
    expect((await x.api('/defaults', { body: { settings: { timers: { vote: 999 } } } })).status).toBe(400);
    expect((await x.api('/defaults', { body: { settings: { timers: { vote: 30 } } } })).status).toBe(200);
    const c = await x.connect('C');
    await x.call(c, 'room:create', { name: 'Cy' });
    await until(c, (v) => v.settings.timers.vote === 30);

    // Ban by anonymous id: dropped now, refused next time.
    const anon = anonId(c.browserId)!;
    const gone = new Promise<void>((r) => c.once('banned', () => r()));
    expect((await x.api('/bans', { body: { anon, reason: 'spam' } })).body.disconnected).toBe(1);
    await gone;
    await expect(x.connect('C again', { browserId: c.browserId })).rejects.toThrow(/banned/);
    expect((await x.api('/bans', { body: { anon: 'not an id', reason: '' } })).status).toBe(400);
    await x.api('/bans/remove', { body: { anon } });
    await expect(x.connect('C back', { browserId: c.browserId })).resolves.toBeTruthy();

    await sleep(50);
    const actions = (await x.store.audit()).map((e) => e.action);
    for (const act of ['close_room', 'broadcast', 'maintenance', 'default_settings', 'ban', 'unban']) expect(actions).toContain(act);
  });

  it('swaps billboard images (real images only, not the house slot) and serves them', async () => {
    const x = await setup();
    await x.login();
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
    const b = await x.connect('B');
    const status = new Promise((r) => b.once('status', r));
    const up = await x.api('/billboards/roof-hotel', { raw: png, type: 'image/png' });
    expect(up.status).toBe(200);
    expect(((await status) as { billboards: Record<string, string> }).billboards['roof-hotel']).toBe(up.body.version);
    const img = await fetch(`http://localhost:${x.port}/billboards/roof-hotel?v=${up.body.version}`);
    expect(img.headers.get('content-type')).toBe('image/png');
    expect(Buffer.from(await img.arrayBuffer()).equals(png)).toBe(true);

    expect((await x.api('/billboards/roof-hotel', { raw: Buffer.from('<svg onload=alert(1)>'), type: 'image/svg+xml' })).status).toBe(415);
    expect((await x.api('/billboards/house-3042', { raw: png, type: 'image/png' })).status).toBe(400);
    expect((await x.api('/billboards/roof-hotel', { raw: Buffer.alloc(3 * 1024 * 1024), type: 'image/png' })).status).toBe(413);
    await x.api('/billboards/roof-hotel/reset', { body: {} });
    expect((await fetch(`http://localhost:${x.port}/billboards/roof-hotel`)).status).toBe(404);
  });
});

describe('Cloudflare Access', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256' };
  const team = 'https://wanted.cloudflareaccess.com';
  const aud = 'aud-tag-123';
  const token = (claims: Record<string, unknown>, kid = 'k1') => {
    const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const head = `${enc({ alg: 'RS256', kid })}.${enc(claims)}`;
    return `${head}.${sign('RSA-SHA256', Buffer.from(head), privateKey).toString('base64url')}`;
  };
  const verifier = () => new AccessVerifier({ teamDomain: team, aud }, async () => ({ keys: [jwk] }));
  const now = Math.floor(Date.now() / 1000);

  it('accepts only tokens signed by the team, for this application, not expired', async () => {
    const v = verifier();
    expect(await v.verify(token({ iss: team, aud: [aud], exp: now + 60, email: 'me@example.com' }))).toEqual({ email: 'me@example.com' });
    expect(await v.verify(token({ iss: team, aud: ['other'], exp: now + 60 }))).toBeNull();
    expect(await v.verify(token({ iss: 'https://evil.cloudflareaccess.com', aud: [aud], exp: now + 60 }))).toBeNull();
    expect(await v.verify(token({ iss: team, aud: [aud], exp: now - 3600 }))).toBeNull();
    expect(await v.verify(token({ iss: team, aud: [aud], exp: now + 60 }, 'unknown'))).toBeNull();
    const forged = token({ iss: team, aud: [aud], exp: now + 60 }).split('.');
    forged[1] = Buffer.from(JSON.stringify({ iss: team, aud: [aud], exp: now + 99999, email: 'x' })).toString('base64url');
    expect(await v.verify(forged.join('.'))).toBeNull();
  });

  it('when configured, the admin API refuses requests without a valid token', async () => {
    const x = await setup({ admin: { credentials: { passwordHash, totpSecret: SECRET }, accessVerifier: verifier() } });
    expect((await x.api('/session')).status).toBe(403);
    const good = token({ iss: team, aud: [aud], exp: now + 60 });
    expect((await x.api('/session', { headers: { 'cf-access-jwt-assertion': good } })).body.access).toBe(true);
  });
});
