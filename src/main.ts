import * as THREE from 'three/webgpu';
import { pass, viewportUV, float } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { buildTrack, buildRoad, ROAD_HALF } from './track';
import { buildTerrain, terrainH } from './terrain';
import { buildSky, buildLights, SUN_DIR } from './sky';
import { buildScenery } from './scenery';
import { buildCarVisual } from './car';
import { RallyVehicle, type VehicleInput } from './vehicle';
import { Dust } from './dust';
import { Hud, fmtTime } from './hud';
import { audio, speak } from './audio';

type GameState = 'MENU' | 'COUNTDOWN' | 'RACING' | 'FINISHED';

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const rand = (a: number, b: number) => a + Math.random() * (b - a);
const $ = (id: string) => document.getElementById(id)!;
const show = (id: string) => $(id).classList.remove('hidden');
const hide = (id: string) => $(id).classList.add('hidden');

async function main(): Promise<void> {
  /* ---------- renderer (WebGPU, cai para WebGL2 se preciso) ---------- */
  const forceWebGL = new URLSearchParams(location.search).has('webgl');
  const renderer = new THREE.WebGPURenderer({ antialias: true, forceWebGL });
  await renderer.init();
  // captura erros de validação do WebGPU (não aparecem como exceção JS)
  const gpuErrs: string[] = [];
  (window as any).__gpuErrs = gpuErrs;
  const device = (renderer.backend as any).device as GPUDevice | undefined;
  if (device) {
    device.onuncapturederror = (e: any) => {
      if (gpuErrs.length < 20) gpuErrs.push(String(e.error?.message ?? e));
    };
  }
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  $('app').appendChild(renderer.domElement);
  $('gpuBadge').textContent = (renderer.backend as any).isWebGPUBackend ? '⚡ WebGPU' : 'WebGL 2';

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xd8dcc8, 260, 1600);
  const camera = new THREE.PerspectiveCamera(66, innerWidth / innerHeight, 0.3, 5000);

  /* ---------- mundo ---------- */
  const track = buildTrack();
  const sky = buildSky();
  scene.add(sky);
  const sun = buildLights(scene);
  scene.add(buildTerrain(track.roadDist));
  scene.add(buildRoad(track));
  const scenery = buildScenery(scene, track);

  const carVis = buildCarVisual();
  scene.add(carVis.group);
  for (const w of carVis.wheels) scene.add(w);

  const vehicle = new RallyVehicle(track);
  vehicle.reset(track.START_I - Math.round(8 / 2.5));

  const dust = new Dust();
  scene.add(dust.mesh);

  const hud = new Hud(track);

  /* ---------- pós-processamento: bloom + vinheta ---------- */
  const postProcessing = new THREE.PostProcessing(renderer);
  const scenePass = pass(scene, camera);
  const scenePassColor = scenePass.getTextureNode();
  const bloomPass = bloom(scenePassColor, 0.35, 0.3, 0.92);
  const vig = viewportUV.sub(0.5).length().mul(1.15).oneMinus().clamp(0.42, 1).pow(0.65);
  postProcessing.outputNode = scenePassColor.add(bloomPass).mul(vig);

  /* ---------- estado ---------- */
  const G = {
    state: 'MENU' as GameState,
    time: 0,
    best: parseFloat(localStorage.getItem('rally-maringa-best') ?? 'NaN'),
    camMode: 0,
    menuAngle: 0,
    camPos: new THREE.Vector3(),
    camLook: new THREE.Vector3(),
  };
  hud.refreshBest(G.best);

  const keys = { up: false, down: false, left: false, right: false, hb: false };
  const input: VehicleInput = { throttle: 0, brake: 0, steer: 0, handbrake: false };

  addEventListener('keydown', (e) => {
    if (e.repeat) return;
    audio.start();
    switch (e.code) {
      case 'ArrowUp': case 'KeyW': keys.up = true; break;
      case 'ArrowDown': case 'KeyS': keys.down = true; break;
      case 'ArrowLeft': case 'KeyA': keys.left = true; break;
      case 'ArrowRight': case 'KeyD': keys.right = true; break;
      case 'Space': keys.hb = true; e.preventDefault(); break;
      case 'KeyC': G.camMode = (G.camMode + 1) % 3; break;
      case 'KeyM': audio.setMuted(!audio.muted); break;
      case 'KeyR': if (G.state === 'RACING') vehicle.reset(vehicle.idx); break;
      case 'Enter':
        if (G.state === 'MENU') startRace();
        else if (G.state === 'FINISHED') { hide('results'); startRace(); }
        break;
    }
  });
  addEventListener('keyup', (e) => {
    switch (e.code) {
      case 'ArrowUp': case 'KeyW': keys.up = false; break;
      case 'ArrowDown': case 'KeyS': keys.down = false; break;
      case 'ArrowLeft': case 'KeyA': keys.left = false; break;
      case 'ArrowRight': case 'KeyD': keys.right = false; break;
      case 'Space': keys.hb = false; break;
    }
  });

  function startRace(): void {
    hide('menu');
    hud.setVisible(true);
    vehicle.reset(track.START_I - Math.round(8 / 2.5));
    track.corners.forEach((c) => { c.called = false; });
    G.time = 0;
    G.state = 'COUNTDOWN';
    const p = vehicle.chassis.position;
    const h = vehicle.heading();
    G.camPos.set(p.x - Math.sin(h) * 8.6, p.y + 3.4, p.z - Math.cos(h) * 8.6);
    G.camLook.set(p.x, p.y, p.z);
    show('countdown');
    const cd = $('cdNum');
    let n = 3;
    cd.textContent = String(n);
    cd.classList.remove('go');
    audio.beep(440);
    const iv = setInterval(() => {
      n--;
      if (n > 0) { cd.textContent = String(n); audio.beep(440); }
      else {
        clearInterval(iv);
        cd.textContent = 'GO!';
        cd.classList.add('go');
        audio.beep(880, 0.5, 0.45);
        G.state = 'RACING';
        speak('go!');
        setTimeout(() => hide('countdown'), 700);
      }
    }, 1000);
  }

  function finishRace(): void {
    G.state = 'FINISHED';
    audio.beep(660, 0.4);
    audio.beep(990, 0.6);
    $('finalTime').textContent = fmtTime(G.time);
    const detail = $('resultDetail');
    const rec = $('newRecord');
    const avg = (track.RACE_KM / (G.time / 3600)).toFixed(0);
    if (isNaN(G.best) || G.time < G.best) {
      detail.textContent = (isNaN(G.best) ? '' : 'previous: ' + fmtTime(G.best) + ' · ') + 'avg ' + avg + ' km/h';
      rec.style.display = 'block';
      G.best = G.time;
      localStorage.setItem('rally-maringa-best', String(G.best));
      speak('new stage record!');
    } else {
      detail.textContent = '+' + (G.time - G.best).toFixed(1) + 's off the best (' + fmtTime(G.best) + ') · avg ' + avg + ' km/h';
      rec.style.display = 'none';
    }
    hud.refreshBest(G.best);
    show('results');
  }

  /* ---------- câmera ---------- */
  const shake = new THREE.Vector3();
  function updateCamera(dt: number): void {
    const p = vehicle.chassis.position;
    const h = vehicle.heading();
    const fwd = new THREE.Vector3(Math.sin(h), 0, Math.cos(h));
    let target: THREE.Vector3, look: THREE.Vector3, stiff: number;
    if (G.state === 'MENU') {
      G.menuAngle += dt * 0.22;
      const r = 13;
      target = new THREE.Vector3(p.x + Math.sin(G.menuAngle) * r, p.y + 3.6, p.z + Math.cos(G.menuAngle) * r);
      look = new THREE.Vector3(p.x, p.y + 0.6, p.z);
      stiff = 2.2;
    } else if (G.camMode === 0) {          // perseguição
      target = new THREE.Vector3(p.x, p.y, p.z).addScaledVector(fwd, -8.8);
      target.y = p.y + 3.1;
      // olha um pouco adiante na pista (antecipa a curva)
      const ahead = track.pts[clamp(vehicle.idx + 16, 0, track.NSEG)];
      look = new THREE.Vector3(
        lerp(p.x + fwd.x * 6, ahead.x, 0.35),
        p.y + 1.1,
        lerp(p.z + fwd.z * 6, ahead.z, 0.35));
      stiff = 5.2;
    } else if (G.camMode === 1) {          // capô
      target = new THREE.Vector3(p.x, p.y + 0.9, p.z).addScaledVector(fwd, 0.4);
      look = new THREE.Vector3(p.x, p.y + 0.6, p.z).addScaledVector(fwd, 26);
      stiff = 18;
    } else {                                // TV
      const i = clamp(vehicle.idx + 30, 0, track.NSEG);
      target = new THREE.Vector3(
        track.pts[i].x + track.norm[i].x * 26, 0, track.pts[i].z + track.norm[i].z * 26);
      target.y = terrainH(target.x, target.z) + 13;
      look = new THREE.Vector3(p.x, p.y + 1, p.z);
      stiff = 3.2;
    }
    const minY = terrainH(target.x, target.z) + 1.4;
    if (target.y < minY) target.y = minY;
    const k = 1 - Math.exp(-stiff * dt);
    G.camPos.lerp(target, k);
    G.camLook.lerp(look, Math.min(1, k * 1.6));
    const spd = Math.abs(vehicle.forwardSpeed());
    const sh = (vehicle.offroad ? 0.05 : 0.012) * clamp(spd / 30, 0, 1);
    shake.set(rand(-sh, sh), rand(-sh, sh), rand(-sh, sh));
    camera.position.copy(G.camPos).add(shake);
    camera.lookAt(G.camLook);
    camera.fov = lerp(camera.fov, 66 + clamp(spd - 20, 0, 26) * 0.5, dt * 3);
    camera.updateProjectionMatrix();
    sun.position.set(p.x, p.y, p.z).addScaledVector(SUN_DIR, 190);
    sun.target.position.set(p.x, p.y, p.z);
    sky.position.copy(camera.position);
  }

  /* ---------- laço ---------- */
  const dbg = { frames: 0, err: null as string | null };
  (window as any).__dbg = dbg;
  const clock = new THREE.Clock();

  function tick(dt: number): void {
    const driving = G.state === 'RACING';
    input.throttle = driving && keys.up ? 1 : 0;
    input.brake = driving && keys.down ? 1 : 0;
    const steerTarget = driving ? (keys.right ? 1 : 0) - (keys.left ? 1 : 0) : 0;
    input.steer = lerp(input.steer, steerTarget, clamp((steerTarget !== 0 ? 5.2 : 7.5) * dt, 0, 1));
    input.handbrake = driving && keys.hb;

    if (driving) G.time += dt;
    vehicle.step(dt, input);
    vehicle.syncVisual(carVis.group, carVis.wheels);
    if (driving && vehicle.idx >= track.FINISH_I) finishRace();

    // poeira nas rodas traseiras
    const spd = Math.abs(vehicle.forwardSpeed());
    const intensity = (spd > 3 ? spd / 45 : 0) + vehicle.slip * 0.9 + (vehicle.offroad && spd > 2 ? 0.7 : 0);
    if (intensity > 0.1 && vehicle.grounded) {
      const nSpawn = Math.min(5, Math.ceil(intensity * 3.5));
      const rw = vehicle.rearWheelPositions();
      for (let s = 0; s < nSpawn; s++) {
        const w = rw[s % 2];
        dust.spawn(w.x, w.y + 0.1, w.z, 0.4, 0.7 + intensity * 0.4);
      }
    }
    dust.update(dt, camera);

    audio.engine(
      clamp((spd / 47) % 0.34 / 0.34 * 0.8 + spd / 47 * 0.2 + (input.throttle ? 0.12 : 0), 0, 1),
      input.throttle, vehicle.slip, vehicle.offroad, spd);

    updateCamera(dt);
    scenery.update(camera.position, dt);
    if (G.state !== 'MENU') {
      hud.update(dt, {
        kmh: spd * 3.6,
        reverse: vehicle.forwardSpeed() < -0.5,
        time: G.time,
        idx: vehicle.idx,
        carX: vehicle.chassis.position.x,
        carZ: vehicle.chassis.position.z,
        racing: driving,
      });
    }
    if ((window as any).__raw) renderer.render(scene, camera);
    else postProcessing.render();
    (dbg as any).draws = renderer.info.render.drawCalls;
    dbg.frames++;
  }

  function loop(): void {
    requestAnimationFrame(loop);
    if ((window as any).__pause) { clock.getDelta(); return; }
    try { tick(Math.min(clock.getDelta(), 0.05)); }
    catch (e: any) { dbg.err = String(e?.stack ?? e); }
  }

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });

  hide('loading');
  show('menu');
  loop();

  /* ---------- hooks de depuração (usados nos testes automatizados) ---------- */
  (window as any).__game = {
    tick, G, input, keys, vehicle, track, camera, renderer, scene, startRace,
  };
  (window as any).__shot = async (w = 720, q = 0.55) => {
    await postProcessing.renderAsync();
    const src = renderer.domElement;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = Math.round(src.height * w / src.width);
    c.getContext('2d')!.drawImage(src, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', q).split(',')[1];
  };
  // captura via render target (funciona com a aba oculta; sem pós-processo,
  // gamma aproximado em CPU) — só para testes automatizados
  (window as any).__shotRT = async (w = 1024, q = 0.6) => {
    w = Math.ceil(w / 64) * 64; // WebGPU: bytesPerRow múltiplo de 256
    const hgt = Math.round(w * innerHeight / innerWidth);
    const rt = new THREE.RenderTarget(w, hgt);
    renderer.setRenderTarget(rt);
    await renderer.renderAsync(scene, camera);
    const buf = await renderer.readRenderTargetPixelsAsync(rt as any, 0, 0, w, hgt) as Uint8Array;
    renderer.setRenderTarget(null);
    rt.dispose();
    (window as any).__lastShotStats = {
      len: buf.length, expected: w * hgt * 4,
      nonZero: buf.slice(0, 40000).reduce((a: number, b: number) => a + (b > 0 ? 1 : 0), 0),
    };
    const c = document.createElement('canvas');
    c.width = w; c.height = hgt;
    const ctx = c.getContext('2d')!;
    const img = ctx.createImageData(w, hgt);
    const g = new Uint8ClampedArray(256);
    for (let i = 0; i < 256; i++) g[i] = Math.round(Math.pow(i / 255, 1 / 2.2) * 255);
    const flip = !(renderer.backend as any).isWebGPUBackend; // WebGL lê de baixo p/ cima
    for (let y = 0; y < hgt; y++) {
      const srcRow = (flip ? (hgt - 1 - y) : y) * w * 4, dstRow = y * w * 4;
      for (let x = 0; x < w * 4; x += 4) {
        img.data[dstRow + x] = g[buf[srcRow + x]];
        img.data[dstRow + x + 1] = g[buf[srcRow + x + 1]];
        img.data[dstRow + x + 2] = g[buf[srcRow + x + 2]];
        img.data[dstRow + x + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return c.toDataURL('image/jpeg', q).split(',')[1];
  };
}

main().catch((e) => {
  console.error(e);
  const el = document.querySelector('#loading div:last-child');
  if (el) el.textContent = 'FAILED TO START: ' + e;
});
