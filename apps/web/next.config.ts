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

/** Where browser error reports go (Sentry), if a DSN was set at build time. */
function errorReportSources(): string[] {
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (!dsn) return [];
  try {
    return [new URL(dsn).origin];
  } catch {
    return [];
  }
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
  `connect-src ${[...gameServerSources(), ...errorReportSources()].join(' ')} blob: data:${isDev ? ' ws: http:' : ''}`,
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

/**
 * Game portals (/play/<portal>/...: see packages/shared/src/portal.ts) show the game in their own
 * page, in a frame, and load their SDK, which serves ads from many ad networks. Their pages get
 * their own headers: framed only by that portal, scripts and connections allowed from https
 * (the SDK and its ads), and nothing else changes for the website's pages.
 */
const PORTAL_FRAME_ANCESTORS: Record<string, string[]> = {
  // CrazyGames runs the game on several crazygames.com origins (docs: Requirements > Technical,
  // "Sitelock"). Their app origins aren't documented: add any found in testing with
  // CRAZYGAMES_FRAME_ANCESTORS (space-separated) at build time.
  crazygames: ['https://crazygames.com', 'https://*.crazygames.com', ...(process.env.CRAZYGAMES_FRAME_ANCESTORS ?? '').split(/\s+/).filter(Boolean)],
};

function portalCsp(ancestors: string[]): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https:${isDev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline' https:",
    "img-src 'self' blob: data: https:",
    "font-src 'self' data: https:",
    "media-src 'self' blob: https:",
    `connect-src ${gameServerSources().join(' ')} https: wss: blob: data:${isDev ? ' ws: http:' : ''}`,
    'frame-src https:',
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    `frame-ancestors 'self' ${ancestors.join(' ')}`,
  ].join('; ');
}

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
      // Everything except the portals' pages (/play/...): the website, exactly as before.
      {
        source: '/:path((?!play(?:/|$)).*)',
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
      // Each portal's pages: framed by that portal only. No X-Frame-Options (it can't name a site),
      // no opener isolation (the SDK's login popups), and a referrer the portal's SDK can read.
      ...Object.entries(PORTAL_FRAME_ANCESTORS).flatMap(([id, ancestors]) =>
        [`/play/${id}`, `/play/${id}/:path*`].map((source) => ({
          source,
          headers: [
            { key: 'Content-Security-Policy', value: portalCsp(ancestors) },
            { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
            { key: 'X-Content-Type-Options', value: 'nosniff' },
            { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
            { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()' },
          ],
        })),
      ),
    ];
  },
};

export default config;
