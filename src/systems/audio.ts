import { clamp } from '../core/util';

export interface AudioState {
  speedKph: number;
  maxSpeedKph: number;
  throttle: number;
  brake: number;
  doorsOpen: boolean;
  atStation: boolean;
  stationName: string;
  night: number;
  wet: number;
  diesel: boolean;
  slip: number;
  stopped: boolean;
}

export class AudioEngine {
  ctx?: AudioContext;
  ready = false;
  muted = false;
  volume = 0.7;
  announcementsEnabled = true;

  private master?: GainNode;
  private compressor?: DynamicsCompressorNode;
  private noiseBuffer?: AudioBuffer;
  private rumbleGain?: GainNode;
  private rollGain?: GainNode;
  private rollFilter?: BiquadFilterNode;
  private motorGain?: GainNode;
  private motorOscA?: OscillatorNode;
  private motorOscB?: OscillatorNode;
  private motorFilter?: BiquadFilterNode;
  private windGain?: GainNode;
  private rainGain?: GainNode;
  private crowdGain?: GainNode;
  private squealGain?: GainNode;
  private squealFilter?: BiquadFilterNode;
  private clackDistance = 0;
  private hornActive = false;
  private hornNodes: { osc: OscillatorNode; gain: GainNode }[] = [];
  private lastAnnouncement = 0;
  private ambientTimer = 0;

  private initializing = false;

  async init(): Promise<void> {
    if (this.ready) {
      if (this.ctx?.state === 'suspended') await this.ctx.resume();
      return;
    }
    if (this.initializing) return;
    this.initializing = true;
    const Ctor: typeof AudioContext | undefined = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    try {
      const ctx = new Ctor();
      this.ctx = ctx;
      await ctx.resume();

      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.knee.value = 18;
      comp.ratio.value = 5;
      comp.attack.value = 0.005;
      comp.release.value = 0.2;
      comp.connect(ctx.destination);
      this.compressor = comp;

      const master = ctx.createGain();
      master.gain.value = this.muted ? 0 : this.volume;
      master.connect(comp);
      this.master = master;

      // Noise buffer used by all the loops.
      const len = ctx.sampleRate * 2;
      const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      this.noiseBuffer = buffer;

      const loopNoise = (): AudioBufferSourceNode => {
        const src = ctx.createBufferSource();
        src.buffer = buffer;
        src.loop = true;
        src.start();
        return src;
      };

      // Low rumble
      const rumble = loopNoise();
      const rumbleFilter = ctx.createBiquadFilter();
      rumbleFilter.type = 'lowpass';
      rumbleFilter.frequency.value = 160;
      const rumbleGain = ctx.createGain();
      rumbleGain.gain.value = 0;
      rumble.connect(rumbleFilter).connect(rumbleGain).connect(master);
      this.rumbleGain = rumbleGain;

      // Rolling wheels
      const roll = loopNoise();
      const rollFilter = ctx.createBiquadFilter();
      rollFilter.type = 'bandpass';
      rollFilter.frequency.value = 420;
      rollFilter.Q.value = 0.7;
      const rollGain = ctx.createGain();
      rollGain.gain.value = 0;
      roll.connect(rollFilter).connect(rollGain).connect(master);
      this.rollFilter = rollFilter;
      this.rollGain = rollGain;

      // Traction motor / inverter
      const motorGain = ctx.createGain();
      motorGain.gain.value = 0;
      const motorFilter = ctx.createBiquadFilter();
      motorFilter.type = 'lowpass';
      motorFilter.frequency.value = 1400;
      const motorA = ctx.createOscillator();
      motorA.type = 'sawtooth';
      motorA.frequency.value = 48;
      const motorB = ctx.createOscillator();
      motorB.type = 'triangle';
      motorB.frequency.value = 96;
      const gA = ctx.createGain();
      gA.gain.value = 0.5;
      const gB = ctx.createGain();
      gB.gain.value = 0.28;
      motorA.connect(gA).connect(motorFilter);
      motorB.connect(gB).connect(motorFilter);
      motorFilter.connect(motorGain).connect(master);
      motorA.start();
      motorB.start();
      this.motorOscA = motorA;
      this.motorOscB = motorB;
      this.motorGain = motorGain;
      this.motorFilter = motorFilter;

      // Wind
      const wind = loopNoise();
      const windFilter = ctx.createBiquadFilter();
      windFilter.type = 'bandpass';
      windFilter.frequency.value = 900;
      windFilter.Q.value = 0.4;
      const windGain = ctx.createGain();
      windGain.gain.value = 0;
      wind.connect(windFilter).connect(windGain).connect(master);
      this.windGain = windGain;

      // Rain
      const rain = loopNoise();
      const rainFilter = ctx.createBiquadFilter();
      rainFilter.type = 'lowpass';
      rainFilter.frequency.value = 1800;
      const rainGain = ctx.createGain();
      rainGain.gain.value = 0;
      rain.connect(rainFilter).connect(rainGain).connect(master);
      this.rainGain = rainGain;

      // Crowd murmur
      const crowd = loopNoise();
      const crowdFilter = ctx.createBiquadFilter();
      crowdFilter.type = 'bandpass';
      crowdFilter.frequency.value = 420;
      crowdFilter.Q.value = 1.1;
      const crowdGain = ctx.createGain();
      crowdGain.gain.value = 0;
      crowd.connect(crowdFilter).connect(crowdGain).connect(master);
      this.crowdGain = crowdGain;

      // Brake squeal
      const sq = loopNoise();
      const sqFilter = ctx.createBiquadFilter();
      sqFilter.type = 'bandpass';
      sqFilter.frequency.value = 2800;
      sqFilter.Q.value = 8;
      const sqGain = ctx.createGain();
      sqGain.gain.value = 0;
      sq.connect(sqFilter).connect(sqGain).connect(master);
      this.squealFilter = sqFilter;
      this.squealGain = sqGain;

      this.ready = true;
    } catch (err) {
      console.warn('Audio unavailable', err);
    } finally {
      this.initializing = false;
    }
  }

  setVolume(v: number): void {
    this.volume = clamp(v, 0, 1);
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(this.muted ? 0 : this.volume, this.ctx.currentTime, 0.04);
    }
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(m ? 0 : this.volume, this.ctx.currentTime, 0.04);
  }

  update(dt: number, s: AudioState): void {
    const ctx = this.ctx;
    if (!ctx || !this.ready) return;
    const t = ctx.currentTime;
    const speedRatio = clamp(s.speedKph / Math.max(1, s.maxSpeedKph), 0, 1);
    const absSpeed = Math.abs(s.speedKph);
    const moving = absSpeed > 0.5;

    if (this.rumbleGain) this.rumbleGain.gain.setTargetAtTime(moving ? 0.1 + speedRatio * 0.22 : 0, t, 0.15);
    if (this.rollGain) this.rollGain.gain.setTargetAtTime(moving ? 0.025 + speedRatio * 0.13 : 0, t, 0.12);
    if (this.rollFilter) this.rollFilter.frequency.setTargetAtTime(260 + absSpeed * 12, t, 0.2);
    if (this.windGain) this.windGain.gain.setTargetAtTime(moving ? speedRatio * speedRatio * 0.1 : 0, t, 0.2);

    const motorActive = s.throttle > 0.02 && !s.doorsOpen;
    const motorLevel = s.diesel ? 0.16 : 0.1;
    if (this.motorGain) this.motorGain.gain.setTargetAtTime(motorActive ? motorLevel * (0.45 + s.throttle * 0.6) : 0, t, 0.07);
    if (this.motorOscA && this.motorOscB) {
      const base = s.diesel ? 34 + speedRatio * 95 : 46 + speedRatio * 210 + s.throttle * 18;
      this.motorOscA.frequency.setTargetAtTime(base, t, 0.08);
      this.motorOscB.frequency.setTargetAtTime(base * (s.diesel ? 2.02 : 3.01), t, 0.08);
    }
    if (this.motorFilter) this.motorFilter.frequency.setTargetAtTime(s.diesel ? 500 + s.throttle * 700 : 900 + speedRatio * 2400, t, 0.1);

    if (this.squealGain) {
      const sq = s.brake > 0.15 && absSpeed < 35 && absSpeed > 1.5 ? (s.brake - 0.15) * 0.06 : 0;
      this.squealGain.gain.setTargetAtTime(sq, t, 0.06);
    }
    if (this.squealFilter) this.squealFilter.frequency.setTargetAtTime(2200 + absSpeed * 22, t, 0.1);

    if (this.rainGain) this.rainGain.gain.setTargetAtTime(s.wet * 0.12, t, 0.4);
    if (this.crowdGain) this.crowdGain.gain.setTargetAtTime(s.atStation && !s.doorsOpen ? 0.035 : s.atStation ? 0.02 : 0, t, 0.5);

    // Rail joints every 12 m, capped so the clacks stay musical.
    if (moving) {
      this.clackDistance += Math.abs(s.speedKph) / 3.6 * dt;
      if (this.clackDistance > 12.5) {
        this.clackDistance = 0;
        this.clack(Math.min(1, speedRatio + 0.2));
      }
    }

    // Station ambience chirps/announcements
    this.ambientTimer -= dt;
    if (s.atStation && !moving && this.ambientTimer <= 0) {
      this.ambientTimer = 9 + Math.random() * 9;
      this.ambientShuffle();
    }

    if (!this.hornActive && this.hornNodes.length) this.releaseHorn();
    void speedRatio;
  }

  private clack(intensity: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.noiseBuffer || !this.master) return;
    const now = ctx.currentTime;
    for (let i = 0; i < 2; i++) {
      const t = now + i * 0.045;
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuffer;
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = 900 + i * 180;
      f.Q.value = 1.2;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.045 * intensity, t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.075);
      src.connect(f).connect(g).connect(this.master);
      src.start(t, Math.random() * 1.5, 0.09);
    }
  }

  hornStart(): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || this.hornActive) return;
    this.hornActive = true;
    const now = ctx.currentTime;
    const freqs = [311, 370, 466];
    for (const f of freqs) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = f;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 1800;
      filter.Q.value = 0.8;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.055, now + 0.05);
      osc.connect(filter).connect(gain).connect(this.master);
      osc.start(now);
      this.hornNodes.push({ osc, gain });
    }
  }

  hornStop(): void {
    this.hornActive = false;
  }

  private releaseHorn(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    for (const { osc, gain } of this.hornNodes) {
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(gain.gain.value, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.3);
      try {
        osc.stop(now + 0.35);
      } catch {
        /* already stopped */
      }
    }
    this.hornNodes = [];
  }

  chime(): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const notes = [987, 784, 659];
    notes.forEach((f, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = f;
      const t = ctx.currentTime + i * 0.22;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.08, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.75);
      osc.connect(gain).connect(this.master!);
      osc.start(t);
      osc.stop(t + 0.8);
    });
  }

  doorSound(open: boolean): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const now = ctx.currentTime;
    if (this.noiseBuffer) {
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuffer;
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = open ? 1500 : 900;
      filter.Q.value = 1.4;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.linearRampToValueAtTime(0.09, now + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.7);
      src.connect(filter).connect(gain).connect(this.master);
      src.start(now, Math.random(), 0.8);
    }
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(open ? 120 : 160, now);
    osc.frequency.linearRampToValueAtTime(open ? 220 : 90, now + 0.5);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(0.03, now + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.6);
    osc.connect(gain).connect(this.master);
    osc.start(now);
    osc.stop(now + 0.65);
  }

  brakeHiss(): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.noiseBuffer) return;
    const now = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 2200;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.06, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.5);
    src.connect(filter).connect(gain).connect(this.master);
    src.start(now, Math.random(), 0.6);
  }

  buttonClick(): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(1250, now);
    gain.gain.setValueAtTime(0.025, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.05);
    osc.connect(gain).connect(this.master);
    osc.start(now);
    osc.stop(now + 0.06);
  }

  announce(text: string): void {
    if (!this.announcementsEnabled) return;
    if (typeof speechSynthesis === 'undefined') return;
    const now = performance.now();
    if (now - this.lastAnnouncement < 1500) return;
    this.lastAnnouncement = now;
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 0.94;
      u.pitch = 0.92;
      u.volume = 0.55 * (this.muted ? 0 : this.volume);
      const voices = speechSynthesis.getVoices();
      const preferred = voices.find((v) => /en-GB|British|Daniel|Google UK/i.test(v.name)) ?? voices.find((v) => v.lang.startsWith('en'));
      if (preferred) u.voice = preferred;
      speechSynthesis.speak(u);
    } catch {
      /* speech not available */
    }
  }

  private ambientShuffle(): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    if (Math.random() < 0.4) this.chime();
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880 + Math.random() * 400, now);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(0.012, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.35);
    osc.connect(gain).connect(this.master);
    osc.start(now);
    osc.stop(now + 0.4);
  }

  dispose(): void {
    try {
      speechSynthesis?.cancel();
    } catch {
      /* noop */
    }
    this.ctx?.close();
    this.ready = false;
  }
}
