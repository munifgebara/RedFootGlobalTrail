import * as THREE from 'three/webgpu';
import * as CANNON from 'cannon-es';
import { terrainH } from './terrain';
import type { Track } from './track';
import { ROAD_HALF } from './track';

export interface VehicleInput {
  throttle: number;   // 0..1
  brake: number;      // 0..1
  steer: number;      // -1 (esq) .. +1 (dir)
  handbrake: boolean;
}

const WHEEL_RADIUS = 0.42;
const GRIP_ROAD = 2.4;
const GRIP_OFFROAD = 1.0;
const GRIP_HANDBRAKE_REAR = 0.55;

/**
 * Física de verdade: cannon-es RaycastVehicle sobre um heightfield que
 * replica o relevo analítico num corredor ao redor da especial.
 */
export class RallyVehicle {
  world: CANNON.World;
  chassis: CANNON.Body;
  vehicle: CANNON.RaycastVehicle;
  track: Track;
  idx = 0;                       // amostra da pista mais próxima
  offroad = false;
  slip = 0;                      // 0..1 (derrapagem)
  grounded = true;
  private upsideDownTime = 0;

  constructor(track: Track) {
    this.track = track;
    this.world = new CANNON.World({ gravity: new CANNON.Vec3(0, -10.5, 0) });
    this.world.broadphase = new CANNON.SAPBroadphase(this.world);
    this.world.defaultContactMaterial.friction = 0.3;

    this.buildGround();

    // chassi: shape deslocado p/ cima => centro de massa baixo (anti-capote)
    const chassisShape = new CANNON.Box(new CANNON.Vec3(0.85, 0.45, 2.05));
    this.chassis = new CANNON.Body({ mass: 900 });
    this.chassis.addShape(chassisShape, new CANNON.Vec3(0, 0.35, 0));
    this.chassis.angularDamping = 0.35;
    this.world.addBody(this.chassis);

    this.vehicle = new CANNON.RaycastVehicle({
      chassisBody: this.chassis,
      indexRightAxis: 0,
      indexUpAxis: 1,
      indexForwardAxis: 2,
    });
    const wheelOptions = {
      radius: WHEEL_RADIUS,
      directionLocal: new CANNON.Vec3(0, -1, 0),
      axleLocal: new CANNON.Vec3(-1, 0, 0),
      suspensionStiffness: 42,
      suspensionRestLength: 0.42,
      frictionSlip: GRIP_ROAD,
      dampingRelaxation: 2.6,
      dampingCompression: 4.6,
      maxSuspensionForce: 100000,
      maxSuspensionTravel: 0.38,
      rollInfluence: 0.03,
      customSlidingRotationalSpeed: -30,
      useCustomSlidingRotationalSpeed: true,
      chassisConnectionPointLocal: new CANNON.Vec3(),
    };
    const conn: [number, number, number][] = [
      [-0.84, 0.05, 1.32], [0.84, 0.05, 1.32],    // dianteiras (0,1)
      [-0.84, 0.05, -1.32], [0.84, 0.05, -1.32],  // traseiras (2,3)
    ];
    for (const [x, y, z] of conn) {
      wheelOptions.chassisConnectionPointLocal = new CANNON.Vec3(x, y, z);
      this.vehicle.addWheel({ ...wheelOptions });
    }
    this.vehicle.addToWorld(this.world);
  }

  /** Heightfield cobrindo um corredor ao redor do traçado. */
  private buildGround(): void {
    const pts = this.track.pts;
    let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
    for (const p of pts) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
    }
    const M = 220; // margem lateral (m)
    minX -= M; maxX += M; minZ -= M; maxZ += M;
    const elem = 5;
    const nx = Math.ceil((maxX - minX) / elem) + 1;
    const nz = Math.ceil((maxZ - minZ) / elem) + 1;
    // convenção do cannon (corpo girado -90° em X):
    //   worldX = pos.x + i*elem ; worldZ = pos.z - j*elem
    const data: number[][] = [];
    for (let i = 0; i < nx; i++) {
      const row: number[] = [];
      for (let j = 0; j < nz; j++) {
        row.push(terrainH(minX + i * elem, maxZ - j * elem));
      }
      data.push(row);
    }
    const shape = new CANNON.Heightfield(data, { elementSize: elem });
    const body = new CANNON.Body({ mass: 0 });
    body.addShape(shape);
    body.quaternion.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), -Math.PI / 2);
    body.position.set(minX, 0, maxZ);
    this.world.addBody(body);
  }

  /** Sonda o solo físico por raycast (debug/validação). */
  probeGround(x: number, z: number): { physics: number | null; analytic: number } {
    const result = new CANNON.RaycastResult();
    this.world.raycastClosest(
      new CANNON.Vec3(x, 200, z), new CANNON.Vec3(x, -200, z), {}, result);
    return {
      physics: result.hasHit ? result.hitPointWorld.y : null,
      analytic: terrainH(x, z),
    };
  }

  reset(atIdx: number): void {
    const t = this.track;
    const i = Math.max(2, Math.min(t.NSEG - 2, atIdx));
    this.idx = i;
    const p = t.pts[i];
    const heading = Math.atan2(t.tang[i].x, t.tang[i].z);
    this.chassis.position.set(p.x, terrainH(p.x, p.z) + 1.2, p.z);
    this.chassis.quaternion.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), heading);
    this.chassis.velocity.setZero();
    this.chassis.angularVelocity.setZero();
    for (let w = 0; w < 4; w++) {
      this.vehicle.applyEngineForce(0, w);
      this.vehicle.setBrake(0, w);
    }
    this.upsideDownTime = 0;
  }

  /** Velocidade à frente em m/s (negativa = ré). */
  forwardSpeed(): number {
    const f = this.forwardDir();
    const v = this.chassis.velocity;
    return f.x * v.x + f.z * v.z;
  }

  forwardDir(): CANNON.Vec3 {
    return this.chassis.quaternion.vmult(new CANNON.Vec3(0, 0, 1));
  }

  heading(): number {
    const f = this.forwardDir();
    return Math.atan2(f.x, f.z);
  }

  step(dt: number, input: VehicleInput): void {
    const t = this.track;
    const vf = this.forwardSpeed();
    const speed = Math.abs(vf);

    // amostra mais próxima (janela em volta da última)
    const pos = this.chassis.position;
    let bi = this.idx, bd = 1e9;
    for (let i = Math.max(0, this.idx - 25); i <= Math.min(t.NSEG, this.idx + 45); i++) {
      const dx = t.pts[i].x - pos.x, dz = t.pts[i].z - pos.z;
      const d = dx * dx + dz * dz;
      if (d < bd) { bd = d; bi = i; }
    }
    this.idx = bi;
    const lat = (pos.x - t.pts[bi].x) * t.norm[bi].x + (pos.z - t.pts[bi].z) * t.norm[bi].z;
    this.offroad = Math.abs(lat) > ROAD_HALF + 1.2;

    // motor 4x4 com corte de topo (~145 km/h) e reforço em baixa
    const VMAX = 40;
    let engine = 0;
    if (input.throttle > 0 && vf < VMAX) {
      engine = 2100 * input.throttle * Math.max(0.35, 1 - Math.max(vf, 0) / VMAX);
    }
    if (input.brake > 0 && vf < 0.5) {
      engine = -1400 * input.brake; // ré
    }
    const brakeForce = input.brake > 0 && vf >= 0.5 ? 38 * input.brake : 0;

    // aderência dinâmica: terra batida x fora da estrada x freio de mão
    const gripBase = this.offroad ? GRIP_OFFROAD : GRIP_ROAD;
    for (let w = 0; w < 4; w++) {
      const rear = w >= 2;
      const wi = this.vehicle.wheelInfos[w];
      wi.frictionSlip = input.handbrake && rear ? GRIP_HANDBRAKE_REAR : gripBase;
      this.vehicle.applyEngineForce(rear || !input.handbrake ? -engine : 0, w);
      let b = brakeForce;
      if (input.handbrake && rear) b = Math.max(b, 14);
      if (this.offroad) b += 1.6; // arrasto do mato
      this.vehicle.setBrake(b, w);
    }
    // esterço encolhe com a velocidade (estabilidade em alta, agilidade em baixa).
    // Sinal negativo: com y-up e frente em +z, virar à DIREITA reduz o heading
    // (a direita do carro é -x — mesma convenção da câmera do three).
    const steerMax = 0.55 / (1 + speed * 0.028);
    this.vehicle.setSteeringValue(-input.steer * steerMax, 0);
    this.vehicle.setSteeringValue(-input.steer * steerMax, 1);

    // arrasto aerodinâmico + downforce (estabilidade em alta)
    const v = this.chassis.velocity;
    const hv = Math.hypot(v.x, v.z);
    if (hv > 1) {
      const drag = 0.55 * hv;
      this.chassis.applyForce(new CANNON.Vec3(-v.x * drag, 0, -v.z * drag));
    }
    this.chassis.applyForce(new CANNON.Vec3(0, -6 * hv, 0));

    // empurrão suave de volta quando muito longe da pista
    if (Math.abs(lat) > 30) {
      const push = -Math.sign(lat) * 2400;
      this.chassis.applyForce(new CANNON.Vec3(t.norm[bi].x * push, 0, t.norm[bi].z * push));
    }

    this.world.step(1 / 60, dt, 3);

    // derrapagem p/ poeira e som
    let sliding = 0, grounded = 0;
    for (const wi of this.vehicle.wheelInfos) {
      if (wi.isInContact) grounded++;
      if (wi.sliding || wi.skidInfo < 0.85) sliding++;
    }
    this.grounded = grounded >= 2;
    this.slip = sliding / 4;

    // auto-desvira se capotar
    const up = this.chassis.quaternion.vmult(new CANNON.Vec3(0, 1, 0));
    if (up.y < 0.15) {
      this.upsideDownTime += dt;
      if (this.upsideDownTime > 2.5) this.reset(this.idx);
    } else {
      this.upsideDownTime = 0;
    }
  }

  /** Copia pose física para os visuais (carroceria + rodas). */
  syncVisual(carGroup: THREE.Object3D, wheelMeshes: THREE.Object3D[]): void {
    const b = this.chassis;
    carGroup.position.set(b.position.x, b.position.y, b.position.z);
    carGroup.quaternion.set(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w);
    // origem do modelo visual fica no chão (rodas y=0.42): desloca p/ baixo
    carGroup.translateY(-0.82);
    for (let i = 0; i < 4; i++) {
      this.vehicle.updateWheelTransform(i);
      const wt = this.vehicle.wheelInfos[i].worldTransform;
      wheelMeshes[i].position.set(wt.position.x, wt.position.y, wt.position.z);
      wheelMeshes[i].quaternion.set(wt.quaternion.x, wt.quaternion.y, wt.quaternion.z, wt.quaternion.w);
    }
  }

  /** Posições no mundo das rodas traseiras (para a poeira). */
  rearWheelPositions(): THREE.Vector3[] {
    const out: THREE.Vector3[] = [];
    for (const i of [2, 3]) {
      const wt = this.vehicle.wheelInfos[i].worldTransform;
      out.push(new THREE.Vector3(wt.position.x, wt.position.y, wt.position.z));
    }
    return out;
  }
}
