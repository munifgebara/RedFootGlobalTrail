import * as THREE from 'three/webgpu';
import {
  positionLocal, positionWorld, color, float, vec2, vec3, mix, smoothstep, uniform, time, mx_noise_float,
} from 'three/tsl';

export const SUN_DIR = new THREE.Vector3(0.55, 0.62, 0.42).normalize();

/**
 * Cúpula de céu procedural: gradiente de fim de tarde, disco solar em HDR
 * (alimenta o bloom do pós-processamento) e nuvens de ruído que derivam
 * lentamente com o tempo.
 */
export function buildSky(): THREE.Mesh {
  const mat = new THREE.MeshBasicNodeMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
  });

  const d = positionLocal.normalize();
  const h = d.y;

  let sky: any = mix(color(0xf7dfae), color(0x9cc8ee), smoothstep(-0.06, 0.16, h));
  sky = mix(sky, color(0x3f86dd), smoothstep(0.16, 0.72, h));

  // sol: disco HDR + halo quente
  const sunU = uniform(SUN_DIR.clone());
  const sd = d.dot(sunU).clamp(0, 1);
  sky = sky.add(color(0xfff3d0).mul(sd.pow(900).mul(9.0)));
  sky = sky.add(color(0xffd9a0).mul(sd.pow(7).mul(0.25)));

  // nuvens: ruído projetado no "teto"
  const proj = d.xz.div(h.add(0.15));
  const n1 = mx_noise_float(vec3(proj.mul(0.85), time.mul(0.008)));
  const n2 = mx_noise_float(vec3(proj.mul(2.1).add(37.0), time.mul(0.016)));
  const cloudField = n1.add(n2.mul(0.5));
  const clouds = smoothstep(0.28, 0.85, cloudField)
    .mul(smoothstep(0.015, 0.16, h))
    .mul(0.6);
  const cloudCol = mix(color(0xffffff), color(0xffe9d2), smoothstep(0.3, 0.05, h));
  sky = mix(sky, cloudCol, clouds);

  mat.colorNode = sky;

  const mesh = new THREE.Mesh(new THREE.SphereGeometry(3800, 32, 16), mat);
  mesh.frustumCulled = false;
  return mesh;
}

/**
 * Sombra de nuvens varrendo o chão (0 = céu limpo, 1 = sombra cheia).
 * Mesma família de ruído das nuvens do céu, derivando com o tempo.
 */
export function cloudShadowNode() {
  const p = positionWorld.xz.mul(0.0045).add(vec2(time.mul(-0.010), time.mul(-0.004)));
  const n = mx_noise_float(vec3(p, 7.3))
    .add(mx_noise_float(vec3(p.mul(2.4).add(37.0), 3.1)).mul(0.5));
  return smoothstep(0.30, 0.95, n);
}

/** Luzes da cena: sol direcional com sombras + hemisférica. */
export function buildLights(scene: THREE.Scene): THREE.DirectionalLight {
  const sun = new THREE.DirectionalLight(0xfff0d8, 2.8);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  sun.shadow.camera.near = 20;
  sun.shadow.camera.far = 450;
  sun.shadow.camera.left = -100;
  sun.shadow.camera.right = 100;
  sun.shadow.camera.top = 100;
  sun.shadow.camera.bottom = -100;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  scene.add(sun);
  scene.add(sun.target);
  scene.add(new THREE.HemisphereLight(0xbdd8f2, 0x6b5033, 0.95));
  return sun;
}
