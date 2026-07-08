// Downloads CC0 PBR assets from Poly Haven (https://polyhaven.com, CC0)
// into public/assets/. Run once; the files are committed so the site
// stays fully static and reproducible.
//   node tools/fetch-assets.mjs

import fs from 'fs';
import path from 'path';

const OUT = new URL('../public/assets/', import.meta.url).pathname
  .replace(/^\/([A-Za-z]:)/, '$1'); // Windows path fix

const UA = { 'User-Agent': 'RedFootGlobalTrail/1.0 (asset fetch; github.com/munifgebara/RedFootGlobalTrail)' };

const TEXTURES = ['red_dirt_mud_01', 'sparse_grass'];
const MODELS = ['boulder_01', 'jacaranda_tree'];
const RES = '1k';

async function jf(url) {
  const r = await fetch(url, { headers: UA });
  if (!r.ok) throw new Error(url + ' -> ' + r.status);
  return r.json();
}
async function dl(url, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const r = await fetch(url, { headers: UA });
  if (!r.ok) throw new Error(url + ' -> ' + r.status);
  const buf = Buffer.from(await r.arrayBuffer());
  fs.writeFileSync(dest, buf);
  console.log(dest.split(/[\\/]/).slice(-2).join('/'), (buf.length / 1024).toFixed(0) + ' KB');
}

for (const id of TEXTURES) {
  const files = await jf('https://api.polyhaven.com/files/' + id);
  const maps = { Diffuse: 'diff', nor_gl: 'nor', arm: 'arm' };
  for (const [key, short] of Object.entries(maps)) {
    const entry = files[key]?.[RES]?.jpg;
    if (!entry) { console.warn(id, key, 'indisponível'); continue; }
    await dl(entry.url, path.join(OUT, 'textures', id, short + '.jpg'));
  }
}

for (const id of MODELS) {
  const files = await jf('https://api.polyhaven.com/files/' + id);
  const g = files.gltf?.[RES]?.gltf;
  if (!g) { console.warn(id, 'sem gltf'); continue; }
  const dir = path.join(OUT, 'models', id);
  await dl(g.url, path.join(dir, id + '.gltf'));
  for (const [rel, info] of Object.entries(g.include ?? {})) {
    await dl(info.url, path.join(dir, rel));
  }
}
console.log('done');
