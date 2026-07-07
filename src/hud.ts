import type { Track, Corner } from './track';
import { DS } from './track';
import { speak } from './audio';

const $ = (id: string) => document.getElementById(id)!;

export function fmtTime(t: number): string {
  const m = Math.floor(t / 60), s = t - m * 60;
  return String(m).padStart(2, '0') + ':' + s.toFixed(1).padStart(4, '0');
}

const SEV_TXT: Record<number, string> = { 1: 'HAIRPIN', 2: '2', 3: '3', 4: '4', 5: '5', 6: '6' };
const SEV_VOICE: Record<number, string> = {
  1: 'hairpin', 2: 'two', 3: 'three', 4: 'four', 5: 'five', 6: 'six',
};

export class Hud {
  private track: Track;
  private mm: CanvasRenderingContext2D;
  private mmBase: HTMLCanvasElement;
  private mmMap: (x: number, z: number) => [number, number];
  private throttleT = 0;

  constructor(track: Track) {
    this.track = track;
    $('chipLen').textContent = track.RACE_KM.toFixed(1);

    // minimapa pré-renderizado
    const W = 340, pad = 30;
    let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
    for (const p of track.pts) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
    }
    const sc = Math.min((W - pad * 2) / (maxX - minX), (W - pad * 2) / (maxZ - minZ));
    this.mmMap = (x, z) => [
      pad + (x - minX) * sc + (W - pad * 2 - (maxX - minX) * sc) / 2,
      W - (pad + (z - minZ) * sc + (W - pad * 2 - (maxZ - minZ) * sc) / 2),
    ];
    const off = document.createElement('canvas');
    off.width = off.height = W;
    const g = off.getContext('2d')!;
    g.strokeStyle = 'rgba(255,255,255,.85)';
    g.lineWidth = 5; g.lineJoin = 'round'; g.lineCap = 'round';
    g.beginPath();
    track.pts.forEach((p, i) => {
      const [x, y] = this.mmMap(p.x, p.z);
      i ? g.lineTo(x, y) : g.moveTo(x, y);
    });
    g.stroke();
    const [sx, sy] = this.mmMap(track.pts[track.START_I].x, track.pts[track.START_I].z);
    const [fx, fy] = this.mmMap(track.pts[track.FINISH_I].x, track.pts[track.FINISH_I].z);
    g.fillStyle = '#39d353'; g.beginPath(); g.arc(sx, sy, 7, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#ffc531'; g.beginPath(); g.arc(fx, fy, 7, 0, Math.PI * 2); g.fill();
    this.mmBase = off;
    this.mm = ($('minimap') as HTMLCanvasElement).getContext('2d')!;
  }

  setVisible(on: boolean): void {
    $('hud').classList.toggle('on', on);
  }

  refreshBest(best: number): void {
    const txt = isNaN(best) ? '—' : fmtTime(best);
    $('bestLine').textContent = 'best: ' + txt;
    $('chipBest').textContent = '🏆 best: ' + txt;
  }

  /** Atualiza HUD (limitado a ~12 Hz para não estressar o DOM). */
  update(dt: number, opts: {
    kmh: number; reverse: boolean; time: number; idx: number;
    carX: number; carZ: number; racing: boolean;
  }): void {
    this.throttleT -= dt;
    if (this.throttleT > 0) return;
    this.throttleT = 0.08;
    const t = this.track;
    $('speed').textContent = String(Math.round(opts.kmh));
    const gear = opts.reverse ? 'R' : opts.kmh < 1 ? 'N' : String(Math.min(6, Math.floor(opts.kmh / 33) + 1));
    $('gear').textContent = gear;
    ($('rpmFill') as HTMLElement).style.width =
      (Math.min(Math.max((opts.kmh % 33) / 33, 0.08), 1) * 100) + '%';
    $('timer').textContent = fmtTime(opts.time);
    const prog = Math.min(Math.max((opts.idx - t.START_I) / (t.FINISH_I - t.START_I), 0), 1);
    ($('progFill') as HTMLElement).style.width = (prog * 100) + '%';
    $('kmText').textContent = (prog * t.RACE_KM).toFixed(1) + ' / ' + t.RACE_KM.toFixed(1) + ' km';
    this.updatePacenote(opts.idx, opts.racing);
    this.drawMinimap(opts.carX, opts.carZ);
  }

  private updatePacenote(idx: number, racing: boolean): void {
    const dNow = idx * DS;
    let next: Corner | null = null;
    for (const c of this.track.corners) {
      if (c.endAt > dNow + 6) { next = c; break; }
    }
    const arrow = $('pnArrow'), main = $('pnMain'), dist = $('pnDist');
    if (!next || next.at - dNow > 260) {
      arrow.textContent = '▲'; arrow.className = 'sevEasy';
      main.textContent = 'STRAIGHT'; main.className = '';
      dist.textContent = next ? Math.round((next.at - dNow) / 10) * 10 + ' m' : '';
      return;
    }
    const d = Math.max(0, next.at - dNow);
    const sevClass = next.sev <= 2 ? 'sevHard' : next.sev <= 4 ? 'sevMed' : 'sevEasy';
    arrow.textContent = next.dir === 'E' ? '⬅' : '➡';
    arrow.className = sevClass;
    main.textContent = (next.dir === 'E' ? 'LEFT ' : 'RIGHT ') + SEV_TXT[next.sev] + (next.long ? ' LONG' : '');
    main.className = sevClass;
    dist.textContent = d > 15 ? Math.round(d / 10) * 10 + ' m' : 'NOW';
    if (!next.called && d < 150 && racing) {
      next.called = true;
      speak((next.dir === 'E' ? 'left ' : 'right ') + SEV_VOICE[next.sev] + (next.long ? ' long' : ''));
    }
  }

  private drawMinimap(x: number, z: number): void {
    this.mm.clearRect(0, 0, 340, 340);
    this.mm.drawImage(this.mmBase, 0, 0);
    const [mx, my] = this.mmMap(x, z);
    this.mm.fillStyle = '#ff4d3d';
    this.mm.beginPath(); this.mm.arc(mx, my, 9, 0, Math.PI * 2); this.mm.fill();
    this.mm.strokeStyle = '#fff'; this.mm.lineWidth = 3; this.mm.stroke();
  }
}
