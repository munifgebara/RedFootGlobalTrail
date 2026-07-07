import * as THREE from 'three/webgpu';

/**
 * Identidade "Red Foot Global Trail": pegada vermelha com contorno preto,
 * desenhada proceduralmente — em canvas (texturas/decais) e em THREE.Shape
 * (extrusões 3D, como o monumento da largada).
 *
 * Layout em coordenadas unitárias (pé ~2.2 de altura, apontando p/ cima):
 * sola grande rotacionada + 5 dedos em arco no topo.
 */

const SOLE = { cx: 0, cy: -0.35, rx: 0.62, ry: 0.85, rot: -0.22 };
const TOES: { cx: number; cy: number; r: number }[] = [
  { cx: -0.52, cy: 0.72, r: 0.24 },   // dedão
  { cx: -0.05, cy: 0.92, r: 0.19 },
  { cx: 0.38, cy: 0.88, r: 0.165 },
  { cx: 0.68, cy: 0.68, r: 0.14 },
  { cx: 0.88, cy: 0.40, r: 0.12 },
];

/** Desenha a pegada num contexto 2D (y do canvas cresce p/ baixo). */
export function drawFoot(g: CanvasRenderingContext2D, cx: number, cy: number,
                         s: number, fill: string, outline?: string, outlineW = 0.1): void {
  const blob = (x: number, y: number, rx: number, ry: number, rot: number) => {
    g.beginPath();
    g.ellipse(cx + x * s, cy - y * s, rx * s, ry * s, -rot, 0, Math.PI * 2);
    g.fill();
    if (outline) { g.lineWidth = outlineW * s; g.strokeStyle = outline; g.stroke(); }
  };
  g.fillStyle = fill;
  blob(SOLE.cx, SOLE.cy, SOLE.rx, SOLE.ry, SOLE.rot);
  for (const t of TOES) blob(t.cx, t.cy, t.r, t.r, 0);
}

/** Textura transparente da pegada (para decais no carro, faixas etc.). */
export function footDecalTexture(size = 256, fill = '#d81f10', outline = '#151312'): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  drawFoot(g, size / 2, size / 2 + size * 0.08, size * 0.20, fill, outline, 0.12);
  const t = new THREE.CanvasTexture(c);
  t.anisotropy = 8;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Shapes 2D da pegada (sola + dedos) para extrusão. */
export function footShapes(scale = 1, grow = 0): THREE.Shape[] {
  const shapes: THREE.Shape[] = [];
  const blob = (cx: number, cy: number, rx: number, ry: number, rot: number) => {
    const s = new THREE.Shape();
    s.absellipse(cx * scale, cy * scale, (rx + grow) * scale, (ry + grow) * scale, 0, Math.PI * 2, false, rot);
    shapes.push(s);
  };
  blob(SOLE.cx, SOLE.cy, SOLE.rx, SOLE.ry, SOLE.rot);
  for (const t of TOES) blob(t.cx, t.cy, t.r, t.r, 0);
  return shapes;
}

/**
 * Monumento 3D da logo: pegada vermelha extrudada com "contorno" preto
 * (extrusão maior atrás), sobre pedestal — gira devagar na largada.
 */
export function buildLogoMonument(scale = 3): THREE.Group {
  const grp = new THREE.Group();

  const red = new THREE.MeshPhysicalMaterial({
    color: 0xd81f10, roughness: 0.28, metalness: 0.15,
    clearcoat: 0.8, clearcoatRoughness: 0.25,
  });
  const black = new THREE.MeshStandardMaterial({ color: 0x17140f, roughness: 0.55 });
  const whiteMat = new THREE.MeshStandardMaterial({ color: 0xf4f2ec, roughness: 0.6 });

  const front = new THREE.Mesh(
    new THREE.ExtrudeGeometry(footShapes(scale), {
      depth: 0.30 * scale, bevelEnabled: true,
      bevelThickness: 0.045 * scale, bevelSize: 0.04 * scale, bevelSegments: 3,
    }), red);
  front.castShadow = true;

  const back = new THREE.Mesh(
    new THREE.ExtrudeGeometry(footShapes(scale, 0.11), {
      depth: 0.16 * scale, bevelEnabled: true,
      bevelThickness: 0.03 * scale, bevelSize: 0.03 * scale, bevelSegments: 2,
    }), black);
  back.position.z = -0.14 * scale;
  back.castShadow = true;

  const foot = new THREE.Group();
  foot.add(front, back);
  foot.position.y = 1.6 * scale;   // centro do pé acima do pedestal
  grp.add(foot);
  grp.userData.foot = foot;

  const pedestal = new THREE.Mesh(
    new THREE.CylinderGeometry(0.55 * scale, 0.7 * scale, 0.5 * scale, 20), whiteMat);
  pedestal.position.y = 0.25 * scale;
  pedestal.castShadow = true;
  grp.add(pedestal);
  const column = new THREE.Mesh(
    new THREE.CylinderGeometry(0.12 * scale, 0.16 * scale, 0.6 * scale, 10), black);
  column.position.y = 0.75 * scale;
  grp.add(column);

  return grp;
}
