import { audio } from './audio';

/**
 * Video-game rock'n'roll, 100% synthesized with WebAudio — no assets.
 * Kick/snare/hi-hat, palm-muted bass riff and distorted power chords over a
 * classic E–G–A–E/D progression, scheduled with a look-ahead loop.
 * Toggle with N (persisted in localStorage).
 */

const BPM = 138;
const STEP = 60 / BPM / 2;            // eighth notes
const STEPS_PER_BAR = 8;
const BARS = 4;

// chord root per half-bar (E2, G2, A2, E2/D2)
const HALF_BAR_ROOTS = [82.41, 82.41, 98.0, 98.0, 110.0, 110.0, 82.41, 73.42];
// bass riff, semitones above the chord root, one per eighth
const BASS_RIFF = [0, 0, 12, 0, 7, 0, 10, 7];
const KICK = [1, 0, 0, 1, 1, 0, 0, 0];
const SNARE = [0, 0, 1, 0, 0, 0, 1, 0];

class RockMusic {
  private started = false;
  private enabled = localStorage.getItem('rfgt-music') !== '0';
  private out!: GainNode;
  private dist!: WaveShaperNode;
  private noise!: AudioBuffer;
  private step = 0;
  private nextT = 0;
  private timer: ReturnType<typeof setInterval> | null = null;

  get isEnabled(): boolean { return this.enabled; }

  ensureStarted(): void {
    if (this.started || !this.enabled) return;
    const C = audio.ctx;
    if (!C || !audio.master) return;
    this.started = true;

    this.out = C.createGain();
    this.out.gain.value = 0.30;
    const comp = C.createDynamicsCompressor();
    comp.threshold.value = -18; comp.ratio.value = 6;
    this.out.connect(comp);
    comp.connect(audio.master);

    // distorção compartilhada da guitarra
    this.dist = C.createWaveShaper();
    const curve = new Float32Array(512);
    for (let i = 0; i < 512; i++) {
      const x = (i / 255.5) - 1;
      curve[i] = Math.tanh(6 * x);
    }
    this.dist.curve = curve;
    const gtrTone = C.createBiquadFilter();
    gtrTone.type = 'lowpass'; gtrTone.frequency.value = 2400;
    const gtrOut = C.createGain(); gtrOut.gain.value = 0.16;
    this.dist.connect(gtrTone); gtrTone.connect(gtrOut); gtrOut.connect(this.out);

    // ruído compartilhado (caixa/chimbal)
    const len = Math.floor(C.sampleRate * 0.5);
    this.noise = C.createBuffer(1, len, C.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    this.nextT = C.currentTime + 0.1;
    this.timer = setInterval(() => this.schedule(), 90);
  }

  toggle(): boolean {
    this.enabled = !this.enabled;
    localStorage.setItem('rfgt-music', this.enabled ? '1' : '0');
    if (this.enabled) {
      this.ensureStarted();
      if (this.started) this.out.gain.value = 0.30;
    } else if (this.started) {
      this.out.gain.value = 0;
    }
    return this.enabled;
  }

  private schedule(): void {
    const C = audio.ctx!;
    while (this.nextT < C.currentTime + 0.35) {
      this.playStep(this.step, this.nextT);
      this.step = (this.step + 1) % (STEPS_PER_BAR * BARS);
      this.nextT += STEP;
    }
  }

  private playStep(s: number, t: number): void {
    const inBar = s % STEPS_PER_BAR;
    const halfBar = Math.floor(s / 4) % HALF_BAR_ROOTS.length;
    const root = HALF_BAR_ROOTS[halfBar];

    if (KICK[inBar]) this.kick(t);
    if (SNARE[inBar]) this.snare(t);
    this.hat(t, inBar % 2 === 0 ? 0.14 : 0.08);
    this.bass(t, root * Math.pow(2, BASS_RIFF[inBar] / 12));
    // guitarra: sustain no início do meio-compasso, chugs abafados no resto
    this.powerChord(t, root * 2, inBar % 4 === 0 ? 0.42 : 0.11);
  }

  private env(g: GainNode, t: number, peak: number, dur: number): void {
    g.gain.setValueAtTime(peak, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  }

  private kick(t: number): void {
    const C = audio.ctx!;
    const o = C.createOscillator(), g = C.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.09);
    this.env(g, t, 0.9, 0.16);
    o.connect(g); g.connect(this.out);
    o.start(t); o.stop(t + 0.18);
  }

  private snare(t: number): void {
    const C = audio.ctx!;
    const n = C.createBufferSource(); n.buffer = this.noise;
    const f = C.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1900; f.Q.value = 0.8;
    const g = C.createGain();
    this.env(g, t, 0.5, 0.14);
    n.connect(f); f.connect(g); g.connect(this.out);
    n.start(t); n.stop(t + 0.16);
    const o = C.createOscillator(), og = C.createGain();
    o.type = 'triangle'; o.frequency.value = 190;
    this.env(og, t, 0.25, 0.08);
    o.connect(og); og.connect(this.out);
    o.start(t); o.stop(t + 0.1);
  }

  private hat(t: number, vol: number): void {
    const C = audio.ctx!;
    const n = C.createBufferSource(); n.buffer = this.noise;
    const f = C.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 7500;
    const g = C.createGain();
    this.env(g, t, vol, 0.05);
    n.connect(f); f.connect(g); g.connect(this.out);
    n.start(t); n.stop(t + 0.06);
  }

  private bass(t: number, freq: number): void {
    const C = audio.ctx!;
    const o = C.createOscillator(); o.type = 'square'; o.frequency.value = freq;
    const f = C.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 620;
    const g = C.createGain();
    this.env(g, t, 0.30, STEP * 0.95);
    o.connect(f); f.connect(g); g.connect(this.out);
    o.start(t); o.stop(t + STEP);
  }

  private powerChord(t: number, freq: number, dur: number): void {
    const C = audio.ctx!;
    const g = C.createGain();
    this.env(g, t, 0.5, dur);
    g.connect(this.dist);
    for (const [mult, det] of [[1, -4], [1, 4], [1.5, 0], [2, 2]] as const) {
      const o = C.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = freq * mult;
      o.detune.value = det;
      o.connect(g);
      o.start(t); o.stop(t + dur + 0.05);
    }
  }
}

export const music = new RockMusic();
