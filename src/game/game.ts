import * as THREE from 'three';
import { CameraRig } from './cameraRig';
import { EngineAudio } from './audio';
import { InputManager } from './input';
import { Route, type NearestResult } from './route';
import { RoadNetwork, type DrivePath, type RoadSurface } from './roads';
import { DrivingWorld } from './world';
import { PlayerVehicle } from './vehicle';
import { TrafficSystem } from './traffic';
import type { CarInput } from './physics';
import {
  ROAD,
  UPGRADES,
  carSpec,
  levelInfo,
  regionById,
  upgradeCost,
} from './config';
import { formatCredits, formatTime } from './format';
import { hud, saveProfile, saveSettings, ui } from './store';
import type { GameApi } from './api';
import type {
  CameraMode,
  CarId,
  MapData,
  Profile,
  Quality,
  RegionId,
  Settings,
  Toast,
  Units,
  UpgradeId,
} from './types';

type Mode = 'menu' | 'driving' | 'paused';

interface ChallengeRun {
  time: number;
  stage: 0 | 1 | 2 | 3;
  ringStart: number | null;
  finished: boolean;
}

const IDLE_INPUT: CarInput = { throttle: 0, brake: 0, steer: 0, handbrake: false };
const clamp = THREE.MathUtils.clamp;

export class Game implements GameApi {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly route: Route;
  private readonly roads: RoadNetwork;
  private readonly mapData: MapData;
  private readonly world: DrivingWorld;
  private readonly vehicle: PlayerVehicle;
  private readonly traffic: TrafficSystem;
  private readonly rig: CameraRig;
  private readonly input: InputManager;
  private readonly audio = new EngineAudio();

  private profile: Profile;
  private settings: Settings;
  private mode: Mode = 'menu';
  private challenge: ChallengeRun | null = null;

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
  private nextGateDistance = 0;
  private lastNearest: NearestResult | null = null;
  private currentRegionId: RegionId;
  private currentRegionName: string;

  private lastFrame = 0;
  private raf = 0;
  private resolutionScale = 1;
  private frameMs = 16.7;
  private adaptClock = 0;

  private toast: Toast | null = null;
  private toastTimer = 0;
  private toastQueue: Toast[] = [];
  private toastId = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.profile = ui.get().profile;
    this.settings = ui.get().settings;
    this.currentRegionId = this.settings.region;
    this.currentRegionName = regionById(this.settings.region).name;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = false;
    this.renderer.setClearColor(0x9bc8da, 1);

    this.route = new Route();
    this.roads = new RoadNetwork(this.route);
    this.mapData = { ...this.route.mapData(), junctions: this.roads.mapRoads() };
    this.world = new DrivingWorld(this.scene, this.route, this.settings.quality, this.roads);
    this.vehicle = new PlayerVehicle(this.scene, carSpec(this.profile.upgrades), this.mapData);
    this.traffic = new TrafficSystem(this.scene, this.route, this.roads);
    this.rig = new CameraRig(this.vehicle.group, this.scene);
    this.input = new InputManager(this.handleHotkey);
    this.input.setEnabled(false);
    this.audio.setMuted(this.settings.muted);

    hud.set({
      units: this.settings.units,
      region: this.currentRegionId,
      regionName: this.currentRegionName,
    });

    this.placeAtRegion(this.settings.region);
    this.applyResolution();
    this.vehicle.setView(this.settings.camera);
    this.rig.setMode(this.settings.camera);
    this.vehicle.setCarModel(this.settings.car, () => {
      this.pushToast('error', 'CAR MODEL UNAVAILABLE', 'Using the workshop body for this drive.');
    });

    window.addEventListener('resize', this.resize);
    document.addEventListener('visibilitychange', this.handleVisibility);
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
    this.pushToast('info', regionById(this.currentRegionId).name.toUpperCase(), 'Follow the island loop. Each gate pays credits.');
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
    this.clearToasts();
    ui.set({ screen: 'menu', sessionCredits: 0 });
  }

  restartRun(): void {
    const wasChallenge = this.challenge !== null;
    this.commitProgress();
    if (wasChallenge) {
      this.startChallenge();
      return;
    }
    this.resetRun();
    this.clearToasts();
    this.mode = 'driving';
    this.input.setEnabled(true);
    this.audio.start();
    this.audio.setRunning(true);
    ui.set({ screen: 'driving', sessionCredits: 0 });
    this.pushToast('info', 'FRESH START', `${regionById(this.currentRegionId).name} · next gate is live.`);
  }

  startChallenge(): void {
    if (this.mode === 'driving') return;
    this.commitProgress();
    this.resetRun();
    this.challenge = { time: 0, stage: 0, ringStart: null, finished: false };
    this.placeOnMain(this.route.wrap(this.roads.skywayStart - 140));
    this.input.clear();
    this.mode = 'driving';
    this.input.setEnabled(true);
    this.audio.start();
    this.audio.setRunning(true);
    ui.set({ screen: 'driving', sessionCredits: 0 });
    this.clearToasts();
    this.pushToast('info', 'INTERCHANGE TRIAL', 'Skyway on-ramp, then the roundabout. The clock is running.');
    this.pushHud();
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
      this.pushToast('info', `LEVEL ${nextLevel} REQUIRED`, 'Clear gates to unlock the next stage.');
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

  setCamera(camera: CameraMode): void {
    if (this.settings.camera === camera) return;
    this.settings = { ...this.settings, camera };
    saveSettings(this.settings);
    ui.set({ settings: this.settings });
    this.vehicle.setView(camera);
    this.rig.setMode(camera);
  }

  setCar(car: CarId): void {
    if (this.settings.car === car) return;
    this.settings = { ...this.settings, car };
    saveSettings(this.settings);
    ui.set({ settings: this.settings });
    this.vehicle.setCarModel(car, () => {
      this.pushToast('error', 'CAR MODEL UNAVAILABLE', 'Keeping the previous body.');
    });
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

  setRegion(region: RegionId): void {
    if (this.mode === 'driving') return;
    this.settings = { ...this.settings, region };
    saveSettings(this.settings);
    ui.set({ settings: this.settings });
    if (this.mode === 'menu') {
      this.resetRun();
    } else {
      this.placeAtRegion(region);
      this.pushHud();
    }
  }

  getMap(): MapData {
    return this.mapData;
  }

  // ------------------------------------------------------------------ setup

  private applyQuality(): void {
    this.world.setQuality(this.settings.quality);
    this.resolutionScale = 1;
    this.applyResolution();
  }

  private resolutionTarget(): number {
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const cap =
      this.settings.quality === 'low' ? 0.95 :
      this.settings.quality === 'medium' ? 1.2 : 1.45;
    return Math.min(dpr, cap);
  }

  private applyResolution(): void {
    const ratio = Math.max(0.65, this.resolutionTarget() * this.resolutionScale);
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.rig.resize(window.innerWidth, window.innerHeight);
  }

  private resize = (): void => {
    this.applyResolution();
  };

  private governFrame(rawDt: number): void {
    if (this.mode === 'paused' || rawDt <= 0 || rawDt > 0.25) return;
    this.frameMs += (rawDt * 1000 - this.frameMs) * 0.055;
    this.adaptClock += rawDt;
    if (this.adaptClock < 1.4) return;
    this.adaptClock = 0;

    let next = this.resolutionScale;
    if (this.frameMs > 24 && next > 0.68) {
      next = Math.max(0.66, next - 0.09);
    } else if (this.frameMs > 19 && next > 0.7) {
      next = Math.max(0.68, next - 0.045);
    } else if (this.frameMs < 17.2 && next < 0.99) {
      next = Math.min(1, next + 0.035);
    }

    if (Math.abs(next - this.resolutionScale) > 0.005) {
      this.resolutionScale = next;
      this.applyResolution();
    }
  }

  private handleVisibility = (): void => {
    if (document.hidden && this.mode === 'driving') this.pause();
    if (!document.hidden) {
      this.lastFrame = performance.now();
      this.frameMs = 16.7;
      this.adaptClock = 0;
    }
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
    if (code === 'KeyC' && screen !== 'garage') {
      this.setCamera(this.settings.camera === 'cockpit' ? 'chase' : 'cockpit');
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
    const rawDt = Math.max(0, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    const dt = Math.min(0.05, rawDt);
    this.step(dt);
    this.renderer.render(this.scene, this.rig.activeCamera);
    this.governFrame(rawDt);
    this.raf = requestAnimationFrame(this.loop);
  };

  private step(dt: number): void {
    this.tickToasts(dt);

    if (this.mode === 'paused') return;

    const input = this.mode === 'driving' ? this.input.read() : IDLE_INPUT;
    this.vehicle.update(dt, input, this.settings.units, this.nextGateDistance);

    this.traffic.update(
      dt,
      this.lastNearest?.distanceAlong ?? 0,
      this.vehicle.physics.speedKmh,
      this.lastNearest?.offset ?? ROAD.startOffset,
    );
    if (this.mode === 'driving') {
      const impact = this.traffic.resolvePlayerCollision(this.vehicle.physics.chassis, this.vehicle.group.position.y);
      if (impact > 0.6) this.rig.kick(Math.min(0.75, 0.18 + impact * 0.035));
      this.updateRun(dt);
    }

    this.rig.update(dt, {
      speedKmh: this.vehicle.physics.speedKmh,
      steer: this.vehicle.physics.steering / 0.54,
      throttle: this.vehicle.physics.throttle,
      brake: this.vehicle.physics.brakeAmount,
      mode: this.mode === 'menu' ? 'menu' : 'driving',
      shake: this.settings.shake,
    });
    this.world.update(dt, this.rig.activeCamera);
    this.vehicle.setNight(this.world.nightFactor);
    this.traffic.setNight(this.world.nightFactor);
    this.renderer.toneMappingExposure = this.world.exposure;

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
    this.lastNearest = nearest;
    this.routeHint = nearest.index;

    const region = this.route.regionAt(nearest.distanceAlong);
    this.currentRegionId = region.id;
    this.currentRegionName = region.name;

    const surface = this.roads.surfaceAt(position, this.vehicle.group.position.y, this.routeHint);
    let delta = nearest.distanceAlong - this.lastDistance;
    const length = this.route.length;
    if (delta > length / 2) delta -= length;
    if (delta < -length / 2) delta += length;
    this.lastDistance = nearest.distanceAlong;

    if (!this.challenge && surface.kind === 'main' && Math.abs(delta) < 20 && delta > 0) {
      this.peak += delta;
      this.distanceBank += delta;
    }

    this.enforceRail(nearest, surface);

    const forward = this.vehicle.forwardDirection();
    const facing = forward.dot(surface.tangent) < 0 ? -1 : 1;
    this.vehicle.setRoadPose(surface.height, Math.atan(surface.grade) * facing);

    if (this.challenge) {
      this.updateChallenge(dt, surface, nearest);
    } else {
      while (this.peak >= (this.sectorIndex + 1) * this.route.sectorLength) {
        this.sectorIndex += 1;
        this.awardSector();
      }
    }

    this.bestSpeedFloor = Math.max(this.bestSpeedFloor, physics.speedKmh);

    this.hudTimer -= dt;
    if (this.hudTimer <= 0) {
      this.hudTimer = 0.06;
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
    const gateInLap = this.sectorIndex % ROAD.sectorCount;

    this.profile = {
      ...this.profile,
      credits: this.profile.credits + credits,
      xp: this.profile.xp + xp,
      bestSpeed: Math.max(this.profile.bestSpeed, Math.round(physics.speedKmh)),
    };
    this.sessionCredits += credits;
    this.cleanLine = true;
    this.world.setActiveGate(this.sectorIndex % ROAD.sectorCount);

    if (gateInLap === 0) {
      this.completeLap();
    } else {
      this.pushToast(
        'sector',
        'GATE CLEARED',
        `+$${formatCredits(credits)} · +${xp} XP${clean ? ' · CLEAN LINE' : ''}`,
      );
    }

    const newLevel = levelInfo(this.profile.xp).level;
    if (newLevel > previousLevel) {
      this.pushToast('level', `LEVEL ${newLevel}`, `${levelInfo(this.profile.xp).name} · new garage stage unlocked`);
    }

    this.commitProgress();
    this.syncProfile();
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

    this.pushToast(
      'lap',
      `ISLAND LAP ${lapNumber}`,
      `${formatTime(lap)}${best ? ' · NEW BEST' : ''} · +$${formatCredits(credits)}`,
    );
  }

  /** Soft guardrail: keep the car inside the rails and scrub sideways impacts. */
  private enforceRail(nearest: NearestResult, surface: RoadSurface): void {
    // The junction roads are intentionally free of hard guardrail collision so
    // the player can transition across the merge noses into the roundabout and
    // ramp without an invisible wall at the opening.
    if (surface.kind === 'branch') return;
    const side = Math.sign(nearest.offset);
    if (this.roads.isMainGap(nearest.distanceAlong, side)) return;

    const right = nearest.frame.right;
    const offset = nearest.offset;
    const limit = ROAD.railOffset - 0.95;
    if (Math.abs(offset) <= limit) return;

    const overshoot = Math.abs(offset) - limit;
    const body = this.vehicle.physics.chassis;
    body.position.x -= right.x * overshoot * side;
    body.position.z -= right.z * overshoot * side;

    const velocity = body.velocity;
    const lateral = velocity.x * right.x + velocity.z * right.z;
    if (lateral * side > 0) {
      velocity.x -= right.x * lateral * 1.35;
      velocity.z -= right.z * lateral * 1.35;
      velocity.x *= 0.94;
      velocity.z *= 0.94;
      const impact = Math.min(1, Math.abs(lateral) / 12);
      this.rig.kick(0.2 + impact * 0.5);
      this.vehicle.physics.steering *= 0.55;
      this.cleanLine = false;
    }
    this.vehicle.syncTransform();
  }

  private placeOnMain(distance: number, offset = ROAD.startOffset, resetProgress = true): void {
    const placement = this.route.placement(distance, offset);
    this.vehicle.place(placement.position, placement.quaternion);
    const nearest = this.route.nearest(placement.position, -1);
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(placement.quaternion);
    const facing = forward.dot(placement.frame.tangent) < 0 ? -1 : 1;
    const region = this.route.regionAt(distance);
    this.vehicle.setRoadPose(
      this.route.elevationAt(distance),
      Math.atan(this.route.gradeAt(distance)) * facing,
    );
    this.routeHint = nearest.index;
    this.lastNearest = nearest;
    this.lastDistance = distance;
    this.currentRegionId = region.id;
    this.currentRegionName = region.name;
    if (resetProgress) {
      this.peak = distance;
      this.sectorIndex = region.gateIndex;
      this.world.setActiveGate(this.sectorIndex % ROAD.sectorCount);
    }
  }

  private updateChallenge(dt: number, surface: RoadSurface, nearest: NearestResult): void {
    const run = this.challenge;
    if (!run || run.finished) return;
    run.time += dt;

    const pathId = surface.path?.id;
    if (run.stage === 0) {
      if (pathId === 'skyway' && surface.distance > 30) {
        run.stage = 1;
        this.pushToast('sector', 'SKYWAY CLEAR', 'Now take the roundabout entry.');
      }
      return;
    }
    if (run.stage === 1) {
      if (pathId === 'roundabout-entry' || pathId === 'roundabout-ring') {
        run.stage = 2;
        run.ringStart = null;
        this.pushToast('sector', 'ROUNDABOUT', 'Carry the ring, then take the exit.');
      }
      return;
    }
    if (run.stage === 2) {
      if (pathId === 'roundabout-ring') {
        if (run.ringStart == null) run.ringStart = surface.distance;
        const loopLength = this.roads.roundaboutRing.length;
        let travel = surface.distance - run.ringStart;
        travel = ((travel % loopLength) + loopLength) % loopLength;
        if (travel > loopLength / 2) travel -= loopLength;
        if (Math.abs(travel) > loopLength * 0.2) {
          run.stage = 3;
          this.pushToast('sector', 'RING CLEAR', 'Rejoin the coast road to finish.');
        }
      }
      return;
    }

    const finish = this.roads.roundaboutAccessEnd + 20;
    if (surface.kind === 'main' && nearest.distanceAlong >= finish && nearest.distanceAlong < finish + 140) {
      this.finishChallenge();
    }
  }

  private finishChallenge(): void {
    const run = this.challenge;
    if (!run || run.finished) return;
    run.finished = true;
    const time = run.time;
    const best = this.profile.bestTrial == null || time < this.profile.bestTrial;
    const previousLevel = levelInfo(this.profile.xp).level;
    const credits = 500;
    const xp = 110;

    this.profile = {
      ...this.profile,
      credits: this.profile.credits + credits,
      xp: this.profile.xp + xp,
      bestTrial: best ? time : this.profile.bestTrial,
    };
    this.sessionCredits += credits;
    this.pushToast(
      'lap',
      'INTERCHANGE TRIAL',
      `${formatTime(time)}${best ? ' · NEW BEST' : ''} · +$${formatCredits(credits)}`,
    );

    const newLevel = levelInfo(this.profile.xp).level;
    if (newLevel > previousLevel) {
      this.pushToast('level', `LEVEL ${newLevel}`, `${levelInfo(this.profile.xp).name} · new garage stage unlocked`);
    }

    this.syncProfile();
    saveProfile(this.profile);
    this.pushHud();
  }

  private challengeObjective(): string {
    const run = this.challenge;
    if (!run) return '';
    if (run.finished) return 'Complete · pause to restart';
    if (run.stage === 0) return 'Skyway on-ramp';
    if (run.stage === 1) return 'Take the roundabout';
    if (run.stage === 2) return 'Carry the ring';
    return 'Rejoin the coast road';
  }

  private recover(): void {
    const position = this.vehicle.group.position;
    const surface = this.roads.surfaceAt(position, position.y, this.routeHint);
    let target: DrivePath | null = surface.kind === 'branch' ? surface.path : null;

    if (!target) {
      let bestScore = Infinity;
      for (const path of this.roads.branchPaths) {
        if (!path.driveable) continue;
        const sample = this.roads.nearestSample(path, position);
        if (!sample) continue;
        const lateral = Math.abs(sample.lateral);
        if (lateral > path.halfWidth + 3) continue;
        const point = path.samples[sample.index];
        const vertical = Math.abs(point.position.y - position.y);
        if (vertical > 8) continue;
        const score = lateral + vertical * 0.55;
        if (score < bestScore) {
          bestScore = score;
          target = path;
        }
      }
    }

    if (target) {
      const sample = this.roads.nearestSample(target, position);
      if (sample) {
        const offset = clamp(sample.lateral, -target.halfWidth + 1.3, target.halfWidth - 1.3);
        const placement = this.roads.placeOnPath(target, sample.distance, offset);
        this.vehicle.place(placement.position, placement.quaternion);
        this.vehicle.setRoadPose(placement.position.y, Math.atan(placement.grade));
        const nearest = this.route.nearest(placement.position, -1);
        const region = this.route.regionAt(nearest.distanceAlong);
        this.routeHint = nearest.index;
        this.lastDistance = nearest.distanceAlong;
        this.lastNearest = nearest;
        this.currentRegionId = region.id;
        this.currentRegionName = region.name;
        this.input.clear();
        this.rig.kick(0.07);
        this.pushHud();
        return;
      }
    }

    const nearest = this.route.nearest(position, this.routeHint);
    this.placeOnMain(nearest.distanceAlong, ROAD.startOffset, false);
    this.input.clear();
    this.rig.kick(0.07);
    this.pushHud();
  }

  private placeAtRegion(regionId: RegionId): void {
    const region = regionById(regionId);
    // Ten metres past the gate keeps the car unambiguously on the new
    // district's side of the loop, away from the start/finish seam.
    const start = this.route.wrap(this.route.regionStart(regionId) + 10);
    this.placeOnMain(start);
    this.currentRegionId = region.id;
    this.currentRegionName = region.name;
    this.peak = start;
    this.sectorIndex = region.gateIndex;
    // sectorIndex points at the sector just opened, so gateDistances[sectorIndex]
    // is the next physical gate, not the one after it.
    this.world.setActiveGate(this.sectorIndex % ROAD.sectorCount);
  }

  private resetRun(): void {
    this.challenge = null;
    this.placeAtRegion(this.settings.region);
    this.lapTime = 0;
    this.cleanLine = true;
    this.sessionCredits = 0;
    this.distanceBank = 0;
    this.bestSpeedFloor = 0;
    this.hudTimer = 0;
    this.saveTimer = 12;
    this.pushHud();
  }

  // ------------------------------------------------------------------- hud

  private pushHud(): void {
    const physics = this.vehicle.physics;
    const position = this.vehicle.group.position;
    const nearest = this.lastNearest ?? this.route.nearest(position, this.routeHint);
    const nextIndex = this.sectorIndex % ROAD.sectorCount;
    let nextGate = this.route.gateDistances[nextIndex] - nearest.distanceAlong;
    if (nextGate < 0) nextGate += this.route.length;
    const sectorLength = this.route.sectorLength;
    this.nextGateDistance = nextGate;
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.vehicle.group.quaternion);
    const standing = Math.abs(physics.signedSpeed) < 0.4;
    const region = this.route.regionAt(nearest.distanceAlong);

    hud.set({
      speed: physics.speedKmh,
      rpm: physics.rpm,
      gear: physics.reverse ? 'R' : standing && physics.throttle < 0.05 ? 'N' : String(physics.gear),
      region: region.id,
      regionName: region.name,
      nextGateDistance: nextGate,
      gateProgress: clamp(1 - nextGate / sectorLength, 0, 1),
      mapX: position.x,
      mapZ: position.z,
      heading: Math.atan2(forward.x, -forward.z),
      drifting: physics.slip > 0.45 && physics.speedKmh > 30,
      units: this.settings.units,
      clock: this.world.clockLabel,
      phase: this.world.phaseLabel,
      challenge: this.challenge
        ? {
            active: true,
            finished: this.challenge.finished,
            time: this.challenge.time,
            objective: this.challengeObjective(),
            best: this.profile.bestTrial,
          }
        : null,
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
