import * as THREE from 'three/webgpu';

export interface CarVisual {
  group: THREE.Group;          // carroceria (segue o chassi físico)
  wheels: THREE.Object3D[];    // 4 rodas soltas na cena (seguem a suspensão)
}

function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.anisotropy = 8;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * Carro de rally estilizado: perfil lateral extrudado com bevel (silhueta
 * de verdade, não caixote), pintura vermelha com clearcoat, teto branco,
 * pods de farol emissivos, aerofólio, para-lamas e número de porta.
 */
export function buildCarVisual(): CarVisual {
  const group = new THREE.Group();

  const paint = new THREE.MeshPhysicalMaterial({
    color: 0xd92a1c, roughness: 0.32, metalness: 0.1,
    clearcoat: 1.0, clearcoatRoughness: 0.15,
  });
  const white = new THREE.MeshStandardMaterial({ color: 0xf4f4f2, roughness: 0.4 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x191b1f, roughness: 0.65 });
  const glass = new THREE.MeshPhysicalMaterial({
    color: 0x22333e, roughness: 0.05, metalness: 0.2,
    clearcoat: 1.0,
  });

  // perfil lateral (x = comprimento, y = altura) → extrudado na largura
  const s = new THREE.Shape();
  const profile: [number, number][] = [
    [-2.08, 0.30], [-2.14, 0.80], [-1.42, 0.94], [-0.80, 1.34],
    [0.34, 1.36], [0.98, 0.96], [2.00, 0.80], [2.14, 0.38],
    [1.80, 0.20], [-1.72, 0.20],
  ];
  s.moveTo(profile[0][0], profile[0][1]);
  for (let i = 1; i < profile.length; i++) s.lineTo(profile[i][0], profile[i][1]);
  const bodyGeo = new THREE.ExtrudeGeometry(s, {
    depth: 1.58, bevelEnabled: true, bevelThickness: 0.07, bevelSize: 0.06, bevelSegments: 2,
  });
  bodyGeo.translate(0, 0, -0.79);
  bodyGeo.rotateY(-Math.PI / 2); // comprimento no eixo z (frente = +z)
  const body = new THREE.Mesh(bodyGeo, paint);
  body.castShadow = true;
  group.add(body);

  // teto branco + vent
  const roof = new THREE.Mesh(new THREE.BoxGeometry(1.46, 0.06, 1.16), white);
  roof.position.set(0, 1.39, -0.24);
  group.add(roof);
  const vent = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.09, 0.4), dark);
  vent.position.set(0, 1.43, 0.12);
  group.add(vent);

  // vidros (planos levemente afastados da carroceria)
  const windshield = new THREE.Mesh(new THREE.PlaneGeometry(1.42, 0.72), glass);
  windshield.position.set(0, 1.17, 0.70);
  windshield.rotation.x = -Math.PI / 2 + Math.atan2(1.36 - 0.96, 0.98 - 0.34);
  group.add(windshield);
  const rear = new THREE.Mesh(new THREE.PlaneGeometry(1.38, 0.5), glass);
  rear.position.set(0, 1.14, -1.06);
  rear.rotation.x = Math.PI / 2 - Math.atan2(1.34 - 0.94, 1.42 - 0.8);
  rear.rotation.y = Math.PI;
  group.add(rear);
  for (const sx of [-1, 1]) {
    const side = new THREE.Mesh(new THREE.PlaneGeometry(1.34, 0.34), glass);
    side.position.set(sx * 0.865, 1.12, -0.22);
    side.rotation.y = sx * Math.PI / 2;
    group.add(side);
  }

  // número de porta
  const numTex = canvasTexture(128, 128, (g) => {
    g.fillStyle = '#fff'; g.beginPath(); g.arc(64, 64, 56, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#111'; g.font = '900 82px "Segoe UI", sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('7', 64, 70);
  });
  const numMat = new THREE.MeshStandardMaterial({ map: numTex, transparent: true, roughness: 0.5 });
  for (const sx of [-1, 1]) {
    const pl = new THREE.Mesh(new THREE.PlaneGeometry(0.56, 0.56), numMat);
    pl.position.set(sx * 0.90, 0.72, 0.18);
    pl.rotation.y = sx * Math.PI / 2;
    group.add(pl);
  }

  // aerofólio
  const wing = new THREE.Mesh(new THREE.BoxGeometry(1.62, 0.06, 0.44), dark);
  wing.position.set(0, 1.28, -1.98);
  wing.castShadow = true;
  group.add(wing);
  for (const sx of [-0.72, 0.72]) {
    const st = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.3, 0.3), dark);
    st.position.set(sx, 1.06, -1.95);
    group.add(st);
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.16, 0.5), dark);
    plate.position.set(sx + Math.sign(sx) * 0.06, 1.30, -1.98);
    group.add(plate);
  }

  // pods de farol de rally (emissivos → bloom)
  const podGeo = new THREE.CylinderGeometry(0.13, 0.15, 0.12, 12);
  const podMat = new THREE.MeshStandardMaterial({
    color: 0xfff8d8, emissive: 0xfff2b8, emissiveIntensity: 2.2,
  });
  const podRing = new THREE.MeshStandardMaterial({ color: 0x22242a, roughness: 0.5 });
  for (const x of [-0.56, -0.20, 0.20, 0.56]) {
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.17, 0.10, 12), podRing);
    ring.rotation.x = Math.PI / 2;
    ring.position.set(x, 0.92, 2.10);
    group.add(ring);
    const l = new THREE.Mesh(podGeo, podMat);
    l.rotation.x = Math.PI / 2;
    l.position.set(x, 0.92, 2.13);
    group.add(l);
  }

  // lanternas traseiras emissivas
  const tailMat = new THREE.MeshStandardMaterial({
    color: 0xff2a1e, emissive: 0xcc1408, emissiveIntensity: 1.6,
  });
  for (const x of [-0.66, 0.66]) {
    const tl = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.12, 0.05), tailMat);
    tl.position.set(x, 0.72, -2.13);
    group.add(tl);
  }

  // para-choques e saias
  const fb = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.22, 0.3), dark);
  fb.position.set(0, 0.34, 2.06);
  group.add(fb);
  const rb = fb.clone(); rb.position.z = -2.06; group.add(rb);
  for (const sx of [-1, 1]) {
    const skirt = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.14, 2.6), dark);
    skirt.position.set(sx * 0.86, 0.22, 0);
    group.add(skirt);
  }
  // para-lamas (mud flaps)
  for (const sx of [-0.62, 0.62]) {
    const flap = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.26, 0.03),
      new THREE.MeshStandardMaterial({ color: 0x101114, roughness: 0.9 }));
    flap.position.set(sx, 0.2, -1.72);
    group.add(flap);
  }
  // antena
  const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.5, 4), dark);
  ant.position.set(-0.6, 1.6, -0.9);
  ant.rotation.z = 0.15;
  group.add(ant);

  // sombra de contato falsa (leitura visual mesmo na penumbra)
  const blobTex = canvasTexture(128, 128, (g) => {
    const gr = g.createRadialGradient(64, 64, 8, 64, 64, 62);
    gr.addColorStop(0, 'rgba(0,0,0,.36)');
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  });
  const blob = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 5.0),
    new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false }));
  blob.rotation.x = -Math.PI / 2;
  blob.position.y = 0.06;
  blob.renderOrder = 2;
  group.add(blob);

  // rodas: pneu + aro dourado com raios (ficam soltas na cena; a física posiciona)
  const wheels: THREE.Object3D[] = [];
  const tireMat = new THREE.MeshStandardMaterial({ color: 0x141518, roughness: 0.92 });
  const rimMat = new THREE.MeshStandardMaterial({ color: 0xd8b23c, roughness: 0.35, metalness: 0.6 });
  for (let i = 0; i < 4; i++) {
    const w = new THREE.Group();
    const tire = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.32, 18), tireMat);
    tire.rotation.z = Math.PI / 2;
    tire.castShadow = true;
    w.add(tire);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.34, 12), rimMat);
    hub.rotation.z = Math.PI / 2;
    w.add(hub);
    for (let k = 0; k < 5; k++) {
      // raios no plano da roda (eixo do pneu = x)
      const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.34, 0.07), rimMat);
      spoke.rotation.x = (k / 5) * Math.PI * 2;
      w.add(spoke);
    }
    wheels.push(w);
  }

  return { group, wheels };
}
