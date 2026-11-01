import * as THREE from 'three';
import { CameraRig } from './cameraRig';
import { EngineAudio } from './audio';
import { InputManager } from './input';
import { Route } from './route';
import { DrivingWorld } from './world';
import { PlayerVehicle } from './vehicle';
import type { CarInput } from './physics';
import { ROAD, UPGRADES, carSpec, levelInfo, upgradeCost } from './config';
import { formatCredits, formatTime } from './format';
import { hud, saveProfile, saveSettings, ui } from './store';
import type { GameApi } from './api';
import type { Profile, Quality, Settings, Toast, Units, UpgradeId } from './types';

type Mode = 'menu' | 'driving' | 'paused';

const IDLE_INPUT: CarInput = { throttle: 0, brake: 0, steer: 0, handbrake: false };
const clamp = THREE.MathUtils.clamp;

export class Game implements GameApi {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly route: Route;
  private readonly world: DrivingWorld;
  private readonly vehicle: PlayerVehicle;
  private readonly rig: CameraRig;
  private readonly input: InputManager;
  private readonly audio = new EngineAudio();

  private profile: Profile;
  private settings: Settings;
  private mode: Mode = 'menu';

  private routeHint = 0;
  private lastDistance = 0;
  private peak = 0;
  private sectorIndex = 0;
  private lapTime = 0;
  private cleanLine = true;
  private sessionCredits = 0;
  private distanceBank = 0;
  private hudTimer = 0;
  private saveTimer = 12;
  private bestSpeedFloor = 0;

  private lastFrame = 0;
  private raf = 0;

  private toast: Toast | null = null;
  private toastTimer = 0;
  private toastQueue: Toast[] = [];
  private toastId = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setClearColor(0x05070b, 1);

    this.profile = ui.get().profile;
    this.settings = ui.get().settings;

    this.route = new Route();
    this.world = new DrivingWorld(this.scene, this.renderer, this.route, this.settings.quality);
    this.vehicle = new PlayerVehicle(this.scene, carSpec(this.profile.upgrades), this.settings.quality);
    this.rig = new CameraRig(this.vehicle.group);
    this.input = new InputManager(this.handleHotkey);
    this.input.setEnabled(false);
    this.audio.setMuted(this.settings.muted);

    hud.set({ bestLap: this.profile.bestLap, units: this.settings.units });
    this.placeAtStart();
    this.world.setActiveGate(0);
    this.resize();

    window.addEventListener('resize', this.resize);
    document.addEventListener('visibilitychange', this.handleVisibility);
    this.applyQuality();
    this.pushHud();

    this.lastFrame = performance.now();
    this.raf = requestAnimationFrame(this.loop);
  }

  // ---------------------------------------------------------------- game api

  play(): void {
    if (this.mode === 'driving') return;
    this.resetRun();
    this.clearToasts();
    this.mode = 'driving';
    this.input.setEnabled(true);
    this.audio.start();
    this.audio.setRunning(true);
    ui.set({ screen: 'driving', sessionCredits: 0 });
    this.pushToast('info', 'RUN STARTED', 'Clear all 12 sectors for the lap bonus.');
    this.pushHud();
  }

  pause(): void {
    if (this.mode !== 'driving') return;
    this.mode = 'paused';
    this.input.setEnabled(false);
    this.input.clear();
    this.audio.setRunning(false);
    this.commitProgress();
    ui.set({ screen: 'paused' });
  }

  resume(): void {
    if (this.mode !== 'paused' || ui.get().screen !== 'paused') return;
    this.mode = 'driving';
    this.input.setEnabled(true);
    this.audio.setRunning(true);
    ui.set({ screen: 'driving' });
  }

  toMenu(): void {
    this.commitProgress();
    this.mode = 'menu';
    this.input.setEnabled(false);
    this.audio.setRunning(false);
    this.resetRun();
    ui.set({ screen: 'menu', sessionCredits: 0 });
  }

  restartRun(): void {
    this.commitProgress();
    this.resetRun();
    this.clearToasts();
    this.mode = 'driving';
    this.input.setEnabled(true);
    this.audio.start();
    this.audio.setRunning(true);
    ui.set({ screen: 'driving', sessionCredits: 0 });
    this.pushToast('info', 'FRESH RUN', 'Sector 01 of 12.');
  }

  openGarage(from: 'menu' | 'paused'): void {
    if (from === 'paused' && this.mode === 'driving') this.pause();
    this.input.setEnabled(false);
    this.audio.setRunning(false);
    ui.set({ screen: 'garage', garageFrom: from });
  }

  closeGarage(): void {
    const from = ui.get().garageFrom;
    ui.set({ screen: from });
  }

  buyUpgrade(id: UpgradeId): void {
    const def = UPGRADES.find((upgrade) => upgrade.id === id);
    if (!def) return;
    const current = this.profile.upgrades[id];
    if (current >= 5) {
      this.pushToast('info', 'FULLY UPGRADED', `${def.name} is already at stage 5.`);
      return;
    }
    const nextLevel = current + 1;
    const playerLevel = levelInfo(this.profile.xp).level;
    const cost = upgradeCost(id, current);
    if (playerLevel < nextLevel) {
      this.pushToast('info', `LEVEL ${nextLevel} REQUIRED`, 'Clear sectors to unlock the next stage.');
      return;
    }
    if (this.profile.credits < cost) {
      this.pushToast('error', 'NOT ENOUGH CREDITS', `You need ${formatCredits(cost - this.profile.credits)} more.`);
      return;
    }

    const upgrades = { ...this.profile.upgrades, [id]: nextLevel };
    this.profile = {
      ...this.profile,
      credits: this.profile.credits - cost,
      upgrades,
    };
    this.vehicle.setSpec(carSpec(upgrades));
    this.syncProfile();
    saveProfile(this.profile);
    this.pushToast('info', `${def.name.toUpperCase()} · STAGE ${nextLevel}`, def.effect);
  }

  setUnits(units: Units): void {
    this.settings = { ...this.settings, units };
    saveSettings(this.settings);
    ui.set({ settings: this.settings });
    hud.set({ units });
  }

  toggleMute(): void {
    this.settings = { ...this.settings, muted: !this.settings.muted };
    this.audio.setMuted(this.settings.muted);
    saveSettings(this.settings);
    ui.set({ settings: this.settings });
    this.pushToast('info', this.settings.muted ? 'SOUND OFF' : 'SOUND ON', 'M toggles audio.');
  }

  setQuality(quality: Quality): void {
    this.settings = { ...this.settings, quality };
    saveSettings(this.settings);
    ui.set({ settings: this.settings });
    this.applyQuality();
  }

  setShake(on: boolean): void {
    this.settings = { ...this.settings, shake: on };
    saveSettings(this.settings);
    ui.set({ settings: this.settings });
  }

  // ------------------------------------------------------------------ setup

  private applyQuality(): void {
    this.vehicle.setQuality(this.settings.quality);
    this.world.setQuality(this.settings.quality);
    const ratio = this.settings.quality === 'low' ? 1 : this.settings.quality === 'medium' ? Math.min(1.35, window.devicePixelRatio) : Math.min(1.75, window.devicePixelRatio);
    this.renderer.setPixelRatio(ratio);
    this.resize();
  }

  private resize = (): void => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.renderer.setSize(width, height, false);
    this.rig.resize(width, height);
  };

  private handleVisibility = (): void => {
    if (document.hidden && this.mode === 'driving') this.pause();
  };

  private handleHotkey = (code: string, event: KeyboardEvent): void => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const screen = ui.get().screen;

    if (code === 'Escape') {
      if (screen === 'garage') this.closeGarage();
      else if (screen === 'paused') this.resume();
      else if (screen === 'driving') this.pause();
      return;
    }
    if (code === 'Enter') {
      if (screen === 'menu') this.play();
      else if (screen === 'paused') this.resume();
      return;
    }
    if (code === 'KeyU') {
      this.setUnits(this.settings.units === 'kmh' ? 'mph' : 'kmh');
      return;
    }
    if (code === 'KeyM') {
      this.toggleMute();
      return;
    }
    if (code === 'KeyR' && screen === 'driving') {
      this.recover();
      return;
    }
    if (code === 'KeyG' && screen === 'paused') {
      this.openGarage('paused');
    }
  };

  // ------------------------------------------------------------------- loop

  private loop = (now: number): void => {
    const dt = Math.min(0.05, Math.max(0, (now - this.lastFrame) / 1000));
    this.lastFrame = now;
    this.step(dt);
    this.renderer.render(this.scene, this.rig.camera);
    this.raf = requestAnimationFrame(this.loop);
  };

  private step(dt: number): void {
    this.tickToasts(dt);

    if (this.mode === 'paused') return;

    const input = this.mode === 'driving' ? this.input.read() : IDLE_INPUT;
    this.vehicle.update(dt, input);

    if (this.mode === 'driving') this.updateRun(dt);

    this.world.update(dt, this.vehicle.group.position, this.rig.camera);
    this.rig.update(dt, {
      speedKmh: this.vehicle.physics.speedKmh,
      steer: this.vehicle.physics.steering / 0.52,
      throttle: this.vehicle.physics.throttle,
      brake: this.vehicle.physics.brakeAmount,
      mode: this.mode === 'menu' ? 'menu' : 'driving',
      shake: this.settings.shake,
    });

    this.audio.update({
      rpm: this.vehicle.physics.rpm,
      throttle: this.vehicle.physics.throttle,
      speedKmh: this.vehicle.physics.speedKmh,
      slip: this.vehicle.physics.slip,
    });
  }

  // -------------------------------------------------------------------- run

  private updateRun(dt: number): void {
    this.lapTime += dt;
    const physics = this.vehicle.physics;
    const position = this.vehicle.group.position;
    const nearest = this.route.nearest(position, this.routeHint);
    this.routeHint = nearest.index;

    let delta = nearest.distanceAlong - this.lastDistance;
    const length = this.route.length;
    if (delta > length / 2) delta -= length;
    if (delta < -length / 2) delta += length;
    this.lastDistance = nearest.distanceAlong;

    if (Math.abs(delta) < 20 && delta > 0) {
      this.peak += delta;
      this.distanceBank += delta;
    }

    this.enforceRail(nearest.frame.right, nearest.offset);

    while (this.peak >= (this.sectorIndex + 1) * this.route.sectorLength) {
      this.sectorIndex += 1;
      this.awardSector();
    }

    this.bestSpeedFloor = Math.max(this.bestSpeedFloor, physics.speedKmh);

    this.hudTimer -= dt;
    if (this.hudTimer <= 0) {
      this.hudTimer = 0.05;
      this.pushHud();
    }

    this.saveTimer -= dt;
    if (this.saveTimer <= 0) {
      this.saveTimer = 12;
      this.commitProgress();
    }
  }

  private awardSector(): void {
    const physics = this.vehicle.physics;
    const clean = this.cleanLine;
    const multiplier = clean ? 1.25 : 1;
    const credits = Math.round((45 + physics.speedKmh * 0.32) * multiplier);
    const xp = Math.round((16 + physics.speedKmh * 0.035) * multiplier);
    const previousLevel = levelInfo(this.profile.xp).level;
    const sectorInLap = this.sectorIndex % ROAD.sectorCount;

    this.profile = {
      ...this.profile,
      credits: this.profile.credits + credits,
      xp: this.profile.xp + xp,
      bestSpeed: Math.max(this.profile.bestSpeed, Math.round(physics.speedKmh)),
    };
    this.sessionCredits += credits;
    this.cleanLine = true;
    this.world.setActiveGate(this.sectorIndex % ROAD.sectorCount);

    if (sectorInLap === 0) {
      this.completeLap();
    } else {
      this.pushToast(
        'sector',
        `SECTOR ${String(sectorInLap).padStart(2, '0')} CLEARED`,
        `+$${formatCredits(credits)} · +${xp} XP${clean ? ' · CLEAN LINE' : ''}`,
      );
    }

    const newLevel = levelInfo(this.profile.xp).level;
    if (newLevel > previousLevel) {
      this.pushToast('level', `LEVEL ${newLevel}`, `${levelInfo(this.profile.xp).name} · new garage stage unlocked`);
    }

    this.commitProgress();
    this.syncProfile();
    hud.set({ bestLap: this.profile.bestLap });
  }

  private completeLap(): void {
    const lap = this.lapTime;
    const best = this.profile.bestLap == null || lap < this.profile.bestLap;
    const lapNumber = Math.floor(this.sectorIndex / ROAD.sectorCount);
    const credits = Math.round(280 + this.vehicle.physics.speedKmh * 0.9);
    const xp = 85;

    this.profile = {
      ...this.profile,
      laps: this.profile.laps + 1,
      bestLap: best ? lap : this.profile.bestLap,
      credits: this.profile.credits + credits,
      xp: this.profile.xp + xp,
    };
    this.sessionCredits += credits;
    this.lapTime = 0;
    hud.set({ lapTime: 0, bestLap: this.profile.bestLap });

    this.pushToast(
      'lap',
      `LAP ${lapNumber} COMPLETE`,
      `${formatTime(lap)}${best ? ' · NEW BEST' : ''} · +$${formatCredits(credits)}`,
    );
  }

  /** Soft guardrail: keep the car inside the rails and scrub sideways impacts. */
  private enforceRail(right: THREE.Vector3, offset: number): void {
    const limit = ROAD.railOffset - 0.95;
    if (Math.abs(offset) <= limit) return;

    const side = Math.sign(offset);
    const overshoot = Math.abs(offset) - limit;
    const body = this.vehicle.physics.chassis;
    body.position.x -= right.x * overshoot * side;
    body.position.z -= right.z * overshoot * side;

    const velocity = body.velocity;
    const lateral = velocity.x * right.x + velocity.z * right.z;
    if (lateral * side > 0) {
      velocity.x -= right.x * lateral * 1.35;
      velocity.z -= right.z * lateral * 1.35;
      velocity.x *= 0.93;
      velocity.z *= 0.93;
      const impact = Math.min(1, Math.abs(lateral) / 12);
      this.rig.kick(0.22 + impact * 0.55);
      this.vehicle.physics.steering *= 0.55;
      this.cleanLine = false;
    }
    this.vehicle.syncTransform();
  }

  private recover(): void {
    const nearest = this.route.nearest(this.vehicle.group.position, this.routeHint);
    const placement = this.route.placement(nearest.distanceAlong, ROAD.startOffset);
    this.vehicle.place(placement.position, placement.quaternion);
    this.routeHint = nearest.index;
    this.lastDistance = nearest.distanceAlong;
    this.input.clear();
    this.rig.kick(0.08);
  }

  private resetRun(): void {
    this.placeAtStart();
    this.peak = 0;
    this.sectorIndex = 0;
    this.lapTime = 0;
    this.cleanLine = true;
    this.sessionCredits = 0;
    this.distanceBank = 0;
    this.bestSpeedFloor = 0;
    this.hudTimer = 0;
    this.saveTimer = 12;
    this.world.setActiveGate(0);
    this.pushHud();
  }

  private placeAtStart(): void {
    const placement = this.route.placement(0, ROAD.startOffset);
    this.vehicle.place(placement.position, placement.quaternion);
    const nearest = this.route.nearest(placement.position, -1);
    this.routeHint = nearest.index;
    this.lastDistance = nearest.distanceAlong;
  }

  // ------------------------------------------------------------------- hud

  private pushHud(): void {
    const physics = this.vehicle.physics;
    const sectorLength = this.route.sectorLength;
    const standing = Math.abs(physics.signedSpeed) < 0.40;
    hud.set({
      speed: physics.speedKmh,
      rpm: physics.rpm,
      gear: physics.reverse ? 'R' : standing && physics.throttle < 0.05 ? 'N' : String(physics.gear),
      sector: (this.sectorIndex % ROAD.sectorCount) + 1,
      sectors: ROAD.sectorCount,
      sectorProgress: (this.peak % sectorLength) / sectorLength,
      lap: Math.floor(this.sectorIndex / ROAD.sectorCount) + 1,
      lapTime: this.lapTime,
      bestLap: this.profile.bestLap,
      throttle: physics.throttle,
      brake: physics.brakeAmount,
      steering: clamp(physics.steering / 0.52, -1, 1),
      drifting: physics.slip > 0.45 && physics.speedKmh > 28,
      units: this.settings.units,
    });
  }

  // ------------------------------------------------------------- persistence

  private commitProgress(): void {
    const distance = Math.round(this.distanceBank);
    if (distance <= 0) {
      if (this.bestSpeedFloor > this.profile.bestSpeed) {
        this.profile = { ...this.profile, bestSpeed: Math.round(this.bestSpeedFloor) };
        this.bestSpeedFloor = this.profile.bestSpeed;
        this.syncProfile();
        saveProfile(this.profile);
      }
      return;
    }
    this.distanceBank -= distance;
    this.profile = {
      ...this.profile,
      distance: this.profile.distance + distance,
      bestSpeed: Math.max(this.profile.bestSpeed, Math.round(this.bestSpeedFloor)),
    };
    this.bestSpeedFloor = this.profile.bestSpeed;
    this.syncProfile();
    saveProfile(this.profile);
  }

  private syncProfile(): void {
    ui.set({ profile: this.profile, sessionCredits: this.sessionCredits });
  }

  // ----------------------------------------------------------------- toasts

  private clearToasts(): void {
    this.toastQueue = [];
    this.toast = null;
    this.toastTimer = 0;
    ui.set({ toast: null });
  }

  private pushToast(kind: Toast['kind'], title: string, detail?: string): void {
    this.toastQueue.push({ id: ++this.toastId, kind, title, detail });
    if (this.toastQueue.length > 3) this.toastQueue.shift();
  }

  private tickToasts(dt: number): void {
    if (this.toast) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) {
        this.toast = null;
        ui.set({ toast: null });
      }
    }
    if (!this.toast && this.toastQueue.length > 0) {
      this.toast = this.toastQueue.shift() ?? null;
      if (this.toast) {
        this.toastTimer = 2.8;
        ui.set({ toast: this.toast });
      }
    }
  }

}
