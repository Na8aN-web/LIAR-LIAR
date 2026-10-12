// Renders a trailer script to video, frame by frame, at a fixed resolution and frame rate.
//
//   pnpm trailer:render main                         16:9 1080p (or the script's own format)
//   pnpm trailer:render vertical --res 4k            2160×3840
//   pnpm trailer:render main --format 9:16 --res 4k --from 0 --to 10
//   pnpm trailer:render main --layers --alpha --png
//
// Options:
//   --format 16:9 | 9:16       frame shape (default: the script's "format", else 16:9)
//   --res 1080p | 4k | WxH     output size (default 1080p)
//   --from S --to S            render only part of the trailer (seconds)
//   --layers                   also render the scene alone, and the overlays alone on transparent
//   --alpha                    with --layers: the overlays also as a ProRes 4444 .mov (with alpha)
//   --png                      keep a PNG of every frame (full picture; overlays always get PNGs with --layers)
//   --crf N                    H.264 quality (default 12; lower is better and bigger)
//   --workers N                browsers rendering in parallel (default 3)
//   --stills 1.5,8,12.25       just PNG stills at these times (seconds), for thumbnails and checking shots
//   --url URL                  a running dev server (default http://localhost:3000; one is started if none answers)
//   --out DIR                  where files go (default out/trailers)
//   --progress                 machine-readable progress lines (used by the studio's Record button)
//
// How: opens /dev/trailer/studio?render=1 in headless Edge/Chrome with the real GPU, at exactly
// the output size, and asks the page for one frame at a time (the page advances the scene clock by
// exactly 1/fps), so the result is smooth however slow the machine is. Frames go straight into
// ffmpeg. Several browsers each take a chunk of the frames; the chunks are joined without
// re-encoding. The soundtrack is synthesized offline in the page and mixed in at the end, once
// with the music and once without.

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const require = createRequire(import.meta.url);
const ffmpeg = require('ffmpeg-static');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// ---------------------------------------------------------------- arguments
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const opt = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : def;
};
const VALUED = new Set(['--format', '--res', '--from', '--to', '--crf', '--url', '--out', '--workers', '--stills']);
const name = argv.find((a, i) => !a.startsWith('--') && !VALUED.has(argv[i - 1]));
if (!name) {
  console.error('Usage: pnpm trailer:render <script> [--format 16:9|9:16] [--res 1080p|4k|WxH] [--from s] [--to s] [--layers] [--alpha] [--png] [--workers n]');
  process.exit(1);
}
const progressMode = flag('progress');
const say = (msg) => console.log(msg);
const progress = (o) => progressMode && console.log(`PROGRESS ${JSON.stringify(o)}`);

const scriptFile = join(root, 'trailers', `${name}.json`);
if (!existsSync(scriptFile)) {
  console.error(`No trailers/${name}.json`);
  process.exit(1);
}
const script = JSON.parse(readFileSync(scriptFile, 'utf8'));
const format = (opt('format') ?? script.format ?? '16:9').replace('x', ':');
const resArg = (opt('res') ?? '1080p').toLowerCase();
const size = (() => {
  const m = /^(\d+)x(\d+)$/.exec(resArg);
  if (m) return { W: +m[1], H: +m[2] };
  const [long, short] = resArg === '4k' ? [3840, 2160] : [1920, 1080];
  return format === '9:16' ? { W: short, H: long } : { W: long, H: short };
})();
const res = `${size.W}x${size.H}`;
const crf = opt('crf', '12');
const outDir = resolve(root, opt('out', 'out/trailers'));
mkdirSync(outDir, { recursive: true });
const tag = `${name}-${format.replace(':', 'x')}-${res}`;

// ---------------------------------------------------------------- dev server
let base = opt('url', 'http://localhost:3000').replace(/\/+$/, '');
let devServer = null;
async function answers(url) {
  try {
    const r = await fetch(`${url}/dev/trailer/api/scripts`, { signal: AbortSignal.timeout(4000) });
    return r.ok;
  } catch {
    return false;
  }
}
if (!(await answers(base))) {
  say('No dev server answering; starting one (pnpm --filter @wtc/web dev)…');
  devServer = spawn('pnpm', ['--filter', '@wtc/web', 'dev'], { cwd: root, shell: true, stdio: 'ignore' });
  base = 'http://localhost:3000';
  for (let i = 0; i < 120 && !(await answers(base)); i++) await new Promise((r) => setTimeout(r, 1000));
  if (!(await answers(base))) throw new Error('The dev server did not start.');
  // First visit compiles the studio page (slow on a cold server); do it before the browsers come.
  say('Compiling the studio page…');
  await fetch(`${base}/dev/trailer/studio`, { signal: AbortSignal.timeout(180_000) }).catch(() => {});
}

// ---------------------------------------------------------------- browsers
async function launch() {
  const opts = {
    headless: true,
    args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--force-color-profile=srgb', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
  };
  if (process.env.TRAILER_BROWSER) return chromium.launch({ ...opts, executablePath: process.env.TRAILER_BROWSER });
  for (const channel of ['msedge', 'chrome']) {
    try {
      return await chromium.launch({ ...opts, channel });
    } catch {
      /* next */
    }
  }
  throw new Error('Needs Microsoft Edge or Google Chrome installed (or TRAILER_BROWSER=path).');
}

// Each worker is its own browser: PNG capture is the slow part, and separate browsers do it in parallel.
const browsers = [];
function cleanup() {
  for (const b of browsers) b.close().catch(() => {});
  if (devServer) {
    if (process.platform === 'win32') spawn('taskkill', ['/pid', String(devServer.pid), '/T', '/F'], { stdio: 'ignore' });
    else devServer.kill();
  }
}
process.on('SIGINT', () => {
  cleanup();
  process.exit(130);
});

/** Opens the studio page for a layer and waits until models, textures, fonts and shaders are in. */
async function openStudio(layer) {
  const browser = await launch();
  browsers.push(browser);
  const page = await browser.newPage({ viewport: { width: size.W, height: size.H }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => say(`page error: ${e.message}`));
  const url = `${base}/dev/trailer/studio?render=1&script=${encodeURIComponent(name)}&format=${format.replace(':', 'x')}&res=${res}&layer=${layer}`;
  await page.goto(url, { waitUntil: 'load', timeout: 180_000 });
  const cdp = await page.context().newCDPSession(page);
  if (layer === 'overlay') await cdp.send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });
  let started = Date.now();
  let reloaded = false;
  for (;;) {
    // The dev server may reload the page while it compiles: just ask again.
    const st = await page
      .evaluate(() => {
        const s = window.__trailerStudio;
        return s ? { ready: s.ready(), error: s.error() } : { ready: false, error: null };
      })
      .catch(() => ({ ready: false, error: null }));
    if (st.error) throw new Error(`Script problem:\n${st.error}`);
    if (st.ready) {
      await new Promise((r) => setTimeout(r, 1500));
      if (await page.evaluate(() => !!window.__trailerStudio?.ready()).catch(() => false)) break;
      continue;
    }
    // A cold dev server sometimes leaves the first load stuck: reload once before giving up.
    if (!reloaded && Date.now() - started > 90_000) {
      reloaded = true;
      started = Date.now();
      await page.reload({ waitUntil: 'load', timeout: 180_000 }).catch(() => {});
      continue;
    }
    if (Date.now() - started > 180_000) throw new Error('The studio page never got ready (models or fonts not loading?).');
    await new Promise((r) => setTimeout(r, 250));
  }
  const info = await page.evaluate(() => window.__trailerStudio.info());
  return { browser, page, cdp, info };
}

// ---------------------------------------------------------------- ffmpeg

/** ffmpeg reading PNGs on stdin. */
function encoder(args) {
  const p = spawn(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'image2pipe', '-c:v', 'png', '-framerate', String(script.fps ?? 60), '-i', '-', ...args], {
    stdio: ['pipe', 'inherit', 'inherit'],
  });
  const done = new Promise((ok, fail) => p.on('exit', (c) => (c === 0 ? ok() : fail(new Error(`ffmpeg exited with ${c}`)))));
  done.catch(() => {}); // reported by end()
  p.stdin.on('error', () => {});
  return {
    write: (buf) => new Promise((ok) => (p.stdin.write(buf) ? ok() : p.stdin.once('drain', ok))),
    end: async () => {
      p.stdin.end();
      await done;
    },
  };
}

function run(args) {
  return new Promise((ok, fail) => {
    const p = spawn(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'inherit' });
    p.on('exit', (c) => (c === 0 ? ok() : fail(new Error(`ffmpeg exited with ${c}`))));
  });
}

/** Joins segments without re-encoding. */
async function concat(files, out) {
  if (files.length === 1) {
    rmSync(out, { force: true });
    await run(['-i', files[0], '-c', 'copy', ...(out.endsWith('.mp4') ? ['-movflags', '+faststart'] : []), out]);
  } else {
    const list = `${out}.txt`;
    const quote = (f) => `file '${f.replace(/\\/g, '/').split("'").join("'\\''")}'`;
    writeFileSync(list, files.map(quote).join('\n'));
    await run(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', ...(out.endsWith('.mp4') ? ['-movflags', '+faststart'] : []), out]);
    rmSync(list, { force: true });
  }
  for (const f of files) rmSync(f, { force: true });
}

const h264 = (file) => [
  '-vf', 'scale=out_color_matrix=bt709:out_range=tv:flags=lanczos+accurate_rnd+full_chroma_int',
  '-c:v', 'libx264', '-preset', 'medium', '-crf', crf, '-pix_fmt', 'yuv420p', '-profile:v', 'high',
  '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-movflags', '+faststart', file,
];
const prores = (file) => ['-c:v', 'prores_ks', '-profile:v', '4444', '-pix_fmt', 'yuva444p10le', '-vendor', 'apl0', file];

// ---------------------------------------------------------------- a pass over the frames

/**
 * Renders frames [from, to) of one layer with several browsers, each a contiguous chunk. A chunk
 * first runs the scene from frame 0 up to its start without drawing, so animations land exactly
 * where one long render would have them. Each chunk encodes its own segment of every output
 * ({ name: { file, args } }), joined at the end. PNGs go to pngDir if given.
 */
async function pass(layer, outputs, pngDir) {
  const first = await openStudio(layer);
  const { info } = first;
  const fps = info.fps;
  const from = Math.max(0, Math.round(Number(opt('from', 0)) * fps));
  const to = Math.min(info.frames, Math.round(Number(opt('to', info.duration)) * fps));
  const total = to - from;
  const want = Number(opt('workers', 3));
  const workers = Math.max(1, Math.min(want, Math.floor(total / 30) || 1));
  const bounds = Array.from({ length: workers + 1 }, (_, k) => from + Math.round((total * k) / workers));
  const counts = new Array(workers).fill(0);
  let t0 = 0;
  let lastSay = 0;
  const report = () => {
    const done = counts.reduce((a, b) => a + b, 0);
    const per = (Date.now() - t0) / Math.max(1, done);
    const left = Math.round(((total - done) * per) / 1000);
    progress({ frame: done, frames: total, message: `${layer}: ${(1000 / per).toFixed(1)} frames/s with ${workers} browser${workers > 1 ? 's' : ''} · ~${left}s left` });
    if (!progressMode && (Date.now() - lastSay > 10_000 || done === total)) {
      lastSay = Date.now();
      say(`  ${layer}: ${done}/${total} frames (${(1000 / per).toFixed(1)}/s, ~${left}s left)`);
    }
  };

  // Open every browser first (they load in parallel), then start the clock.
  const pages = [first, ...(await Promise.all(Array.from({ length: workers - 1 }, () => openStudio(layer))))];
  if (workers > 1) say(`  ${layer}: ${workers} browsers in parallel`);
  t0 = Date.now();
  const segs = Object.fromEntries(Object.keys(outputs).map((k) => [k, []]));
  await Promise.all(
    pages.map(async (w, k) => {
      const a = bounds[k];
      const b = bounds[k + 1];
      const encs = Object.entries(outputs).map(([key, o]) => {
        const dot = o.file.lastIndexOf('.');
        const seg = `${o.file.slice(0, dot)}.part${k}${o.file.slice(dot)}`;
        segs[key][k] = seg;
        return encoder(o.args(seg));
      });
      if (a > 0) await w.page.evaluate((n) => window.__trailerStudio.preroll(n), a);
      for (let i = a; i < b; i++) {
        await w.page.evaluate((n) => window.__trailerStudio.frame(n), i);
        const shot = await w.cdp.send('Page.captureScreenshot', { format: 'png', optimizeForSpeed: true, fromSurface: true, captureBeyondViewport: false });
        const png = Buffer.from(shot.data, 'base64');
        for (const e of encs) await e.write(png);
        if (pngDir) writeFileSync(join(pngDir, `${String(i - from).padStart(5, '0')}.png`), png);
        counts[k]++;
        report();
      }
      for (const e of encs) await e.end();
      if (k !== 0) await w.browser.close();
    }),
  );
  for (const [key, o] of Object.entries(outputs)) await concat(segs[key], o.file);
  return { ...first, from, to };
}

// ---------------------------------------------------------------- main
const outputs = [];
const tmpVideo = join(outDir, `${tag}.video.mp4`);
try {
  say(`Rendering trailers/${name}.json → ${format} ${res} at ${script.fps ?? 60} fps`);

  // Stills only: one browser, frames in order (the scene runs forward between them without drawing).
  if (opt('stills')) {
    const s = await openStudio('full');
    const times = opt('stills').split(',').map(Number).filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
    for (const t of times) {
      const i = Math.min(s.info.frames - 1, Math.round(t * s.info.fps));
      await s.page.evaluate((n) => window.__trailerStudio.preroll(n), i);
      await s.page.evaluate((n) => window.__trailerStudio.frame(n), i);
      const shot = await s.cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
      const file = join(outDir, `${tag}-still-${t.toFixed(2)}s.png`);
      writeFileSync(file, Buffer.from(shot.data, 'base64'));
      outputs.push(file);
    }
    say(`Done:\n${outputs.map((o) => `  ${o}`).join('\n')}`);
    process.exitCode = 0;
    throw Object.assign(new Error('stills done'), { quiet: true });
  }

  // The full picture.
  const pngDir = flag('png') ? join(outDir, `${tag}-frames`) : null;
  if (pngDir) {
    rmSync(pngDir, { recursive: true, force: true });
    mkdirSync(pngDir, { recursive: true });
  }
  const full = await pass('full', { video: { file: tmpVideo, args: h264 } }, pngDir);
  if (pngDir) outputs.push(pngDir);

  // The soundtrack, with and without music, muxed onto the picture.
  progress({ message: 'Mixing the soundtrack…' });
  say('Mixing the soundtrack…');
  const fromS = full.from / full.info.fps;
  const toS = full.to / full.info.fps;
  for (const withMusic of full.info.music ? [true, false] : [false]) {
    const b64 = await full.page.evaluate((m) => window.__trailerStudio.soundtrack(m), withMusic);
    const suffix = withMusic || !full.info.music ? '' : '-nomusic';
    const wav = join(outDir, `${tag}${suffix}.wav`);
    writeFileSync(wav, Buffer.from(b64, 'base64'));
    const file = join(outDir, `${tag}${suffix}.mp4`);
    await run(['-i', tmpVideo, '-ss', String(fromS), '-to', String(toS), '-i', wav, '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '320k', '-shortest', '-movflags', '+faststart', file]);
    outputs.push(file, wav);
  }
  rmSync(tmpVideo, { force: true });
  await full.browser.close();

  // Layers for editing: the scene alone, and the overlays alone on transparent.
  if (flag('layers')) {
    const sceneFile = join(outDir, `${tag}-scene.mp4`);
    await pass('scene', { video: { file: sceneFile, args: h264 } }).then((r) => r.browser.close());
    outputs.push(sceneFile);

    const ovDir = join(outDir, `${tag}-overlay`);
    rmSync(ovDir, { recursive: true, force: true });
    mkdirSync(ovDir, { recursive: true });
    const alphaFile = join(outDir, `${tag}-overlay.mov`);
    await pass('overlay', flag('alpha') ? { alpha: { file: alphaFile, args: prores } } : {}, ovDir).then((r) => r.browser.close());
    if (flag('alpha')) outputs.push(alphaFile);
    outputs.push(ovDir);
  }

  const rel = (o) => o.replace(root + '\\', '').replace(root + '/', '');
  progress({ state: 'done', message: 'Done.', outputs: outputs.map(rel) });
  say(`Done:\n${outputs.map((o) => `  ${rel(o)}`).join('\n')}`);
} catch (err) {
  if (!err.quiet) {
    progress({ state: 'error', message: String(err.message ?? err) });
    console.error(err.message ?? err);
    process.exitCode = 1;
  }
} finally {
  cleanup();
}
