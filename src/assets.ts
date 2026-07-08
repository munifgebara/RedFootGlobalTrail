import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/**
 * Assets CC0 do Poly Haven (https://polyhaven.com — CC0), baixados por
 * tools/fetch-assets.mjs para public/assets/ e servidos estaticamente.
 */

export interface PbrTex {
  map: THREE.Texture;   // sRGB
  nor: THREE.Texture;   // linear (OpenGL normal)
  arm: THREE.Texture;   // linear (R=AO, G=roughness, B=metal)
}

export interface GameAssets {
  road: PbrTex;
  ground: PbrTex;
  boulder: { geometry: THREE.BufferGeometry; material: THREE.Material } | null;
}

const texLoader = new THREE.TextureLoader();

async function loadTex(url: string, srgb: boolean): Promise<THREE.Texture> {
  const t = await texLoader.loadAsync(url);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  return t;
}

async function loadPbr(id: string): Promise<PbrTex> {
  const base = `assets/textures/${id}/`;
  const [map, nor, arm] = await Promise.all([
    loadTex(base + 'diff.jpg', true),
    loadTex(base + 'nor.jpg', false),
    loadTex(base + 'arm.jpg', false),
  ]);
  return { map, nor, arm };
}

export async function loadAssets(): Promise<GameAssets> {
  const gltfLoader = new GLTFLoader();
  const [road, ground, boulderGltf] = await Promise.all([
    loadPbr('red_dirt_mud_01'),
    loadPbr('sparse_grass'),
    gltfLoader.loadAsync('assets/models/boulder_01/boulder_01.gltf').catch(() => null),
  ]);
  let boulder: GameAssets['boulder'] = null;
  if (boulderGltf) {
    boulderGltf.scene.traverse((o: THREE.Object3D) => {
      if (!boulder && (o as THREE.Mesh).isMesh) {
        const m = o as THREE.Mesh;
        boulder = { geometry: m.geometry, material: m.material as THREE.Material };
      }
    });
  }
  return { road, ground, boulder };
}
