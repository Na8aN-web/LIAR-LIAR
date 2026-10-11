import type { AnalyticsEvent } from '../analytics/events';
import type { GameSummary } from '../game/summary';
import type { FeedbackEntry } from '../room';
import { SCHEMA_SQL } from './schema';
import type { AuditEntry, Ban, BillboardImage, Range, Store } from './types';

/** The one thing this store needs from a database client: pg's Pool and PGlite both fit. */
export interface Sql {
  query<R = any>(text: string, params?: unknown[]): Promise<{ rows: R[] }>;
  exec?(text: string): Promise<unknown>;
  end?(): Promise<void>;
  close?(): Promise<void>;
}

const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString());

/** WHERE clause for a time range on `col`, appending its parameters to `params`. */
function range(col: string, r: Range, params: unknown[]) {
  const parts: string[] = [];
  if (r.from) parts.push(`${col} >= $${params.push(r.from)}`);
  if (r.to) parts.push(`${col} < $${params.push(r.to)}`);
  return parts;
}
const where = (parts: string[]) => (parts.length ? `WHERE ${parts.join(' AND ')}` : '');

/** Postgres (ANALYTICS_STORE=postgres, DATABASE_URL=...). Same records as the file store. */
export class PostgresStore implements Store {
  readonly kind = 'postgres' as const;
  constructor(private readonly db: Sql) {}

  async init() {
    // The schema is idempotent (CREATE ... IF NOT EXISTS). pg runs several statements in one
    // query; PGlite (tests) needs exec for that.
    if (this.db.exec) await this.db.exec(SCHEMA_SQL);
    else await this.db.query(SCHEMA_SQL);
  }

  async addEvent(e: AnalyticsEvent) {
    const { at, type, anon, seed, ...data } = e;
    await this.db.query('INSERT INTO events (at, type, anon, data, seed) VALUES ($1, $2, $3, $4, $5)', [at, type, anon, JSON.stringify(data), !!seed]);
  }
  async addGame(g: GameSummary) {
    await this.db.query('INSERT INTO games (game_id, ended_at, players, bots, check_game, seed, summary) VALUES ($1, $2, $3, $4, $5, $6, $7)', [
      g.gameId ?? null,
      g.endedAt,
      g.players,
      g.bots,
      !!g.check,
      !!g.seed,
      JSON.stringify(g),
    ]);
  }
  async addFeedback(f: FeedbackEntry) {
    await this.db.query('INSERT INTO feedback (at, game_id, name, anon, answers, seed) VALUES ($1, $2, $3, $4, $5, $6)', [
      f.at,
      f.gameId,
      f.name,
      f.anon ?? null,
      JSON.stringify(f.answers),
      !!f.seed,
    ]);
  }
  async addAudit(a: AuditEntry) {
    await this.db.query('INSERT INTO admin_audit (at, action, ok, detail, ip, country) VALUES ($1, $2, $3, $4, $5, $6)', [
      a.at,
      a.action,
      a.ok,
      a.detail ? JSON.stringify(a.detail) : null,
      a.ip,
      a.country ?? null,
    ]);
  }

  async events(q: Range & { types?: AnalyticsEvent['type'][] } = {}) {
    const params: unknown[] = [];
    const parts = range('at', q, params);
    if (q.types) parts.push(`type = ANY($${params.push(q.types)})`);
    const { rows } = await this.db.query(`SELECT at, type, anon, data, seed FROM events ${where(parts)} ORDER BY at, id`, params);
    return rows.map((r) => ({ ...(r.data as object), at: iso(r.at), type: r.type, anon: r.anon, ...(r.seed ? { seed: true } : {}) }) as AnalyticsEvent);
  }
  async games(q: Range = {}) {
    const params: unknown[] = [];
    const { rows } = await this.db.query(`SELECT summary FROM games ${where(range('ended_at', q, params))} ORDER BY ended_at, id`, params);
    return rows.map((r) => r.summary as GameSummary);
  }
  async feedback(q: Range = {}) {
    const params: unknown[] = [];
    const { rows } = await this.db.query(`SELECT at, game_id, name, anon, answers, seed FROM feedback ${where(range('at', q, params))} ORDER BY at, id`, params);
    return rows.map((r) => ({ at: iso(r.at), gameId: r.game_id, name: r.name, anon: r.anon, answers: r.answers, ...(r.seed ? { seed: true as const } : {}) }));
  }
  async audit(q: Range & { limit?: number } = {}) {
    const params: unknown[] = [];
    const parts = range('at', q, params);
    const limit = q.limit ? `LIMIT $${params.push(q.limit)}` : '';
    const { rows } = await this.db.query(`SELECT at, action, ok, detail, ip, country FROM admin_audit ${where(parts)} ORDER BY at DESC, id DESC ${limit}`, params);
    return rows.map((r) => ({ at: iso(r.at), action: r.action, ok: r.ok, ip: r.ip, country: r.country, ...(r.detail ? { detail: r.detail } : {}) }));
  }

  async bans(): Promise<Ban[]> {
    const { rows } = await this.db.query('SELECT anon, at, reason FROM bans ORDER BY at');
    return rows.map((r) => ({ anon: r.anon, at: iso(r.at), reason: r.reason }));
  }
  async addBan(b: Ban) {
    await this.db.query('INSERT INTO bans (anon, at, reason) VALUES ($1, $2, $3) ON CONFLICT (anon) DO UPDATE SET at = $2, reason = $3', [b.anon, b.at, b.reason]);
  }
  async removeBan(anon: string) {
    await this.db.query('DELETE FROM bans WHERE anon = $1', [anon]);
  }

  async getConfig<T>(key: string): Promise<T | null> {
    const { rows } = await this.db.query('SELECT value FROM config WHERE key = $1', [key]);
    return rows.length ? (rows[0].value as T) : null;
  }
  async setConfig(key: string, value: unknown) {
    await this.db.query('INSERT INTO config (key, value, updated_at) VALUES ($1, $2, now()) ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = now()', [
      key,
      JSON.stringify(value),
    ]);
  }

  async putBillboard(img: BillboardImage) {
    await this.db.query(
      'INSERT INTO billboards (slot, version, content_type, bytes, updated_at) VALUES ($1, $2, $3, $4, now()) ' +
        'ON CONFLICT (slot) DO UPDATE SET version = $2, content_type = $3, bytes = $4, updated_at = now()',
      [img.slot, img.version, img.contentType, img.bytes],
    );
  }
  async getBillboard(slot: string): Promise<BillboardImage | null> {
    const { rows } = await this.db.query('SELECT slot, version, content_type, bytes FROM billboards WHERE slot = $1', [slot]);
    if (!rows.length) return null;
    const r = rows[0];
    return { slot: r.slot, version: r.version, contentType: r.content_type, bytes: Buffer.from(r.bytes) };
  }
  async removeBillboard(slot: string) {
    await this.db.query('DELETE FROM billboards WHERE slot = $1', [slot]);
  }

  async removeSeed() {
    let n = 0;
    for (const table of ['events', 'games', 'feedback']) {
      const { rows } = await this.db.query(`WITH d AS (DELETE FROM ${table} WHERE seed RETURNING 1) SELECT count(*)::int AS n FROM d`);
      n += rows[0]?.n ?? 0;
    }
    return n;
  }

  async close() {
    await (this.db.end?.() ?? this.db.close?.());
  }
}
