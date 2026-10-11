// Prepares the 3042Official crew art. The source in assets/source/branding/ is only read.
//   node tools/build-branding.mjs        (pnpm branding)
//
//   public/branding/crew-color.webp   full color, for the Credits screen
//   public/branding/crew-print.webp   old-print look for the in-town billboard: sepia,
//                                     flattened contrast, a little grain and a darker edge
import { mkdir, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'assets/source/branding/3042crew.png');
const OUT = join(ROOT, 'apps/web/public/branding');
await mkdir(OUT, { recursive: true });

const SIZE = 512;
await sharp(SRC).resize(SIZE, SIZE).webp({ quality: 82 }).toFile(join(OUT, 'crew-color.webp'));

// Sepia: greyscale, then tint toward brown ink on yellowed paper.
const base = await sharp(SRC).resize(SIZE, SIZE).flatten({ background: '#d8c49a' }).greyscale().linear(0.82, 22).raw().toBuffer({ resolveWithObject: true });
const { data, info } = base;
const out = Buffer.alloc(info.width * info.height * 3);
let seed = 3042;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const ink = [58, 36, 18];
const paper = [226, 204, 158];
for (let y = 0; y < info.height; y++) {
  for (let x = 0; x < info.width; x++) {
    const i = y * info.width + x;
    let v = data[i * info.channels] / 255;
    v = Math.min(1, Math.max(0, v + (rnd() - 0.5) * 0.08)); // grain
    // Vignette: printed edges go darker.
    const dx = x / info.width - 0.5;
    const dy = y / info.height - 0.5;
    v *= 1 - 0.55 * Math.max(0, Math.hypot(dx, dy) - 0.32);
    for (let c = 0; c < 3; c++) out[i * 3 + c] = Math.round(ink[c] + (paper[c] - ink[c]) * v);
  }
}
await sharp(out, { raw: { width: info.width, height: info.height, channels: 3 } }).webp({ quality: 80 }).toFile(join(OUT, 'crew-print.webp'));

for (const f of ['crew-color.webp', 'crew-print.webp']) console.log(`${f} ${((await stat(join(OUT, f))).size / 1024).toFixed(0)} KB`);
