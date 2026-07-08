import * as THREE from 'three/webgpu';
import {
  uv, positionWorld, mx_noise_float, color, float, vec2, vec3, smoothstep, mix, attribute,
  texture, normalMap,
} from 'three/tsl';
import type { GameAssets } from './assets';
import { terrainH, setRoadGrader } from './terrain';
import { cloudShadowNode } from './sky';

export const ROAD_HALF = 4.3;
export const DS = 2.5;

/* ---------- traçado da especial: ruas/estradas reais (OSM) ---------- */
import eco from './data/ecogarden.json';
const CTRL: [number, number][] = eco.route as [number, number][];

export interface Corner {
  at: number; endAt: number; dir: 'E' | 'D'; sev: number; long: boolean;
  apex: number; called: boolean;
}

export interface Track {
  pts: THREE.Vector3[];
  tang: THREE.Vector3[];
  norm: THREE.Vector3[];
  NSEG: number;
  START_I: number;
  FINISH_I: number;
  RACE_KM: number;
  corners: Corner[];
  roadDist(x: number, z: number): number;
}

export function buildTrack(): Track {
  // 'centripetal' evita loops/overshoot com pontos reais de espaçamento irregular
  const curve = new THREE.CatmullRomCurve3(
    CTRL.map((p) => new THREE.Vector3(p[0], 0, p[1])), false, 'centripetal');
  const len = curve.getLength();
  const NSEG = Math.floor(len / DS);
  const pts = curve.getSpacedPoints(NSEG);
  const tang: THREE.Vector3[] = [], norm: THREE.Vector3[] = [];
  for (let i = 0; i <= NSEG; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(NSEG, i + 1)];
    const t = new THREE.Vector3().subVectors(b, a).normalize();
    tang.push(t);
    norm.push(new THREE.Vector3(-t.z, 0, t.x)); // esquerda
    pts[i].y = terrainH(pts[i].x, pts[i].z);
  }
  const START_I = Math.round(180 / DS);
  const FINISH_I = NSEG - Math.round(120 / DS);

  // hash espacial p/ distância à pista
  const CELL = 42, grid = new Map<string, number[]>();
  const gk = (x: number, z: number) => Math.floor(x / CELL) + '_' + Math.floor(z / CELL);
  for (let i = 0; i <= NSEG; i++) {
    const k = gk(pts[i].x, pts[i].z);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k)!.push(i);
  }
  const roadNearest = (x: number, z: number): { d: number; i: number } => {
    let best = 1e18, bi = -1;
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      const arr = grid.get((cx + dx) + '_' + (cz + dz));
      if (!arr) continue;
      for (const i of arr) {
        const ddx = pts[i].x - x, ddz = pts[i].z - z;
        const d = ddx * ddx + ddz * ddz;
        if (d < best) { best = d; bi = i; }
      }
    }
    return { d: Math.sqrt(best), i: bi };
  };
  const roadDist = (x: number, z: number) => roadNearest(x, z).d;

  /* ---------- perfil da estrada: suave e com rampa limitada ---------- */
  const prof = new Float32Array(NSEG + 1);
  for (let i = 0; i <= NSEG; i++) prof[i] = terrainH(pts[i].x, pts[i].z);
  for (let pass = 0; pass < 2; pass++) {
    const src = prof.slice();
    for (let i = 0; i <= NSEG; i++) {
      let s = 0, c = 0;
      for (let j = -12; j <= 12; j++) {
        const k = i + j;
        if (k >= 0 && k <= NSEG) { s += src[k]; c++; }
      }
      prof[i] = s / c;
    }
    const maxDy = 0.12 * DS; // 12%
    for (let i = 1; i <= NSEG; i++) {
      prof[i] = Math.max(prof[i - 1] - maxDy, Math.min(prof[i - 1] + maxDy, prof[i]));
    }
    for (let i = NSEG - 1; i >= 0; i--) {
      prof[i] = Math.max(prof[i + 1] - maxDy, Math.min(prof[i + 1] + maxDy, prof[i]));
    }
  }
  for (let i = 0; i <= NSEG; i++) pts[i].y = prof[i];

  // corte/aterro contínuo: pista plana no perfil, encostas fundem a ~90 m
  // (fade largo — a malha do terreno tem ~13 m entre vértices)
  setRoadGrader((x, z, h) => {
    const n = roadNearest(x, z);
    if (n.i < 0 || n.d > 90) return h;
    const w = n.d < 9 ? 1 : 1 - (n.d - 9) / 81;
    const ws = w * w * (3 - 2 * w); // smoothstep
    return h * (1 - ws) + prof[n.i] * ws;
  });

  /* ---------- pacenotes ---------- */
  const kappa = new Float32Array(NSEG + 1);
  for (let i = 1; i < NSEG; i++) {
    const a = tang[i - 1], b = tang[i + 1];
    let dA = Math.atan2(b.x, b.z) - Math.atan2(a.x, a.z);
    while (dA > Math.PI) dA -= Math.PI * 2;
    while (dA < -Math.PI) dA += Math.PI * 2;
    kappa[i] = dA / (2 * DS);
  }
  const kS = new Float32Array(NSEG + 1);
  for (let i = 0; i <= NSEG; i++) {
    let s = 0, c = 0;
    for (let j = -3; j <= 3; j++) {
      const k = i + j;
      if (k >= 0 && k <= NSEG) { s += kappa[k]; c++; }
    }
    kS[i] = s / c;
  }
  const sevFromR = (r: number) => r < 16 ? 1 : r < 28 ? 2 : r < 45 ? 3 : r < 72 ? 4 : r < 115 ? 5 : 6;
  const corners: Corner[] = [];
  {
    const TH = 1 / 170;
    let i = START_I;
    while (i < FINISH_I) {
      if (Math.abs(kS[i]) > TH) {
        const sign = Math.sign(kS[i]); const st = i; let maxK = 0;
        while (i < FINISH_I && Math.sign(kS[i]) === sign && Math.abs(kS[i]) > TH * 0.6) {
          maxK = Math.max(maxK, Math.abs(kS[i])); i++;
        }
        const clen = (i - st) * DS;
        if (clen > 10 && maxK > TH) {
          // kappa positivo = heading crescendo = curva à ESQUERDA (y-up, z-frente)
          corners.push({
            at: st * DS, endAt: i * DS, dir: sign > 0 ? 'E' : 'D',
            sev: sevFromR(1 / maxK), long: clen > 85,
            apex: Math.floor((st + i) / 2), called: false,
          });
        }
      } else i++;
    }
  }

  return {
    pts, tang, norm, NSEG, START_I, FINISH_I,
    RACE_KM: (FINISH_I - START_I) * DS / 1000,
    corners, roadDist,
  };
}

/* ---------- malhas da estrada ---------- */
function ribbonGeometry(t: Track, halfIn: number, halfOut: number,
                        colorIn?: THREE.Color, colorOut?: THREE.Color): THREE.BufferGeometry {
  const n = t.NSEG + 1;
  const posArr = new Float32Array(n * 2 * 3), uvArr = new Float32Array(n * 2 * 2);
  const colArr = colorIn && colorOut ? new Float32Array(n * 2 * 3) : null;
  const idx: number[] = [];
  for (let i = 0; i < n; i++) {
    const p = t.pts[i], nl = t.norm[i];
    const lx = p.x + nl.x * halfIn, lz = p.z + nl.z * halfIn;
    const rx = p.x + nl.x * halfOut, rz = p.z + nl.z * halfOut;
    posArr.set([lx, terrainH(lx, lz) + 0.09, lz], i * 6);
    posArr.set([rx, terrainH(rx, rz) + 0.07, rz], i * 6 + 3);
    uvArr.set([0, i * DS / 8, 1, i * DS / 8], i * 4);
    if (colArr && colorIn && colorOut) {
      colArr.set([colorIn.r, colorIn.g, colorIn.b], i * 6);
      colArr.set([colorOut.r, colorOut.g, colorOut.b], i * 6 + 3);
    }
    if (i < n - 1) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uvArr, 2));
  if (colArr) g.setAttribute('color', new THREE.BufferAttribute(colArr, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Estrada de terra roxa — PBR real (Poly Haven red_dirt_mud_01, CC0) +
 *  trilhos de pneu, bordas e sombras de nuvens procedurais em TSL. */
export function buildRoad(t: Track, assets: GameAssets): THREE.Group {
  const grp = new THREE.Group();

  const mat = new THREE.MeshStandardNodeMaterial({ metalness: 0 });
  const u = uv().x, v = uv().y;
  const rutL = smoothstep(0.17, 0.03, u.sub(0.30).abs());
  const rutR = smoothstep(0.17, 0.03, u.sub(0.70).abs());
  const ruts = rutL.add(rutR).clamp(0, 1);
  const edge = smoothstep(0.0, 0.10, u).mul(smoothstep(1.0, 0.90, u));
  const roadUV = vec2(u, v);                       // 1 tile na largura, 1 a cada 8 m
  const diff = texture(assets.road.map, roadUV);
  const arm = texture(assets.road.arm, roadUV);
  mat.colorNode = diff.rgb
    .mul(arm.r.mul(0.6).add(0.4))                  // oclusão assada
    .mul(float(1.0).sub(ruts.mul(0.30)))           // trilhos de pneu escurecidos
    .mul(float(0.80).add(edge.mul(0.20)))
    .mul(float(1.0).sub(cloudShadowNode().mul(0.18)));
  mat.normalNode = normalMap(texture(assets.road.nor, roadUV));
  mat.roughnessNode = arm.g.sub(ruts.mul(0.2)).clamp(0.3, 1);

  const road = new THREE.Mesh(ribbonGeometry(t, -ROAD_HALF, ROAD_HALF), mat);
  road.receiveShadow = true;
  grp.add(road);

  // acostamentos: terra → grama
  const cDirt = new THREE.Color(0x6e4530), cGrass = new THREE.Color(0x86ad52);
  const shoulderMat = new THREE.MeshStandardNodeMaterial({ roughness: 1 });
  const shUV = positionWorld.xz.mul(0.12);
  shoulderMat.colorNode = attribute('color', 'vec3')
    .mul(texture(assets.ground.map, shUV).rgb.mul(1.8))
    .mul(float(1.0).sub(cloudShadowNode().mul(0.20)));
  shoulderMat.normalNode = normalMap(texture(assets.ground.nor, shUV));
  for (const [a, b] of [[ROAD_HALF - 0.1, ROAD_HALF + 3.4], [-(ROAD_HALF - 0.1), -(ROAD_HALF + 3.4)]]) {
    const m = new THREE.Mesh(ribbonGeometry(t, a, b, cDirt, cGrass), shoulderMat);
    m.receiveShadow = true;
    grp.add(m);
  }
  return grp;
}
