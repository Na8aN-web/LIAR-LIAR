// Remote playtest launcher: builds the web app, starts the game server, the web app,
// the one-origin proxy, and a public tunnel, then prints the link to share.
//
//   pnpm playtest                 production web build + Cloudflare quick tunnel (ngrok fallback)
//   pnpm playtest -- --no-tunnel  everything local on http://localhost:8080 (for checking)
//   pnpm playtest -- --tunnel ngrok
//   pnpm playtest -- --strict     server in production mode: no bots, no skip button, 6+ players
//   pnpm playtest -- --skip-build reuse the last web build
import { spawn, spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startProxy } from './proxy.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const has = (flag) => process.argv.includes(`--${flag}`);
const argValue = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const PROXY_PORT = 8080;
const children = [];

function run(name, cmd, args, env = {}) {
  const child = spawn(cmd, args, { cwd: root, shell: true, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  const prefix = (chunk) =>
    chunk
      .toString()
      .split(/\r?\n/)
      .filter(Boolean)
      .forEach((l) => console.log(`[${name}] ${l}`));
  child.stdout.on('data', prefix);
  child.stderr.on('data', prefix);
  child.on('exit', (code) => code && console.log(`[${name}] exited with code ${code}`));
  children.push(child);
  return child;
}

function stopAll() {
  for (const c of children) {
    if (c.exitCode !== null) continue;
    // Windows: kill the whole process tree (pnpm -> node).
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(c.pid), '/T', '/F'], { stdio: 'ignore' });
    else c.kill('SIGTERM');
  }
}
process.on('SIGINT', () => {
  console.log('\nStopping…');
  stopAll();
  process.exit(0);
});

const onPath = (bin) => spawnSync(process.platform === 'win32' ? 'where' : 'which', [bin], { stdio: 'ignore' }).status === 0;

function banner(url) {
  const line = '='.repeat(Math.max(40, url.length + 8));
  console.log(`\n${line}\n  SHARE THIS LINK:  ${url}\n${line}\n`);
}

async function waitFor(url, label, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url);
      if (res.status < 500) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  console.log(`${label} did not come up at ${url}`);
  return false;
}

// 1. Build the web app (production: fast loads on phones, no dev overlay).
if (!has('skip-build')) {
  console.log('Building the web app (about a minute)…');
  const build = spawnSync('pnpm', ['--filter', '@wtc/web', 'build'], { cwd: root, shell: true, stdio: 'inherit' });
  if (build.status !== 0) process.exit(build.status ?? 1);
}

// 2. Game server, web app, proxy.
run('server', 'pnpm', ['--filter', '@wtc/server', 'exec', 'tsx', 'src/index.ts'], has('strict') ? { NODE_ENV: 'production' } : {});
run('web', 'pnpm', ['--filter', '@wtc/web', 'start']);
await startProxy({ port: PROXY_PORT });
await waitFor('http://localhost:3001/health', 'Game server');
await waitFor(`http://localhost:${PROXY_PORT}/`, 'Web app');
console.log(`Local check: http://localhost:${PROXY_PORT}`);

// 3. Tunnel.
const wanted = has('no-tunnel') ? 'none' : argValue('tunnel') ?? (onPath('cloudflared') ? 'cloudflared' : onPath('ngrok') ? 'ngrok' : 'missing');

if (wanted === 'none') {
  banner(`http://localhost:${PROXY_PORT}`);
} else if (wanted === 'cloudflared') {
  const tunnel = run('tunnel', 'cloudflared', ['tunnel', '--no-autoupdate', '--url', `http://localhost:${PROXY_PORT}`]);
  let shown = false;
  const scan = (chunk) => {
    const m = chunk.toString().match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (m && !shown) {
      shown = true;
      banner(m[0]);
    }
  };
  tunnel.stdout.on('data', scan);
  tunnel.stderr.on('data', scan);
} else if (wanted === 'ngrok') {
  run('tunnel', 'ngrok', ['http', String(PROXY_PORT), '--log', 'stdout']);
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    try {
      const res = await fetch('http://127.0.0.1:4040/api/tunnels');
      const url = (await res.json()).tunnels?.find((t) => t.public_url?.startsWith('https'))?.public_url;
      if (url) {
        banner(url);
        break;
      }
    } catch {}
  }
} else {
  console.log('\nNo tunnel tool found. Install Cloudflare Tunnel (see PLAYTEST.md):');
  console.log('  winget install --id Cloudflare.cloudflared');
  console.log(`The game is running locally at http://localhost:${PROXY_PORT}`);
}
console.log('Press Ctrl+C to stop everything.');
