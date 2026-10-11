import { readFileSync, statSync } from 'node:fs';
import { appendFile, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { MIN_PLAYERS } from '@wtc/shared';
import { createGameServer } from './server';

// Dev tools (bots, phase skipping, 2-player lobbies) are opt-in: `--dev` on the command line
// (pnpm dev passes it). A server started any other way is a production server, and
// NODE_ENV=production refuses --dev outright.
const production = process.env.NODE_ENV === 'production';
const devMode = process.argv.includes('--dev') && !production;
if (process.argv.includes('--dev') && production) console.warn('Ignoring --dev: NODE_ENV is production');

const port = Number(process.env.PORT ?? 3001);
const minPlayers = devMode ? Number(process.env.MIN_PLAYERS ?? 2) : MIN_PLAYERS;

// Production: which sites may connect. ALLOWED_ORIGINS=https://a.example,https://b.example;
// unset = only the server's own host (same-origin, e.g. behind one proxy). Dev: anything.
// ALLOWED_ORIGINS_FILE adds origins from a file (one per line) that is re-read whenever it
// changes, so a tunnel's new URL can be allowed without restarting the server (pnpm playtest).
const splitList = (s: string) =>
  s
    .split(/[\s,]+/)
    .map((x) => x.trim())
    .filter(Boolean);
const fixedOrigins = splitList(process.env.ALLOWED_ORIGINS ?? process.env.CORS_ORIGIN ?? '');
const originsFile = process.env.ALLOWED_ORIGINS_FILE ? resolve(process.env.ALLOWED_ORIGINS_FILE) : null;
let fileOrigins: string[] = [];
let fileStamp = -1;
function allowedOrigins(): string[] {
  if (originsFile) {
    try {
      const stamp = statSync(originsFile).mtimeMs;
      if (stamp !== fileStamp) {
        fileStamp = stamp;
        fileOrigins = splitList(readFileSync(originsFile, 'utf8'));
      }
    } catch {
      fileOrigins = [];
    }
  }
  return [...fixedOrigins, ...fileOrigins];
}

// Behind a proxy or tunnel you run (Cloudflare, nginx): trust its client-IP headers.
const trustProxy = process.env.TRUST_PROXY === '1';

// One JSON line per finished game, for balance tuning. GAME_LOG=off disables it. The file is
// written next to the server, never inside the web app's public folder, and this server serves
// no files, so it can't be downloaded. Feedback answers go to feedback.jsonl beside it.
const gameLog = process.env.GAME_LOG === 'off' ? null : resolve(process.env.GAME_LOG ?? 'logs/games.jsonl');
const feedbackLog =
  process.env.FEEDBACK_LOG === 'off' ? null : resolve(process.env.FEEDBACK_LOG ?? join(dirname(gameLog ?? resolve('logs/games.jsonl')), 'feedback.jsonl'));
for (const f of [gameLog, feedbackLog]) {
  if (f && /[\\/]public[\\/]/.test(f)) throw new Error(`${f}: logs must not be inside a public web folder`);
}

async function appendLine(file: string, value: unknown) {
  try {
    await mkdir(dirname(file), { recursive: true });
    await appendFile(file, JSON.stringify(value) + '\n');
  } catch (err) {
    console.error(`could not write ${file}`, err instanceof Error ? err.message : 'unknown');
  }
}

const server = createGameServer({
  port,
  devMode,
  minPlayers,
  corsOrigin: devMode && !fixedOrigins.length && !originsFile ? true : allowedOrigins,
  trustProxy,
  onGameEnd: (summary) => {
    if (gameLog) void appendLine(gameLog, summary);
    console.log(`Game finished: ${summary.players} players, ${summary.posters.length} posters. Stats saved.`);
  },
  onFeedback: (entry) => {
    if (feedbackLog) void appendLine(feedbackLog, entry);
    console.log(`Feedback received from ${entry.name}.`);
  },
});
server.listen().then((p) => {
  console.log(`Wanted: True Colors server on :${p} (${devMode ? 'dev' : 'production'}, min ${minPlayers} players)`);
  if (!devMode) {
    const extra = originsFile ? ` (plus whatever ${originsFile} lists at the time)` : '';
    console.log(`Connections allowed from: ${fixedOrigins.length ? fixedOrigins.join(', ') : 'this server’s own host'}${extra}`);
  }
  if (trustProxy) console.log('Trusting proxy headers for client IPs (TRUST_PROXY=1)');
  if (gameLog) console.log(`Game stats -> ${gameLog}`);
  if (feedbackLog) console.log(`Feedback   -> ${feedbackLog}`);
});
