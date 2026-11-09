// Creates the schema in the database at DATABASE_URL (apps/server/.env.local), and optionally
// copies existing data into it. The destination must be empty; nothing is ever overwritten.
//   pnpm db:import                                  create the tables and show row counts
//   pnpm db:import -- --from "postgres://..."       copy from another Postgres (e.g. Railway's public URL)
//   pnpm db:import -- --from path/to/logs           copy from a file store folder (DATA_DIR)
import { existsSync } from 'node:fs';
import pg from 'pg';
import { copyFiles, copyPostgres, tableCounts } from '../src/store/copy';
import { PostgresStore } from '../src/store/postgres';

if (existsSync('.env.local')) process.loadEnvFile('.env.local');

const i = process.argv.indexOf('--from');
const from = i >= 0 ? process.argv[i + 1] : null;
const url = process.env.DATABASE_URL;
if (!url) throw new Error('Set DATABASE_URL (apps/server/.env.local) to the database to fill.');
if (i >= 0 && !from) throw new Error('--from needs a postgres:// URL or a folder.');
if (from === url) throw new Error('The source and the destination are the same database.');

const dst = new pg.Client({ connectionString: url });
await dst.connect();
try {
  await new PostgresStore(dst).init();
  console.log('Tables are in place. Rows now:', await tableCounts(dst));
  if (from && /^postgres(ql)?:\/\//.test(from)) {
    const src = new pg.Client({ connectionString: from });
    await src.connect();
    try {
      console.log('Rows in the source:', await tableCounts(src));
      console.log('Copied. Rows now:', await copyPostgres(src, dst));
    } finally {
      await src.end();
    }
  } else if (from) {
    console.log('Copied. Rows now:', await copyFiles(from, dst));
  }
} finally {
  await dst.end();
}
