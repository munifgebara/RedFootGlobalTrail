/** Motor, cascalho, bipes de largada (WebAudio) e voz do copiloto. */
class AudioSystem {
  ctx: AudioContext | null = null;      // exposto p/ a música
  master!: GainNode;                    // idem
  private started = false;
  muted = false;
  private eGain!: GainNode;
  private nGain!: GainNode;
  private o1!: OscillatorNode;
  private o2!: OscillatorNode;

  start(): void {
    if (this.started || this.muted) return;
    try {
      const C = new AudioContext();
      this.ctx = C;
      this.master = C.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(C.destination);

      this.eGain = C.createGain();
      this.eGain.gain.value = 0;
      const f = C.createBiquadFilter();
      f.type = 'lowpass'; f.frequency.value = 900;
      this.o1 = C.createOscillator(); this.o1.type = 'sawtooth';
      this.o2 = C.createOscillator(); this.o2.type = 'square';
      const g2 = C.createGain(); g2.gain.value = 0.4;
      this.o1.connect(this.eGain);
      this.o2.connect(g2); g2.connect(this.eGain);
      this.eGain.connect(f); f.connect(this.master);
      this.o1.start(); this.o2.start();

      const len = C.sampleRate * 1.2;
      const buf = C.createBuffer(1, len, C.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      const noise = C.createBufferSource();
      noise.buffer = buf; noise.loop = true;
      this.nGain = C.createGain(); this.nGain.gain.value = 0;
      const nf = C.createBiquadFilter();
      nf.type = 'bandpass'; nf.frequency.value = 420; nf.Q.value = 0.6;
      noise.connect(nf); nf.connect(this.nGain); this.nGain.connect(this.master);
      noise.start();
      this.started = true;
    } catch { /* sem áudio, sem drama */ }
  }

  engine(rpm: number, load: number, slip: number, offroad: boolean, speed: number): void {
    if (!this.started || !this.ctx) return;
    const t = this.ctx.currentTime;
    const f = 42 + rpm * 150;
    this.o1.frequency.setTargetAtTime(f, t, 0.03);
    this.o2.frequency.setTargetAtTime(f * 1.5 + 3, t, 0.03);
    this.eGain.gain.setTargetAtTime(0.05 + load * 0.075, t, 0.05);
    const clampedSpeed = Math.min(Math.max(speed / 40, 0), 1);
    this.nGain.gain.setTargetAtTime(
      clampedSpeed * (0.03 + (offroad ? 0.05 : 0) + slip * 0.05), t, 0.08);
  }

  beep(freq: number, dur = 0.18, vol = 0.35): void {
    if (!this.started || !this.ctx || this.muted) return;
    const C = this.ctx;
    const o = C.createOscillator(), g = C.createGain();
    o.type = 'sine'; o.frequency.value = freq;
    g.gain.setValueAtTime(vol, C.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, C.currentTime + dur);
    o.connect(g); g.connect(this.master);
    o.start(); o.stop(C.currentTime + dur);
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.5;
  }
}

export const audio = new AudioSystem();

export function speak(txt: string): void {
  if (audio.muted) return;
  try {
    const u = new SpeechSynthesisUtterance(txt);
    u.lang = 'en-US'; u.rate = 1.15; u.pitch = 1.0; u.volume = 0.9;
    speechSynthesis.speak(u);
  } catch { /* no voice available */ }
}
