// One local origin for the whole game, so a single tunnel URL works:
//   /socket.io/*  -> game server (HTTP + WebSocket upgrade)
//   everything    -> Next.js web app (HTTP + WebSocket upgrade, e.g. dev hot reload)
// Usage: node tools/proxy.mjs [--port 8080] [--web 3000] [--server 3001]
import http from 'node:http';
import net from 'node:net';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return Number(i >= 0 ? process.argv[i + 1] : fallback);
}

export function startProxy({ port = 8080, webPort = 3000, serverPort = 3001 } = {}) {
  const targetFor = (url = '') => (url.startsWith('/socket.io') ? serverPort : webPort);

  const proxy = http.createServer((req, res) => {
    const upstream = http.request(
      { host: '127.0.0.1', port: targetFor(req.url), method: req.method, path: req.url, headers: req.headers },
      (up) => {
        res.writeHead(up.statusCode ?? 502, up.headers);
        up.pipe(res);
      },
    );
    upstream.on('error', () => {
      if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain' });
      res.end('Game is starting up or not running. Try again in a moment.');
    });
    req.pipe(upstream);
  });

  // WebSockets: replay the upgrade request to the target and splice the sockets together.
  proxy.on('upgrade', (req, socket, head) => {
    const upstream = net.connect(targetFor(req.url), '127.0.0.1', () => {
      const lines = [`${req.method} ${req.url} HTTP/${req.httpVersion}`];
      for (let i = 0; i < req.rawHeaders.length; i += 2) lines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`);
      upstream.write(lines.join('\r\n') + '\r\n\r\n');
      if (head?.length) upstream.write(head);
      upstream.pipe(socket);
      socket.pipe(upstream);
    });
    const close = () => {
      socket.destroy();
      upstream.destroy();
    };
    upstream.on('error', close);
    socket.on('error', close);
  });

  return new Promise((resolve) => proxy.listen(port, () => resolve(proxy)));
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}` || process.argv[1]?.endsWith('proxy.mjs')) {
  const port = arg('port', 8080);
  startProxy({ port, webPort: arg('web', 3000), serverPort: arg('server', 3001) }).then(() =>
    console.log(`Proxy on http://localhost:${port}  (/socket.io -> :${arg('server', 3001)}, rest -> :${arg('web', 3000)})`),
  );
}
