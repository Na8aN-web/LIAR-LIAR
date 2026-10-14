// Turns a rendered trailer into a game portal's preview video (CrazyGames: Requirements > Game
// covers): the static cover as the opening second, no sound, and checks the limits.
//   node tools/portal-preview.mjs <trailer.mp4> <cover.png> <out.mp4> [--cover-seconds 1]
// The trailer comes from `pnpm trailer:render crazygames-landscape` (or -portrait); the cover from
// the trailer studio's Thumbnail mode, Cover layout (export the larger size for a sharp still).
import { spawnSync } from 'node:child_process';
import { statSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ffmpeg = require('ffmpeg-static');

const [input, cover, out] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const i = process.argv.indexOf('--cover-seconds');
const coverSeconds = i > 0 ? Number(process.argv[i + 1]) : 1;
if (!input || !cover || !out) {
  console.error('Usage: node tools/portal-preview.mjs <trailer.mp4> <cover.png> <out.mp4> [--cover-seconds 1]');
  process.exit(1);
}

const MAX_SECONDS = 20;
const MAX_BYTES = 50 * 1024 * 1024;

/** Width, height, frame rate and length of a video, from ffmpeg's report. */
function probe(file) {
  const r = spawnSync(ffmpeg, ['-hide_banner', '-i', file], { encoding: 'utf8' });
  const text = r.stderr;
  const size = /Video:.*?(\d{2,5})x(\d{2,5})/.exec(text);
  const fps = /(\d+(?:\.\d+)?) fps/.exec(text);
  const dur = /Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/.exec(text);
  if (!size || !dur) throw new Error(`Can't read ${file}`);
  return { W: +size[1], H: +size[2], fps: fps ? +fps[1] : 60, seconds: +dur[1] * 3600 + +dur[2] * 60 + +dur[3] };
}

const v = probe(input);
const total = v.seconds + coverSeconds;
if (total > MAX_SECONDS) console.warn(`Warning: ${total.toFixed(1)} s is over ${MAX_SECONDS} s; the portal will cut it.`);

// The cover, scaled to cover the frame exactly, held for coverSeconds; then the trailer. No audio.
const filter =
  `[0:v]scale=${v.W}:${v.H}:force_original_aspect_ratio=increase,crop=${v.W}:${v.H},setsar=1,fps=${v.fps},format=yuv420p[c];` +
  `[1:v]setsar=1,fps=${v.fps},format=yuv420p[t];[c][t]concat=n=2:v=1:a=0[v]`;
const r = spawnSync(
  ffmpeg,
  ['-hide_banner', '-loglevel', 'error', '-y', '-loop', '1', '-t', String(coverSeconds), '-i', cover, '-i', input, '-filter_complex', filter, '-map', '[v]', '-an', '-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out],
  { stdio: 'inherit' },
);
if (r.status !== 0) process.exit(r.status ?? 1);

const o = probe(out);
const bytes = statSync(out).size;
console.log(`${out}: ${o.W}x${o.H}, ${o.seconds.toFixed(2)} s, ${(bytes / 1024 / 1024).toFixed(1)} MB, no audio`);
if (bytes > MAX_BYTES) console.warn('Warning: over 50 MB. Raise the CRF (e.g. 24) and run again.');
