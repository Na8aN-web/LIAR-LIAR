// Remote playtest launcher. Production build and production game server, one local origin
// (proxy), and a public Cloudflare tunnel. Prints the link to share and a QR code for phones,
// and restarts anything that crashes.
//
//   pnpm playtest                    build, start everything, open the tunnel
//   pnpm playtest -- --skip-build    reuse the last web build (faster restarts)
//   pnpm playtest -- --no-tunnel     everything local on http://localhost:8080 (for checking)
//   pnpm playtest -- --tunnel ngrok  use ngrok instead of Cloudflare
//
// What it sets up, and why:
//   - NODE_ENV=production, no --dev: no bots (except practice games), no "dev: skip", /dev pages 404.
//   - TRUST_PROXY=1: every player arrives through Cloudflare, so rate limits read each player's
//     real IP from Cloudflare's header instead of seeing one IP for everyone.
//   - The tunnel's https URL is written to an allowed-origins file the server re-reads, so a new
//     URL (every tunnel restart) is allowed without restarting the server or losing games.
//   - Server output, including errors, is also saved to apps/server/logs/playtest-<date>.log.
import { spawn, spawnSync } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import QRCode from 'qrcode';
import { startProxy } from './proxy.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const has = (flag) => process.argv.includes(`--${flag}`);
const argValue = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const PROXY_PORT = 8080;
const ORIGINS_FILE = join(tmpdir(), 'wtc-playtest-origins.txt');
const LOG_DIR = join(root, 'apps/server/logs');
mkdirSync(LOG_DIR, { recursive: true });
const logFile = createWriteStream(join(LOG_DIR, `playtest-${new Date().toISOString().slice(0, 10)}.log`), { flags: 'a' });
let stopping = false;
let currentUrl = null;

const stamp = () => new Date().toTimeString().slice(0, 8);
const say = (line) => {
  console.log(line);
  logFile.write(`${stamp()} ${line}\n`);
};

// ---------------------------------------------------------------- supervised processes
const procs = new Map();

/** Runs a process and restarts it (after a short pause) if it exits while we're not stopping. */
// Started directly (no pnpm or shell in between), so stopping one really stops it.
function supervise(name, cmd, args, { cwd = root, env = {}, onLine, onRestart } = {}) {
  let restarts = 0;
  const start = () => {
    const child = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    procs.set(name, child);
    const lines = (chunk) =>
      chunk
        .toString()
        .split(/\r?\n/)
        .filter(Boolean)
        .forEach((l) => {
          logFile.write(`${stamp()} [${name}] ${l}\n`);
          if (!onLine?.(l)) console.log(`[${name}] ${l}`);
        });
    child.stdout.on('data', lines);
    child.stderr.on('data', lines);
    child.on('exit', (code) => {
      if (stopping) return;
      restarts++;
      const wait = Math.min(15, 2 * restarts);
      const what = { web: 'The web app', server: 'The game server', tunnel: 'The tunnel' }[name] ?? name;
      say(`\n!! ${stamp()} ${what} ${code === 0 ? 'stopped' : 'crashed'}. Restarting it in ${wait}s (restart #${restarts})…`);
      setTimeout(() => {
        if (stopping) return;
        onRestart?.();
        start();
      }, wait * 1000);
    });
  };
  start();
}

function stopAll() {
  stopping = true;
  for (const c of procs.values()) {
    if (c.exitCode !== null) continue;
    // Windows: kill the whole process tree (pnpm -> node).
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(c.pid), '/T', '/F'], { stdio: 'ignore' });
    else c.kill('SIGTERM');
  }
}
process.on('SIGINT', () => {
  say('\nStopping…');
  stopAll();
  logFile.end();
  process.exit(0);
});

async function waitFor(url, label, tries = 90) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url);
      if (res.status < 500) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  say(`${label} did not come up at ${url}`);
  return false;
}

async function banner(url, note = '') {
  const line = '='.repeat(Math.max(56, url.length + 22));
  const qr = await QRCode.toString(url, { type: 'terminal', small: true }).catch(() => '');
  say(`\n${line}\n  SHARE THIS LINK:   ${url}\n${note ? `  ${note}\n` : ''}${line}`);
  console.log(qr);
  console.log('  Phones: point the camera at the QR code above.');
  console.log(`  Stats and feedback are saved in apps/server/logs/. Press Ctrl+C to stop everything.\n`);
}

/** Allows exactly the current tunnel URL (plus localhost, always) to connect. */
function allowOrigin(url) {
  writeFileSync(ORIGINS_FILE, url ? `${url}\n` : '');
}

/** Checks the public link really reaches the game, from the internet side. */
async function checkPublic(url) {
  for (let i = 0; i < 40; i++) {
    if (stopping || url !== currentUrl) return;
    try {
      const page = await fetch(url, { signal: AbortSignal.timeout(8000) });
      const sock = await fetch(`${url}/socket.io/?EIO=4&transport=polling`, { headers: { origin: url }, signal: AbortSignal.timeout(8000) });
      if (page.ok && sock.ok) return say(`  ✓ ${stamp()} The link works from the internet. Send it!`);
    } catch {}
    await new Promise((r) => setTimeout(r, 3000));
  }
  say('  ✗ The link is not answering yet. Try opening it on your phone; if it fails, press Ctrl+C and run pnpm playtest again.');
}

/** True if something is already listening on this port. */
const portBusy = (port) =>
  new Promise((resolve) => {
    const probe = net.connect(port, '127.0.0.1');
    probe.once('connect', () => (probe.destroy(), resolve(true)));
    probe.once('error', () => resolve(false));
  });

// ---------------------------------------------------------------- 0. ports free?
const busy = [];
for (const port of [3000, 3001, PROXY_PORT]) if (await portBusy(port)) busy.push(port);
if (busy.length) {
  say(`Port${busy.length > 1 ? 's' : ''} ${busy.join(', ')} already in use: probably a pnpm dev or an earlier playtest still running.`);
  say('Close that window (or press Ctrl+C in it), then run pnpm playtest again. Restarting the PC also works.');
  process.exit(1);
}

// ---------------------------------------------------------------- 1. web build
if (!has('skip-build')) {
  say('Building the web app (about a minute)…');
  const build = spawnSync('pnpm', ['--filter', '@wtc/web', 'build'], { cwd: root, shell: true, stdio: 'inherit' });
  if (build.status !== 0) process.exit(build.status ?? 1);
}

// ---------------------------------------------------------------- 2. game server, web app, proxy
allowOrigin(null);
supervise('server', process.execPath, ['--import', 'tsx', 'src/index.ts'], {
  cwd: join(root, 'apps/server'),
  env: { NODE_ENV: 'production', TRUST_PROXY: '1', ALLOWED_ORIGINS_FILE: ORIGINS_FILE },
  onRestart: () => say('   Games in progress were lost; players open the same link and start a new game.'),
});
supervise('web', process.execPath, ['node_modules/next/dist/bin/next', 'start', '-p', '3000'], { cwd: join(root, 'apps/web'), env: { NODE_ENV: 'production' } });
await startProxy({ port: PROXY_PORT });
await waitFor('http://localhost:3001/health', 'Game server');
await waitFor(`http://localhost:${PROXY_PORT}/`, 'Web app');
say(`Local check: http://localhost:${PROXY_PORT}`);

// ---------------------------------------------------------------- 3. tunnel
const onPath = (bin) => spawnSync(process.platform === 'win32' ? 'where' : 'which', [bin], { stdio: 'ignore' }).status === 0;
// winget installs cloudflared here; a terminal opened before the install won't have it on PATH yet.
const cloudflaredExe = onPath('cloudflared')
  ? 'cloudflared'
  : ['C:\\Program Files (x86)\\cloudflared\\cloudflared.exe', 'C:\\Program Files\\cloudflared\\cloudflared.exe'].find((p) => existsSync(p));
const wanted = has('no-tunnel') ? 'none' : argValue('tunnel') ?? (cloudflaredExe ? 'cloudflared' : onPath('ngrok') ? 'ngrok' : 'missing');

if (wanted === 'none') {
  await banner(`http://localhost:${PROXY_PORT}`, 'Local only (--no-tunnel): friends elsewhere can’t reach this.');
} else if (wanted === 'cloudflared') {
  supervise('tunnel', cloudflaredExe, ['tunnel', '--no-autoupdate', '--url', `http://localhost:${PROXY_PORT}`], {
    onLine: (l) => {
      const m = l.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      if (m && m[0] !== currentUrl) {
        const first = !currentUrl;
        currentUrl = m[0];
        allowOrigin(currentUrl);
        void banner(currentUrl, first ? '' : 'NEW LINK: the tunnel restarted. Send this one to everyone (the old link no longer works).').then(() => checkPublic(currentUrl));
      }
      // cloudflared is chatty; only show its errors.
      return !/ERR|error|failed/i.test(l);
    },
    onRestart: () => say('   Getting a new tunnel link…'),
  });
} else if (wanted === 'ngrok') {
  supervise('tunnel', 'ngrok', ['http', String(PROXY_PORT), '--log', 'stdout'], { onLine: () => true });
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    try {
      const res = await fetch('http://127.0.0.1:4040/api/tunnels');
      const url = (await res.json()).tunnels?.find((t) => t.public_url?.startsWith('https'))?.public_url;
      if (url) {
        currentUrl = url;
        allowOrigin(url);
        await banner(url);
        void checkPublic(url);
        break;
      }
    } catch {}
  }
} else {
  say('\nNo tunnel tool found. Install Cloudflare Tunnel (see PLAYTEST.md):');
  say('  winget install --id Cloudflare.cloudflared');
  say(`The game is running locally at http://localhost:${PROXY_PORT}`);
}
