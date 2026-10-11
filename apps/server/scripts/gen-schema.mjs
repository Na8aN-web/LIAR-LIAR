// Rebuilds src/store/schema.ts from src/store/schema.sql (the server embeds the SQL so a bundled
// build doesn't need the .sql file next to it). Run after editing schema.sql: pnpm db:schema
import { readFileSync, writeFileSync } from 'node:fs';
const sql = readFileSync(new URL('../src/store/schema.sql', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
writeFileSync(
  new URL('../src/store/schema.ts', import.meta.url),
  `// Generated from schema.sql by \`pnpm db:schema\`. Edit schema.sql, not this file (a test checks they match).\nexport const SCHEMA_SQL = ${JSON.stringify(sql)};\n`,
);
console.log('src/store/schema.ts updated');
