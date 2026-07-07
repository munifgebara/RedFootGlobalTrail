import * as THREE from 'three/webgpu';
import { uv, color, float, instancedBufferAttribute, mix } from 'three/tsl';

const N = 320;

/**
 * Poeira de terra: quads instanciados sempre de frente para a câmera,
 * com fade por instância (atributo instanciado lido no shader TSL).
 */
export class Dust {
  mesh: THREE.InstancedMesh;
  private life = new Float32Array(N);
  private vel = new Float32Array(N * 3);
  private posArr = new Float32Array(N * 3);
  private scale = new Float32Array(N);
  private fadeAttr: THREE.InstancedBufferAttribute;
  private head = 0;
  private dummy = new THREE.Object3D();

  constructor() {
    const geo = new THREE.PlaneGeometry(1, 1);
    this.fadeAttr = new THREE.InstancedBufferAttribute(new Float32Array(N), 1);
    this.fadeAttr.setUsage(THREE.DynamicDrawUsage);

    const mat = new THREE.MeshBasicNodeMaterial({
      transparent: true, depthWrite: false,
    });
    const r = uv().sub(0.5).length().mul(2.0);
    const soft = r.oneMinus().clamp(0, 1).pow(1.7);
    const fade = instancedBufferAttribute(this.fadeAttr);
    mat.colorNode = mix(color(0xb08a63), color(0xd8bfa0), soft.mul(0.5));
    mat.opacityNode = soft.mul(fade).mul(0.36);

    this.mesh = new THREE.InstancedMesh(geo, mat, N);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
  }

  spawn(x: number, y: number, z: number, spread: number, up: number): void {
    const i = this.head;
    this.head = (this.head + 1) % N;
    this.posArr[i * 3] = x + (Math.random() - 0.5) * 2 * spread;
    this.posArr[i * 3 + 1] = y;
    this.posArr[i * 3 + 2] = z + (Math.random() - 0.5) * 2 * spread;
    this.vel[i * 3] = (Math.random() - 0.5) * 2.8;
    this.vel[i * 3 + 1] = (1.2 + Math.random() * 1.4) * up;
    this.vel[i * 3 + 2] = (Math.random() - 0.5) * 2.8;
    this.life[i] = 1;
    this.scale[i] = 0.9 + Math.random() * 1.2;
  }

  update(dt: number, camera: THREE.Camera): void {
    for (let i = 0; i < N; i++) {
      if (this.life[i] <= 0) {
        this.dummy.position.set(0, -1000, 0);
        this.dummy.scale.setScalar(0.001);
      } else {
        this.life[i] -= dt * 0.9;
        this.posArr[i * 3] += this.vel[i * 3] * dt;
        this.posArr[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
        this.posArr[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
        this.vel[i * 3 + 1] *= 1 - dt * 0.8;
        this.scale[i] += dt * 2.4;
        this.dummy.position.set(this.posArr[i * 3], this.posArr[i * 3 + 1], this.posArr[i * 3 + 2]);
        this.dummy.quaternion.copy(camera.quaternion);
        this.dummy.scale.setScalar(this.scale[i]);
      }
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
      this.fadeAttr.setX(i, Math.max(0, this.life[i]));
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.fadeAttr.needsUpdate = true;
  }
}
