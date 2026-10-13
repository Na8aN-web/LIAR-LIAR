import { createHash } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { ANNOUNCEMENT_MAX, DEFAULT_SETTINGS, HOUSE_SLOT, isBillboardSlot, type Announcement } from '@wtc/shared';
import { countryOf, isAnonId, type AnalyticsEvent } from '../analytics/events';
import { applySettings, cleanText, type FinishedGame, type Room } from '../room';
import { clientIp } from '../security';
import type { Store } from '../store/types';
import type { AccessVerifier } from './access';
import type { AdminAuth } from './auth';
import type { Control } from './control';
import * as metrics from './metrics';
import type { Monitor } from './monitor';

// The admin API: /admin/api/*, on the game server (the web app forwards /admin/api to it, so
// the dashboard, the API and Cloudflare Access all live under /admin).
//
// Every request must carry the `x-wtc-admin: 1` header (a page on another site can't add it, so
// this blocks cross-site request forgery along with the SameSite=Strict cookie), and pass
// Cloudflare Access when that is configured. Everything except /session and /login needs a
// signed-in session. Every action and login attempt goes to the audit log.

export interface AdminContext {
  store: Store | null;
  control: Control;
  monitor: Monitor;
  /** Null when no admin login is set up (`pnpm admin:setup`): the API then refuses everything. */
  auth: AdminAuth | null;
  access: AccessVerifier | null;
  trustProxy: boolean;
  rooms: Map<string, Room>;
  finished: () => FinishedGame[];
  online: () => { sockets: number; players: number };
  closeRoom: (code: string, reason: string) => boolean;
  announce: (text: string) => Announcement;
  pushStatus: () => void;
  /** Disconnects everyone connected from that anonymous browser id. Returns how many. */
  dropBanned: (anon: string) => number;
}

export const COOKIE = '__Host-wtc_admin';
const JSON_MAX = 16 * 1024;
export const IMAGE_MAX = 2 * 1024 * 1024;
const DAY = 86_400_000;

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'x-robots-tag': 'noindex, nofollow',
    'cross-origin-resource-policy': 'same-origin',
  });
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage, max: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length'] ?? 0);
    if (declared > max) return reject(new HttpError(413, 'Too large'));
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > max) {
        reject(new HttpError(413, 'Too large'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) throw new HttpError(415, 'Send JSON');
  try {
    const v = JSON.parse((await readBody(req, JSON_MAX)).toString('utf8') || '{}');
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error();
    return v;
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(400, 'Bad JSON');
  }
}

const cookieOf = (req: IncomingMessage, name: string) => {
  for (const part of String(req.headers.cookie ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return undefined;
};

/** PNG, JPEG or WebP, by their first bytes (the file name and declared type aren't trusted). */
export function imageType(b: Buffer): string | null {
  if (b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length > 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

/** ?from=YYYY-MM-DD&to=YYYY-MM-DD (inclusive), default the last 30 days; at most a year. */
function windowOf(q: URLSearchParams): metrics.Window {
  const now = Date.now();
  const parse = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? Date.parse(`${v}T00:00:00Z`) : NaN);
  let to = parse(q.get('to'));
  to = Number.isNaN(to) ? Date.parse(`${metrics.dayOf(now)}T00:00:00Z`) + DAY : to + DAY;
  let from = parse(q.get('from'));
  if (Number.isNaN(from) || from >= to) from = to - 30 * DAY;
  if (to - from > 366 * DAY) from = to - 366 * DAY;
  return { from: new Date(from), to: new Date(to), now };
}

const num = (v: string | null) => (v !== null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : undefined);

export function adminHandler(ctx: AdminContext) {
  const audit = (req: IncomingMessage, action: string, ok: boolean, detail?: Record<string, unknown>) =>
    ctx.store
      ?.addAudit({ at: new Date().toISOString(), action, ok, detail, ip: clientIp(req, ctx.trustProxy), country: countryOf(req.headers, ctx.trustProxy) })
      .catch((e) => console.error('audit write failed', e instanceof Error ? e.message : 'unknown'));

  /** Stored records, without seed (bot) data unless asked for. */
  const data = async (q: URLSearchParams, w: metrics.Window, opts: { allEvents?: boolean } = {}) => {
    if (!ctx.store) throw new HttpError(503, 'No data store');
    const seed = q.get('seed') !== '0';
    const keep = <T extends { seed?: boolean }>(xs: T[]) => (seed ? xs : xs.filter((x) => !x.seed));
    const events = keep(await ctx.store.events(opts.allEvents ? { to: w.to } : { from: w.from, to: w.to }));
    return {
      events,
      games: keep(await ctx.store.games({ from: w.from, to: w.to })),
      feedback: keep(await ctx.store.feedback({ from: w.from, to: w.to })),
    };
  };

  const routes: Record<string, (req: IncomingMessage, q: URLSearchParams, m: RegExpMatchArray) => Promise<unknown>> = {
    // ---------------------------------------------------------------- reads
    'GET /live': async () => {
      const rooms = [...ctx.rooms.values()].map((r) => r.snapshot());
      const humans = (r: (typeof rooms)[number]) => r.players.filter((p) => !p.bot);
      return {
        now: Date.now(),
        online: ctx.online(),
        rooms: {
          total: rooms.length,
          open: rooms.filter((r) => !r.locked && !r.practice).length,
          public: rooms.filter((r) => r.visibility === 'public' && !r.practice).length,
          private: rooms.filter((r) => r.visibility === 'private' && !r.practice).length,
          locked: rooms.filter((r) => r.locked).length,
          practice: rooms.filter((r) => r.practice).length,
          inGame: rooms.filter((r) => r.phase !== 'lobby' && r.phase !== 'ended').length,
          list: rooms.sort((a, b) => humans(b).length - humans(a).length),
        },
        server: ctx.monitor.system(),
        // Leak watch: rooms, players and memory once a minute (last 3 hours), and why rooms closed.
        history: ctx.monitor.history,
        closed: ctx.monitor.closed,
        errors: ctx.monitor.errors.slice(0, 30),
        finished: ctx.finished().map((f) => ({ gameId: f.gameId, code: f.code, endedAt: f.endedAt, players: Object.keys(f.names).length })),
        maintenance: ctx.control.maintenance,
      };
    },
    'GET /rooms/([A-Z0-9]{3,8})': async (req, _q, m) => {
      const room = ctx.rooms.get(m[1]);
      if (!room) throw new HttpError(404, 'No such room');
      // Secrets only once the game is over.
      const finished = room.finishedGame();
      if (finished) audit(req, 'view_game_secrets', true, { room: room.code, gameId: finished.gameId });
      return { room: room.snapshot(), finished };
    },
    'GET /finished/([A-Za-z0-9_-]{4,20})': async (req, _q, m) => {
      const f = ctx.finished().find((x) => x.gameId === m[1]);
      if (!f) throw new HttpError(404, 'Not kept any more (finished games stay viewable for a while after they end)');
      audit(req, 'view_game_secrets', true, { gameId: f.gameId });
      return f;
    },
    'GET /growth': async (_req, q) => {
      const w = windowOf(q);
      const d = await data(q, w, { allEvents: true });
      return { ...metrics.growth(d.events, d.games, w), lobby: metrics.lobby(d.events, w) };
    },
    'GET /sources': async (_req, q) => {
      const w = windowOf(q);
      return metrics.sources((await data(q, w, { allEvents: true })).events, w);
    },
    'GET /funnel': async (_req, q) => {
      const w = windowOf(q);
      return metrics.funnel((await data(q, w)).events, w);
    },
    'GET /balance': async (_req, q) => {
      const w = windowOf(q);
      const d = await data(q, w);
      return metrics.balance(d.games, d.events, w, {
        posterMode: q.get('posterMode') || undefined,
        minPlayers: num(q.get('minPlayers')),
        maxPlayers: num(q.get('maxPlayers')),
        decoys: num(q.get('decoys')),
        inspects: num(q.get('inspects')),
        swaps: num(q.get('swaps')),
        botOnly: q.get('botOnly') === '1',
        who: q.get('who') === 'humans' ? 'humans' : q.get('who') === 'withBots' ? 'withBots' : undefined,
      });
    },
    'GET /feedback': async (_req, q) => {
      const w = windowOf(q);
      return metrics.feedback((await data(q, w)).feedback, w);
    },
    'GET /safety': async (_req, q) => {
      const w = windowOf(q);
      return metrics.safety((await data(q, w)).events, (await ctx.store?.bans()) ?? [], w);
    },
    'GET /billboards': async (_req, q) => {
      const w = windowOf(q);
      return { slots: metrics.billboards((await data(q, w)).events, w), versions: ctx.control.billboards };
    },
    'GET /audit': async (_req, q) => ({ entries: (await ctx.store?.audit({ limit: Math.min(500, num(q.get('limit')) ?? 200) })) ?? [] }),
    'GET /controls': async () => {
      const seedCount = ctx.store ? (await ctx.store.events()).filter((e) => e.seed).length + (await ctx.store.games()).filter((g) => g.seed).length : 0;
      return {
        maintenance: ctx.control.maintenance,
        defaults: ctx.control.defaults,
        builtInDefaults: DEFAULT_SETTINGS,
        billboards: ctx.control.billboards,
        store: ctx.store?.kind ?? null,
        seedRecords: seedCount,
      };
    },

    // ---------------------------------------------------------------- actions (all audited)
    'POST /rooms/([A-Z0-9]{3,8})/close': async (req, _q, m) => {
      const body = await readJson(req);
      const reason = cleanText(body.reason, 120) || 'The admins closed this room.';
      const ok = ctx.closeRoom(m[1], reason);
      audit(req, 'close_room', ok, { room: m[1], reason });
      if (!ok) throw new HttpError(404, 'No such room');
      return { ok: true };
    },
    'POST /bans': async (req) => {
      const body = await readJson(req);
      if (!isAnonId(body.anon)) throw new HttpError(400, 'That is not an anonymous player id');
      const reason = cleanText(body.reason, 200);
      await ctx.control.ban(body.anon, reason);
      const dropped = ctx.dropBanned(body.anon);
      void ctx.store?.addEvent({ at: new Date().toISOString(), type: 'safety', kind: 'ban', by: 'admin', anon: null, target: body.anon, reason } as AnalyticsEvent);
      audit(req, 'ban', true, { anon: body.anon, reason, disconnected: dropped });
      return { ok: true, disconnected: dropped };
    },
    'POST /bans/remove': async (req) => {
      const body = await readJson(req);
      if (!isAnonId(body.anon)) throw new HttpError(400, 'That is not an anonymous player id');
      await ctx.control.unban(body.anon);
      void ctx.store?.addEvent({ at: new Date().toISOString(), type: 'safety', kind: 'unban', by: 'admin', anon: null, target: body.anon } as AnalyticsEvent);
      audit(req, 'unban', true, { anon: body.anon });
      return { ok: true };
    },
    'POST /broadcast': async (req) => {
      const text = cleanText((await readJson(req)).text, ANNOUNCEMENT_MAX);
      if (!text) throw new HttpError(400, 'Write a message');
      const a = ctx.announce(text);
      audit(req, 'broadcast', true, { text, reached: ctx.online().sockets });
      return { ok: true, announcement: a };
    },
    'POST /maintenance': async (req) => {
      const body = await readJson(req);
      if (typeof body.on !== 'boolean') throw new HttpError(400, 'on must be true or false');
      await ctx.control.setMaintenance(body.on, cleanText(body.message, ANNOUNCEMENT_MAX));
      ctx.pushStatus();
      audit(req, 'maintenance', true, { on: body.on, message: ctx.control.maintenance.message });
      return { ok: true, maintenance: ctx.control.maintenance };
    },
    'POST /defaults': async (req) => {
      const body = await readJson(req);
      if (body.reset === true) {
        await ctx.control.setDefaults(DEFAULT_SETTINGS);
        audit(req, 'default_settings', true, { reset: true });
        return { ok: true, defaults: ctx.control.defaults };
      }
      const res = applySettings(ctx.control.defaults, body.settings);
      if (!res.ok) {
        audit(req, 'default_settings', false, { error: res.error });
        throw new HttpError(400, res.error);
      }
      await ctx.control.setDefaults(res.settings);
      audit(req, 'default_settings', true, { settings: res.settings });
      return { ok: true, defaults: res.settings };
    },
    'POST /billboards/([a-z0-9-]{1,40})': async (req, _q, m) => {
      const slot = m[1];
      if (!isBillboardSlot(slot) || slot === HOUSE_SLOT) throw new HttpError(400, 'Unknown or reserved slot');
      const bytes = await readBody(req, IMAGE_MAX);
      const type = imageType(bytes);
      if (!type) {
        audit(req, 'billboard_upload', false, { slot, reason: 'not an image' });
        throw new HttpError(415, 'Upload a PNG, JPEG or WebP image');
      }
      const version = createHash('sha256').update(bytes).digest('base64url').slice(0, 12);
      await ctx.store?.putBillboard({ slot, version, contentType: type, bytes });
      await ctx.control.setBillboard(slot, version);
      ctx.pushStatus();
      audit(req, 'billboard_upload', true, { slot, version, bytes: bytes.length, type });
      return { ok: true, version };
    },
    'POST /billboards/([a-z0-9-]{1,40})/reset': async (req, _q, m) => {
      const slot = m[1];
      if (!isBillboardSlot(slot) || slot === HOUSE_SLOT) throw new HttpError(400, 'Unknown or reserved slot');
      await ctx.store?.removeBillboard(slot);
      await ctx.control.setBillboard(slot, null);
      ctx.pushStatus();
      audit(req, 'billboard_reset', true, { slot });
      return { ok: true };
    },
  };
  const compiled = Object.entries(routes).map(([key, fn]) => {
    const [method, path] = key.split(' ');
    return { method, re: new RegExp(`^${path}$`), fn };
  });

  return async function handle(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? '/', 'http://x');
    const path = url.pathname.replace(/^\/admin\/api/, '') || '/';
    const ip = clientIp(req, ctx.trustProxy);
    try {
      if (req.headers['x-wtc-admin'] !== '1') throw new HttpError(403, 'Forbidden');
      if (req.method !== 'GET' && req.method !== 'POST') throw new HttpError(405, 'Method not allowed');
      if (ctx.access && !(await ctx.access.verify(req.headers['cf-access-jwt-assertion']))) throw new HttpError(403, 'Cloudflare Access is required');

      if (path === '/session' && req.method === 'GET') {
        const signedIn = !!ctx.auth?.check(cookieOf(req, COOKIE));
        return send(res, 200, { configured: !!ctx.auth, signedIn, access: !!ctx.access });
      }
      if (!ctx.auth) throw new HttpError(503, 'The admin login is not set up. Run pnpm admin:setup on the server.');

      if (path === '/login' && req.method === 'POST') {
        const body = await readJson(req);
        const r = await ctx.auth.login(ip, body.password, body.code);
        audit(req, 'login', r.ok, r.ok ? undefined : { reason: r.status === 429 ? 'rate limited' : 'wrong password or code' });
        if (!r.ok) return send(res, r.status, { error: r.error });
        res.setHeader('set-cookie', `${COOKIE}=${r.token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${12 * 3600}`);
        return send(res, 200, { ok: true });
      }

      const token = cookieOf(req, COOKIE);
      if (!ctx.auth.check(token)) throw new HttpError(401, 'Sign in again');
      if (!ctx.auth.requests.take(createHash('sha256').update(token!).digest('base64url'))) throw new HttpError(429, 'Slow down');

      if (path === '/logout' && req.method === 'POST') {
        ctx.auth.logout(token);
        audit(req, 'logout', true);
        res.setHeader('set-cookie', `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`);
        return send(res, 200, { ok: true });
      }

      for (const r of compiled) {
        if (r.method !== req.method) continue;
        const m = path.match(r.re);
        if (m) return send(res, 200, await r.fn(req, url.searchParams, m));
      }
      throw new HttpError(404, 'Not found');
    } catch (err) {
      if (err instanceof HttpError) return send(res, err.status, { error: err.message });
      console.error('admin api error', err instanceof Error ? err.message : 'unknown');
      return send(res, 500, { error: 'Server error' });
    }
  };
}

/** GET /billboards/<slot>?v=<version>: a replaced billboard image (public: it's on screen anyway). */
export function billboardHandler(ctx: Pick<AdminContext, 'store' | 'control'>) {
  return async function handle(req: IncomingMessage, res: ServerResponse) {
    const m = (req.url ?? '').match(/^\/billboards\/([a-z0-9-]{1,40})(?:\?v=([\w-]{1,20}))?$/);
    const slot = m?.[1];
    if (req.method !== 'GET' || !slot || !isBillboardSlot(slot) || !ctx.control.billboards[slot]) return res.writeHead(404).end();
    const img = await ctx.store?.getBillboard(slot).catch(() => null);
    if (!img) return res.writeHead(404).end();
    res.writeHead(200, {
      'content-type': img.contentType,
      'content-length': img.bytes.length,
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; sandbox",
      // Versioned URLs never change; unversioned ones are rechecked.
      'cache-control': m?.[2] === img.version ? 'public, max-age=31536000, immutable' : 'no-cache',
    });
    res.end(img.bytes);
  };
}
