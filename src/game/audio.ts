export interface AudioState {
  rpm: number;
  throttle: number;
  speedKmh: number;
  slip: number;
}

/** Small procedural engine/wind/tyre synth. No audio assets are downloaded. */
export class EngineAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private engineGain: GainNode | null = null;
  private engineFilter: BiquadFilterNode | null = null;
  private oscA: OscillatorNode | null = null;
  private oscB: OscillatorNode | null = null;
  private oscSub: OscillatorNode | null = null;
  private windGain: GainNode | null = null;
  private skidGain: GainNode | null = null;
  private started = false;
  private running = false;
  private muted = false;
  private volume = 0.38;

  start(): void {
    if (this.started) {
      this.ctx?.resume().catch(() => undefined);
      return;
    }
    try {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      const ctx = new Ctor();
      this.ctx = ctx;

      const master = ctx.createGain();
      master.gain.value = this.muted ? 0.0001 : this.volume;
      master.connect(ctx.destination);
      this.master = master;

      const noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const data = noise.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

      const wind = ctx.createBufferSource();
      wind.buffer = noise;
      wind.loop = true;
      const windFilter = ctx.createBiquadFilter();
      windFilter.type = 'bandpass';
      windFilter.frequency.value = 720;
      windFilter.Q.value = 0.7;
      const windGain = ctx.createGain();
      windGain.gain.value = 0.0001;
      wind.connect(windFilter).connect(windGain).connect(master);
      wind.start();
      this.windGain = windGain;

      const skid = ctx.createBufferSource();
      skid.buffer = noise;
      skid.loop = true;
      const skidFilter = ctx.createBiquadFilter();
      skidFilter.type = 'bandpass';
      skidFilter.frequency.value = 1900;
      skidFilter.Q.value = 3.2;
      const skidGain = ctx.createGain();
      skidGain.gain.value = 0.0001;
      skid.connect(skidFilter).connect(skidGain).connect(master);
      skid.start();
      this.skidGain = skidGain;

      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 520;
      filter.Q.value = 1.2;
      const engineGain = ctx.createGain();
      engineGain.gain.value = 0.0001;
      filter.connect(engineGain).connect(master);
      this.engineFilter = filter;
      this.engineGain = engineGain;

      const oscA = ctx.createOscillator();
      oscA.type = 'sawtooth';
      oscA.frequency.value = 60;
      oscA.connect(filter);

      const oscB = ctx.createOscillator();
      oscB.type = 'triangle';
      oscB.frequency.value = 120;
      oscB.connect(filter);

      const oscSub = ctx.createOscillator();
      oscSub.type = 'sine';
      oscSub.frequency.value = 32;
      const subGain = ctx.createGain();
      subGain.gain.value = 0.5;
      oscSub.connect(subGain).connect(engineGain);

      oscA.start();
      oscB.start();
      oscSub.start();
      this.oscA = oscA;
      this.oscB = oscB;
      this.oscSub = oscSub;

      this.started = true;
    } catch {
      this.ctx = null;
    }
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.applyMaster();
  }

  setRunning(running: boolean): void {
    this.running = running;
    this.applyMaster();
  }

  private applyMaster(): void {
    if (!this.ctx || !this.master) return;
    const target = this.muted || !this.running ? 0.0001 : this.volume;
    this.master.gain.setTargetAtTime(target, this.ctx.currentTime, 0.08);
  }

  update(state: AudioState): void {
    if (!this.ctx || !this.engineGain || !this.engineFilter || !this.oscA || !this.oscB || !this.oscSub) {
      return;
    }
    const now = this.ctx.currentTime;
    const rpm = Math.max(700, state.rpm);
    const base = 26 + (rpm / 60) * 1.05;
    this.oscA.frequency.setTargetAtTime(base, now, 0.035);
    this.oscB.frequency.setTargetAtTime(base * 2.008, now, 0.035);
    this.oscSub.frequency.setTargetAtTime(base * 0.5, now, 0.05);
    this.engineFilter.frequency.setTargetAtTime(280 + rpm * 0.32 + state.throttle * 420, now, 0.06);

    const engineTarget = this.running ? 0.06 + state.throttle * 0.075 + Math.min(0.05, rpm / 8200) : 0.0001;
    this.engineGain.gain.setTargetAtTime(engineTarget, now, 0.08);

    if (this.windGain) {
      const windTarget = this.running ? Math.min(0.14, Math.pow(state.speedKmh / 250, 1.6) * 0.2) : 0.0001;
      this.windGain.gain.setTargetAtTime(windTarget, now, 0.12);
    }
    if (this.skidGain) {
      const skidTarget = this.running && state.speedKmh > 25 ? Math.min(0.16, state.slip * 0.2) : 0.0001;
      this.skidGain.gain.setTargetAtTime(skidTarget, now, 0.06);
    }
  }
}
