# 👣 Red Foot Global Trail

A [GEBARA Labs](https://www.gebaralabs.dev/) experiment.

**Stage 1: Ecogarden** — a 3D rally simulator that runs 100% in the browser,
set on the red-earth backroads around Maringá, Paraná, Brazil: terra roxa
dirt, coffee fields, pink and yellow ipê trees, farm houses and the Maringá
Cathedral on the horizon. One ~6 km special stage with a co-driver calling
pacenotes, and the 3D Red Foot logo monument spinning at the start line.

First location reference: [Ecogarden on Google Maps](https://maps.app.goo.gl/sVvb3SNtY87cxKEf6).

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

---

Built with Claude Code as an AI-model evaluation POC, for GEBARA Labs.
