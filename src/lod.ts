import * as THREE from 'three/webgpu';

/**
 * LOD por distância para malhas instanciadas.
 *
 * Cada item (árvore, arbusto…) guarda matrizes prontas por "parte"
 * (ex.: tronco e copa). Periodicamente os itens são re-bucketados nos
 * níveis conforme a distância da câmera; o nível "billboard"
 * (matrixIndex -1) recompõe a matriz apontando o plano para a câmera.
 *
 * Importante (WebGPU): cada InstancedMesh é limitado a CHUNK instâncias —
 * o binding das matrizes não pode passar de 64 KB (limite de uniform
 * buffer), então cada parte é fatiada em vários sub-meshes.
 */

const CHUNK = 1000;

export interface LodItem {
  pos: THREE.Vector3;
  scale: number;
  color?: THREE.Color;
  matrices: THREE.Matrix4[];   // uma por parte (índice = matrixIndex)
}

export interface LodPartSpec {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  matrixIndex: number;         // -1 => billboard (compõe de pos/scale)
  useColor: boolean;
  castShadow?: boolean;
}

interface LodPart extends LodPartSpec {
  chunks: THREE.InstancedMesh[];
}

interface LodLevel {
  maxDist: number;
  parts: LodPart[];
}

export class DistanceLod {
  items: LodItem[] = [];
  group = new THREE.Group();
  private levels: LodLevel[] = [];
  private cooldown = 0;
  private lastCam = new THREE.Vector3(1e9, 1e9, 1e9);
  private tmpQ = new THREE.Quaternion();
  private tmpM = new THREE.Matrix4();
  private tmpS = new THREE.Vector3();
  private up = new THREE.Vector3(0, 1, 0);

  addLevel(maxDist: number, parts: LodPartSpec[]): void {
    this.levels.push({ maxDist, parts: parts.map((p) => ({ ...p, chunks: [] })) });
    this.levels.sort((a, b) => a.maxDist - b.maxDist);
  }

  private chunkFor(part: LodPart, slot: number): { mesh: THREE.InstancedMesh; local: number } {
    const ci = Math.floor(slot / CHUNK);
    while (part.chunks.length <= ci) {
      const m = new THREE.InstancedMesh(part.geometry, part.material, CHUNK);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.castShadow = part.castShadow ?? false;
      m.frustumCulled = false;
      m.count = 0;
      m.visible = false;
      part.chunks.push(m);
      this.group.add(m);
    }
    return { mesh: part.chunks[ci], local: slot % CHUNK };
  }

  /** Re-bucketa (barato: só roda a cada ~0.33 s ou quando a câmera anda). */
  update(camPos: THREE.Vector3, dt: number): void {
    this.cooldown -= dt;
    if (this.cooldown > 0 && camPos.distanceToSquared(this.lastCam) < 15 * 15) return;
    this.cooldown = 0.33;
    this.lastCam.copy(camPos);

    const counts = this.levels.map(() => 0);
    for (const item of this.items) {
      const d = item.pos.distanceTo(camPos);
      let li = -1;
      for (let l = 0; l < this.levels.length; l++) {
        if (d <= this.levels[l].maxDist) { li = l; break; }
      }
      if (li < 0) continue; // além do último nível: some
      const level = this.levels[li];
      const slot = counts[li]++;
      for (const part of level.parts) {
        const { mesh, local } = this.chunkFor(part, slot);
        let m: THREE.Matrix4;
        if (part.matrixIndex < 0) {
          const yaw = Math.atan2(camPos.x - item.pos.x, camPos.z - item.pos.z);
          this.tmpQ.setFromAxisAngle(this.up, yaw);
          m = this.tmpM.compose(item.pos, this.tmpQ,
            this.tmpS.set(item.scale, item.scale, item.scale));
        } else {
          m = item.matrices[part.matrixIndex];
        }
        mesh.setMatrixAt(local, m);
        if (part.useColor && item.color) mesh.setColorAt(local, item.color);
      }
    }
    this.levels.forEach((level, l) => {
      for (const part of level.parts) {
        part.chunks.forEach((mesh, ci) => {
          const n = Math.max(0, Math.min(CHUNK, counts[l] - ci * CHUNK));
          mesh.count = n;
          mesh.visible = n > 0;
          if (n > 0) {
            mesh.instanceMatrix.needsUpdate = true;
            if (part.useColor && mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
          }
        });
      }
    });
  }
}
