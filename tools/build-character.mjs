// Builds the animated scarecrow: one rigged mesh, one skeleton, six clips.
//   node tools/build-character.mjs [--triangles 8000] [--out apps/web/public/models/scarecrow.glb]
//
// Source: the Mixamo FBX files in assets/source/animations/ (only read, never written).
// Every file carries the same rigged scarecrow (Mixamo auto-rig of apps/scarecrow.glb)
// and one clip. We take the mesh and skeleton from one file, check that every other
// file's skeleton has the same joints and rest pose, then copy each clip onto the shared
// skeleton under a short name:
//
//   sit-relaxed  <- Sitting2.fbx        (upright, hands on knees)
//   sit-hunched  <- Sitting.fbx         (bent forward, head down)
//   sit-leaning  <- Sittingcross.fbx    (leaning back, legs crossed)
//   despair-1    <- Sitting Disbelief.fbx
//   despair-2    <- Sitting Disbelief2.fbx
//   victory      <- Sitting Victory.fbx
//
// Then: scale to the game's model space (1.96 tall, facing +z; the clips already keep the
// feet at y=0), on the root node so skin data stays untouched -> weld + simplify the mesh to
// the triangle target (meshoptimizer keeps original vertices, so skin weights survive)
// -> drop redundant keyframes -> quantize -> EXT_meshopt_compression.
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { meshopt, prune, quantize, resample, simplify, weld } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}
const SRC_DIR = join(ROOT, 'assets/source/animations');
const OUT = resolve(arg('out', join(ROOT, 'apps/web/public/models/scarecrow.glb')));
const TARGET = Number(arg('triangles', '8000'));
/** Model height in game model units (matches MODEL_HEIGHT in scarecrowModel.ts). */
const MODEL_HEIGHT = 1.96;

const CLIPS = [
  ['sit-relaxed', 'Sitting2.fbx'],
  ['sit-hunched', 'Sitting.fbx'],
  ['sit-leaning', 'Sittingcross.fbx'],
  ['despair-1', 'Sitting Disbelief.fbx'],
  ['despair-2', 'Sitting Disbelief2.fbx'],
  ['victory', 'Sitting Victory.fbx'],
];
/** File whose mesh and skeleton we keep. */
const BASE = 'Sitting.fbx';

await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready, MeshoptSimplifier.ready]);
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });

// ---------------------------------------------------------------- convert FBX -> glTF
const fbxBin = join(
  ROOT,
  'node_modules/fbx2gltf/bin',
  process.platform === 'win32' ? 'Windows_NT/FBX2glTF.exe' : `${process.platform === 'darwin' ? 'Darwin' : 'Linux'}/FBX2glTF`,
);
const tmp = await mkdtemp(join(tmpdir(), 'wtc-character-'));
const docs = new Map();
for (const file of new Set([BASE, ...CLIPS.map(([, f]) => f)])) {
  const out = join(tmp, file.replace(/\W+/g, '_'));
  execFileSync(fbxBin, ['--binary', '--input', join(SRC_DIR, file), '--output', out], { stdio: 'ignore' });
  docs.set(file, await io.read(`${out}.glb`));
}
await rm(tmp, { recursive: true, force: true });

const doc = docs.get(BASE);
const root = doc.getRoot();
const sourceBytes = (await Promise.all(CLIPS.map(([, f]) => stat(join(SRC_DIR, f))))).reduce((n, s) => n + s.size, 0);

// ---------------------------------------------------------------- one skeleton
const nodesByName = (d) => new Map(d.getRoot().listNodes().map((n) => [n.getName(), n]));
const baseNodes = nodesByName(doc);
const baseJoints = root.listSkins()[0].listJoints().map((j) => j.getName());
const close = (a, b, eps) => a.every((v, i) => Math.abs(v - b[i]) <= eps);
for (const [name, file] of CLIPS) {
  const other = docs.get(file);
  const joints = other.getRoot().listSkins()[0]?.listJoints().map((j) => j.getName()) ?? [];
  const missing = baseJoints.filter((j) => !joints.includes(j));
  if (missing.length) throw new Error(`${file}: skeleton differs (missing ${missing.join(', ')})`);
  const theirs = nodesByName(other);
  for (const j of baseJoints) {
    const a = baseNodes.get(j);
    const b = theirs.get(j);
    if (!close(a.getTranslation(), b.getTranslation(), 1e-5) || !close(a.getRotation(), b.getRotation(), 1e-3)) {
      throw new Error(`${file}: rest pose of ${j} differs from ${BASE}`);
    }
  }
  console.log(`skeleton ok   ${name.padEnd(12)} ${file}`);
}

// ---------------------------------------------------------------- copy clips onto it
const oldAnimations = root.listAnimations();
const buffer = root.listBuffers()[0];
const copyAccessor = (a) =>
  doc
    .createAccessor()
    .setType(a.getType())
    .setArray(a.getArray().slice())
    .setNormalized(a.getNormalized())
    .setBuffer(buffer);
const durations = {};
for (const [name, file] of CLIPS) {
  const src = docs.get(file).getRoot().listAnimations()[0];
  const anim = doc.createAnimation(name);
  let end = 0;
  for (const ch of src.listChannels()) {
    const target = baseNodes.get(ch.getTargetNode().getName());
    if (!target) continue;
    const s = ch.getSampler();
    const input = copyAccessor(s.getInput());
    end = Math.max(end, input.getMax([])[0]);
    const sampler = doc.createAnimationSampler().setInput(input).setOutput(copyAccessor(s.getOutput())).setInterpolation(s.getInterpolation());
    anim.addSampler(sampler).addChannel(doc.createAnimationChannel().setTargetNode(target).setTargetPath(ch.getTargetPath()).setSampler(sampler));
  }
  durations[name] = end;
}
for (const a of oldAnimations) a.dispose();

// ---------------------------------------------------------------- model space
// The rig comes in tiny units (Mixamo cm scaled down by FBX2glTF). Scale and centre it on
// the root node: the mesh node and joints are its children, so skinning is unaffected.
const sceneRoot = root.getDefaultScene().listChildren()[0];
const meshNode = root.listNodes().find((n) => n.getMesh() && n.getSkin());
if (!meshNode || meshNode.getParentNode() !== sceneRoot) throw new Error('expected the skinned mesh directly under the root node');
// Stored vertex positions are in bind space, not where the rig puts them, so measure the
// skinned rest pose: v' = sum(w * jointWorld * inverseBind * v), relative to the root.
const mul = (a, b) => {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let i = 0; i < 4; i++) o[c * 4 + r] += a[i * 4 + r] * b[c * 4 + i];
  return o;
};
const skin = meshNode.getSkin();
const ibm = skin.getInverseBindMatrices().getArray();
const jointMats = skin.listJoints().map((j, i) => mul(j.getWorldMatrix(), Array.from(ibm.slice(i * 16, i * 16 + 16))));
const prim = meshNode.getMesh().listPrimitives()[0];
const [P, J, W] = ['POSITION', 'JOINTS_0', 'WEIGHTS_0'].map((s) => prim.getAttribute(s));
const lo = [Infinity, Infinity, Infinity];
const hi = [-Infinity, -Infinity, -Infinity];
const v = [], jj = [], ww = [];
for (let i = 0; i < P.getCount(); i++) {
  P.getElement(i, v);
  J.getElement(i, jj);
  W.getElement(i, ww);
  const out = [0, 0, 0];
  for (let n = 0; n < 4; n++) {
    if (!ww[n]) continue;
    const m = jointMats[jj[n]];
    for (let r = 0; r < 3; r++) out[r] += ww[n] * (m[r] * v[0] + m[4 + r] * v[1] + m[8 + r] * v[2] + m[12 + r]);
  }
  for (let r = 0; r < 3; r++) {
    lo[r] = Math.min(lo[r], out[r]);
    hi[r] = Math.max(hi[r], out[r]);
  }
}
const [minX, minY, minZ] = lo;
const [maxX, maxY, maxZ] = hi;
if (sceneRoot.getMatrix().some((x, i) => Math.abs(x - (i % 5 === 0 ? 1 : 0)) > 1e-6)) throw new Error('expected an identity root node');
const k = MODEL_HEIGHT / (maxY - minY);
console.log(`rest pose     ${(maxX - minX).toFixed(4)} x ${(maxY - minY).toFixed(4)} x ${(maxZ - minZ).toFixed(4)} source units, scale x${k.toFixed(2)}`);
sceneRoot.setName('Scarecrow').setScale([k, k, k]);
meshNode.setName('Body');
root.listMaterials().forEach((m) => m.setName('Straw').setBaseColorFactor([0.63, 0.49, 0.31, 1]).setRoughnessFactor(1).setMetallicFactor(0));

// ---------------------------------------------------------------- optimize
const triangles = () => root.listMeshes().reduce((n, m) => n + m.listPrimitives().reduce((t, p) => t + (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3, 0), 0);
const vertices = () => root.listMeshes().reduce((n, m) => n + m.listPrimitives().reduce((t, p) => t + p.getAttribute('POSITION').getCount(), 0), 0);
const before = { triangles: triangles(), vertices: vertices() };
await doc.transform(weld());
await doc.transform(
  simplify({ simplifier: MeshoptSimplifier, ratio: Math.min(1, TARGET / triangles()), error: 0.01 }),
  resample({ tolerance: 1e-4 }),
  prune({ keepLeaves: true }),
  quantize({ quantizeNormal: 8, quantizeWeight: 8 }),
  meshopt({ encoder: MeshoptEncoder, level: 'high' }),
);

await mkdir(dirname(OUT), { recursive: true });
await io.write(OUT, doc);
const outBytes = (await stat(OUT)).size;
const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
console.log(`output  ${OUT}`);
console.table({
  triangles: { source: before.triangles, output: triangles() },
  vertices: { source: before.vertices, output: vertices() },
  joints: { source: baseJoints.length, output: root.listSkins()[0].listJoints().length },
  'file size': { source: `${kb(sourceBytes)} (6 FBX)`, output: kb(outBytes) },
});
console.table(Object.fromEntries(root.listAnimations().map((a) => [a.getName(), { seconds: +durations[a.getName()].toFixed(2), channels: a.listChannels().length }])));
