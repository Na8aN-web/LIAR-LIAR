import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { MIN_PLAYERS } from '@wtc/shared';
import { createGameServer } from './server';
import { createStore } from './store';
import { isPasswordHash } from './admin/crypto';
import { Monitor } from './admin/monitor';
import { initErrorReporting } from './errors';
import { timeoutsFromEnv } from './timeouts';

// Local secrets (the admin login from `pnpm admin:setup`) live in apps/server/.env.local, which
// git ignores. On a real host, set the same variables in its environment instead.
if (existsSync('.env.local')) process.loadEnvFile('.env.local');
initErrorReporting();

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

// Admin dashboard (/admin): password hash + authenticator secret from `pnpm admin:setup`.
// Without both, the admin API refuses everything.
const passwordHash = process.env.ADMIN_PASSWORD_HASH ?? '';
const totpSecret = process.env.ADMIN_TOTP_SECRET ?? '';
const adminReady = isPasswordHash(passwordHash) && /^[A-Z2-7]{16,}$/.test(totpSecret);
if ((passwordHash || totpSecret) && !adminReady) console.warn('Admin login is misconfigured (run pnpm admin:setup again): the admin dashboard stays locked.');
// Optional: Cloudflare Access in front of /admin (see SECURITY.md).
const access = process.env.CF_ACCESS_TEAM_DOMAIN && process.env.CF_ACCESS_AUD ? { teamDomain: process.env.CF_ACCESS_TEAM_DOMAIN, aud: process.env.CF_ACCESS_AUD } : null;

const monitor = new Monitor();
monitor.captureConsole();

// Analytics, feedback, the admin log: files in DATA_DIR (default logs/) or Postgres
// (ANALYTICS_STORE=postgres). Never inside the web app's public folder; this server serves
// none of it as files.
const store = await createStore();

const timeouts = timeoutsFromEnv();
const min = (ms: number) => `${+(ms / 60_000).toFixed(2)} min`;
console.log(
  `Idle limits: lobby warns after ${min(timeouts.lobbyIdleMs)} idle, closes ${min(timeouts.lobbyIdleGraceMs)} later; ` +
    `lobby max ${min(timeouts.lobbyMaxMs)}; AFK host ${min(timeouts.hostAfkMs)}; players away after ${timeouts.awayAfterPosters} idle posters, ` +
    `removed after ${timeouts.removeAfterPosters}; games close past ${timeouts.gameOvertimeFactor}× their length + ${min(timeouts.gameOvertimeExtraMs)}; ` +
    `empty rooms after ${min(timeouts.emptyRoomMs)}`,
);
const server = createGameServer({
  port,
  timeouts,
  devMode,
  minPlayers,
  corsOrigin: devMode && !fixedOrigins.length && !originsFile ? true : allowedOrigins,
  trustProxy,
  store,
  monitor,
  admin: { credentials: adminReady ? { passwordHash, totpSecret } : null, access },
  onGameEnd: (summary) => {
    store.addGame(summary).catch((e) => console.error('could not save game stats', e instanceof Error ? e.message : 'unknown'));
    console.log(`Game finished: ${summary.players} players, ${summary.posters.length} posters. Stats saved.`);
  },
  onFeedback: (entry) => {
    store.addFeedback(entry).catch((e) => console.error('could not save feedback', e instanceof Error ? e.message : 'unknown'));
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
  console.log(`Data: ${store.kind === 'file' ? resolve(process.env.DATA_DIR ?? 'logs') : 'Postgres'}`);
  console.log(`Admin dashboard: ${adminReady ? `/admin (password + authenticator code${access ? ', behind Cloudflare Access' : ''})` : 'locked (run pnpm admin:setup)'}`);
});
