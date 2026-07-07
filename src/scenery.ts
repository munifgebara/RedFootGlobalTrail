import * as THREE from 'three/webgpu';
import {
  positionLocal, time, sin, cos, float, vec3, hash, instanceIndex, uv, mix, color, step, abs, fract,
} from 'three/tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { terrainH, fieldNoise } from './terrain';
import type { Track } from './track';
import { ROAD_HALF, DS } from './track';

// gerador determinístico
let seed = 20260707;
function srand(): number {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
}
function srange(a: number, b: number): number { return a + srand() * (b - a); }

function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D, w: number, h: number) => void,
                   repX = 1, repY = 1): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d')!, w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repX, repY);
  t.anisotropy = 8;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function bannerTex(text: string, bg: string, fg: string): THREE.CanvasTexture {
  return canvasTex(1024, 128, (g, w, h) => {
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(255,255,255,.35)'; g.lineWidth = 6; g.strokeRect(6, 6, w - 12, h - 12);
    g.fillStyle = fg; g.font = '900 76px "Segoe UI", sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, w / 2, h / 2 + 4);
  });
}

const mats = {
  trunk: new THREE.MeshStandardMaterial({ color: 0x6b4a30, roughness: 1 }),
  wood: new THREE.MeshStandardMaterial({ color: 0x8a6a48, roughness: 1 }),
  white: new THREE.MeshStandardMaterial({ color: 0xf2f0ea, roughness: 0.8 }),
  grey: new THREE.MeshStandardMaterial({ color: 0x9aa0a8, roughness: 0.9 }),
};

/** Copa "amassada" (icosaedro com vértices deslocados) p/ árvores low-poly vivas. */
function lumpyCanopy(radius: number): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(radius, 1);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = v.clone().normalize();
    const k = 1 + (Math.sin(v.x * 5.1) * Math.cos(v.y * 4.3) + Math.sin(v.z * 6.7)) * 0.10;
    v.copy(n.multiplyScalar(radius * k));
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

export function buildScenery(scene: THREE.Scene, t: Track): void {
  trees(scene, t);
  coffee(scene, t);
  grassTufts(scene, t);
  fences(scene, t);
  poles(scene, t);
  chevrons(scene, t);
  gantry(scene, t, t.START_I, 'RALLY DE MARINGÁ', '#c81e14');
  gantry(scene, t, t.FINISH_I, 'CHEGADA', '#111418');
  sponsors(scene, t);
  cathedralAndCity(scene);
  farms(scene, t);
}

/* ---------- árvores (ipês) com vento nas copas ---------- */
function trees(scene: THREE.Scene, t: Track): void {
  const N = 560;
  const trunkG = new THREE.CylinderGeometry(0.32, 0.5, 4.6, 6);
  const canG = lumpyCanopy(3.1);
  const trunks = new THREE.InstancedMesh(trunkG, mats.trunk, N);

  const canMat = new THREE.MeshStandardNodeMaterial({ roughness: 1, flatShading: true });
  // balanço sutil de vento por instância
  const phase = hash(instanceIndex).mul(6.283);
  const sway = vec3(
    sin(time.mul(0.9).add(phase)),
    float(0),
    cos(time.mul(1.1).add(phase)),
  ).mul(positionLocal.y.max(0).mul(0.035));
  canMat.positionNode = positionLocal.add(sway);
  const cans = new THREE.InstancedMesh(canG, canMat, N);

  trunks.castShadow = cans.castShadow = true;
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(),
        S = new THREE.Vector3(), P = new THREE.Vector3();
  const palette = [0xe774b8, 0xf2c94c, 0x4d8a3d, 0x4d8a3d, 0x5da048, 0x4d8a3d];
  let placed = 0, tries = 0;
  while (placed < N && tries < N * 40) {
    tries++;
    const i = Math.floor(srand() * t.NSEG);
    const side = srand() < 0.5 ? 1 : -1, off = srange(15, 120);
    const x = t.pts[i].x + t.norm[i].x * off * side + srange(-8, 8);
    const z = t.pts[i].z + t.norm[i].z * off * side + srange(-8, 8);
    if (t.roadDist(x, z) < 13) continue;
    const y = terrainH(x, z), s = srange(0.8, 1.9);
    Q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), srand() * Math.PI * 2);
    M.compose(P.set(x, y + 2.3 * s, z), Q, S.set(s, s, s));
    trunks.setMatrixAt(placed, M);
    M.compose(P.set(x + srange(-0.4, 0.4), y + 6.2 * s * 0.92, z + srange(-0.4, 0.4)),
      Q, S.set(s, s * srange(0.85, 1.15), s));
    cans.setMatrixAt(placed, M);
    cans.setColorAt(placed, new THREE.Color(palette[Math.floor(srand() * palette.length)])
      .offsetHSL(0, 0, srange(-0.04, 0.04)));
    placed++;
  }
  trunks.count = cans.count = placed;
  scene.add(trunks, cans);
}

/* ---------- pés de café em fileiras ---------- */
function coffee(scene: THREE.Scene, t: Track): void {
  const N = 1600;
  const g = new THREE.SphereGeometry(0.85, 5, 4);
  g.scale(1, 1.25, 1);
  const mesh = new THREE.InstancedMesh(g,
    new THREE.MeshStandardMaterial({ color: 0x36592d, roughness: 1, flatShading: true }), N);
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(),
        S = new THREE.Vector3(), P = new THREE.Vector3();
  let placed = 0, tries = 0;
  while (placed < N && tries < N * 30) {
    tries++;
    const i = Math.floor(srand() * t.NSEG);
    const side = srand() < 0.5 ? 1 : -1, off = srange(16, 90);
    let x = t.pts[i].x + t.norm[i].x * off * side;
    let z = t.pts[i].z + t.norm[i].z * off * side;
    if (fieldNoise(x, z) <= 0.55) continue;
    x = Math.round(x / 3.6) * 3.6;
    z = Math.round(z / 3.6) * 3.6 + srange(-0.5, 0.5);
    if (t.roadDist(x, z) < 14) continue;
    const s = srange(0.8, 1.15);
    M.compose(P.set(x, terrainH(x, z) + 0.9 * s, z), Q, S.set(s, s, s));
    mesh.setMatrixAt(placed, M);
    placed++;
  }
  mesh.count = placed;
  mesh.castShadow = true;
  scene.add(mesh);
}

/* ---------- capim na beira da estrada, com vento ---------- */
function grassTufts(scene: THREE.Scene, t: Track): void {
  const N = 5200;
  const p1 = new THREE.PlaneGeometry(1, 1);
  const p2 = new THREE.PlaneGeometry(1, 1);
  p2.rotateY(Math.PI / 2);
  const geo = mergeGeometries([p1, p2])!;
  geo.translate(0, 0.5, 0);

  const mat = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
  const vT = uv().y; // 1 = topo
  // 3 lâminas triangulares por quad
  const tri = abs(fract(uv().x.mul(3)).sub(0.5)).mul(2);
  const halfW = mix(float(0.85), float(0.10), vT);
  mat.opacityNode = step(tri, halfW);
  mat.alphaTest = 0.5;
  const shade = hash(instanceIndex.add(17)).mul(0.35).add(0.75);
  mat.colorNode = mix(color(0x41682c), color(0x8fbf4e), vT).mul(shade);
  // vento: topo balança
  const phase = hash(instanceIndex).mul(6.283);
  const bend = sin(time.mul(1.7).add(phase)).mul(vT.mul(vT)).mul(0.14);
  mat.positionNode = positionLocal.add(vec3(bend, 0, bend.mul(0.6)));

  const mesh = new THREE.InstancedMesh(geo, mat, N);
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(),
        S = new THREE.Vector3(), P = new THREE.Vector3();
  let placed = 0, tries = 0;
  while (placed < N && tries < N * 20) {
    tries++;
    const i = Math.floor(srand() * t.NSEG);
    const side = srand() < 0.5 ? 1 : -1;
    const off = srange(ROAD_HALF + 2.2, 42);
    const x = t.pts[i].x + t.norm[i].x * off * side + srange(-3, 3);
    const z = t.pts[i].z + t.norm[i].z * off * side + srange(-3, 3);
    if (t.roadDist(x, z) < ROAD_HALF + 1.6) continue;
    const s = srange(0.5, 1.15);
    Q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), srand() * Math.PI * 2);
    M.compose(P.set(x, terrainH(x, z), z), Q, S.set(s * srange(0.8, 1.4), s, s));
    mesh.setMatrixAt(placed, M);
    placed++;
  }
  mesh.count = placed;
  scene.add(mesh);
}

/* ---------- cercas ---------- */
function fences(scene: THREE.Scene, t: Track): void {
  const posts: [number, number, number][] = [];
  for (let i = 0; i < t.NSEG; i += 14) {
    if (Math.sin(i * 0.028) > 0.15) continue;
    const side = Math.sin(i * 0.011) > 0 ? 1 : -1;
    const off = ROAD_HALF + 5.5;
    const x = t.pts[i].x + t.norm[i].x * off * side;
    const z = t.pts[i].z + t.norm[i].z * off * side;
    posts.push([x, terrainH(x, z), z]);
  }
  const g = new THREE.BoxGeometry(0.16, 1.35, 0.16);
  const mesh = new THREE.InstancedMesh(g, mats.wood, posts.length);
  const M = new THREE.Matrix4();
  posts.forEach((p, j) => {
    M.makeTranslation(p[0], p[1] + 0.65, p[2]);
    mesh.setMatrixAt(j, M);
  });
  mesh.castShadow = true;
  scene.add(mesh);
}

/* ---------- postes rurais ---------- */
function poles(scene: THREE.Scene, t: Track): void {
  const N = Math.floor(t.NSEG / 60);
  const pole = new THREE.CylinderGeometry(0.14, 0.2, 9, 6);
  const arm = new THREE.BoxGeometry(2.4, 0.14, 0.14);
  const polesM = new THREE.InstancedMesh(pole, mats.grey, N);
  const armsM = new THREE.InstancedMesh(arm, mats.grey, N);
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(),
        S = new THREE.Vector3(1, 1, 1), P = new THREE.Vector3();
  for (let j = 0; j < N; j++) {
    const i = j * 60;
    const side = j % 2 ? 1 : -1;
    const off = ROAD_HALF + 13;
    const x = t.pts[i].x + t.norm[i].x * off * side;
    const z = t.pts[i].z + t.norm[i].z * off * side;
    const y = terrainH(x, z);
    Q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(t.tang[i].x, t.tang[i].z));
    M.compose(P.set(x, y + 4.5, z), Q, S);
    polesM.setMatrixAt(j, M);
    M.compose(P.set(x, y + 8.7, z), Q, S);
    armsM.setMatrixAt(j, M);
  }
  polesM.castShadow = true;
  scene.add(polesM, armsM);
}

/* ---------- chevrons nas curvas fortes ---------- */
function chevrons(scene: THREE.Scene, t: Track): void {
  const chevronTexture = canvasTex(256, 96, (g, w, h) => {
    g.fillStyle = '#d5372b'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#ffffff';
    for (let x = -40; x < w + 40; x += 64) {
      g.beginPath();
      g.moveTo(x, 8); g.lineTo(x + 30, h / 2); g.lineTo(x, h - 8);
      g.lineTo(x + 16, h - 8); g.lineTo(x + 46, h / 2); g.lineTo(x + 16, 8);
      g.closePath(); g.fill();
    }
  });
  const g = new THREE.PlaneGeometry(3.2, 1.2);
  const m = new THREE.MeshStandardMaterial({ map: chevronTexture, side: THREE.DoubleSide, roughness: 0.8 });
  const post = new THREE.BoxGeometry(0.12, 1.1, 0.12);
  for (const c of t.corners) {
    if (c.sev > 3) continue;
    const i = c.apex;
    const side = c.dir === 'E' ? -1 : 1; // lado externo
    const off = ROAD_HALF + 3.2;
    const x = t.pts[i].x + t.norm[i].x * off * side;
    const z = t.pts[i].z + t.norm[i].z * off * side;
    const y = terrainH(x, z);
    const board = new THREE.Mesh(g, m);
    board.position.set(x, y + 1.7, z);
    board.lookAt(x - t.tang[i].x * 10, y + 1.7, z - t.tang[i].z * 10);
    if (c.dir === 'D') board.rotation.y += Math.PI; // setas apontam p/ dentro
    const p1 = new THREE.Mesh(post, mats.grey);
    p1.position.set(x, y + 0.55, z);
    scene.add(board, p1);
  }
}

/* ---------- pórticos ---------- */
function gantry(scene: THREE.Scene, t: Track, i: number, text: string, bg: string): void {
  const grp = new THREE.Group();
  const p = t.pts[i], nl = t.norm[i];
  const mk = (off: number) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.5, 6.4, 0.5), mats.white);
    const x = p.x + nl.x * off, z = p.z + nl.z * off;
    m.position.set(x, terrainH(x, z) + 3.2, z);
    m.castShadow = true;
    grp.add(m);
  };
  mk(7.2); mk(-7.2);
  const banner = new THREE.Mesh(new THREE.BoxGeometry(14.9, 1.7, 0.3),
    new THREE.MeshStandardMaterial({ map: bannerTex(text, bg, '#ffffff') }));
  banner.position.set(p.x, p.y + 5.9, p.z);
  banner.lookAt(p.x + t.tang[i].x, p.y + 5.9, p.z + t.tang[i].z);
  banner.castShadow = true;
  grp.add(banner);
  scene.add(grp);
}

/* ---------- faixas de patrocinadores ---------- */
function sponsors(scene: THREE.Scene, t: Track): void {
  const ads: [string, string][] = [
    ['CAFÉ MARINGÁ', '#20613b'], ['TERRA ROXA MOTORSPORT', '#7a3b23'], ['COCAMAR', '#0e5a94'],
  ];
  ads.forEach((ad, j) => {
    const i = t.START_I + 18 + j * 22, side = j % 2 ? 1 : -1;
    const p = t.pts[i], nl = t.norm[i];
    const x = p.x + nl.x * (ROAD_HALF + 3.4) * side;
    const z = p.z + nl.z * (ROAD_HALF + 3.4) * side;
    const b = new THREE.Mesh(new THREE.PlaneGeometry(9, 1.1),
      new THREE.MeshStandardMaterial({ map: bannerTex(ad[0], ad[1], '#fff'), side: THREE.DoubleSide }));
    b.position.set(x, terrainH(x, z) + 0.8, z);
    b.lookAt(x + nl.x * -side, terrainH(x, z) + 0.8, z + nl.z * -side);
    scene.add(b);
  });
}

/* ---------- Catedral de Maringá + skyline ---------- */
function cathedralAndCity(scene: THREE.Scene): void {
  const grp = new THREE.Group();
  const cone = new THREE.Mesh(new THREE.ConeGeometry(15, 105, 14, 1, false),
    new THREE.MeshStandardMaterial({ color: 0xd9dde2, roughness: 0.7, flatShading: true }));
  cone.position.y = 52.5;
  const cv = new THREE.Mesh(new THREE.BoxGeometry(0.8, 9, 0.8), mats.white);
  cv.position.y = 109;
  const ch = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.8, 0.8), mats.white);
  ch.position.y = 111;
  const base = new THREE.Mesh(new THREE.CylinderGeometry(19, 19, 4, 16), mats.grey);
  base.position.y = 2;
  grp.add(cone, cv, ch, base);
  const bx = -260, bz = -520;
  grp.position.set(bx, terrainH(bx, bz), bz);
  scene.add(grp);

  const bg = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ color: 0xb9c2cc, roughness: 1 }), 46);
  const M = new THREE.Matrix4();
  for (let j = 0; j < 46; j++) {
    const x = bx + srange(-420, 420), z = bz + srange(-260, 60);
    const w = srange(14, 30), h = srange(18, 85), d = srange(14, 30);
    M.makeScale(w, h, d);
    M.setPosition(x, terrainH(x, z) + h / 2, z);
    bg.setMatrixAt(j, M);
  }
  scene.add(bg);
}

/* ---------- fazendas ---------- */
function farms(scene: THREE.Scene, t: Track): void {
  for (let f = 0; f < 7; f++) {
    const i = Math.floor(srange(0.1, 0.9) * t.NSEG);
    const side = srand() < 0.5 ? 1 : -1, off = srange(48, 140);
    const x = t.pts[i].x + t.norm[i].x * off * side;
    const z = t.pts[i].z + t.norm[i].z * off * side;
    if (t.roadDist(x, z) < 30) continue;
    const y = terrainH(x, z);
    const g = new THREE.Group();
    const casa = new THREE.Mesh(new THREE.BoxGeometry(10, 4, 8),
      new THREE.MeshStandardMaterial({ color: [0xf0e6d4, 0xe8d0b8, 0xd9e4ea][f % 3], roughness: 0.9 }));
    casa.position.y = 2;
    casa.castShadow = true;
    const telhado = new THREE.Mesh(new THREE.ConeGeometry(8.2, 3.4, 4),
      new THREE.MeshStandardMaterial({ color: 0xa8402f, roughness: 1, flatShading: true }));
    telhado.position.y = 5.7;
    telhado.rotation.y = Math.PI / 4;
    g.add(casa, telhado);
    if (f % 2 === 0) {
      const silo = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 11, 10), mats.grey);
      silo.position.set(9, 5.5, -2);
      silo.castShadow = true;
      const topo = new THREE.Mesh(new THREE.ConeGeometry(3.3, 2.2, 10), mats.grey);
      topo.position.set(9, 12.1, -2);
      g.add(silo, topo);
    }
    g.position.set(x, y, z);
    g.rotation.y = srand() * Math.PI * 2;
    scene.add(g);
  }
}
