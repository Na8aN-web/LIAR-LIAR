// Builds the town scenery for the game from the CC0 source packs. Sources are only read.
//   node tools/build-scenery.mjs
//
// Output (apps/web/public):
//   models/scenery.glb      buildings + props, one named root node each, meshopt-compressed
//   textures/paper.webp     aged paper for the Wanted posters
//   textures/ground.webp    dirt for the town square
// and apps/web/components/scene/sceneryAnchors.json (poster spots, footprints).
//
// Buildings come from the town kit (assets/source/scenery/Main File V1_1.glb). Their parts are
// picked by position, turned to face +z with the front edge at the origin, and merged per material.
// Props come from the "Low poly Western Objects" FBX (converted with FBX2glTF) plus the tumbleweed.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join as pathJoin, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { Document, NodeIO, getBounds } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import {
  dedup,
  join,
  mergeDocuments,
  meshopt,
  prune,
  quantize,
  simplifyPrimitive,
  textureCompress,
  transformMesh,
  unpartition,
  weld,
} from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = pathJoin(ROOT, 'assets/source');
const TOWN = pathJoin(SRC, 'scenery/Main File V1_1.glb');
const PACK_DIR = pathJoin(SRC, 'props/Low poly Western Objects');
const PACK_FBX = pathJoin(PACK_DIR, 'Low poly Western objects.fbx');
const OUT_MODEL = pathJoin(ROOT, 'apps/web/public/models/scenery.glb');
const OUT_TEX = pathJoin(ROOT, 'apps/web/public/textures');
const OUT_ANCHORS = pathJoin(ROOT, 'apps/web/components/scene/sceneryAnchors.json');

await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready, MeshoptSimplifier.ready]);
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });

// ---------------------------------------------------------------- tiny column-major mat4 helpers
const mul = (a, b) => {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
};
const translation = (x, y, z) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];
/** Rotate about Y by -90°: +x becomes +z (source fronts face +x; ours face +z). */
const FRONT_TO_Z = [0, 0, 1, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 0, 1];
const apply = (m, [x, y, z]) => [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]];

let triCount = (doc) => {
  let t = 0;
  for (const m of doc.getRoot().listMeshes())
    for (const p of m.listPrimitives()) t += (p.getIndices() ? p.getIndices().getCount() : p.getAttribute('POSITION').getCount()) / 3;
  return Math.round(t);
};

/** Bake each node's world transform (then `extra`) into its mesh and hang it under a new named root. */
function regroup(doc, name, nodes, extra) {
  const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0];
  const root = doc.createNode(name);
  scene.addChild(root);
  for (const n of nodes) {
    const m = mul(extra, n.getWorldMatrix());
    transformMesh(n.getMesh(), m);
    n.setTranslation([0, 0, 0]).setRotation([0, 0, 0, 1]).setScale([1, 1, 1]);
    for (const p of [...n.listParents()]) if (p !== root && p.propertyType === 'Node') p.removeChild(n);
    scene.removeChild(n);
    root.addChild(n);
  }
  return root;
}

function boundsOf(nodes) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const n of nodes) {
    const b = getBounds(n);
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], b.min[k]);
      max[k] = Math.max(max[k], b.max[k]);
    }
  }
  return { min, max };
}

/** Drop the PBR detail maps: at night, in fog, on phones, they cost far more than they show. */
function flattenMaterials(doc) {
  for (const m of doc.getRoot().listMaterials()) {
    m.setNormalTexture(null).setOcclusionTexture(null).setMetallicRoughnessTexture(null).setEmissiveTexture(null);
    m.setMetallicFactor(0).setRoughnessFactor(1);
  }
}

// =====================================================================================
// 1. Buildings (+ the well) from the town kit
// =====================================================================================
const town = await io.read(TOWN);
const townTrisBefore = triCount(town);

// Regions in source world space (x/z of each part's bounds centre). Fronts face +x.
const BUILDINGS = {
  saloon: { x: [-8.5, 0.5], z: [-5.6, 3.0], label: 'Saloon' },
  store: { x: [-8.5, -2.3], z: [3.6, 9.6], label: 'General store (plain storefront, sign added in game)' },
  sheriff: { x: [-8.5, -1.0], z: [10.2, 18.6], label: "Sheriff's office" },
  barn: { x: [-8.5, 2.2], z: [18.8, 29.0], label: 'Livery barn' },
  church: { x: [-9.8, 2.6], z: [35.5, 45.0], label: 'Church' },
  well: { x: [5.3, 8.2], z: [4.6, 7.0], label: 'Well' },
};
// Poster spots on facades, in source coordinates ([x just in front of the wall, y, z]).
// The live poster hangs on the sheriff's upper storey, above the porch roof: from the camera that's
// clear of both the roof edge and the back row of scarecrows. Spare spots sit low on other fronts.
const POSTER_SPOTS = [
  { building: 'sheriff', id: 'sheriff-front', source: [-2.7, 2.95, 15.3], active: true },
  { building: 'saloon', id: 'saloon-front', source: [-1.9, 0.72, -2.75] },
  { building: 'store', id: 'store-front', source: [-4.22, 0.72, 6.4] },
  { building: 'barn', id: 'barn-front', source: [0.66, 0.8, 25.2] },
];

const meshNodes = town.getRoot().listNodes().filter((n) => n.getMesh());
const centre = (n) => {
  const b = getBounds(n);
  return [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2];
};
const anchors = { buildings: {}, posterSpots: [] };
const taken = new Set();

// The bull skull on the barn is a 5.7k-triangle traced decal (every triangle has its own vertices,
// split only by UVs/normals). It's plain white, so drop those, weld by position, then simplify.
// It's flat and faces the street (+x in the source), so one normal fits every vertex.
const skull = meshNodes.find((n) => n.getName() === 'Plane.008');
if (skull) {
  for (const p of skull.getMesh().listPrimitives()) for (const sem of p.listSemantics()) if (sem !== 'POSITION') p.setAttribute(sem, null);
  await town.transform(weld());
  for (const p of skull.getMesh().listPrimitives()) {
    simplifyPrimitive(p, { simplifier: MeshoptSimplifier, ratio: 0.15, error: 0.01 });
    const count = p.getAttribute('POSITION').getCount();
    const normals = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) normals[i * 3] = 1;
    p.setAttribute('NORMAL', town.createAccessor().setType('VEC3').setArray(normals).setBuffer(p.getAttribute('POSITION').getBuffer()));
  }
}

for (const [name, r] of Object.entries(BUILDINGS)) {
  const members = meshNodes.filter((n) => {
    const [x, , z] = centre(n);
    return !taken.has(n) && x >= r.x[0] && x <= r.x[1] && z >= r.z[0] && z <= r.z[1];
  });
  members.forEach((n) => taken.add(n));
  const b = boundsOf(members);
  // Front edge (max x) at the origin, centred along the front, on the ground.
  const F = [b.max[0], b.min[1], (b.min[2] + b.max[2]) / 2];
  const N = mul(FRONT_TO_Z, translation(-F[0], -F[1], -F[2]));
  regroup(town, `building_${name}`, members, N);
  anchors.buildings[name] = {
    label: r.label,
    parts: members.length,
    width: +(b.max[2] - b.min[2]).toFixed(2),
    depth: +(b.max[0] - b.min[0]).toFixed(2),
    height: +(b.max[1] - b.min[1]).toFixed(2),
  };
  for (const s of POSTER_SPOTS.filter((s) => s.building === name)) {
    const [x, y, z] = apply(N, s.source);
    anchors.posterSpots.push({ id: s.id, building: name, position: [+x.toFixed(3), +y.toFixed(3), +z.toFixed(3)], active: !!s.active });
  }
}
// Everything not picked (wagons, cacti, saloon furniture, loose props) is dropped.
for (const n of meshNodes) if (!taken.has(n)) n.dispose();

// Pull the dirt texture for the ground before materials are flattened.
const dirt = town.getRoot().listTextures().find((t) => /Ground076L.*Color/i.test(t.getName() || t.getURI()));
if (dirt) {
  mkdirSync(OUT_TEX, { recursive: true });
  await sharp(Buffer.from(dirt.getImage())).resize(512, 512).modulate({ brightness: 0.8 }).webp({ quality: 72 }).toFile(pathJoin(OUT_TEX, 'ground.webp'));
}
flattenMaterials(town);
await town.transform(prune(), dedup(), join({ keepNamed: false }), prune());

// =====================================================================================
// 2. Props: the FBX pack (converted), lantern, tumbleweed
// =====================================================================================
const tmp = pathJoin(tmpdir(), 'wtc-scenery');
mkdirSync(tmp, { recursive: true });
const fbxBin = pathJoin(ROOT, 'node_modules/fbx2gltf/bin', process.platform === 'win32' ? 'Windows_NT/FBX2glTF.exe' : `${process.platform === 'darwin' ? 'Darwin' : 'Linux'}/FBX2glTF`);
execFileSync(fbxBin, ['--binary', '--input', PACK_FBX, '--output', pathJoin(tmp, 'western-objects')], { stdio: 'ignore' });
const pack = await io.read(pathJoin(tmp, 'western-objects.glb'));

// Keep outdoor props only. Name in pack -> our name.
const KEEP = {
  WesternBarrel: 'barrel',
  WesternBarrel_water: 'barrelWater',
  WesternBarrel_hay: 'barrelHay',
  Crate: 'crate',
  Fence: 'fence',
  Barrier: 'barrier',
  WaterTower: 'waterTower',
  'WesternCart.001': 'wagon',
  WesternCart: 'cart',
  PostSIgn: 'signpost',
  OldBench: 'bench',
  Cactus1: 'cactus1',
  Cactus2: 'cactus2',
  DeadTree: 'deadTree',
  Stump: 'stump',
  Log: 'log',
  WoodWheel: 'wheel',
  Lamo: 'streetLamp',
  Bushes: 'bush',
};
// The FBX references these images by material name; attach them.
const MAT_TEX = {
  Wood: 'Wood-Texture.png',
  Metal: 'Metal-Texture.png',
  Concrete: 'Concrete_Texture.png',
  Fabric: 'Fabric_Texture.png',
  Vegetation: 'Vegetation-Texture.png',
  Signs: 'Signs.png',
  Misc: 'Misc.png',
  DefaultMaterial: 'Wood-Texture.png',
};
const texCache = new Map();
for (const m of pack.getRoot().listMaterials()) {
  const file = MAT_TEX[m.getName()];
  if (!file) continue;
  if (!texCache.has(file)) {
    texCache.set(file, pack.createTexture(file).setImage(readFileSync(pathJoin(PACK_DIR, file))).setMimeType('image/png').setURI(file));
  }
  m.setBaseColorTexture(texCache.get(file)).setBaseColorFactor([1, 1, 1, 1]);
}

const packTrisBefore = triCount(pack);
const propNodes = pack.getRoot().listNodes().filter((n) => n.getMesh() && KEEP[n.getName()]);
anchors.props = {};
for (const n of propNodes) {
  const b = getBounds(n);
  // Stand on the ground, centred.
  const N = translation(-(b.min[0] + b.max[0]) / 2, -b.min[1], -(b.min[2] + b.max[2]) / 2);
  regroup(pack, `prop_${KEEP[n.getName()]}`, [n], N);
  anchors.props[KEEP[n.getName()]] = { size: [0, 1, 2].map((k) => +(b.max[k] - b.min[k]).toFixed(2)) };
}
for (const n of pack.getRoot().listNodes()) if (n.getMesh() && !propNodes.includes(n)) n.dispose();
for (const n of pack.getRoot().listNodes()) if (!n.getMesh() && n.listChildren().length === 0 && !n.getName().startsWith('prop_')) n.dispose();
flattenMaterials(pack);
await pack.transform(prune(), dedup());

async function addSingle(file, name) {
  const doc = await io.read(pathJoin(SRC, 'props', file));
  const nodes = doc.getRoot().listNodes().filter((n) => n.getMesh());
  const b = boundsOf(nodes);
  const N = translation(-(b.min[0] + b.max[0]) / 2, -b.min[1], -(b.min[2] + b.max[2]) / 2);
  regroup(doc, `prop_${name}`, nodes, N);
  anchors.props[name] = { size: [0, 1, 2].map((k) => +(b.max[k] - b.min[k]).toFixed(2)) };
  flattenMaterials(doc);
  await doc.transform(prune(), dedup(), join({ keepNamed: false }));
  return doc;
}
const tumbleweed = await addSingle('tumbleweed.glb', 'tumbleweed');

// =====================================================================================
// 3. Merge, compress, write
// =====================================================================================
const out = town;
mergeDocuments(out, pack);
mergeDocuments(out, tumbleweed);
// mergeDocuments adds each source's scene; move everything into the first scene.
const [main, ...extraScenes] = out.getRoot().listScenes();
for (const s of extraScenes) {
  for (const c of s.listChildren()) {
    s.removeChild(c);
    main.addChild(c);
  }
  s.dispose();
}
out.getRoot().setDefaultScene(main);
// Unwrap the props' empty FBX wrapper nodes (RootNode): keep only the named roots at the top.
for (const top of [...main.listChildren()]) {
  if (top.getName().startsWith('building_') || top.getName().startsWith('prop_')) continue;
  for (const c of [...top.listChildren()]) {
    top.removeChild(c);
    main.addChild(c);
  }
  main.removeChild(top);
  top.dispose();
}
const trisBeforeCompression = triCount(out);
await out.transform(
  unpartition(),
  dedup(),
  prune(),
  textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [512, 512], quality: 75 }),
  quantize(),
  meshopt({ encoder: MeshoptEncoder, level: 'high' }),
);
mkdirSync(dirname(OUT_MODEL), { recursive: true });
await io.write(OUT_MODEL, out);

// Paper texture for the posters.
await sharp(pathJoin(SRC, 'textures/Paper.png')).resize(512, null, { fit: 'inside' }).webp({ quality: 78 }).toFile(pathJoin(OUT_TEX, 'paper.webp'));

anchors.triangles = trisBeforeCompression;
writeFileSync(OUT_ANCHORS, JSON.stringify(anchors, null, 1) + '\n');

const kb = (f) => `${(statSync(f).size / 1024).toFixed(0)} KB`;
const srcBytes = statSync(TOWN).size + statSync(PACK_FBX).size;
console.log(`town kit: ${townTrisBefore} triangles -> kept ${Object.keys(BUILDINGS).length} pieces`);
console.log(`props pack: ${packTrisBefore} triangles -> kept ${propNodes.length} props (+ tumbleweed)`);
console.log(`scenery.glb: ${trisBeforeCompression} triangles, ${kb(OUT_MODEL)} (sources ${(srcBytes / 1024 / 1024).toFixed(1)} MB)`);
console.log(`textures: paper.webp ${kb(pathJoin(OUT_TEX, 'paper.webp'))}, ground.webp ${kb(pathJoin(OUT_TEX, 'ground.webp'))}`);
console.log('roots:', out.getRoot().getDefaultScene().listChildren().map((n) => n.getName()).join(', '));
