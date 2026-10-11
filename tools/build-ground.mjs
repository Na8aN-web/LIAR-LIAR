// Prepares the town-square dirt for the web. Sources in assets/source/textures/ are only read.
//   node tools/build-ground.mjs        (pnpm ground)
//
// ambientCG Ground111 (CC0): the color map and the OpenGL-style normal map, 1024 px, as WebP.
// The normal map keeps a higher quality: lossy artefacts in it show up as fake bumps.
import { stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'assets/source/textures');
const OUT = join(ROOT, 'apps/web/public/textures');

const jobs = [
  { src: 'Ground111_1K-JPG_Color.jpg', out: 'dirt-color.webp', quality: 76 },
  { src: 'Ground111_1K-JPG_NormalGL.jpg', out: 'dirt-normal.webp', quality: 90 },
];
for (const j of jobs) {
  await sharp(join(SRC, j.src)).resize(1024, 1024).webp({ quality: j.quality }).toFile(join(OUT, j.out));
  console.log(`${j.src} -> ${j.out} ${((await stat(join(OUT, j.out))).size / 1024).toFixed(0)} KB`);
}
