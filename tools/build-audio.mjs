// Prepares music and ambience for the web. Sources in assets/source/audio/ are only read.
//   node tools/build-audio.mjs        (pnpm audio)
//
// Each file is sorted by its name: music (music, western, theme, track, song), fire (fire,
// crackle), wind, crows (crow). Music is re-encoded at 128 kbps stereo; ambience at 64 kbps
// mono, and long ambience is cut to a loopable minute (the player crossfades the loop seam).
// Everything is loudness-normalised so the volume sliders mean the same for every file.
// Writes apps/web/public/audio/*.mp3 and manifest.json, which the game reads at runtime.
import { execFileSync } from 'node:child_process';
import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ffmpeg from 'ffmpeg-static';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'assets/source/audio');
const OUT = join(ROOT, 'apps/web/public/audio');

const KINDS = [
  { kind: 'fire', match: /fire|crackle/i },
  { kind: 'wind', match: /wind/i },
  { kind: 'crows', match: /crow/i },
  { kind: 'music', match: /music|western|theme|track|song/i },
];

/** Loudness targets (LUFS): music sits a little above ambience before the sliders. */
const LOUDNESS = { music: -18, fire: -24, wind: -26, crows: -22 };
/** Longest ambience kept, seconds (a 10-minute fire loop isn't needed on a phone). */
const AMBIENCE_MAX = 60;

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function duration(file) {
  // ffmpeg prints "Duration: 00:01:48.00" on stderr when given only an input.
  try {
    execFileSync(ffmpeg, ['-hide_banner', '-i', file], { stdio: ['ignore', 'ignore', 'pipe'] });
  } catch (e) {
    const m = String(e.stderr).match(/Duration: (\d+):(\d+):([\d.]+)/);
    if (m) return +m[1] * 3600 + +m[2] * 60 + +m[3];
  }
  return 0;
}

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });
const files = (await readdir(SRC).catch(() => [])).filter((f) => /\.(mp3|wav|ogg|flac|m4a)$/i.test(f)).sort();
if (!files.length) console.log(`No audio in ${SRC}; the game will run with its synthesized effects only.`);

const manifest = { music: [], ambience: {}, sources: [] };
for (const f of files) {
  const src = join(SRC, f);
  const kind = KINDS.find((k) => k.match.test(f))?.kind;
  if (!kind) {
    console.log(`skipped ${f} (name doesn't say music, fire, wind or crow)`);
    continue;
  }
  const len = duration(src);
  const out = `${kind}-${slug(basename(f, extname(f)))}.mp3`;
  const args = ['-hide_banner', '-loglevel', 'error', '-y'];
  let start = 0;
  let keep = len;
  if (kind !== 'music' && len > AMBIENCE_MAX) {
    // Skip any fade-in at the start of long recordings.
    start = Math.min(20, len - AMBIENCE_MAX);
    keep = AMBIENCE_MAX;
  }
  args.push('-ss', String(start), '-t', String(keep), '-i', src);
  args.push('-af', `loudnorm=I=${LOUDNESS[kind]}:TP=-2:LRA=11`);
  if (kind === 'music') args.push('-ac', '2', '-b:a', '128k');
  else args.push('-ac', '1', '-b:a', '64k');
  args.push('-ar', '44100', join(OUT, out));
  execFileSync(ffmpeg, args, { stdio: 'inherit' });
  const size = (await stat(join(OUT, out))).size;
  const entry = { file: `/audio/${out}`, seconds: Math.round(keep * 10) / 10 };
  if (kind === 'music') manifest.music.push(entry);
  else manifest.ambience[kind] = entry;
  manifest.sources.push({ source: `assets/source/audio/${f}`, kind, output: out });
  console.log(`${kind.padEnd(6)} ${f.padEnd(22)} ${len.toFixed(0).padStart(4)} s -> ${out} ${keep.toFixed(0)} s, ${(size / 1024).toFixed(0)} KB`);
}
await writeFile(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`wrote ${join(OUT, 'manifest.json')}`);
