import { FileStore } from './file';
import { PostgresStore } from './postgres';
import type { Store } from './types';

export type { Store } from './types';
export { FileStore } from './file';
export { PostgresStore } from './postgres';

/**
 * The store picked by configuration:
 *   ANALYTICS_STORE=file (default)  files in DATA_DIR (default: logs, next to the server)
 *   ANALYTICS_STORE=postgres        DATABASE_URL=postgres://user:pass@host:5432/db
 *                                   (DATABASE_SSL=1 for hosted databases that require TLS)
 * The schema is created on start (store/schema.sql).
 */
export async function createStore(env: NodeJS.ProcessEnv = process.env): Promise<Store> {
  const kind = (env.ANALYTICS_STORE ?? 'file').toLowerCase();
  let store: Store;
  if (kind === 'postgres') {
    if (!env.DATABASE_URL) throw new Error('ANALYTICS_STORE=postgres needs DATABASE_URL');
    const { default: pg } = await import('pg');
    const pool = new pg.Pool({
      connectionString: env.DATABASE_URL,
      max: 5,
      ssl: env.DATABASE_SSL === '1' ? { rejectUnauthorized: true } : undefined,
    });
    store = new PostgresStore(pool);
  } else if (kind === 'file') {
    store = new FileStore(env.DATA_DIR ?? 'logs');
  } else {
    throw new Error(`Unknown ANALYTICS_STORE "${kind}" (file or postgres)`);
  }
  await store.init();
  return store;
}
