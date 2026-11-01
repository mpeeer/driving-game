import * as THREE from 'three';
import { Economy, ServiceResult } from '../systems/economy';
import { Hud, HudCallbacks, ScreenName } from '../ui/hud';
import { AudioEngine } from '../systems/audio';
import { CameraRig, ViewMode } from '../systems/cameraRig';
import { Session, SessionModifiers } from './session';
import { getLine, getRegion, getTrain } from '../content/data';
import { makeShowcasePlan, TrackPath } from '../world/trackPlan';
import { TrackView } from '../world/trackView';
import { Scenery } from '../world/scenery';
import { StationView } from '../world/stationView';
import { SkySystem } from '../world/sky';
import { TrainSim } from '../train/trainSim';
import { TrainMesh } from '../train/trainMesh';
import { PassengerSystem } from '../world/passengers';
import { clamp } from './util';

type GameState = 'menu' | 'dispatch' | 'depot' | 'loading' | 'driving' | 'paused' | 'summary';

export class Game {
  private renderer: THREE.WebGLRenderer;
  private canvas: HTMLCanvasElement;
  private clock = new THREE.Clock();
  economy: Economy;
  hud: Hud;
  audio = new AudioEngine();
  state: GameState = 'menu';
  session?: Session;
  private cameraRig?: CameraRig;

  private menuScene = new THREE.Scene();
  private menuCamera = new THREE.PerspectiveCamera(48, 1, 0.1, 12000);
  private menuSky?: SkySystem;
  private menuTarget = new THREE.Vector3();
  private menuPassengers = new PassengerSystem();
  private menuPath?: TrackPath;
  private menuTrainMesh?: TrainMesh;
  private menuTime = 0;
  private menuPlanStations: StationView[] = [];
  private menuScenery?: Scenery;
  private menuTrack?: TrackView;

  private keys = new Set<string>();
  private dragging = false;
  private dragX = 0;
  private dragY = 0;
  private lookLeft = false;
  private lookRight = false;
  private hudAccumulator = 0;
  private previousScreen: ScreenName = 'menu';
  private started = false;

  constructor(canvas: HTMLCanvasElement, uiRoot: HTMLElement) {
    this.canvas = canvas;
    this.economy = new Economy();
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.03;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setClearColor(0x0a0f15, 1);
    this.applyGraphics();

    const callbacks: HudCallbacks = {
      onPlay: () => this.showDispatch(),
      onDepot: () => this.showDepot(),
      onMenu: () => this.showMenu(),
      onControls: () => this.showControls(),
      onCloseControls: () => this.closeControls(),
      onReset: () => {
        this.economy.reset();
        this.hud.selectedLineId = 'hbr-m1';
        this.hud.selectedRegion = 'harbour';
        this.hud.renderMenu();
        this.hud.renderDispatch();
        this.hud.renderDepot();
        this.hud.showScreen('menu');
        this.state = 'menu';
      },
      onStartService: (lineId) => void this.startService(lineId),
      onUnlockLine: (lineId) => this.unlockLine(lineId),
      onUnlockRegion: (regionId) => this.unlockRegion(regionId),
      onSelectTrain: (trainId) => {
        this.economy.setActiveTrain(trainId);
        this.hud.renderDispatch();
        this.hud.renderDepot();
      },
      onBuyTrain: (trainId) => this.buyTrain(trainId),
      onBuyUpgrade: (upgradeId) => this.buyUpgrade(upgradeId),
      onDepotTab: () => this.hud.renderDepot(),
      onPause: () => this.pause(),
      onResume: () => this.resume(),
      onRestart: () => this.restart(),
      onQuit: () => this.quitToDispatch(),
      onCamera: () => this.cycleCamera(),
      onDoors: () => this.session?.toggleDoors(),
      onLights: () => this.session?.cycleHeadlights(),
      onEmergency: () => this.session?.emergency(),
      onHorn: (down) => this.setHorn(down),
      onVolume: (v) => {
        this.audio.setVolume(v);
        this.economy.updateSettings({ volume: v });
      },
      onToggleMute: () => {
        const m = !this.economy.settings.mute;
        this.audio.setMuted(m);
        this.economy.updateSettings({ mute: m });
        this.hud.renderPauseSettings();
      },
      onAnnouncements: (on) => {
        this.audio.announcementsEnabled = on;
        this.economy.updateSettings({ announcements: on });
      },
      onQuality: (q) => {
        this.economy.updateSettings({ quality: q });
        this.applyGraphics();
      },
      onHints: (on) => this.economy.updateSettings({ showHints: on }),
      onReverse: () => this.session?.toggleReverser(),
    };

    this.hud = new Hud(uiRoot, this.economy, callbacks);
    this.hud.renderMenu();
    this.hud.showScreen('menu');
    this.buildMenuScene();
    this.bindInput();
    this.resize();
    window.addEventListener('resize', () => this.resize());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state === 'driving') this.pause();
    });
    this.audio.announcementsEnabled = this.economy.settings.announcements;
    this.audio.volume = this.economy.settings.volume;
    this.audio.muted = this.economy.settings.mute;
    document.addEventListener('pointerdown', () => {
      void this.audio.init().then(() => {
        this.audio.setVolume(this.economy.settings.volume);
        this.audio.setMuted(this.economy.settings.mute);
      });
    }, { once: true });
  }

  private applyGraphics(): void {
    const q = this.economy.settings.quality;
    const ratio = q === 'high' ? Math.min(2, window.devicePixelRatio) : q === 'medium' ? Math.min(1.5, window.devicePixelRatio) : 1;
    this.renderer.setPixelRatio(ratio);
    this.renderer.shadowMap.enabled = q !== 'low';
    if (this.menuSky) this.menuSky.sunLight.castShadow = q !== 'low';
    if (this.session) this.session.sky.sunLight.castShadow = q !== 'low';
  }

  private buildMenuScene(): void {
    const theme = getRegion('harbour').theme;
    this.menuScene.fog = new THREE.Fog(0x4a4a5f, 90, 620);
    this.menuSky = new SkySystem(this.menuScene);
    this.menuSky.setHour(18.7);
    const plan = makeShowcasePlan();
    const path = new TrackPath(plan);
    this.menuPath = path;
    this.menuTrack = new TrackView(plan, path, { electric: true, theme, lineColor: '#4da3ff' });
    this.menuScene.add(this.menuTrack.group);
    this.menuScenery = new Scenery(plan, path, theme);
    this.menuScene.add(this.menuScenery.group);
    for (const st of plan.stations) {
      const sv = new StationView(path, st, {
        platformLength: 200,
        theme,
        lineColor: '#4da3ff',
        lineCode: 'M1',
        night: this.menuSky.night,
      });
      this.menuPlanStations.push(sv);
      this.menuScene.add(sv.group);
    }
    this.menuScene.add(this.menuPassengers.group);

    const def = getTrain('cityrunner');
    const sim = new TrainSim(def, path, this.menuPlanStations[0].stopS);
    sim.doors = 1;
    sim.doorsTarget = 1;
    sim.notifyPassengers(64);
    this.menuTrainMesh = new TrainMesh(def);
    this.menuTrainMesh.setLineInfo('M1', '#4da3ff', 'Harbour Loop');
    this.menuTrainMesh.update(sim, path, 0.016, {
      lineCode: 'M1', lineColor: '#4da3ff', destination: 'Harbour Loop', night: this.menuSky.night, cabView: false,
    });
    this.menuTrainMesh.group.updateMatrixWorld(true);
    this.menuTrainMesh.group.position.set(0.0, 0, 0.0);
    this.menuScene.add(this.menuTrainMesh.group);
    this.menuPassengers.setupStation(this.menuPlanStations[0], path, 120);
    const centerS = sim.s - sim.length * 0.5;
    const p = path.sample(centerS);
    this.menuTarget.set(p.x, p.y + 2.2, p.z);
    this.menuSky.focus(this.menuTarget);
    this.menuCamera.position.set(this.menuTarget.x + 38, this.menuTarget.y + 15, this.menuTarget.z + 30);
    this.menuCamera.lookAt(this.menuTarget);
    this.menuTrack.update(sim.s);
  }

  start(): void {
    this.clock.start();
    const loop = () => {
      requestAnimationFrame(loop);
      this.frame();
    };
    requestAnimationFrame(loop);
  }

  private frame(): void {
    const dt = Math.min(0.05, this.clock.getDelta());
    if (this.state === 'driving' && this.session) {
      this.handleHeldKeys(dt);
      this.session.update(dt);
      this.updateCamera(dt);
      this.audio.update(dt, {
        speedKph: this.session.train.speedKph,
        maxSpeedKph: this.session.trainDef.maxSpeedKph,
        throttle: this.session.train.throttle,
        brake: this.session.train.brakeApplied,
        doorsOpen: this.session.train.doorsOpen,
        atStation: this.session.aligned,
        stationName: this.session.currentStation?.plan.name ?? '',
        night: this.session.night,
        wet: this.session.wet,
        diesel: this.session.trainDef.traction === 'diesel',
        slip: this.session.train.slip,
        stopped: Math.abs(this.session.train.v) < 0.2,
      });
      this.hudAccumulator += dt;
      if (this.hudAccumulator > 0.055) {
        this.hudAccumulator = 0;
        const st = this.session.hudState({
          money: this.economy.money,
          level: this.economy.level,
          xpFraction: this.economy.levelProgress.fraction,
          viewMode: this.cameraRig?.mode ?? 'cab',
          showHints: this.economy.settings.showHints,
        });
        this.hud.update(st);
      }
      this.session.sky.follow(this.cameraRig!.camera.position);
      this.renderer.render(this.session.scene, this.cameraRig!.camera);
    } else if ((this.state === 'paused' || this.state === 'summary') && this.session) {
      this.session.sky.follow(this.cameraRig!.camera.position);
      this.renderer.render(this.session.scene, this.cameraRig!.camera);
    } else {
      this.menuTime += dt;
      this.updateMenuCamera(dt);
      this.menuPassengers.update(dt);
      this.menuScenery?.update(dt, this.menuTime);
      this.menuSky?.focus(this.menuTarget);
      this.menuSky?.follow(this.menuCamera.position);
      this.renderer.render(this.menuScene, this.menuCamera);
    }
  }

  private updateMenuCamera(dt: number): void {
    const t = this.menuTime * 0.09;
    const radius = 44;
    const x = this.menuTarget.x + Math.sin(t) * radius;
    const z = this.menuTarget.z + Math.cos(t) * radius;
    const y = this.menuTarget.y + 12.5 + Math.sin(t * 1.7) * 1.5;
    this.menuCamera.position.lerp(new THREE.Vector3(x, y, z), 1 - Math.exp(-0.8 * dt));
    this.menuCamera.lookAt(this.menuTarget);
    this.menuCamera.fov = 48;
    this.menuCamera.updateProjectionMatrix();
  }

  private updateCamera(dt: number): void {
    if (!this.session || !this.cameraRig) return;
    this.cameraRig.update(dt, this.session.train, this.session.path, {
      time: this.menuTime + this.clock.elapsedTime,
      maxSpeed: this.session.train.maxSpeedMs,
    });
    if (this.lookLeft) this.cameraRig.lookYaw = clamp(this.cameraRig.lookYaw + dt * 1.15, -1.6, 1.6);
    if (this.lookRight) this.cameraRig.lookYaw = clamp(this.cameraRig.lookYaw - dt * 1.15, -1.6, 1.6);
  }

  private handleHeldKeys(dt: number): void {
    if (!this.session) return;
    if (this.keys.has('w') || this.keys.has('arrowup')) this.session.nudgeThrottle(dt * 1.35);
    if (this.keys.has('s') || this.keys.has('arrowdown')) this.session.nudgeBrake(dt * 1.6);
  }

  private showDispatch(): void {
    this.state = 'dispatch';
    this.hud.renderDispatch();
    this.hud.showScreen('dispatch');
  }

  private showDepot(): void {
    this.state = 'depot';
    this.hud.renderDepot();
    this.hud.showScreen('depot');
  }

  private showMenu(): void {
    this.state = 'menu';
    this.hud.renderMenu();
    this.hud.showScreen('menu');
  }

  private showControls(): void {
    this.previousScreen = this.state === 'driving' ? 'driving' : this.state === 'paused' ? 'paused' : this.state === 'dispatch' ? 'dispatch' : this.state === 'depot' ? 'depot' : 'menu';
    this.hud.showScreen('controls');
  }

  private closeControls(): void {
    this.hud.showScreen(this.previousScreen);
  }

  private unlockLine(lineId: string): void {
    const line = getLine(lineId);
    if (!line) return;
    if (this.economy.unlockLine(lineId)) {
      this.hud.toast(`Route rights acquired · ${line.code} ${line.name}`, 'good');
      this.hud.selectedLineId = lineId;
      this.hud.selectedRegion = line.regionId;
      this.audio.buttonClick();
    } else {
      this.hud.toast('Unable to unlock this line yet.', 'bad');
    }
    this.hud.renderDispatch();
    this.hud.renderDepot();
    this.hud.renderMenu();
    this.state = this.state === 'depot' ? 'depot' : 'dispatch';
  }

  private unlockRegion(regionId: string): void {
    const region = getRegion(regionId);
    if (this.economy.unlockRegion(regionId)) {
      this.hud.toast(`${region.name} added to the network`, 'good');
      this.hud.selectedRegion = regionId;
      const line = this.economy.linesForRegion(regionId).find((l) => this.economy.isLineUnlocked(l));
      if (line) this.hud.selectedLineId = line.id;
      this.audio.buttonClick();
    } else {
      this.hud.toast('Unable to unlock this region yet.', 'bad');
    }
    this.hud.renderDispatch();
    this.hud.renderDepot();
    this.hud.renderMenu();
    this.state = this.state === 'depot' ? 'depot' : 'dispatch';
  }

  private buyTrain(trainId: string): void {
    const train = getTrain(trainId);
    if (this.economy.buyTrain(trainId)) {
      this.hud.toast(`${train.name} delivered to the depot`, 'good');
      this.audio.buttonClick();
    } else {
      this.hud.toast('Unable to purchase this train yet.', 'bad');
    }
    this.hud.renderDepot();
    this.hud.renderDispatch();
  }

  private buyUpgrade(id: string): void {
    if (this.economy.buyUpgrade(id)) {
      this.hud.toast('Upgrade installed', 'good');
      this.audio.buttonClick();
    } else {
      this.hud.toast('Unable to purchase this upgrade.', 'bad');
    }
    this.hud.renderDepot();
    this.hud.renderMenu();
  }

  private async startService(lineId: string): Promise<void> {
    const line = getLine(lineId);
    if (!line) return;
    if (!this.economy.isLineUnlocked(line)) {
      this.hud.toast('Unlock this route in the Depot first.', 'bad');
      return;
    }
    this.hud.setLoading(true);
    this.state = 'loading';
    await new Promise((r) => setTimeout(r, 60));
    try {
      this.disposeSession();
      const region = getRegion(line.regionId);
      const train = getTrain(this.economy.activeTrainId);
      const mods: SessionModifiers = this.economy.modifiers();
      const session = new Session(line, region, train, mods, this.audio, {
        toast: (msg, type) => this.hud.toast(msg, type),
        announce: (text) => this.audio.announce(text),
        onNotice: (msg, tone) => this.hud.showStopToast(msg, tone),
        onComplete: (result) => this.finishService(result),
      });
      this.session = session;
      this.cameraRig = new CameraRig(this.renderer.domElement.width / Math.max(1, this.renderer.domElement.height));
      this.cameraRig.setAspect(window.innerWidth / Math.max(1, window.innerHeight));
      this.state = 'driving';
      this.menuTime = 0;
      this.hud.setupSession({
        lineCode: line.code,
        lineName: line.name,
        lineColor: line.color,
        stations: session.plan.stations.map((s) => s.name),
        capacity: session.capacity,
        destination: session.plan.stations[session.plan.stations.length - 1].name,
        serviceNumber: this.serviceNumber(session),
        startClock: session.clock,
        stationS: session.plan.stations.map((s) => s.s),
        stopS: session.stations.map((s) => s.stopS),
      });
      this.hud.showScreen('driving');
      this.audio.announcementsEnabled = this.economy.settings.announcements;
      void this.audio.init();
      this.audio.setVolume(this.economy.settings.volume);
      this.audio.setMuted(this.economy.settings.mute);
      this.hud.setLoading(false);
      this.hud.toast(`${line.code} ${line.name} · ${train.name} ready for service`, 'info');
      if (!this.economy.data.tutorialSeen) {
        this.economy.data.tutorialSeen = true;
        this.economy.save();
        setTimeout(() => this.hud.toast('Hold W for power, S for brake, D for doors. Stop on the board at the platform.', 'info'), 1600);
      }
    } catch (err) {
      console.error(err);
      this.hud.setLoading(false);
      this.state = 'dispatch';
      this.hud.showScreen('dispatch');
      this.hud.toast('Could not build this line. Try another.', 'bad');
    }
  }

  private serviceNumber(session: Session): string {
    const n = 100 + (Math.abs(Math.round(session.plan.length)) % 800);
    return String(n);
  }

  private finishService(raw: Omit<ServiceResult, 'newLevel' | 'levelsGained'>): void {
    const result = this.economy.completeService(raw);
    this.state = 'summary';
    this.audio.chime();
    this.hud.showSummary(result, this.session?.line.color ?? '#4da3ff');
    this.hud.renderMenu();
  }

  private disposeSession(): void {
    if (this.session) {
      try {
        this.session.dispose();
      } catch (err) {
        console.warn('Session dispose failed', err);
      }
      this.session = undefined;
    }
    this.cameraRig = undefined;
    this.audio.hornStop();
  }

  private pause(): void {
    if (this.state !== 'driving') return;
    this.state = 'paused';
    this.keys.clear();
    this.audio.hornStop();
    this.hud.renderPauseSettings();
    this.hud.showScreen('paused');
  }

  private resume(): void {
    if (this.state !== 'paused') return;
    this.state = 'driving';
    this.hud.showScreen('driving');
  }

  private restart(): void {
    const lineId = this.session?.line.id ?? getLine(this.hud.selectedLineId)?.id;
    if (!lineId) return;
    void this.startService(lineId);
  }

  private quitToDispatch(): void {
    this.disposeSession();
    this.state = 'dispatch';
    this.hud.renderDispatch();
    this.hud.showScreen('dispatch');
    this.hud.renderMenu();
  }

  private cycleCamera(): void {
    if (!this.session || !this.cameraRig) return;
    const mode = this.cameraRig.cycle();
    this.cameraRig.resetLook();
    const labels: Record<ViewMode, string> = { cab: 'Cab view', chase: 'Chase view', orbit: 'Orbit view' };
    this.hud.toast(labels[mode], 'info');
  }

  private setHorn(down: boolean): void {
    if (!this.session || this.state !== 'driving') {
      if (!down) this.audio.hornStop();
      return;
    }
    if (down) this.audio.hornStart();
    else this.audio.hornStop();
  }

  private bindInput(): void {
    window.addEventListener('keydown', (e) => {
      const target = e.target as HTMLElement | null;
      if (target && ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName)) return;
      const k = e.key.toLowerCase();
      if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) e.preventDefault();
      const isNew = !this.keys.has(k);
      this.keys.add(k);
      if (k === ' ') {
        if (isNew) this.setHorn(true);
        return;
      }
      if (!isNew || e.repeat) return;
      if (k === 'escape') {
        if (this.state === 'driving') this.pause();
        else if (this.state === 'paused') this.resume();
        return;
      }
      if (this.state !== 'driving' || !this.session) return;
      switch (k) {
        case 'd': this.session.toggleDoors(); break;
        case 'h': this.session.cycleHeadlights(); break;
        case 'c': this.cycleCamera(); break;
        case 'e': this.session.emergency(); break;
        case 'f': this.session.toggleWipers(); break;
        case 'r': this.session.toggleReverser(); break;
        case 'z': this.session.setThrottle(0); break;
        case 'x':
          this.session.releaseBrake();
          this.audio.brakeHiss();
          break;
        case 'arrowleft': this.lookLeft = true; break;
        case 'arrowright': this.lookRight = true; break;
        default: break;
      }
    });
    window.addEventListener('keyup', (e) => {
      const k = e.key.toLowerCase();
      this.keys.delete(k);
      if (k === ' ') this.setHorn(false);
      if (k === 'arrowleft') this.lookLeft = false;
      if (k === 'arrowright') this.lookRight = false;
    });
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.lookLeft = false;
      this.lookRight = false;
      this.audio.hornStop();
    });

    this.canvas.addEventListener('pointerdown', (e) => {
      if (this.state !== 'driving') return;
      this.dragging = true;
      this.dragX = e.clientX;
      this.dragY = e.clientY;
      this.canvas.setPointerCapture(e.pointerId);
      this.canvas.style.cursor = 'grabbing';
    });
    this.canvas.addEventListener('pointermove', (e) => {
      if (!this.dragging || !this.cameraRig) return;
      const dx = e.clientX - this.dragX;
      const dy = e.clientY - this.dragY;
      this.dragX = e.clientX;
      this.dragY = e.clientY;
      if (this.cameraRig.mode === 'cab') {
        this.cameraRig.lookYaw = clamp(this.cameraRig.lookYaw - dx * 0.0035, -2.6, 2.6);
        this.cameraRig.lookPitch = clamp(this.cameraRig.lookPitch - dy * 0.0026, -0.85, 0.85);
      } else {
        this.cameraRig.orbitYaw -= dx * 0.005;
        this.cameraRig.orbitPitch = clamp(this.cameraRig.orbitPitch + dy * 0.002, -0.08, 0.85);
      }
    });
    const endDrag = (e: PointerEvent) => {
      if (!this.dragging) return;
      this.dragging = false;
      this.canvas.style.cursor = 'grab';
      try {
        this.canvas.releasePointerCapture(e.pointerId);
      } catch {
        /* pointer already released */
      }
    };
    this.canvas.addEventListener('pointerup', endDrag);
    this.canvas.addEventListener('pointercancel', endDrag);
    this.canvas.addEventListener('wheel', (e) => {
      if (this.state !== 'driving') return;
      e.preventDefault();
      this.cameraRig?.zoomBy(e.deltaY);
    }, { passive: false });
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    this.canvas.style.cursor = 'grab';
  }

  private resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.menuCamera.aspect = w / Math.max(1, h);
    this.menuCamera.updateProjectionMatrix();
    if (this.cameraRig) {
      this.cameraRig.setAspect(w / Math.max(1, h));
    }
  }

  get audioEngine(): AudioEngine {
    return this.audio;
  }

  get currentSession(): Session | undefined {
    return this.session;
  }

  startFromMenu(): void {
    if (this.started) return;
    this.started = true;
    this.start();
  }
}
