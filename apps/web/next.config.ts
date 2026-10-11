import type { NextConfig } from 'next';

const isDev = process.env.NODE_ENV === 'development';

/** Where the page may open its game connection (see lib/socket.ts serverUrl()). */
function gameServerSources(): string[] {
  const out = ["'self'"];
  const env = process.env.NEXT_PUBLIC_SERVER_URL;
  if (env && env !== 'same-origin') {
    const u = new URL(env);
    out.push(u.origin, `${u.protocol === 'https:' ? 'wss' : 'ws'}://${u.host}`);
  }
  // Local and LAN playtests: page on :3000, game server on :3001 of the same machine.
  out.push('http://*:3001', 'ws://*:3001');
  return out;
}

/**
 * Content Security Policy: the page may only run its own scripts, load its own files and talk to
 * its own game server. Player text is always rendered as text (React escapes it; canvas draws
 * it), so this is a second line of defence. 'unsafe-inline' scripts are what Next.js needs
 * without nonces; 'wasm-unsafe-eval' is for the model decoder (meshoptimizer, WebAssembly).
 */
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'${isDev ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data:",
  "font-src 'self'",
  "media-src 'self' blob:",
  `connect-src ${gameServerSources().join(' ')} blob: data:${isDev ? ' ws: http:' : ''}`,
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

/**
 * The game server, as this web server reaches it (server to server, never the browser). The
 * admin API and replaced billboard images are forwarded there, so they share the page's origin:
 * one cookie scope, one CSP, and one path (/admin) for Cloudflare Access to guard.
 */
const GAME_SERVER = (process.env.GAME_SERVER_INTERNAL_URL ?? 'http://127.0.0.1:3001').replace(/\/+$/, '');

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ['@wtc/shared'],
  // Lets phones on the same Wi-Fi load the dev server by LAN IP.
  // Tunnel hosts too, in case someone tunnels the dev server instead of `pnpm playtest`.
  allowedDevOrigins: ['192.168.*.*', '10.*.*.*', '172.*.*.*', '*.local', '*.trycloudflare.com', '*.ngrok-free.app', '*.ngrok.io'],
  async rewrites() {
    return [
      { source: '/admin/api/:path*', destination: `${GAME_SERVER}/admin/api/:path*` },
      { source: '/billboards/:slot', destination: `${GAME_SERVER}/billboards/:slot` },
    ];
  },
  async headers() {
    return [
      // The admin dashboard: never indexed, never cached, never framed.
      {
        source: '/admin/:path*',
        headers: [
          { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
          { key: 'Cache-Control', value: 'no-store' },
        ],
      },
      {
        source: '/admin',
        headers: [
          { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
          { key: 'Cache-Control', value: 'no-store' },
        ],
      },
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: csp },
          // Browsers only accept this over HTTPS; it then keeps the site on HTTPS for a year.
          { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          // Room links (/r/CODE) are never sent to other sites (e.g. when a social link is opened).
          { key: 'Referrer-Policy', value: 'same-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()' },
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
        ],
      },
    ];
  },
};

export default config;
