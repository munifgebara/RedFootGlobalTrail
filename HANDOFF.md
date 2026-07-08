# Where we came from & where we're going
### (De onde viemos e para onde vamos — handoff for the next agent)

> Read this first. It is the map of the project: what exists, why it looks
> the way it does, how to verify changes without a human in the loop, and
> which traps have already bitten us. Companion docs: [README.md](README.md)
> (product/stack) and [IDEAS.md](IDEAS.md) (roadmap backlog).

---

## 1. What this is

**Red Foot Global Trail** — a GEBARA Labs (https://www.gebaralabs.dev/) POC
used to evaluate AI coding models. Currently a 3D rally game, 100% static,
running in the browser. **Stage 1 "Ecogarden"** follows real OpenStreetMap
roads with real SRTM elevations around a Google Maps pin in Maringá, Brazil
(https://maps.app.goo.gl/sVvb3SNtY87cxKEf6).

- Repo: https://github.com/munifgebara/RedFootGlobalTrail (branch `main`)
- Live: https://munifgebara.github.io/RedFootGlobalTrail/ (Pages ← `main`/`docs`)
- Stack: Vite + TypeScript · three.js **WebGPU/TSL** (auto WebGL 2 fallback)
  · **cannon-es** RaycastVehicle · WebAudio (SFX + procedural rock music)

## 2. Where we came from (increment history)

Each increment = working state + commit + push (see `git log` for details):

| Commit | What |
|---|---|
| `d64a4dc` | v1 POC: single-file game, Three.js via CDN, arcade physics |
| `7ac8e5f` | v2: Vite+TS+WebGPU/TSL+cannon-es rewrite; TSL terrain/sky/road; bloom+vignette; RaycastVehicle on heightfield |
| `43112be` | Issue #1: distance LOD (hi/med/billboard trees, chunked ≤1000 instances — WebGPU 64 KB limit), Red Foot logo in 3D, cloud shadows, wind |
| `f692a87` | English as default language; GEBARA Labs branding; stage renamed Ecogarden |
| `aeabb21` | Big hills/climbs (later superseded by real SRTM data) |
| `956d9e3` | Procedural rock'n'roll soundtrack (WebAudio synth), N toggles music |
| `7fd453e` | **Steering inversion fix** (see pitfalls §6.1) |
| `b5ac96b` | Real-world stage: OSM route + SRTM grid baked by `tools/build-map.mjs`; 12% road grading (cut/fill) |
| `ba81df1` | Issue #2: Poly Haven CC0 PBR textures (road/ground) + photoscanned boulder; GLTF infra |
| `1629986` | Issue #3: mobile detection + on-screen touch controls |
| `1f2bd90` | Issue #4: start-line cliff fix (weighted-average road grader) |

Workflow contract with Munif (the owner):
- **One GitHub issue per request, then execute, commit `Closes #N`, push.**
- **Commit + push autonomously after every working increment — never ask.**
- English is the project's default language (UI, docs, co-driver voice).
- PowerShell is allowlisted in `.claude/settings.local.json` of the parent folder.

## 3. Architecture (src/)

| File | Responsibility |
|---|---|
| `main.ts` | Bootstrap (WebGPU init, postfx bloom+vignette), game states (MENU/COUNTDOWN/RACING/FINISHED), camera, input, loop, **debug hooks** |
| `track.ts` | Route from `data/ecogarden.json` → spline, samples every 2.5 m, pacenotes from curvature, road profile smoothing + 12% cap, **road grader** (continuous cut/fill), road/shoulder meshes (PBR + TSL) |
| `terrain.ts` | `terrainH(x,z)` = bilinear SRTM grid + micro-relief + grader hook; terrain mesh w/ crop-field vertex colors × PBR grass |
| `vehicle.ts` | cannon-es world, heightfield (mirrors `terrainH`), RaycastVehicle tuning, reset/auto-flip, `probeGround()` |
| `scenery.ts` | Trees/coffee/grass via `lod.ts`, rocks (scanned boulder), fences, poles, chevrons, gantries, sponsors, cathedral+city, farms, logo monument |
| `lod.ts` | Distance LOD w/ re-bucketing; **chunks of ≤1000 instances** (WebGPU uniform limit); billboard level |
| `logo.ts` | Red Foot footprint: canvas drawing + THREE.Shape extrusion (monument, decals) |
| `car.ts` | Car visual (extruded silhouette, clearcoat, decals, emissive lights) |
| `assets.ts` | Loads Poly Haven textures/GLB from `public/assets/` |
| `sky.ts` | TSL sky dome (gradient, HDR sun for bloom, animated clouds), `cloudShadowNode()`, lights |
| `dust.ts` | Billboarded instanced dust w/ per-instance fade |
| `music.ts` / `audio.ts` | Procedural rock loop / engine+gravel SFX, beeps, `speechSynthesis` co-driver |
| `hud.ts` / `touch.ts` | DOM HUD, minimap, pacenote panel / mobile detection + touch buttons |

Tools (Node, no deps): `tools/build-map.mjs` (bake any lat/lng → OSM route +
SRTM grid → `src/data/<name>.json`; **this is the seed of the multi-map
pipeline**), `tools/fetch-assets.mjs` (Poly Haven CC0 downloads).

## 4. How to run & publish

```bash
npm install
npm run dev        # localhost:5173
npm run typecheck && npm run build   # build → docs/ (commit it; Pages serves it)
npm run preview    # serves docs/ at :4300
```
URL flags: `?webgl` force WebGL 2 · `?touch` force touch UI · `?off=trees,coffee,grass,rocks,logo` disable scenery groups (bisection debugging).

## 5. Agent verification harness (no human needed)

The game exposes hooks (kept intentionally):
- `window.__game` = `{ tick(dt), G, keys, input, vehicle, track, camera, renderer, scene, startRace, audio, music }`
- `window.__dbg` = `{ frames, err, draws }` — `err` catches loop exceptions.
- `window.__gpuErrs` — **WebGPU validation errors** (they never throw in JS; a
  single invalid bind group blacks out the whole frame — always check this).
- `window.__pause = true` stops the rAF loop so you can `tick()` manually
  (deterministic simulation) and stage cameras for screenshots.
- `await window.__shotRT(1024, q)` → base64 JPEG rendered off-screen via
  render target readback (**works with hidden tabs**; width is rounded to a
  multiple of 64 — WebGPU 256-byte row alignment). `__shot()` copies the
  canvas (needs a visible, presenting tab).
- Screenshot review trick: run a tiny local HTTP server that accepts POSTed
  base64 and writes JPGs, then `fetch('http://localhost:4599/name', {method:'POST', body: b64})`
  and read the file (pattern used throughout; server script lives in the
  session scratchpad — trivially recreated, ~20 lines).
- Autopilot recipe (correct key convention!): error = `atan2(dx,dz) − vehicle.heading()`
  wrapped to ±π; **`keys.left = err > 0`, `keys.right = err < 0`**; brake when
  speed > target computed from upcoming bend; if stuck/backwards >2.5 s call
  `vehicle.reset(vehicle.idx)` (same as the player's R key).

## 6. Pitfalls already paid for (do not repeat)

1. **Handedness**: y-up, car faces +z ⇒ the car's RIGHT is **−x** (same as the
   three.js camera). Turning right DECREASES `atan2(fwd.x, fwd.z)`. A
   self-consistent autopilot will NOT catch an inverted-steering bug — verify
   in screen space (`camera.worldToLocal` of the car, x>0 = screen right).
2. **WebGPU 64 KB uniform limit**: an InstancedMesh whose matrices get
   re-uploaded must stay ≤1000 instances; otherwise the whole command buffer
   is invalidated → black screen, no JS error. `lod.ts` chunks for this.
3. **Nearest-sample blending is discontinuous** where a route passes near
   itself — grade with a distance-weighted average (track.ts kernel), and the
   spatial-hash search radius must cover the blend radius.
4. **Poly Haven photoscans are huge** (jacaranda_tree = 203 MB) — check sizes
   before committing; 1k textures + boulder ≈ 11 MB total is the budget style.
5. **Overpass API**: use GET + a real User-Agent (POST text/plain → 406).
   OpenTopoData: ≤100 points/call, ~1 req/s.
6. **`setPointerCapture` throws** on synthetic/expired pointers — try/catch it.
7. Hidden preview tabs: rAF pauses, canvas stops presenting, `setInterval`
   throttles — use `__pause` + manual `tick()` + `__shotRT`.
8. In MENU the physics runs with no input; on a slope the car can roll away
   (harmless now, but remember when staging screenshots).

## 7. Where we're going (backlog — see IDEAS.md)

Priority order suggested by the owner's requests:
1. **RedFoot running game (cross-country)** — replace the car with a runner:
   alternate **`1` = left leg, `0` = right leg** to run (rhythm = speed,
   breaking rhythm breaks stride). Same Ecogarden stage. Fixed avatar with
   running clothes first.
2. **Avatars** — choose male/female first; customization later.
3. **Multi-map selection** — player picks a stage; maps baked from Google
   Maps/OSM at famous foot-race locations (Corrida das Catedrais,
   Maringá–Londrina, Iguaçu Falls, Grand Canyon, Machu Picchu…), cross vibe.
   `tools/build-map.mjs <lat> <lng> <name>` already bakes new stages; a stage
   selector + per-stage JSON is the missing piece.
4. **Track pipeline via GitHub issues** — one issue per new track with the
   Maps reference; a dev (or agent) runs the bake tool and ships it.
5. Nice-to-haves parked: skid marks, ghost of best run, gamepad, a proper
   CC0 rally-car GLB (none found with direct download so far), GTAO.

Open loose end: none critical — issues #1–#4 closed (verify #4 shows CLOSED
after GitHub processes commit `1f2bd90`).

---
*Written 2026-07-08 by the previous agent session (Claude Fable 5) as a
continuation baseline. Boa sorte — e cuidado com a mão direita em −x.* 👣
