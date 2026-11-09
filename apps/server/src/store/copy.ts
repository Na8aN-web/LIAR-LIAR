import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { FileStore } from './file';
import { PostgresStore, type Sql } from './postgres';

// Copies everything the game keeps (stats, analytics, feedback, admin log, bans, admin settings,
// billboards) into an empty Postgres database, in one transaction: `pnpm db:import`.

const TABLES = [
  { name: 'events', cols: ['at', 'type', 'anon', 'data', 'seed'], order: 'at, id', batch: 500 },
  { name: 'games', cols: ['game_id', 'ended_at', 'players', 'bots', 'check_game', 'seed', 'summary'], order: 'ended_at, id', batch: 200 },
  { name: 'feedback', cols: ['at', 'game_id', 'name', 'anon', 'answers', 'seed'], order: 'at, id', batch: 500 },
  { name: 'admin_audit', cols: ['at', 'action', 'ok', 'detail', 'ip', 'country'], order: 'at, id', batch: 500 },
  { name: 'bans', cols: ['anon', 'at', 'reason'], order: 'at, anon', batch: 500 },
  { name: 'config', cols: ['key', 'value', 'updated_at'], order: 'key', batch: 100 },
  // Images are up to 2 MB each: one at a time.
  { name: 'billboards', cols: ['slot', 'version', 'content_type', 'bytes', 'updated_at'], order: 'slot', batch: 1 },
] as const;

export type Counts = Record<string, number>;

export async function tableCounts(db: Sql): Promise<Counts> {
  const out: Counts = {};
  for (const t of TABLES) {
    const { rows } = await db.query(`SELECT count(*)::int AS n FROM ${t.name}`);
    out[t.name] = rows[0].n;
  }
  return out;
}

const total = (c: Counts) => Object.values(c).reduce((a, b) => a + b, 0);

/** Runs a copy in one transaction, into a database that must be empty: nothing is ever overwritten. */
async function intoEmpty(dst: Sql, copy: () => Promise<void>): Promise<Counts> {
  const before = await tableCounts(dst);
  if (total(before)) throw new Error(`The destination already has data: ${JSON.stringify(before)}. Nothing was copied.`);
  await dst.query('BEGIN');
  try {
    await copy();
    await dst.query('COMMIT');
  } catch (err) {
    await dst.query('ROLLBACK');
    throw err;
  }
  return tableCounts(dst);
}

/** Copies every table from another Postgres database. */
export function copyPostgres(src: Sql, dst: Sql): Promise<Counts> {
  return intoEmpty(dst, async () => {
    for (const t of TABLES) {
      const cols = t.cols.join(', ');
      for (let offset = 0; ; offset += t.batch) {
        const { rows } = await src.query(`SELECT to_jsonb(r) AS row FROM (SELECT ${cols} FROM ${t.name} ORDER BY ${t.order} LIMIT ${t.batch} OFFSET ${offset}) r`);
        if (!rows.length) break;
        await dst.query(`INSERT INTO ${t.name} (${cols}) SELECT ${cols} FROM jsonb_populate_recordset(NULL::${t.name}, $1::jsonb)`, [JSON.stringify(rows.map((r) => r.row))]);
        if (rows.length < t.batch) break;
      }
    }
  });
}

/** Copies a file store's folder (DATA_DIR). */
export function copyFiles(dir: string, dst: Sql): Promise<Counts> {
  if (!existsSync(dir)) throw new Error(`No such folder: ${dir}`);
  const src = new FileStore(dir);
  const to = new PostgresStore(dst);
  return intoEmpty(dst, async () => {
    for (const e of await src.events()) await to.addEvent(e);
    for (const g of await src.games()) await to.addGame(g);
    for (const f of await src.feedback()) await to.addFeedback(f);
    // The audit log comes newest first.
    for (const a of (await src.audit()).reverse()) await to.addAudit(a);
    for (const b of await src.bans()) await to.addBan(b);
    const configFile = join(dir, 'config.json');
    if (existsSync(configFile)) {
      for (const [key, value] of Object.entries(JSON.parse(readFileSync(configFile, 'utf8')))) await to.setConfig(key, value);
    }
    const images = join(dir, 'billboards');
    if (existsSync(images)) {
      for (const file of readdirSync(images).filter((f) => f.endsWith('.json'))) {
        const img = await src.getBillboard(file.slice(0, -'.json'.length));
        if (img) await to.putBillboard(img);
      }
    }
  });
}
