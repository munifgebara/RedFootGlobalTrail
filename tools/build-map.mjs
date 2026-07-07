// Builds a real-world stage from OpenStreetMap roads + SRTM elevations.
// Usage: node tools/build-map.mjs <lat> <lng> <name>
// Writes src/data/<name>.json with { route, grid } in local meters.
//
// World convention: x = east, z = north, normalized so the route's bbox
// center lands at (1500, 250) — the world center the engine already uses.

const [lat0, lng0, name] = [
  parseFloat(process.argv[2] ?? '-23.469248'),
  parseFloat(process.argv[3] ?? '-51.900126'),
  process.argv[4] ?? 'ecogarden',
];

const M_PER_DEG_LAT = 110540;
const M_PER_DEG_LNG = 111320 * Math.cos(lat0 * Math.PI / 180);
const toXZ = (lat, lng) => [(lng - lng0) * M_PER_DEG_LNG, (lat - lat0) * M_PER_DEG_LAT];
const toLatLng = (x, z) => [lat0 + z / M_PER_DEG_LAT, lng0 + x / M_PER_DEG_LNG];

const UA = {
  'User-Agent': 'RedFootGlobalTrail/1.0 (map baking tool; github.com/munifgebara/RedFootGlobalTrail)',
  'Accept': 'application/json',
};

const TARGET_LEN = 5200;     // m de rota desejados
const MAX_SPAN = 2600;       // bbox máximo (terreno cobre ±3100 do centro)
const ROUTE_STEP = 30;       // m entre pontos emitidos
const GRID_MARGIN = 380;     // m além do bbox da rota
const GRID_MAX_PTS = 8100;   // ~90x90
const ELEV_SCALE = 1.15;     // exagero leve p/ gameplay
const MAX_GRADE = 0.12;      // rampa máx. do perfil da estrada (12%)
const GRADE_W_IN = 12;       // corredor de corte/aterro: plena mistura até (m)
const GRADE_W_OUT = 48;      // ... some até (m)

/* ---------------- 1. vias reais (Overpass/OSM) ---------------- */
async function fetchWays() {
  const q = `[out:json][timeout:60];
way(around:1700,${lat0},${lng0})[highway~"^(track|unclassified|tertiary|secondary|residential|service|living_street)$"];
out geom;`;
  const endpoints = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
  ];
  for (const ep of endpoints) {
    try {
      const r = await fetch(ep + '?data=' + encodeURIComponent(q), { headers: UA });
      if (!r.ok) { console.error('overpass', ep, r.status); continue; }
      const j = await r.json();
      if (j.elements?.length) return j.elements;
    } catch (e) { console.error('overpass fail', ep, e.message); }
  }
  throw new Error('Overpass sem resposta');
}

/* ---------------- 2. grafo denso + caminhada gulosa ---------------- */
function buildRoute(ways) {
  const key = (x, z) => Math.round(x) + ',' + Math.round(z);
  const nodes = new Map(); // key -> {x,z,edges:[{k2,x,z}]}
  const addNode = (x, z) => {
    const k = key(x, z);
    if (!nodes.has(k)) nodes.set(k, { x, z, edges: [] });
    return k;
  };
  for (const w of ways) {
    if (!w.geometry) continue;
    for (let i = 0; i + 1 < w.geometry.length; i++) {
      const [x1, z1] = toXZ(w.geometry[i].lat, w.geometry[i].lon);
      const [x2, z2] = toXZ(w.geometry[i + 1].lat, w.geometry[i + 1].lon);
      const k1 = addNode(x1, z1), k2 = addNode(x2, z2);
      if (k1 === k2) continue;
      nodes.get(k1).edges.push(k2);
      nodes.get(k2).edges.push(k1);
    }
  }
  // nós mais próximos do centro como candidatos a largada
  const starts = [...nodes.values()]
    .sort((a, b) => (a.x * a.x + a.z * a.z) - (b.x * b.x + b.z * b.z))
    .slice(0, 8);

  let best = [];
  for (const s of starts) {
    const used = new Set();
    const pts = [[s.x, s.z]];
    let cur = key(s.x, s.z), dir = null, len = 0;
    let minX = s.x, maxX = s.x, minZ = s.z, maxZ = s.z;
    for (let step = 0; step < 4000 && len < TARGET_LEN; step++) {
      const n = nodes.get(cur);
      let bestK = null, bestTurn = 1e9;
      for (const k2 of n.edges) {
        const ek = cur < k2 ? cur + '|' + k2 : k2 + '|' + cur;
        if (used.has(ek)) continue;
        const m = nodes.get(k2);
        const dx = m.x - n.x, dz = m.z - n.z;
        const a = Math.atan2(dx, dz);
        let turn = dir === null ? 0 : Math.abs(a - dir);
        if (turn > Math.PI) turn = 2 * Math.PI - turn;
        if (turn < bestTurn) { bestTurn = turn; bestK = k2; }
      }
      if (bestK === null) break;                    // beco sem saída
      if (bestTurn > 2.6 && len > 400) break;       // só voltaria por onde veio
      const m = nodes.get(bestK);
      const nx1 = Math.min(minX, m.x), nx2 = Math.max(maxX, m.x);
      const nz1 = Math.min(minZ, m.z), nz2 = Math.max(maxZ, m.z);
      if (nx2 - nx1 > MAX_SPAN || nz2 - nz1 > MAX_SPAN) break;
      minX = nx1; maxX = nx2; minZ = nz1; maxZ = nz2;
      const ek = cur < bestK ? cur + '|' + bestK : bestK + '|' + cur;
      used.add(ek);
      const n0 = nodes.get(cur);
      len += Math.hypot(m.x - n0.x, m.z - n0.z);
      dir = Math.atan2(m.x - n0.x, m.z - n0.z);
      pts.push([m.x, m.z]);
      cur = bestK;
    }
    if (pathLen(pts) > pathLen(best)) best = pts;
  }
  return best;
}
const pathLen = (p) => p.reduce((a, c, i) => i ? a + Math.hypot(c[0] - p[i - 1][0], c[1] - p[i - 1][1]) : 0, 0);

/* ---------------- 3. reamostra a cada ROUTE_STEP m ---------------- */
function resample(pts, step) {
  const out = [pts[0]];
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    let [px, pz] = pts[i - 1];
    const [qx, qz] = pts[i];
    let seg = Math.hypot(qx - px, qz - pz);
    while (acc + seg >= step) {
      const t = (step - acc) / seg;
      const nx = px + (qx - px) * t, nz = pz + (qz - pz) * t;
      out.push([nx, nz]);
      seg -= (step - acc); px = nx; pz = nz; acc = 0;
    }
    acc += seg;
  }
  return out;
}

/* ---------------- 4. grade de elevação (SRTM) ---------------- */
async function fetchElevGrid(bbox) {
  const [minX, minZ, maxX, maxZ] = bbox;
  const x0 = minX - GRID_MARGIN, z0 = minZ - GRID_MARGIN;
  const x1 = maxX + GRID_MARGIN, z1 = maxZ + GRID_MARGIN;
  const span = Math.max(x1 - x0, z1 - z0);
  const n = Math.floor(Math.sqrt(GRID_MAX_PTS));
  const dx = Math.max(35, span / (n - 1));
  const nx = Math.floor((x1 - x0) / dx) + 1;
  const nz = Math.floor((z1 - z0) / dx) + 1;
  const locs = [];
  for (let k = 0; k < nz; k++) {
    for (let i = 0; i < nx; i++) {
      const [la, lo] = toLatLng(x0 + i * dx, z0 + k * dx);
      locs.push(la.toFixed(6) + ',' + lo.toFixed(6));
    }
  }
  console.log(`grade ${nx}x${nz} = ${locs.length} pontos de elevação…`);
  const h = new Array(locs.length).fill(0);
  for (let off = 0; off < locs.length; off += 100) {
    const batch = locs.slice(off, off + 100).join('|');
    let ok = false;
    for (const api of [
      'https://api.opentopodata.org/v1/srtm30m?locations=',
      'https://api.open-elevation.com/api/v1/lookup?locations=',
    ]) {
      try {
        const r = await fetch(api + batch, { headers: UA });
        if (!r.ok) continue;
        const j = await r.json();
        const rs = j.results;
        if (!rs?.length) continue;
        rs.forEach((e, i2) => { h[off + i2] = e.elevation ?? 0; });
        ok = true;
        break;
      } catch (e) { console.error('elev fail', e.message); }
    }
    if (!ok) throw new Error('APIs de elevação sem resposta no lote ' + off);
    process.stdout.write(`\r${Math.min(off + 100, locs.length)}/${locs.length}`);
    await new Promise((r) => setTimeout(r, 1100)); // rate limit opentopodata
  }
  console.log();
  return { x0, z0, dx, nx, nz, h };
}

/* ---------------- 5. pós-processa e grava ---------------- */
function smooth(g) {
  const out = g.h.slice();
  for (let k = 1; k < g.nz - 1; k++) {
    for (let i = 1; i < g.nx - 1; i++) {
      const at = (kk, ii) => g.h[kk * g.nx + ii];
      out[k * g.nx + i] = (at(k, i) * 4 + at(k - 1, i) + at(k + 1, i) + at(k, i - 1) + at(k, i + 1)) / 8;
    }
  }
  g.h = out;
}

const ways = await fetchWays();
console.log(ways.length, 'vias OSM');
let route = buildRoute(ways);
console.log('rota bruta:', route.length, 'pts,', Math.round(pathLen(route)), 'm');
if (pathLen(route) < 2000) throw new Error('rota muito curta — ajuste raio/filtros');
route = resample(route, ROUTE_STEP);

// normaliza: centro do bbox da rota → (1500, 250)
let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
for (const [x, z] of route) {
  minX = Math.min(minX, x); maxX = Math.max(maxX, x);
  minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
}
const ox = 1500 - (minX + maxX) / 2, oz = 250 - (minZ + maxZ) / 2;

const grid = await fetchElevGrid([minX, minZ, maxX, maxZ]);
const mean = grid.h.reduce((a, b) => a + b, 0) / grid.h.length;
grid.h = grid.h.map((v) => (v - mean) * ELEV_SCALE);
smooth(grid); smooth(grid); smooth(grid);

/* "terraplanagem": perfil suave da estrada + corte/aterro no corredor.
   Sem isso, ruído SRTM + encostas reais geram rampas de 25%+ na pista. */
{
  const sampleG = (x, z) => {
    const fx = Math.min(Math.max((x - grid.x0) / grid.dx, 0), grid.nx - 1.001);
    const fz = Math.min(Math.max((z - grid.z0) / grid.dx, 0), grid.nz - 1.001);
    const i = Math.floor(fx), k = Math.floor(fz), tx = fx - i, tz = fz - k;
    const at = (kk, ii) => grid.h[kk * grid.nx + ii];
    return (at(k, i) * (1 - tx) + at(k, i + 1) * tx) * (1 - tz)
         + (at(k + 1, i) * (1 - tx) + at(k + 1, i + 1) * tx) * tz;
  };
  // perfil ao longo da rota: média móvel + limite de rampa (duas passadas)
  const prof = route.map(([x, z]) => sampleG(x, z));
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < prof.length; i++) {
      let s = 0, c = 0;
      for (let j = -4; j <= 4; j++) {
        const k = i + j;
        if (k >= 0 && k < prof.length) { s += prof[k]; c++; }
      }
      prof[i] = s / c;
    }
    const maxDy = MAX_GRADE * ROUTE_STEP;
    for (let i = 1; i < prof.length; i++) {
      prof[i] = Math.max(prof[i - 1] - maxDy, Math.min(prof[i - 1] + maxDy, prof[i]));
    }
    for (let i = prof.length - 2; i >= 0; i--) {
      prof[i] = Math.max(prof[i + 1] - maxDy, Math.min(prof[i + 1] + maxDy, prof[i]));
    }
  }
  // corte/aterro: mistura o terreno em direção ao perfil perto da rota
  for (let k = 0; k < grid.nz; k++) {
    for (let i = 0; i < grid.nx; i++) {
      const gx = grid.x0 + i * grid.dx, gz = grid.z0 + k * grid.dx;
      let bd = 1e9, bj = 0;
      for (let j = 0; j < route.length; j++) {
        const dx2 = route[j][0] - gx, dz2 = route[j][1] - gz;
        const d = dx2 * dx2 + dz2 * dz2;
        if (d < bd) { bd = d; bj = j; }
      }
      const dist = Math.sqrt(bd);
      if (dist < GRADE_W_OUT) {
        const w = dist < GRADE_W_IN ? 1 : 1 - (dist - GRADE_W_IN) / (GRADE_W_OUT - GRADE_W_IN);
        const idx = k * grid.nx + i;
        grid.h[idx] = grid.h[idx] * (1 - w) + prof[bj] * w;
      }
    }
  }
}
grid.x0 += ox; grid.z0 += oz;

const data = {
  name,
  lat: lat0, lng: lng0,
  lengthM: Math.round(pathLen(route)),
  route: route.map(([x, z]) => [Math.round((x + ox) * 10) / 10, Math.round((z + oz) * 10) / 10]),
  grid: { ...grid, h: grid.h.map((v) => Math.round(v * 100) / 100) },
};
const fs = await import('fs');
fs.mkdirSync(new URL('../src/data/', import.meta.url), { recursive: true });
fs.writeFileSync(new URL(`../src/data/${name}.json`, import.meta.url), JSON.stringify(data));
console.log(`src/data/${name}.json gravado — rota ${data.lengthM} m, grade ${grid.nx}x${grid.nz}`);
