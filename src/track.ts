import * as THREE from 'three/webgpu';
import {
  uv, positionWorld, mx_noise_float, color, float, vec3, smoothstep, mix, attribute,
} from 'three/tsl';
import { terrainH } from './terrain';
import { cloudShadowNode } from './sky';

export const ROAD_HALF = 4.3;
export const DS = 2.5;

/* ---------- traçado da especial ---------- */
const CTRL: [number, number][] = [
  [0, -260], [0, -120], [0, 0], [12, 180], [64, 330], [165, 420], [300, 462], [430, 420],
  [520, 300], [535, 185], [505, 120], [560, 60], [660, 30], [762, 12], [900, 62], [980, 192], [962, 340],
  [1032, 482], [1172, 532], [1322, 502], [1442, 402], [1462, 252], [1562, 142],
  [1702, 122], [1842, 182], [1922, 312], [1902, 472], [1982, 612], [2132, 662],
  [2292, 632], [2402, 522], [2422, 372], [2455, 318], [2420, 278], [2470, 238], [2560, 250], [2672, 242], [2812, 302],
  [2872, 442], [2842, 592], [2922, 732], [3072, 782], [3232, 752], [3342, 642],
  [3362, 492], [3302, 352], [3302, 210],
];

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
  const curve = new THREE.CatmullRomCurve3(
    CTRL.map((p) => new THREE.Vector3(p[0], 0, p[1])), false, 'catmullrom', 0.35);
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
  const roadDist = (x: number, z: number) => {
    let best = 1e9;
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      const arr = grid.get((cx + dx) + '_' + (cz + dz));
      if (!arr) continue;
      for (const i of arr) {
        const ddx = pts[i].x - x, ddz = pts[i].z - z;
        const d = ddx * ddx + ddz * ddz;
        if (d < best) best = d;
      }
    }
    return Math.sqrt(best);
  };

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
          corners.push({
            at: st * DS, endAt: i * DS, dir: sign > 0 ? 'D' : 'E',
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

/** Estrada de terra roxa — cor 100% procedural em TSL (trilhos de pneu,
 *  bordas escurecidas, grão e variação ao longo do percurso). */
export function buildRoad(t: Track): THREE.Group {
  const grp = new THREE.Group();

  const mat = new THREE.MeshStandardNodeMaterial({ roughness: 1, metalness: 0 });
  const u = uv().x, v = uv().y;
  const rutL = smoothstep(0.17, 0.03, u.sub(0.30).abs());
  const rutR = smoothstep(0.17, 0.03, u.sub(0.70).abs());
  const ruts = rutL.add(rutR).clamp(0, 1);
  const edge = smoothstep(0.0, 0.10, u).mul(smoothstep(1.0, 0.90, u));
  const nAlong = mx_noise_float(vec3(u.mul(14), v.mul(3.5), 1.7));
  const nFine = mx_noise_float(positionWorld.mul(1.6));
  const base = mix(color(0x7a4a33), color(0x54301f), ruts.mul(0.55));
  mat.colorNode = base
    .mul(float(0.9).add(nAlong.mul(0.10)).add(nFine.mul(0.08)))
    .mul(float(0.78).add(edge.mul(0.22)))
    .mul(float(1.0).sub(cloudShadowNode().mul(0.18)));
  // trilhos de pneu levemente mais "polidos" (brilho de terra compactada)
  mat.roughnessNode = float(1.0).sub(ruts.mul(0.25));

  const road = new THREE.Mesh(ribbonGeometry(t, -ROAD_HALF, ROAD_HALF), mat);
  road.receiveShadow = true;
  grp.add(road);

  // acostamentos: terra → grama
  const cDirt = new THREE.Color(0x6e4530), cGrass = new THREE.Color(0x86ad52);
  const shoulderMat = new THREE.MeshStandardNodeMaterial({ roughness: 1 });
  const nSh = mx_noise_float(positionWorld.mul(0.9));
  shoulderMat.colorNode = attribute('color', 'vec3')
    .mul(float(0.95).add(nSh.mul(0.1)))
    .mul(float(1.0).sub(cloudShadowNode().mul(0.20)));
  for (const [a, b] of [[ROAD_HALF - 0.1, ROAD_HALF + 3.4], [-(ROAD_HALF - 0.1), -(ROAD_HALF + 3.4)]]) {
    const m = new THREE.Mesh(ribbonGeometry(t, a, b, cDirt, cGrass), shoulderMat);
    m.receiveShadow = true;
    grp.add(m);
  }
  return grp;
}
