import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@wtc/shared'],
  // Lets phones on the same Wi-Fi load the dev server by LAN IP.
  // Tunnel hosts too, in case someone tunnels the dev server instead of `pnpm playtest`.
  allowedDevOrigins: ['192.168.*.*', '10.*.*.*', '172.*.*.*', '*.local', '*.trycloudflare.com', '*.ngrok-free.app', '*.ngrok.io'],
};

export default config;
