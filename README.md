# 👣 Red Foot Global Trail

A [GEBARA Labs](https://www.gebaralabs.dev/) experiment.

**Stage 1: Ecogarden** — a 3D rally simulator that runs 100% in the browser,
set on the red-earth backroads around Maringá, Paraná, Brazil: terra roxa
dirt, coffee fields, pink and yellow ipê trees, farm houses and the Maringá
Cathedral on the horizon. One ~6 km special stage with a co-driver calling
pacenotes, and the 3D Red Foot logo monument spinning at the start line.

**The stage follows real-world roads and elevations.** The layout comes from
OpenStreetMap ways and the heights from SRTM (30 m) around
[Ecogarden on Google Maps](https://maps.app.goo.gl/sVvb3SNtY87cxKEf6)
(−23.469248, −51.900126), baked into `src/data/ecogarden.json` by
`tools/build-map.mjs` — the site stays fully static.

```bash
# rebake (or bake a brand-new location for a future stage):
node tools/build-map.mjs <lat> <lng> <name>
```

The tool picks a long route through the real road graph, resamples it,
fetches an elevation grid (OpenTopoData/SRTM), applies light exaggeration
(1.15×) and then "grades" the road like a civil engineer would: the route
profile is smoothed and capped at 12% grade, and the terrain is cut/filled
in a corridor around it, so physics, road ribbon and scenery stay perfectly
in sync.

**Play it:** open the repository's GitHub Pages (or run it locally, below).

## Stack

| Layer | Technology |
|---|---|
| Build | Vite + TypeScript (fully static site) |
| Rendering | three.js **WebGPU** with **TSL** materials (automatic WebGL 2 fallback) |
| Physics | **cannon-es** — `RaycastVehicle` on a terrain heightfield |
| Post-processing | Bloom (headlights/sun) + vignette via TSL `PostProcessing` |
| Audio | WebAudio (engine, gravel, beeps) + co-driver voice via `speechSynthesis` |

Everything is generated procedurally at load time: track (Catmull-Rom),
terrain, crop fields, ~560 trees, ~1600 coffee bushes, wind-blown grass,
animated clouds, pacenotes extracted from the track curvature — and the
**Red Foot** identity (the red footprint) drawn on canvas and extruded in 3D.

### Multi-quality model LOD (short / medium / long range)

| Distance | Trees | Coffee | Grass |
|---|---|---|---|
| ≤ 130 m | branched trunk + multi-lobe canopy | full model | dense (≤ 175 m) |
| ≤ 460 m | single faceted canopy | full model | — |
| ≤ 1500 m | per-instance tinted billboard | culled (> 650 m) | — |

Re-bucketing runs every ~0.3 s and each level is split into 1000-instance
sub-meshes (WebGPU's 64 KB uniform-buffer binding limit). Cloud shadows sweep
the terrain and the road in sync with the sky (TSL noise).

## Controls

- **W / ↑** accelerate · **S / ↓** brake & reverse
- **A D / ← →** steering · **SPACE** handbrake (drift)
- **C** camera (chase / hood / TV) · **R** reset to track · **M** sound

## Running locally

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # outputs docs/ (static)
npm run preview    # serves the build at http://localhost:4300
```

Tip: append `?webgl` to the URL to force the WebGL 2 backend.

## Publishing on GitHub Pages

The build goes to **`docs/`** with relative paths, so all it takes is:

1. Push to the `main` branch;
2. **Settings → Pages → Deploy from a branch → `main` / `docs`**.

No workflow or server needed — static pages only.

## Roadmap (see [IDEAS.md](IDEAS.md))

- 🏃 **Become a cross-country foot race**: alternate the `1`/`0` keys to run
  (left/right leg), runner avatar, still around Maringá.
- 🗺️ **Multiple maps** at real tourist landmarks (Maringá–Londrina,
  Iguaçu Falls, Grand Canyon, Machu Picchu…), customizable avatars,
  new tracks added via GitHub issues.

## Asset credits

PBR textures and the scanned boulder come from **[Poly Haven](https://polyhaven.com)** (CC0):
`red_dirt_mud_01` (road), `sparse_grass` (fields), `boulder_01` (roadside rocks).
Fetched by `node tools/fetch-assets.mjs` into `public/assets/` (committed, so the
site stays static). Everything else is generated procedurally at runtime.

---

Built with Claude Code as an AI-model evaluation POC, for GEBARA Labs.
