import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '@wtc/shared';
import type { AnalyticsEvent } from '../src/analytics/events';
import type { GameSummary } from '../src/game/summary';
import { FileStore } from '../src/store/file';
import { PostgresStore } from '../src/store/postgres';
import { SCHEMA_SQL } from '../src/store/schema';
import type { Store } from '../src/store/types';

// Both stores keep the same records and answer the same queries, so switching to Postgres at
// launch is only a config change. Postgres here is PGlite: the real Postgres, in-process.

const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

const game = (endedAt: string, seed = false): GameSummary => ({
  ...(seed ? { seed: true as const } : {}),
  endedAt,
  durationMs: 600_000,
  players: 8,
  bots: 0,
  inspectLimit: 3,
  settings: DEFAULT_SETTINGS,
  posters: [{ poster: 0, wantedIsBot: false, pot: 100, voters: 7, correct: 3, escaped: false, payoutEach: 33 }],
  inspects: 20,
  offers: { made: 2, accepted: 1, declined: 1, expired: 0 },
  extraInspects: 1,
  finalScores: [200, 100],
  winnerCorrectVotes: 1,
  swapLimit: 2,
  totalSwaps: 3,
  colorChanges: [0],
  gameId: `g-${endedAt}`,
});

const stores: [string, () => Promise<Store>][] = [
  [
    'file',
    async () => {
      const dir = mkdtempSync(join(tmpdir(), 'wtc-store-'));
      dirs.push(dir);
      return new FileStore(dir);
    },
  ],
  ['postgres', async () => new PostgresStore(new PGlite())],
];

describe.each(stores)('%s store', (_name, make) => {
  it('keeps events, games, feedback and the audit log, and filters by time and type', async () => {
    const s = await make();
    await s.init();
    await s.init(); // starting twice is fine (the schema is idempotent)
    const visit: AnalyticsEvent = { at: '2026-10-01T10:00:00.000Z', type: 'visit', anon: 'AAAAAAAAAAAAAAAA', page: 'home', src: 'youtube', device: 'mobile', country: 'NG' };
    const step: AnalyticsEvent = { at: '2026-10-02T10:00:00.000Z', type: 'step', anon: 'AAAAAAAAAAAAAAAA', step: 'lobby' };
    const seeded: AnalyticsEvent = { at: '2026-10-03T10:00:00.000Z', type: 'billboard', anon: 'BBBBBBBBBBBBBBBB', slot: 'roof-hotel', seed: true };
    for (const e of [visit, step, seeded]) await s.addEvent(e);
    expect(await s.events()).toEqual([visit, step, seeded]);
    expect(await s.events({ types: ['step'] })).toEqual([step]);
    expect(await s.events({ from: new Date('2026-10-02T00:00:00Z'), to: new Date('2026-10-03T00:00:00Z') })).toEqual([step]);

    await s.addGame(game('2026-10-01T12:00:00.000Z'));
    await s.addGame(game('2026-10-05T12:00:00.000Z', true));
    expect((await s.games()).map((g) => g.endedAt)).toEqual(['2026-10-01T12:00:00.000Z', '2026-10-05T12:00:00.000Z']);
    expect(await s.games({ to: new Date('2026-10-02T00:00:00Z') })).toEqual([game('2026-10-01T12:00:00.000Z')]);

    const fb = { at: '2026-10-01T13:00:00.000Z', gameId: 'g1', name: 'Ada', anon: 'AAAAAAAAAAAAAAAA', answers: { confused: 'x', fun: '', noPointLying: '', pace: '', playAgain: 'yes' as const } };
    await s.addFeedback(fb);
    expect(await s.feedback()).toEqual([fb]);

    await s.addAudit({ at: '2026-10-01T09:00:00.000Z', action: 'login', ok: false, ip: '1.2.3.4', country: null });
    await s.addAudit({ at: '2026-10-01T09:01:00.000Z', action: 'login', ok: true, ip: '1.2.3.4', country: 'NG', detail: { a: 1 } });
    const audit = await s.audit();
    expect(audit.map((a) => a.ok)).toEqual([true, false]); // newest first
    expect(audit[0].detail).toEqual({ a: 1 });
    expect(await s.audit({ limit: 1 })).toHaveLength(1);

    expect(await s.removeSeed()).toBe(2);
    expect(await s.events()).toEqual([visit, step]);
    expect(await s.games()).toHaveLength(1);
    await s.close();
  });

  it('keeps bans, settings and billboard images', async () => {
    const s = await make();
    await s.init();
    await s.addBan({ anon: 'AAAAAAAAAAAAAAAA', at: '2026-10-01T00:00:00.000Z', reason: 'spam' });
    await s.addBan({ anon: 'AAAAAAAAAAAAAAAA', at: '2026-10-02T00:00:00.000Z', reason: 'spam again' });
    expect(await s.bans()).toEqual([{ anon: 'AAAAAAAAAAAAAAAA', at: '2026-10-02T00:00:00.000Z', reason: 'spam again' }]);
    await s.removeBan('AAAAAAAAAAAAAAAA');
    expect(await s.bans()).toEqual([]);

    expect(await s.getConfig('maintenance')).toBeNull();
    await s.setConfig('maintenance', { on: true, message: 'Back soon' });
    await s.setConfig('maintenance', { on: false, message: 'Back soon' });
    expect(await s.getConfig('maintenance')).toEqual({ on: false, message: 'Back soon' });

    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
    await s.putBillboard({ slot: 'roof-hotel', version: 'v1', contentType: 'image/png', bytes });
    const img = await s.getBillboard('roof-hotel');
    expect(img?.version).toBe('v1');
    expect(img?.bytes.equals(bytes)).toBe(true);
    await s.removeBillboard('roof-hotel');
    expect(await s.getBillboard('roof-hotel')).toBeNull();
    await s.close();
  });
});

describe('Postgres schema', () => {
  it('the embedded copy matches schema.sql (run pnpm db:schema after editing it)', () => {
    const file = readFileSync(join(__dirname, '../src/store/schema.sql'), 'utf8').replace(/\r\n/g, '\n');
    expect(SCHEMA_SQL).toBe(file);
  });

  it('refuses rows that would break the privacy rules', async () => {
    const db = new PGlite();
    await db.exec(SCHEMA_SQL);
    // Not an anonymous id (e.g. a raw browser id, a name or an IP address).
    await expect(db.query("INSERT INTO events (at, type, anon) VALUES (now(), 'visit', '192.168.1.20')")).rejects.toThrow();
    await expect(db.query("INSERT INTO events (at, type, anon) VALUES (now(), 'whatever', NULL)")).rejects.toThrow();
    await expect(db.query("INSERT INTO billboards (slot, version, content_type, bytes) VALUES ('x', 'v', 'image/svg+xml', '\\x00')")).rejects.toThrow();
    await db.close();
  });
});
