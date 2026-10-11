import { existsSync } from 'node:fs';
import { appendFile, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { AnalyticsEvent } from '../analytics/events';
import type { GameSummary } from '../game/summary';
import type { FeedbackEntry } from '../room';
import { inRange, type AuditEntry, type Ban, type BillboardImage, type Range, type Store } from './types';

/**
 * Plain files in one folder (default apps/server/logs): JSON Lines for records, small JSON files
 * for settings. games.jsonl and feedback.jsonl keep their playtest format, so `pnpm stats` and
 * `pnpm feedback` keep working. The folder must never be inside a public web folder; the game
 * server serves no files from it (billboard images go through the admin's own route).
 */
export class FileStore implements Store {
  readonly kind = 'file' as const;
  private readonly files;
  private queue: Promise<unknown> = Promise.resolve();
  private readonly cache = new Map<string, { stamp: string; rows: unknown[] }>();

  constructor(readonly dir: string) {
    this.dir = resolve(dir);
    if (/[\\/]public([\\/]|$)/.test(this.dir)) throw new Error(`${this.dir}: data must not be inside a public web folder`);
    this.files = {
      events: join(this.dir, 'events.jsonl'),
      games: join(this.dir, 'games.jsonl'),
      feedback: join(this.dir, 'feedback.jsonl'),
      audit: join(this.dir, 'admin-audit.jsonl'),
      bans: join(this.dir, 'bans.json'),
      config: join(this.dir, 'config.json'),
      billboards: join(this.dir, 'billboards'),
    };
  }

  async init() {
    await mkdir(this.files.billboards, { recursive: true });
  }

  /** Writes happen one at a time, in order. */
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.queue.then(fn, fn);
    this.queue = next.catch(() => {});
    return next;
  }

  private append(file: string, value: unknown) {
    return this.serial(async () => {
      await mkdir(this.dir, { recursive: true });
      await appendFile(file, JSON.stringify(value) + '\n');
    });
  }

  /** All lines of a JSONL file, re-read only when the file changed. Bad lines are skipped. */
  private async lines<T>(file: string): Promise<T[]> {
    let s;
    try {
      s = await stat(file);
    } catch {
      return [];
    }
    const stamp = `${s.size}:${s.mtimeMs}`;
    const hit = this.cache.get(file);
    if (hit?.stamp === stamp) return hit.rows as T[];
    const rows: T[] = [];
    for (const line of (await readFile(file, 'utf8')).split('\n')) {
      if (!line.trim()) continue;
      try {
        rows.push(JSON.parse(line));
      } catch {}
    }
    this.cache.set(file, { stamp, rows });
    return rows;
  }

  private async readJson<T>(file: string, fallback: T): Promise<T> {
    try {
      return JSON.parse(await readFile(file, 'utf8')) as T;
    } catch {
      return fallback;
    }
  }

  /** Replace a JSON file in one step (write a temp file, then rename). */
  private writeJson(file: string, value: unknown) {
    return this.serial(async () => {
      await mkdir(this.dir, { recursive: true });
      await writeFile(`${file}.tmp`, JSON.stringify(value, null, 2));
      await rename(`${file}.tmp`, file);
    });
  }

  addEvent(e: AnalyticsEvent) {
    return this.append(this.files.events, e);
  }
  addGame(g: GameSummary) {
    return this.append(this.files.games, g);
  }
  addFeedback(f: FeedbackEntry) {
    return this.append(this.files.feedback, f);
  }
  addAudit(a: AuditEntry) {
    return this.append(this.files.audit, a);
  }

  async events(q: Range & { types?: AnalyticsEvent['type'][] } = {}) {
    const rows = await this.lines<AnalyticsEvent>(this.files.events);
    return rows.filter((e) => (!q.types || q.types.includes(e.type)) && inRange(e.at, q));
  }
  async games(q: Range = {}) {
    return (await this.lines<GameSummary>(this.files.games)).filter((g) => inRange(g.endedAt, q));
  }
  async feedback(q: Range = {}) {
    return (await this.lines<FeedbackEntry>(this.files.feedback)).filter((f) => inRange(f.at, q));
  }
  async audit(q: Range & { limit?: number } = {}) {
    const rows = (await this.lines<AuditEntry>(this.files.audit)).filter((a) => inRange(a.at, q)).reverse();
    return q.limit ? rows.slice(0, q.limit) : rows;
  }

  bans() {
    return this.readJson<Ban[]>(this.files.bans, []);
  }
  async addBan(b: Ban) {
    const list = (await this.bans()).filter((x) => x.anon !== b.anon);
    await this.writeJson(this.files.bans, [...list, b]);
  }
  async removeBan(anon: string) {
    await this.writeJson(this.files.bans, (await this.bans()).filter((x) => x.anon !== anon));
  }

  async getConfig<T>(key: string): Promise<T | null> {
    const all = await this.readJson<Record<string, unknown>>(this.files.config, {});
    return (all[key] as T) ?? null;
  }
  async setConfig(key: string, value: unknown) {
    const all = await this.readJson<Record<string, unknown>>(this.files.config, {});
    await this.writeJson(this.files.config, { ...all, [key]: value });
  }

  private imagePath = (slot: string) => join(this.files.billboards, `${slot}.bin`);
  private metaPath = (slot: string) => join(this.files.billboards, `${slot}.json`);
  async putBillboard(img: BillboardImage) {
    await this.serial(async () => {
      await mkdir(this.files.billboards, { recursive: true });
      await writeFile(this.imagePath(img.slot), img.bytes);
      await writeFile(this.metaPath(img.slot), JSON.stringify({ version: img.version, contentType: img.contentType }));
    });
  }
  async getBillboard(slot: string): Promise<BillboardImage | null> {
    if (!existsSync(this.metaPath(slot))) return null;
    try {
      const meta = JSON.parse(await readFile(this.metaPath(slot), 'utf8'));
      return { slot, version: meta.version, contentType: meta.contentType, bytes: await readFile(this.imagePath(slot)) };
    } catch {
      return null;
    }
  }
  async removeBillboard(slot: string) {
    await this.serial(async () => {
      await rm(this.imagePath(slot), { force: true });
      await rm(this.metaPath(slot), { force: true });
    });
  }

  async removeSeed() {
    let removed = 0;
    for (const file of [this.files.events, this.files.games, this.files.feedback]) {
      const rows = await this.lines<{ seed?: boolean }>(file);
      const keep = rows.filter((r) => !r.seed);
      removed += rows.length - keep.length;
      if (keep.length === rows.length) continue;
      await this.serial(async () => {
        await writeFile(`${file}.tmp`, keep.map((r) => JSON.stringify(r) + '\n').join(''));
        await rename(`${file}.tmp`, file);
      });
      this.cache.delete(file);
    }
    return removed;
  }

  async close() {
    await this.queue;
  }
}
