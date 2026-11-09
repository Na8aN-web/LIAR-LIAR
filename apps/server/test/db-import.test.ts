import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { afterEach, describe, expect, it } from 'vitest';
import { copyFiles, copyPostgres, tableCounts } from '../src/store/copy';
import { FileStore } from '../src/store/file';
import { PostgresStore, type Sql } from '../src/store/postgres';
import type { Store } from '../src/store/types';

// `pnpm db:import`: everything arrives intact, and a database with data is never touched.

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const image = Buffer.from([0, 1, 2, 250, 255]);

async function fill(s: Store) {
  await s.addEvent({ at: '2026-10-01T10:00:00.000Z', type: 'visit', anon: 'abcdefghijklmnop', page: 'home', src: 'youtube' } as never);
  await s.addGame({ gameId: 'g1', endedAt: '2026-10-01T11:00:00.000Z', players: 6, bots: 2, check: false, posters: [] } as never);
  await s.addFeedback({ at: '2026-10-01T11:01:00.000Z', gameId: 'g1', name: 'Ada', anon: null, answers: { fun: 5 } } as never);
  await s.addAudit({ at: '2026-10-01T12:00:00.000Z', action: 'login', ok: true, ip: '1.2.3.4', country: 'NG', detail: { a: 1 } });
  await s.addAudit({ at: '2026-10-01T12:05:00.000Z', action: 'ban', ok: true, ip: '1.2.3.4', country: null });
  await s.addBan({ anon: 'abcdefghijklmnop', at: '2026-10-01T12:05:00.000Z', reason: 'spam' });
  await s.setConfig('maintenance', { on: true, message: 'Back soon' });
  await s.putBillboard({ slot: 'roof-hotel', version: 'v1', contentType: 'image/png', bytes: image });
}

async function expectAll(db: Sql) {
  const s = new PostgresStore(db);
  expect(await tableCounts(db)).toEqual({ events: 1, games: 1, feedback: 1, admin_audit: 2, bans: 1, config: 1, billboards: 1 });
  expect((await s.events())[0]).toMatchObject({ type: 'visit', page: 'home', anon: 'abcdefghijklmnop' });
  expect((await s.games())[0]).toMatchObject({ gameId: 'g1', players: 6 });
  expect((await s.feedback())[0]).toMatchObject({ name: 'Ada', answers: { fun: 5 } });
  expect((await s.audit()).map((a) => a.action)).toEqual(['ban', 'login']);
  expect((await s.bans())[0].reason).toBe('spam');
  expect(await s.getConfig('maintenance')).toEqual({ on: true, message: 'Back soon' });
  const b = await s.getBillboard('roof-hotel');
  expect(b && [...b.bytes]).toEqual([...image]);
  expect(b?.contentType).toBe('image/png');
}

async function database() {
  const db = new PGlite();
  await new PostgresStore(db as unknown as Sql).init();
  return db as unknown as Sql;
}

// Each in-memory database takes a few seconds to start when the whole suite runs at once.
describe('importing data into an empty database', { timeout: 60_000 }, () => {
  it('copies every table from another Postgres', async () => {
    const [src, dst] = [await database(), await database()];
    await fill(new PostgresStore(src));
    await copyPostgres(src, dst);
    await expectAll(dst);
  });

  it('copies every kind of record from a file store folder', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wtc-import-'));
    dirs.push(dir);
    const files = new FileStore(dir);
    await files.init();
    await fill(files);
    const dst = await database();
    await copyFiles(dir, dst);
    await expectAll(dst);
  });

  it('refuses a destination that already has data, and changes nothing', async () => {
    const [src, dst] = [await database(), await database()];
    await fill(new PostgresStore(src));
    await new PostgresStore(dst).setConfig('keep', 1);
    await expect(copyPostgres(src, dst)).rejects.toThrow(/already has data/);
    expect((await tableCounts(dst)).config).toBe(1);
    expect(await new PostgresStore(dst).getConfig('keep')).toBe(1);
  });

  it('leaves nothing behind when a copy fails halfway', async () => {
    const [src, dst] = [await database(), await database()];
    await fill(new PostgresStore(src));
    await src.query('DROP TABLE billboards');
    await expect(copyPostgres(src, dst)).rejects.toThrow();
    expect(Object.values(await tableCounts(dst)).every((n) => n === 0)).toBe(true);
  });
});
