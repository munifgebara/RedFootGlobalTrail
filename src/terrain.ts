import * as THREE from 'three/webgpu';
import {
  attribute, positionWorld, positionView, mx_noise_float,
  float, sin, smoothstep, vec3,
} from 'three/tsl';
import { cloudShadowNode } from './sky';

import eco from './data/ecogarden.json';

/**
 * Relevo REAL: grade de elevação SRTM (30 m) da região do Ecogarden em
 * Maringá, assada em src/data/ecogarden.json pelo tools/build-map.mjs.
 * Amostragem bilinear com clamp nas bordas + micro-relevo procedural
 * por cima (a SRTM não enxerga ondulações menores que ~30 m).
 */
const G = eco.grid;
function gridH(x: number, z: number): number {
  const fx = Math.min(Math.max((x - G.x0) / G.dx, 0), G.nx - 1.001);
  const fz = Math.min(Math.max((z - G.z0) / G.dx, 0), G.nz - 1.001);
  const i = Math.floor(fx), k = Math.floor(fz);
  const tx = fx - i, tz = fz - k;
  const h00 = G.h[k * G.nx + i], h10 = G.h[k * G.nx + i + 1];
  const h01 = G.h[(k + 1) * G.nx + i], h11 = G.h[(k + 1) * G.nx + i + 1];
  return (h00 * (1 - tx) + h10 * tx) * (1 - tz) + (h01 * (1 - tx) + h11 * tx) * tz;
}
/**
 * "Terraplanagem" contínua: buildTrack registra um grader que mistura a
 * altura do terreno com o perfil suavizado da estrada num corredor — assim
 * a pista respeita rampa máx. de 12% mesmo onde o SRTM é íngreme/ruidoso,
 * e física, fita da estrada e cenário continuam usando a MESMA função.
 */
let roadGrader: ((x: number, z: number, h: number) => number) | null = null;
export function setRoadGrader(fn: (x: number, z: number, h: number) => number): void {
  roadGrader = fn;
}

export function terrainH(x: number, z: number): number {
  const h = gridH(x, z) + 0.9 * Math.sin(x * 0.019) * Math.cos(z * 0.016 + 1.1);
  return roadGrader ? roadGrader(x, z, h) : h;
}

export function terrainNormal(x: number, z: number): THREE.Vector3 {
  const e = 1.5;
  const hx = terrainH(x + e, z) - terrainH(x - e, z);
  const hz = terrainH(x, z + e) - terrainH(x, z - e);
  return new THREE.Vector3(-hx / (2 * e), 1, -hz / (2 * e)).normalize();
}

/** Ruído de talhões (mesma fórmula usada para posicionar cafezais). */
export function fieldNoise(x: number, z: number): number {
  return Math.sin(x * 0.0016 + 2.0) * Math.cos(z * 0.0019 + 0.7)
       + 0.55 * Math.sin(x * 0.0007 - z * 0.0009);
}

/**
 * Terreno com cores por vértice (talhões de soja/café/pasto/colheita e
 * corredor desgastado junto à estrada) + detalhe procedural por fragmento
 * via TSL: ruído em duas escalas e linhas de plantio que somem à distância.
 */
export function buildTerrain(roadDist: (x: number, z: number) => number): THREE.Mesh {
  const SZ = 6200, SEG = 300;
  const geo = new THREE.PlaneGeometry(SZ, SZ, SEG, SEG);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  const fieldFlag = new Float32Array(pos.count); // 1 = lavoura em fileiras
  const cSoy = new THREE.Color(0x6fa844), cCafe = new THREE.Color(0x3f6b35),
        cWheat = new THREE.Color(0xc4a45a), cPasto = new THREE.Color(0x8cb457),
        cWorn = new THREE.Color(0x9b7a4e);
  const tmp = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) + 1500, z = pos.getZ(i) + 250;
    pos.setX(i, x); pos.setZ(i, z);
    pos.setY(i, terrainH(x, z) - 0.12);
    const f = fieldNoise(x, z);
    let rows = 0;
    if (f > 0.55) { tmp.copy(cCafe); rows = 1; }
    else if (f > 0.05) { tmp.copy(cSoy); rows = 1; }
    else if (f > -0.45) tmp.copy(cPasto);
    else { tmp.copy(cWheat); rows = 1; }
    tmp.offsetHSL(0, 0, Math.sin(x * 0.11) * Math.cos(z * 0.13) * 0.02);
    const d = roadDist(x, z);
    if (d < 26) { tmp.lerp(cWorn, Math.max(0, 1 - d / 26) * 0.55); rows = 0; }
    colors[i * 3] = tmp.r; colors[i * 3 + 1] = tmp.g; colors[i * 3 + 2] = tmp.b;
    fieldFlag[i] = rows;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setAttribute('aField', new THREE.BufferAttribute(fieldFlag, 1));
  geo.computeVertexNormals();

  const mat = new THREE.MeshStandardNodeMaterial({ roughness: 1, metalness: 0 });
  const vcol = attribute('color', 'vec3');
  const fField = attribute('aField', 'float');
  const nBig = mx_noise_float(positionWorld.mul(0.045));           // manchas ~20 m
  const nSmall = mx_noise_float(positionWorld.mul(0.6));           // grão fino
  const viewDist = positionView.z.negate();
  const rowFade = smoothstep(float(520), float(60), viewDist);
  const rows = sin(positionWorld.x.mul(1.15)).mul(fField).mul(rowFade).mul(0.09);
  const detail = float(1.0).add(nBig.mul(0.11)).add(nSmall.mul(0.07)).add(rows);
  const cloud = float(1.0).sub(cloudShadowNode().mul(0.22));
  mat.colorNode = vcol.mul(detail).mul(cloud).max(0.0);

  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  return mesh;
}
