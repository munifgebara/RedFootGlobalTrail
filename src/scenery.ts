import * as THREE from 'three/webgpu';
import {
  positionLocal, time, sin, cos, float, vec3, hash, instanceIndex, uv, mix, color, step, abs, fract,
} from 'three/tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { terrainH, fieldNoise } from './terrain';
import type { Track } from './track';
import { ROAD_HALF } from './track';
import { DistanceLod } from './lod';
import { buildLogoMonument, drawFoot } from './logo';

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

function bannerTex(text: string, bg: string, fg: string, feet = false): THREE.CanvasTexture {
  return canvasTex(1024, 128, (g, w, h) => {
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(255,255,255,.35)'; g.lineWidth = 6; g.strokeRect(6, 6, w - 12, h - 12);
    g.fillStyle = fg; g.font = `900 ${feet ? 64 : 76}px "Segoe UI", sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, w / 2, h / 2 + 4);
    if (feet) {
      drawFoot(g, 72, h / 2 + 10, 24, '#ffffff');
      drawFoot(g, w - 72, h / 2 + 10, 24, '#ffffff');
    }
  });
}

const mats = {
  trunk: new THREE.MeshStandardMaterial({ color: 0x6b4a30, roughness: 1 }),
  wood: new THREE.MeshStandardMaterial({ color: 0x8a6a48, roughness: 1 }),
  white: new THREE.MeshStandardMaterial({ color: 0xf2f0ea, roughness: 0.8 }),
  grey: new THREE.MeshStandardMaterial({ color: 0x9aa0a8, roughness: 0.9 }),
};

/** Copa "amassada" (icosaedro com vértices deslocados). */
function lumpyCanopy(radius: number, detail = 1): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(radius, detail);
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

export interface SceneryController {
  update(camPos: THREE.Vector3, dt: number): void;
}

export function buildScenery(scene: THREE.Scene, t: Track): SceneryController {
  const lods: DistanceLod[] = [];
  const DEBUG_DISABLE = new URLSearchParams(location.search).get('off') ?? '';
  if (!DEBUG_DISABLE.includes('trees')) lods.push(trees(scene, t));
  if (!DEBUG_DISABLE.includes('coffee')) lods.push(coffee(scene, t));
  if (!DEBUG_DISABLE.includes('grass')) lods.push(grassTufts(scene, t));
  if (!DEBUG_DISABLE.includes('rocks')) rocks(scene, t);
  fences(scene, t);
  poles(scene, t);
  chevrons(scene, t);
  gantry(scene, t, t.START_I, 'RED FOOT GLOBAL TRAIL', '#c81e14', true);
  gantry(scene, t, t.FINISH_I, 'CHEGADA', '#111418');
  sponsors(scene, t);
  cathedralAndCity(scene);
  farms(scene, t);

  // monumento da logo girando ao lado da largada
  const monument = buildLogoMonument(3);
  if (!DEBUG_DISABLE.includes('logo')) {
    // longe o bastante para a câmera orbital do menu não atravessá-lo
    const i = t.START_I - 16, side = 1;
    const x = t.pts[i].x + t.norm[i].x * (ROAD_HALF + 14) * side;
    const z = t.pts[i].z + t.norm[i].z * (ROAD_HALF + 14) * side;
    monument.position.set(x, terrainH(x, z), z);
    scene.add(monument);
  }

  return {
    update(camPos: THREE.Vector3, dt: number): void {
      for (const l of lods) l.update(camPos, dt);
      (monument.userData.foot as THREE.Object3D).rotation.y += dt * 0.5;
    },
  };
}

/* ================= árvores com 3 níveis de detalhe ================= */
function trees(scene: THREE.Scene, t: Track): DistanceLod {
  const N = 560;
  const lod = new DistanceLod();

  // --- geometrias: tronco (base em y=0) ---
  const trunkMedG = new THREE.CylinderGeometry(0.32, 0.5, 4.6, 6);
  trunkMedG.translate(0, 2.3, 0);
  const branch1 = new THREE.CylinderGeometry(0.09, 0.16, 2.2, 6);
  branch1.translate(0, 1.1, 0); branch1.rotateZ(0.62); branch1.translate(0.22, 2.6, 0);
  const branch2 = new THREE.CylinderGeometry(0.07, 0.13, 1.8, 6);
  branch2.translate(0, 0.9, 0); branch2.rotateZ(-0.55); branch2.rotateY(2.1); branch2.translate(-0.15, 3.1, 0.1);
  const trunkHiCore = new THREE.CylinderGeometry(0.26, 0.52, 5.0, 9);
  trunkHiCore.translate(0, 2.5, 0);
  const trunkHiG = mergeGeometries([trunkHiCore, branch1, branch2])!;

  // --- copas (centradas na origem local) ---
  const canMedG = lumpyCanopy(3.1, 1);
  const lobes: THREE.BufferGeometry[] = [lumpyCanopy(2.5, 1)];
  const lobeOffsets: [number, number, number, number][] = [
    [1.55, 0.55, 0.35, 0.72], [-1.35, 0.25, -0.85, 0.66], [0.25, 1.55, 0.85, 0.6], [-0.45, -0.4, 1.35, 0.5],
  ];
  for (const [x, y, z, s] of lobeOffsets) {
    const l = lumpyCanopy(2.5, 1);
    l.scale(s, s, s);
    l.translate(x, y, z);
    lobes.push(l);
  }
  const canHiG = mergeGeometries(lobes)!;

  // material da copa com vento (compartilhado pelos níveis hi e médio)
  const canMat = new THREE.MeshStandardNodeMaterial({ roughness: 1, flatShading: true });
  const phase = hash(instanceIndex).mul(6.283);
  const sway = vec3(sin(time.mul(0.9).add(phase)), float(0), cos(time.mul(1.1).add(phase)))
    .mul(positionLocal.y.max(0).mul(0.035));
  canMat.positionNode = positionLocal.add(sway);

  // --- billboard (textura em tons de cinza, tintada por instância) ---
  const billTex = canvasTex(128, 128, (g) => {
    g.clearRect(0, 0, 128, 128);
    g.fillStyle = '#7d6250';
    g.fillRect(58, 68, 12, 60);
    g.fillStyle = '#c9c9c9';
    for (const [x, y, r] of [[64, 44, 34], [40, 56, 22], [90, 58, 22], [64, 66, 26]] as const) {
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    }
  });
  const billG = new THREE.PlaneGeometry(7, 8.4);
  billG.translate(0, 4.2, 0);
  const billMat = new THREE.MeshStandardMaterial({
    map: billTex, alphaTest: 0.5, roughness: 1, side: THREE.DoubleSide,
  });

  lod.addLevel(130, [
    { geometry: trunkHiG, material: mats.trunk, matrixIndex: 0, useColor: false, castShadow: true },
    { geometry: canHiG, material: canMat, matrixIndex: 1, useColor: true, castShadow: true },
  ]);
  lod.addLevel(460, [
    { geometry: trunkMedG, material: mats.trunk, matrixIndex: 0, useColor: false, castShadow: true },
    { geometry: canMedG, material: canMat, matrixIndex: 1, useColor: true, castShadow: true },
  ]);
  lod.addLevel(1500, [{ geometry: billG, material: billMat, matrixIndex: -1, useColor: true }]);
  scene.add(lod.group);

  // --- distribuição ---
  const Q = new THREE.Quaternion(), S = new THREE.Vector3(), P = new THREE.Vector3();
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
    const trunkM = new THREE.Matrix4().compose(P.set(x, y, z), Q, S.set(s, s, s));
    const canM = new THREE.Matrix4().compose(
      P.set(x + srange(-0.4, 0.4), y + 5.7 * s, z + srange(-0.4, 0.4)),
      Q, S.set(s, s * srange(0.85, 1.15), s));
    lod.items.push({
      pos: new THREE.Vector3(x, y + 4 * s, z),
      scale: s,
      color: new THREE.Color(palette[Math.floor(srand() * palette.length)])
        .offsetHSL(0, 0, srange(-0.04, 0.04)),
      matrices: [trunkM, canM],
    });
    placed++;
  }
  return lod;
}

/* ================= cafezal (some além de ~650 m) ================= */
function coffee(scene: THREE.Scene, t: Track): DistanceLod {
  const N = 1600;
  const lod = new DistanceLod();
  const g = new THREE.SphereGeometry(0.85, 6, 5);
  g.scale(1, 1.25, 1);
  lod.addLevel(650, [{
    geometry: g,
    material: new THREE.MeshStandardMaterial({ color: 0x36592d, roughness: 1, flatShading: true }),
    matrixIndex: 0, useColor: false, castShadow: true,
  }]);
  scene.add(lod.group);

  const Q = new THREE.Quaternion(), S = new THREE.Vector3(), P = new THREE.Vector3();
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
    const y = terrainH(x, z);
    const M = new THREE.Matrix4().compose(P.set(x, y + 0.9 * s, z), Q.identity(), S.set(s, s, s));
    lod.items.push({ pos: new THREE.Vector3(x, y, z), scale: s, matrices: [M] });
    placed++;
  }
  return lod;
}

/* ================= capim denso só perto da câmera ================= */
function grassTufts(scene: THREE.Scene, t: Track): DistanceLod {
  const N = 7000;
  const lod = new DistanceLod();
  const p1 = new THREE.PlaneGeometry(1, 1);
  const p2 = new THREE.PlaneGeometry(1, 1);
  p2.rotateY(Math.PI / 2);
  const geo = mergeGeometries([p1, p2])!;
  geo.translate(0, 0.5, 0);

  const mat = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
  const vT = uv().y;
  const tri = abs(fract(uv().x.mul(3)).sub(0.5)).mul(2);
  const halfW = mix(float(0.85), float(0.10), vT);
  mat.opacityNode = step(tri, halfW);
  mat.alphaTest = 0.5;
  const shade = hash(instanceIndex.add(17)).mul(0.35).add(0.75);
  mat.colorNode = mix(color(0x41682c), color(0x8fbf4e), vT).mul(shade);
  const phase = hash(instanceIndex).mul(6.283);
  const bend = sin(time.mul(1.7).add(phase)).mul(vT.mul(vT)).mul(0.14);
  mat.positionNode = positionLocal.add(vec3(bend, 0, bend.mul(0.6)));

  lod.addLevel(175, [{ geometry: geo, material: mat, matrixIndex: 0, useColor: false }]);
  scene.add(lod.group);

  const Q = new THREE.Quaternion(), S = new THREE.Vector3(), P = new THREE.Vector3();
  let placed = 0, tries = 0;
  while (placed < N && tries < N * 20) {
    tries++;
    const i = Math.floor(srand() * t.NSEG);
    const side = srand() < 0.5 ? 1 : -1;
    const off = srange(ROAD_HALF + 2.2, 46);
    const x = t.pts[i].x + t.norm[i].x * off * side + srange(-3, 3);
    const z = t.pts[i].z + t.norm[i].z * off * side + srange(-3, 3);
    if (t.roadDist(x, z) < ROAD_HALF + 1.6) continue;
    const s = srange(0.5, 1.15);
    Q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), srand() * Math.PI * 2);
    const y = terrainH(x, z);
    const M = new THREE.Matrix4().compose(P.set(x, y, z), Q, S.set(s * srange(0.8, 1.4), s, s));
    lod.items.push({ pos: new THREE.Vector3(x, y, z), scale: s, matrices: [M] });
    placed++;
  }
  return lod;
}

/* ================= pedras na beira da estrada ================= */
function rocks(scene: THREE.Scene, t: Track): void {
  const N = 300;
  const g = new THREE.DodecahedronGeometry(0.5, 0);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    v.multiplyScalar(0.8 + Math.abs(Math.sin(v.x * 12.3) * Math.cos(v.z * 9.1)) * 0.45);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  const mesh = new THREE.InstancedMesh(g,
    new THREE.MeshStandardMaterial({ roughness: 0.95, flatShading: true }), N);
  mesh.castShadow = true;
  mesh.frustumCulled = false;
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(),
        S = new THREE.Vector3(), P = new THREE.Vector3();
  let placed = 0, tries = 0;
  while (placed < N && tries < N * 25) {
    tries++;
    const i = Math.floor(srand() * t.NSEG);
    const side = srand() < 0.5 ? 1 : -1, off = srange(ROAD_HALF + 1.8, 55);
    const x = t.pts[i].x + t.norm[i].x * off * side + srange(-4, 4);
    const z = t.pts[i].z + t.norm[i].z * off * side + srange(-4, 4);
    if (t.roadDist(x, z) < ROAD_HALF + 1.2) continue;
    const s = srange(0.14, 0.75);
    Q.setFromEuler(new THREE.Euler(srand() * 3, srand() * 3, srand() * 3));
    M.compose(P.set(x, terrainH(x, z) + s * 0.25, z), Q, S.set(s, s * srange(0.6, 1), s));
    mesh.setMatrixAt(placed, M);
    mesh.setColorAt(placed, new THREE.Color().setHSL(0.07, srange(0.05, 0.22), srange(0.32, 0.55)));
    placed++;
  }
  mesh.count = placed;
  scene.add(mesh);
}

/* ================= cercas ================= */
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

/* ================= postes rurais ================= */
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

/* ================= chevrons nas curvas fortes ================= */
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
    const side = c.dir === 'E' ? -1 : 1;
    const off = ROAD_HALF + 3.2;
    const x = t.pts[i].x + t.norm[i].x * off * side;
    const z = t.pts[i].z + t.norm[i].z * off * side;
    const y = terrainH(x, z);
    const board = new THREE.Mesh(g, m);
    board.position.set(x, y + 1.7, z);
    board.lookAt(x - t.tang[i].x * 10, y + 1.7, z - t.tang[i].z * 10);
    if (c.dir === 'D') board.rotation.y += Math.PI;
    const p1 = new THREE.Mesh(post, mats.grey);
    p1.position.set(x, y + 0.55, z);
    scene.add(board, p1);
  }
}

/* ================= pórticos ================= */
function gantry(scene: THREE.Scene, t: Track, i: number, text: string, bg: string, feet = false): void {
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
    new THREE.MeshStandardMaterial({ map: bannerTex(text, bg, '#ffffff', feet) }));
  banner.position.set(p.x, p.y + 5.9, p.z);
  banner.lookAt(p.x + t.tang[i].x, p.y + 5.9, p.z + t.tang[i].z);
  banner.castShadow = true;
  grp.add(banner);
  scene.add(grp);
}

/* ================= faixas de patrocinadores ================= */
function sponsors(scene: THREE.Scene, t: Track): void {
  const ads: [string, string, boolean][] = [
    ['RED FOOT GLOBAL TRAIL', '#b3170a', true],
    ['CAFÉ MARINGÁ', '#20613b', false],
    ['TERRA ROXA MOTORSPORT', '#7a3b23', false],
    ['COCAMAR', '#0e5a94', false],
  ];
  ads.forEach((ad, j) => {
    const i = t.START_I + 16 + j * 20, side = j % 2 ? 1 : -1;
    const p = t.pts[i], nl = t.norm[i];
    const x = p.x + nl.x * (ROAD_HALF + 3.4) * side;
    const z = p.z + nl.z * (ROAD_HALF + 3.4) * side;
    const b = new THREE.Mesh(new THREE.PlaneGeometry(9, 1.1),
      new THREE.MeshStandardMaterial({ map: bannerTex(ad[0], ad[1], '#fff', ad[2]), side: THREE.DoubleSide }));
    b.position.set(x, terrainH(x, z) + 0.8, z);
    b.lookAt(x + nl.x * -side, terrainH(x, z) + 0.8, z + nl.z * -side);
    scene.add(b);
  });
}

/* ================= Catedral de Maringá + skyline ================= */
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

/* ================= fazendas ================= */
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
