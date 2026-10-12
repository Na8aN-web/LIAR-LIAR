// Production entry point (Railway, Docker): the whole game on one public port.
//
//   game server   127.0.0.1:3001   (Socket.io + /health + admin API)
//   web app       127.0.0.1:3000   (Next.js)
//   proxy         0.0.0.0:$PORT    /socket.io -> game server, everything else -> web app
//
// One origin for everything, the same layout `pnpm playtest` uses, so the browser never needs
// cross-site settings. If either app exits, this exits too and the host restarts the container.
// Expects the apps already built (Dockerfile). Usage: node tools/start-prod.mjs

import { spawn } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startProxy } from './proxy.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT ?? 8080);
const SERVER_PORT = 3001;
const WEB_PORT = 3000;

const children = [];
let stopping = false;

function run(name, cmd, args, opts) {
  const p = spawn(cmd, args, { stdio: 'inherit', ...opts, env: { ...process.env, ...opts.env, NODE_ENV: 'production' } });
  children.push(p);
  p.on('exit', (code, signal) => {
    if (stopping) return;
    console.error(`[start] ${name} exited (${signal ?? code}). Stopping so the container restarts.`);
    shutdown(1);
  });
  return p;
}

function shutdown(code) {
  stopping = true;
  for (const c of children) c.kill('SIGTERM');
  setTimeout(() => process.exit(code), 5000).unref();
  Promise.all(children.map((c) => new Promise((r) => (c.exitCode !== null ? r() : c.once('exit', r))))).then(() => process.exit(code));
}
process.on('SIGTERM', () => shutdown(0));
process.on('SIGINT', () => shutdown(0));

// The game server reads PORT; give it its own, not the public one.
run('game server', process.execPath, ['dist/index.js'], {
  cwd: join(root, 'apps/server'),
  env: { PORT: String(SERVER_PORT), TRUST_PROXY: process.env.TRUST_PROXY ?? '1' },
});
run('web app', process.execPath, ['node_modules/next/dist/bin/next', 'start', '-p', String(WEB_PORT), '-H', '127.0.0.1'], {
  cwd: join(root, 'apps/web'),
  env: { PORT: String(WEB_PORT), GAME_SERVER_INTERNAL_URL: `http://127.0.0.1:${SERVER_PORT}` },
});

await startProxy({ port: PORT, webPort: WEB_PORT, serverPort: SERVER_PORT, host: '0.0.0.0', health: true });
console.log(`[start] Wanted: True Colors on port ${PORT}`);
