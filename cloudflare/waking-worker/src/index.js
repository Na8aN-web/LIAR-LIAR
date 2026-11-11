// Cloudflare Worker in front of wantedtruecolors.com (see cloudflare/waking-worker/README.md).
//
// Render's free tier puts the game to sleep after 15 quiet minutes; the first visitor then waits
// about a minute. This Worker:
//   - passes every request straight through to Render (pages, files, Socket.io WebSockets),
//   - when a page is requested while the server is asleep or slow, answers at once with a
//     "waking up" page in the game's style, which polls /healthz and loads the game when it's up.
// Only page loads ever see the waking page; files, WebSockets and the admin API pass untouched.

/** How long a page load may wait for the server before the waking page is shown. */
const PAGE_TIMEOUT_MS = 6000;
/** How long the health check may take before the server counts as asleep. */
const HEALTH_TIMEOUT_MS = 2500;
/** A /healthz poll from the waking page gives up after this (the page polls again). */
const POLL_TIMEOUT_MS = 8000;
/** After a good health check, skip checking again for this long (the server can't fall asleep that fast). */
const AWAKE_GRACE_MS = 2 * 60 * 1000;

// Per isolate (each Cloudflare data center has its own); only ever skips a check.
let awakeUntil = 0;

class Timeout extends Error {}

/** fetch() that gives up after `ms`. The request itself carries on in the background (it's what wakes Render). */
function fetchWithin(input, ms, ctx) {
  const pending = fetch(input);
  ctx.waitUntil(pending.then(() => {}, () => {}));
  return Promise.race([pending, new Promise((_, reject) => setTimeout(() => reject(new Timeout()), ms))]);
}

/** The server is up when its own health check answers exactly "ok" (Render's loading page never does). */
async function isAwake(url, ms, ctx) {
  try {
    const res = await fetchWithin(new Request(new URL('/healthz', url), { headers: { 'cache-control': 'no-store' } }), ms, ctx);
    const ok = res.status === 200 && (await res.text()).trim() === 'ok';
    if (ok) awakeUntil = Date.now() + AWAKE_GRACE_MS;
    return ok;
  } catch {
    return false;
  }
}

/** A browser loading a page (a tab, or a portal's frame), not a file, an API call or a WebSocket. */
function isPageLoad(request) {
  if (request.method !== 'GET' || request.headers.get('upgrade')) return false;
  const dest = request.headers.get('sec-fetch-dest');
  if (dest) return dest === 'document' || dest === 'iframe';
  return (request.headers.get('accept') || '').includes('text/html');
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // The waking page's poll: an answer within a few seconds, whatever Render is doing.
    if (url.pathname === '/healthz' && request.method === 'GET') {
      try {
        const res = await fetchWithin(request, POLL_TIMEOUT_MS, ctx);
        if (res.status === 200) awakeUntil = Date.now() + AWAKE_GRACE_MS;
        return res;
      } catch {
        return new Response('waking', { status: 503, headers: { 'content-type': 'text/plain', 'cache-control': 'no-store', 'retry-after': '5' } });
      }
    }

    // Everything that isn't a page load: straight through (WebSocket upgrades included).
    if (!isPageLoad(request)) return fetch(request);

    if (Date.now() > awakeUntil && !(await isAwake(url, HEALTH_TIMEOUT_MS, ctx))) return wakingPage(url);
    try {
      const res = await fetchWithin(request, PAGE_TIMEOUT_MS, ctx);
      // Restarting or deploying: show the waking page rather than an error.
      if (res.status === 502 || res.status === 503 || res.status === 504) return wakingPage(url);
      return res;
    } catch {
      return wakingPage(url);
    }
  },
};

function wakingPage(url) {
  // The CrazyGames page runs inside their frame; every other page refuses frames, as the site does.
  const ancestors = url.pathname.startsWith('/play/crazygames') ? "'self' https://crazygames.com https://*.crazygames.com" : "'none'";
  return new Response(WAKING_HTML, {
    status: 503,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'retry-after': '30',
      'x-robots-tag': 'noindex',
      'content-security-policy': `default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; frame-ancestors ${ancestors}`,
      'referrer-policy': 'same-origin',
    },
  });
}

const WAKING_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Waking up the town · Wanted: True Colors</title>
<meta name="robots" content="noindex">
<style>
  :root { --night: #0b0806; --brass: #f1d78f; --cream: #f3e6c4; --cream-soft: #cdb994; --oxblood: #8c2a22; --fire: #ff9a48; }
  * { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; overflow: hidden; }
  body {
    display: flex; align-items: center; justify-content: center; padding: 16px;
    background: radial-gradient(ellipse at 50% 115%, #4a2a14 0%, #160e09 42%, #070504 100%);
    color: var(--cream); font-family: Georgia, 'Times New Roman', serif; text-align: center;
  }
  main { width: min(440px, 100%); display: flex; flex-direction: column; align-items: center; gap: 14px; }
  .kicker { font-size: 0.72rem; letter-spacing: 0.35em; text-transform: uppercase; color: var(--cream-soft); }
  h1 { margin: 0; line-height: 1; font-weight: 700; color: var(--brass); font-size: clamp(2.2rem, 9vw, 3.4rem);
       text-shadow: 0 2px 0 #3a2208, 0 4px 22px rgba(240, 170, 70, 0.3); font-variant: small-caps; letter-spacing: 0.02em; }
  h1 span { display: block; color: var(--cream); font-size: 0.62em; letter-spacing: 0.14em; margin-top: 4px; }
  .fire { position: relative; width: 120px; height: 110px; margin: 6px 0 2px; }
  .glow { position: absolute; left: 50%; bottom: -20px; width: 260px; height: 140px; transform: translateX(-50%);
          background: radial-gradient(ellipse at 50% 70%, rgba(255, 154, 72, 0.35), rgba(255, 154, 72, 0) 65%); animation: breathe 2.4s ease-in-out infinite; }
  .flame { position: absolute; left: 50%; bottom: 18px; border-radius: 50% 50% 45% 45% / 60% 60% 40% 40%; transform-origin: 50% 100%;
           background: radial-gradient(ellipse at 50% 80%, #fff3c4 0%, #ffd27a 30%, #ff9a48 60%, rgba(255, 90, 30, 0) 100%); filter: blur(0.5px); }
  .f1 { width: 46px; height: 74px; margin-left: -23px; animation: flicker 0.9s ease-in-out infinite alternate; }
  .f2 { width: 30px; height: 48px; margin-left: -34px; animation: flicker 0.7s ease-in-out infinite alternate-reverse; opacity: 0.85; }
  .f3 { width: 28px; height: 44px; margin-left: 4px; animation: flicker 0.8s 0.2s ease-in-out infinite alternate; opacity: 0.85; }
  .logs { position: absolute; left: 50%; bottom: 8px; width: 92px; height: 16px; transform: translateX(-50%); }
  .logs::before, .logs::after { content: ''; position: absolute; left: 6px; right: 6px; top: 4px; height: 10px; border-radius: 5px; background: #3a2414; }
  .logs::before { transform: rotate(12deg); } .logs::after { transform: rotate(-12deg); }
  .ember { position: absolute; left: 50%; bottom: 40px; width: 3px; height: 3px; border-radius: 50%; background: #ffb060; opacity: 0; animation: rise 3s linear infinite; }
  .e2 { margin-left: -14px; animation-delay: 0.7s; } .e3 { margin-left: 12px; animation-delay: 1.4s; } .e4 { margin-left: -4px; animation-delay: 2.1s; }
  .telegram { width: 100%; padding: 14px 16px; background: #efe0bb; color: #2b2016; border-radius: 3px; text-align: left;
              box-shadow: 0 10px 30px rgba(0, 0, 0, 0.6); font-family: 'Courier New', Courier, monospace; font-size: 0.92rem; line-height: 1.45; }
  .telegram b { display: block; font-size: 0.7rem; letter-spacing: 0.3em; color: var(--oxblood); margin-bottom: 4px; }
  .bar { width: 100%; height: 6px; border-radius: 3px; background: rgba(243, 230, 196, 0.15); overflow: hidden; }
  .bar i { display: block; height: 100%; width: 0; background: linear-gradient(90deg, var(--oxblood), var(--brass)); transition: width 0.9s linear; }
  .status { min-height: 1.4em; font-size: 0.85rem; color: var(--cream-soft); }
  button { font: inherit; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: #1a1006; background: var(--brass);
           border: 0; border-radius: 3px; padding: 10px 18px; cursor: pointer; }
  [hidden] { display: none !important; }
  @keyframes flicker { from { transform: scaleY(0.92) skewX(-2deg); } to { transform: scaleY(1.08) skewX(2deg); } }
  @keyframes breathe { 50% { opacity: 0.75; } }
  @keyframes rise { 0% { opacity: 0; transform: translateY(0); } 15% { opacity: 1; } 100% { opacity: 0; transform: translateY(-90px) translateX(10px); } }
  @media (prefers-reduced-motion: reduce) { .flame, .glow, .ember { animation: none; } .ember { display: none; } }
  @media (max-height: 520px) { .fire { width: 90px; height: 80px; } main { gap: 8px; } h1 { font-size: 2rem; } }
</style>
</head>
<body>
<main>
  <div class="kicker">Wanted</div>
  <h1>True Colors<span>Everyone lies</span></h1>
  <div class="fire" aria-hidden="true">
    <div class="glow"></div><div class="logs"></div>
    <div class="flame f2"></div><div class="flame f3"></div><div class="flame f1"></div>
    <div class="ember"></div><div class="ember e2"></div><div class="ember e3"></div><div class="ember e4"></div>
  </div>
  <div class="telegram" role="status" aria-live="polite">
    <b>TELEGRAM</b>
    <span id="msg">The town was asleep. Lighting the campfire now&nbsp;&mdash; it takes about a minute. The game loads by itself.</span>
  </div>
  <div class="bar" aria-hidden="true"><i id="bar"></i></div>
  <div class="status" id="status">Waking up&hellip;</div>
  <button id="retry" hidden>Try again</button>
</main>
<script>
(function () {
  var started = Date.now();
  var EXPECTED = 60000, SLOW = 150000;
  var bar = document.getElementById('bar');
  var status = document.getElementById('status');
  var msg = document.getElementById('msg');
  var retry = document.getElementById('retry');
  var done = false;
  retry.onclick = function () { location.reload(); };

  function tick() {
    if (done) return;
    var t = Date.now() - started;
    // Fills to about 90% over the expected minute, then creeps: never claims to be done early.
    var p = t < EXPECTED ? 0.9 * t / EXPECTED : 0.9 + 0.09 * (1 - Math.exp(-(t - EXPECTED) / 60000));
    bar.style.width = (p * 100).toFixed(1) + '%';
    var s = Math.round(t / 1000);
    status.textContent = s < 5 ? 'Waking up\\u2026' : 'Waking up\\u2026 ' + s + 's';
    if (t > SLOW && retry.hidden) {
      msg.textContent = 'Taking longer than usual. It keeps trying by itself; you can also reload.';
      retry.hidden = false;
    }
  }

  function poll() {
    if (done) return;
    var ctl = window.AbortController ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctl) ctl.abort(); }, 9000);
    fetch('/healthz', { cache: 'no-store', signal: ctl ? ctl.signal : undefined })
      .then(function (r) { return r.ok ? r.text() : ''; })
      .then(function (text) {
        clearTimeout(timer);
        if (text.trim() === 'ok') {
          done = true;
          bar.style.width = '100%';
          status.textContent = 'Ready. Riding in\\u2026';
          location.reload();
        } else setTimeout(poll, 3000);
      })
      .catch(function () { clearTimeout(timer); setTimeout(poll, 3000); });
  }

  tick();
  setInterval(tick, 1000);
  poll();
})();
</script>
</body>
</html>`;
