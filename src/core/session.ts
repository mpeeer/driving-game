import * as THREE from 'three';
import { LineDef, RegionDef, TrainDef, getTrain } from '../content/data';
import { buildTrackPlan, TrackPath, TrackPlan } from '../world/trackPlan';
import { TrackView } from '../world/trackView';
import { Scenery } from '../world/scenery';
import { StationView } from '../world/stationView';
import { SkySystem } from '../world/sky';
import { PassengerSystem } from '../world/passengers';
import { TrainSim } from '../train/trainSim';
import { TrainMesh } from '../train/trainMesh';
import { AudioEngine } from '../systems/audio';
import type { HudState, RouteItemState } from '../ui/hud';
import { ServiceResult } from '../systems/economy';
import { Rng, clamp, formatHM, hashString } from './util';

export interface SessionModifiers {
  traction: number;
  brakes: number;
  comfort: number;
  fareBonus: number;
  trainer: number;
}

export interface SessionHooks {
  toast: (msg: string, type?: 'good' | 'bad' | 'info') => void;
  announce: (text: string) => void;
  onComplete: (result: Omit<ServiceResult, 'newLevel' | 'levelsGained'>) => void;
  onNotice: (msg: string, tone: 'good' | 'bad' | 'info') => void;
}

interface TimetableRow {
  arrival: number;
  departure: number;
}

interface Exchange {
  active: boolean;
  elapsed: number;
  duration: number;
  alight: number;
  boardPlanned: number;
  boarded: number;
  finalized: boolean;
}

export type SessionPhase = 'boarding' | 'running' | 'arrived' | 'complete';

export class Session {
  scene = new THREE.Scene();
  sky: SkySystem;
  plan: TrackPlan;
  path: TrackPath;
  trackView: TrackView;
  scenery: Scenery;
  stations: StationView[] = [];
  passengers = new PassengerSystem();
  train: TrainSim;
  trainMesh: TrainMesh;
  line: LineDef;
  region: RegionDef;
  trainDef: TrainDef;
  mods: SessionModifiers;
  hooks: SessionHooks;
  audio: AudioEngine;

  clock = 0;
  phase: SessionPhase = 'boarding';
  currentIndex = 0;
  nextIndex = 1;
  timetable: TimetableRow[] = [];
  waiting: number[] = [];
  exchange: Exchange = { active: false, elapsed: 0, duration: 0, alight: 0, boardPlanned: 0, boarded: 0, finalized: false };
  occupancy = 0;
  capacity: number;
  platformLength = 200;
  night = 0;
  wet = 0;
  weather: 'clear' | 'rain' = 'clear';

  stats = {
    fares: 0,
    passengerKm: 0,
    boarded: 0,
    stops: 0,
    perfectStops: 0,
    goodStops: 0,
    onTimeStops: 0,
    delaySum: 0,
    penalties: 0,
    accuracyBonus: 0,
    overspeedEvents: 0,
    harshBrakes: 0,
    satisfaction: 86,
    distanceKm: 0,
    time: 0,
  };
  private stopEvaluated: boolean[] = [];
  private stopTimer = 0;
  private overspeedTimer = 0;
  private overspeedCooldown = 0;
  private atpTimer = 0;
  private harshCooldown = 0;
  private announcedStation = -1;
  private lastAtStation = false;
  private hint = '';
  private hudCache: Partial<HudState> = {};
  private completeSent = false;
  private serviceNumber: string;
  private arriveClock = 0;
  private displayNight = -1;
  private stationFocus = 0;
  private skyTimer = 0;

  constructor(line: LineDef, region: RegionDef, trainDef: TrainDef, mods: SessionModifiers, audio: AudioEngine, hooks: SessionHooks) {
    this.line = line;
    this.region = region;
    this.trainDef = trainDef;
    this.mods = mods;
    this.audio = audio;
    this.hooks = hooks;
    this.plan = buildTrackPlan(line, region);
    this.path = new TrackPath(this.plan);
    this.clock = line.startHour * 3600;
    this.capacity = trainDef.cars * 148;

    this.scene.fog = new THREE.Fog(0xbdd2e2, 220, 1400);
    this.sky = new SkySystem(this.scene);
    this.sky.setHour(this.clock / 3600);
    this.night = this.sky.night;
    this.weather = new Rng(line.seed ^ 0x77aa).chance(0.28) ? 'rain' : 'clear';
    this.wet = this.weather === 'rain' ? 0.7 : 0;

    this.trackView = new TrackView(this.plan, this.path, { electric: region.traction === 'electric', theme: region.theme, lineColor: line.color });
    this.scene.add(this.trackView.group);
    this.scenery = new Scenery(this.plan, this.path, region.theme);
    this.scene.add(this.scenery.group);

    for (const st of this.plan.stations) {
      const view = new StationView(this.path, st, {
        platformLength: this.platformLength,
        theme: region.theme,
        lineColor: line.color,
        lineCode: line.code,
        night: this.night,
      });
      this.stations.push(view);
      this.scene.add(view.group);
    }
    this.scene.add(this.passengers.group);

    this.trainMesh = new TrainMesh(trainDef);
    this.trainMesh.setLineInfo(line.code, line.color, this.plan.stations[this.plan.stations.length - 1].name);
    this.scene.add(this.trainMesh.group);

    const startS = this.stations[0].stopS;
    this.train = new TrainSim(trainDef, this.path, startS);
    this.train.headlights = 1;
    this.train.reverser = 1;

    this.serviceNumber = String(100 + (hashString(line.id) % 800));
    this.buildTimetable();
    this.buildDemand();
    this.stopEvaluated = this.plan.stations.map(() => false);

    // Start with doors open at the first station and passengers boarding.
    this.train.setDoorsOpen(true);
    this.train.doors = 1;
    this.openExchange(0, true);
    this.passengers.setupStation(this.stations[0], this.path, this.waiting[0]);
    this.passengers.beginExchange(this.doorPositions(), this.exchange.boardPlanned, 0);
    this.hooks.announce(`This is ${this.plan.stations[0].name}. This service is for ${this.plan.stations[this.plan.stations.length - 1].name}.`);
  }

  private buildTimetable(): void {
    const n = this.plan.stations.length;
    const avgKph: Record<string, number> = { metro: 46, lightrail: 33, regional: 82, express: 138, freight: 48 };
    const avg = avgKph[this.line.kind] ?? 55;
    let t = this.clock + 55;
    this.timetable = [{ arrival: this.clock, departure: t }];
    const rng = new Rng(this.line.seed ^ 0x4411);
    for (let i = 1; i < n; i++) {
      const dist = this.plan.stations[i].s - this.plan.stations[i - 1].s;
      const travel = dist / (avg / 3.6) + 20 + rng.range(-8, 14);
      const arrival = t + travel;
      const dwell = 35 + this.plan.stations[i].size * 12;
      t = arrival + dwell;
      this.timetable.push({ arrival, departure: t });
    }
  }

  private buildDemand(): void {
    const rng = new Rng(this.line.seed ^ 0x1993);
    const hour = this.line.startHour;
    const peak = (hour > 6.6 && hour < 9.4) || (hour > 16.2 && hour < 18.8) ? 1.32 : 0.88;
    this.waiting = this.plan.stations.map((st, i) => {
      const endPad = i === 0 || i === this.plan.stations.length - 1 ? 0.8 : 1;
      const v = st.demand * peak * rng.range(0.7, 1.35) * endPad;
      return Math.round(clamp(v, 16, 240));
    });
  }

  get stationCount(): number {
    return this.plan.stations.length;
  }

  get currentStation(): StationView {
    return this.stations[clamp(this.currentIndex, 0, this.stations.length - 1)];
  }

  get nextStation(): StationView | null {
    if (this.phase !== 'running') {
      return this.nextIndex > this.currentIndex && this.nextIndex < this.stations.length ? this.stations[this.nextIndex] : null;
    }
    return this.nextIndex < this.stations.length ? this.stations[this.nextIndex] : null;
  }

  get targetStopS(): number | null {
    if (this.phase === 'boarding' || this.phase === 'arrived') return this.currentStation.stopS;
    if (this.nextIndex < this.stations.length) return this.stations[this.nextIndex].stopS;
    return null;
  }

  get distanceToNext(): number {
    const st = this.nextStation;
    if (!st) return 0;
    return Math.max(0, st.stopS - this.train.s);
  }

  get stopAccuracy(): number | null {
    if (this.phase === 'arrived' || this.phase === 'boarding') {
      return Math.abs(this.train.s - this.currentStation.stopS);
    }
    return null;
  }

  get aligned(): boolean {
    const target = this.phase === 'arrived' || this.phase === 'boarding' ? this.currentStation.stopS : null;
    if (target === null) return false;
    return Math.abs(this.train.s - target) <= 24;
  }

  get serviceStartClock(): number {
    return this.line.startHour * 3600;
  }

  get elapsedSinceStart(): number {
    return this.clock - this.serviceStartClock;
  }

  setHeadlights(mode: number): void {
    this.train.headlights = clamp(Math.round(mode), 0, 2) as 0 | 1 | 2;
  }

  cycleHeadlights(): void {
    this.train.headlights = ((this.train.headlights + 1) % 3) as 0 | 1 | 2;
    this.hooks.toast(`Headlights: ${this.train.headlights === 0 ? 'off' : this.train.headlights === 1 ? 'dipped' : 'full beam'}`, 'info');
  }

  toggleWipers(): void {
    this.train.wipers = !this.train.wipers;
  }

  toggleReverser(): void {
    if (Math.abs(this.train.v) > 0.25) {
      this.hooks.toast('Stop the train before changing direction.', 'bad');
      return;
    }
    if (this.train.reverser === 1) {
      this.train.setReverser(-1);
      this.hooks.toast('Reverser set to REVERSE — limited to 25 km/h', 'info');
    } else {
      this.train.setReverser(1);
      this.hooks.toast('Reverser set to FORWARD', 'info');
    }
  }

  emergency(): void {
    if (this.train.emergency) {
      this.train.releaseEmergency();
      this.hooks.toast('Emergency brake released', 'info');
    } else {
      this.train.emergencyBrake();
      this.hooks.toast('EMERGENCY BRAKE APPLIED', 'bad');
      this.audio.brakeHiss();
      this.stats.satisfaction = clamp(this.stats.satisfaction - 2, 30, 100);
    }
  }

  toggleDoors(): void {
    if (this.train.doorsOpen || this.train.doorsTarget > 0.5) this.closeDoors();
    else this.openDoors();
  }

  openDoors(): void {
    if (Math.abs(this.train.v) > 0.25) {
      this.hooks.toast('Stop the train before opening the doors.', 'bad');
      this.audio.buttonClick();
      return;
    }
    if (this.phase === 'running') {
      const next = this.nextStation;
      if (!next || Math.abs(this.train.s - next.stopS) > 32) {
        this.hooks.toast('Not at a platform — move to the stop board.', 'bad');
        return;
      }
      this.arriveAtCurrent();
      if (this.train.doorsTarget > 0.5) return;
    }
    if (this.phase !== 'arrived' && this.phase !== 'boarding') {
      this.hooks.toast('No platform here.', 'bad');
      return;
    }
    if (!this.aligned) {
      this.stats.penalties += 60;
      this.stats.satisfaction = clamp(this.stats.satisfaction - 4, 30, 100);
      this.hooks.toast(`MISALIGNED STOP (${Math.abs(this.train.s - this.currentStation.stopS).toFixed(1)} m off) — doors will not open.`, 'bad');
      return;
    }
    if (this.train.doorsTarget > 0.5) return;
    this.train.setDoorsOpen(true);
    this.audio.doorSound(true);
    this.audio.chime();
    this.openExchange(this.currentIndex, false);
    this.passengers.beginExchange(this.doorPositions(), this.exchange.boardPlanned, this.exchange.alight);
    this.hooks.announce(`Doors opening at ${this.currentStation.plan.name}.`);
    this.hooks.toast('Doors opening — watch the platform.', 'info');
  }

  closeDoors(): void {
    if (this.train.doorsTarget < 0.5) return;
    this.train.setDoorsOpen(false);
    this.audio.doorSound(false);
    this.finalizeExchange();
    if (this.train.emergency) this.train.releaseEmergency();
    const terminus = this.currentIndex >= this.plan.stations.length - 1;
    if (terminus && this.phase === 'arrived') {
      this.completeService();
    } else {
      this.hooks.toast('Doors closed — interlock released.', 'info');
    }
  }

  private openExchange(stationIndex: number, initial: boolean): void {
    const station = this.plan.stations[stationIndex];
    const terminus = stationIndex >= this.plan.stations.length - 1;
    const alight = terminus ? this.occupancy : Math.round(this.occupancy * clamp(station.size * 0.22 + 0.08, 0.08, 0.44));
    const room = this.capacity - this.occupancy + alight;
    void room;
    const board = terminus ? 0 : Math.min(this.waiting[stationIndex] ?? 0, Math.max(0, room));
    const doorCount = this.trainDef.cars * 3;
    const duration = 4 + (alight + board) / Math.max(5, doorCount) + station.size * 2;
    this.exchange = { active: true, elapsed: 0, duration, alight, boardPlanned: board, boarded: 0, finalized: false };
    if (initial) {
      this.train.setDoorsOpen(true);
      this.train.doors = 1;
    }
    this.hooks.announce(terminus
      ? `This is ${station.name}. All passengers alight here. Thank you for travelling.`
      : `Now arriving at ${station.name}. Please mind the gap between the train and the platform.`);
    this.passengers.addWaiting(Math.min(12, Math.max(0, (this.waiting[stationIndex] ?? 0) - 20)));
  }

  private finalizeExchange(): void {
    if (!this.exchange.active || this.exchange.finalized) return;
    const progress = clamp(this.exchange.elapsed / Math.max(0.1, this.exchange.duration), 0, 1);
    const alight = this.exchange.alight;
    const boarded = Math.round(this.exchange.boardPlanned * Math.max(0.15, Math.min(1, progress)));
    this.occupancy = Math.max(0, this.occupancy - alight + boarded);
    this.trainingOccupancy();
    const stationIdx = this.currentIndex;
    this.waiting[stationIdx] = Math.max(0, (this.waiting[stationIdx] ?? 0) - boarded);
    const farePer = this.farePerPassenger();
    this.stats.fares += boarded * farePer;
    this.stats.boarded += boarded;
    const avgTrip = this.averageStationGap() * 2.4;
    this.stats.passengerKm += (boarded * avgTrip) / 1000;
    this.exchange.boarded = boarded;
    this.exchange.finalized = true;
    this.exchange.active = false;
    if (this.occupancy / this.capacity > 0.9) {
      this.stats.satisfaction = clamp(this.stats.satisfaction - 1.5, 30, 100);
    }
    this.hooks.onNotice(`${boarded} boarded · ${alight} alighted`, 'info');
  }

  private trainingOccupancy(): void {
    this.train.notifyPassengers(this.occupancy);
  }

  private farePerPassenger(): number {
    const km = this.averageStationGap() * 3 / 1000;
    const base = 1.7 + km * 0.17;
    const sat = 0.82 + (this.stats.satisfaction / 100) * 0.24;
    return base * this.line.fareMultiplier * this.mods.fareBonus * sat;
  }

  private averageStationGap(): number {
    if (this.plan.stations.length < 2) return 900;
    return (this.plan.stations[this.plan.stations.length - 1].s - this.plan.stations[0].s) / (this.plan.stations.length - 1);
  }

  private doorPositions(): number[] {
    const out: number[] = [];
    for (let i = 0; i < this.trainDef.cars; i++) {
      for (let j = 0; j < 3; j++) {
        out.push(this.train.carCenterS(i) + (j - 1) * this.trainDef.carLength * 0.3);
      }
    }
    return out;
  }

  private arriveAtCurrent(): void {
    if (this.phase === 'arrived' || this.phase === 'boarding') return;
    const index = this.nextIndex;
    if (index >= this.plan.stations.length) return;
    this.currentIndex = index;
    this.nextIndex = Math.min(index + 1, this.stations.length - 1);
    this.phase = 'arrived';
    this.stopTimer = 0;
    const st = this.stations[index];
    const acc = Math.abs(this.train.s - st.stopS);
    const scheduled = this.timetable[index];
    const delay = this.clock - scheduled.arrival;
    if (!this.stopEvaluated[index]) {
      this.stopEvaluated[index] = true;
      this.stats.stops++;
      if (acc <= 1.2) {
        this.stats.perfectStops++;
        this.stats.accuracyBonus += 95;
        this.trainGuard('PERFECT STOP', 'good');
        this.hooks.toast(`Perfect stop · ${acc.toFixed(2)} m`, 'good');
        this.stats.satisfaction = clamp(this.stats.satisfaction + 2.5, 30, 100);
      } else if (acc <= 5) {
        this.stats.goodStops++;
        this.stats.accuracyBonus += 32;
        this.hooks.toast(`Good stop · ${acc.toFixed(1)} m`, 'good');
      } else if (acc <= 15) {
        this.stats.penalties += 35;
        this.hooks.toast(`Stop ${acc.toFixed(1)} m from the board.`, 'info');
      } else {
        this.stats.penalties += 130;
        this.stats.satisfaction = clamp(this.stats.satisfaction - 5, 30, 100);
        this.hooks.toast(`MISSED STOP · ${acc.toFixed(1)} m from the board`, 'bad');
      }
      if (delay <= 45) {
        this.stats.onTimeStops++;
        this.stats.satisfaction = clamp(this.stats.satisfaction + 1.1, 30, 100);
      } else {
        const extra = Math.min(240, delay - 45);
        this.stats.penalties += Math.round(extra * 0.6);
        this.hooks.toast(`Arrived ${Math.round(delay - 45)}s late.`, 'bad');
      }
      this.stats.delaySum += Math.max(0, delay);
    }
    this.arriveClock = this.clock;
    this.audio.chime();
    this.hooks.announce(`This is ${st.plan.name}. Please mind the gap.`);
    if (acc <= 20) {
      this.train.setDoorsOpen(true);
      this.train.doors = 1;
      this.openExchange(index, false);
      this.audio.doorSound(true);
    } else {
      this.hooks.toast('Platform ahead or behind — align with the stop board and press D.', 'bad');
    }
    this.passengers.setupStation(st, this.path, Math.max(4, this.waiting[index] ?? 0));
    if (this.exchange.active) this.passengers.beginExchange(this.doorPositions(), this.exchange.boardPlanned, this.exchange.alight);
    this.hooks.onNotice(`${st.plan.name} · ${acc <= 5 ? 'on the board' : `${acc.toFixed(0)} m off`} · ${formatClockShort(this.clock)}`, acc <= 8 ? 'good' : 'bad');
  }

  private trainGuard(msg: string, tone: 'good' | 'bad'): void {
    void msg;
    void tone;
    this.audio.chime();
  }

  private completeService(): void {
    if (this.completeSent) return;
    this.completeSent = true;
    this.phase = 'complete';
    const km = this.train.distance / 1000;
    const fares = Math.max(0, this.stats.fares);
    const punctualityBonus = this.stats.onTimeStops * 46 * this.line.fareMultiplier;
    const accuracyBonus = this.stats.accuracyBonus;
    const penalties = Math.round(this.stats.penalties);
    const energyCost = this.train.energyKWh * 0.26 + this.train.fuelL * 1.62;
    const maintenance = 22 + km * (2.2 + this.trainDef.massPerCar * 0.02);
    const crewCost = 58 + km * 0.85;
    const net = fares + punctualityBonus + accuracyBonus - penalties - energyCost - maintenance - crewCost;
    const xp = Math.max(20, Math.round(this.stats.boarded * 2.2 + km * 14 + this.stats.perfectStops * 55 + this.stats.onTimeStops * 18 - penalties * 0.12));
    this.stats.distanceKm = km;
    this.hooks.onComplete({
      lineId: this.line.id,
      lineName: this.line.name,
      lineCode: this.line.code,
      trainName: this.trainDef.name,
      fares,
      punctualityBonus,
      accuracyBonus,
      penalties,
      energyCost,
      maintenance,
      crewCost,
      net,
      xp,
      passengers: this.stats.boarded,
      passengerKm: this.stats.passengerKm,
      stops: this.stats.stops,
      perfectStops: this.stats.perfectStops,
      onTimeStops: this.stats.onTimeStops,
      delaySeconds: this.stats.delaySum,
      distanceKm: km,
      overspeedEvents: this.stats.overspeedEvents,
      harshBrakes: this.stats.harshBrakes,
      satisfaction: this.stats.satisfaction,
      durationSeconds: this.elapsedSinceStart,
    });
  }

  setThrottle(v: number): void {
    for (const st of this.stations) void st;
    this.train.setThrottle(v);
  }

  nudgeThrottle(delta: number): void {
    this.train.setThrottle(this.train.throttle + delta);
  }

  nudgeBrake(delta: number): void {
    this.train.setBrake(this.train.brakeCmd + delta);
  }

  releaseBrake(): void {
    this.train.setBrake(0);
    this.audio.brakeHiss();
  }

  update(dt: number): void {
    if (this.phase === 'complete') return;
    this.clock += dt;
    this.stats.time += dt;
    this.train.update(dt, { wet: this.wet > 0.3, occupancy: this.occupancy });

    // Exchange timing
    if (this.exchange.active && !this.exchange.finalized) {
      this.exchange.elapsed += dt;
      if (this.exchange.elapsed >= this.exchange.duration) this.finalizeExchange();
    }

    // Stopping / departure detection
    if (this.phase === 'boarding') {
      if (!this.train.doorsOpen && Math.abs(this.train.v) > 0.6) {
        this.phase = 'running';
        this.nextIndex = Math.min(this.currentIndex + 1, this.stations.length - 1);
        this.passengers.clear();
        this.hooks.toast('Departure — next stop ahead.', 'info');
      }
    } else if (this.phase === 'running') {
      const st = this.nextStation;
      if (st) {
        const dist = this.train.s - st.stopS;
        if (Math.abs(this.train.v) < 0.22 && Math.abs(dist) <= 34) {
          this.stopTimer += dt;
          if (this.stopTimer > 0.9) this.arriveAtCurrent();
        } else {
          this.stopTimer = 0;
        }
        const approach = st.stopS - this.train.s;
        if (approach < 700 && approach > 0 && this.announcedStation !== this.nextIndex) {
          this.announcedStation = this.nextIndex;
          this.hooks.announce(`Now approaching ${st.plan.name}.`);
        }
      }
      if (this.train.s - (st?.stopS ?? 0) > 34 && this.train.v < 0.3) {
        this.hint = 'Overshot the platform — reverse (R) and creep back to the board.';
      }
    } else if (this.phase === 'arrived') {
      if (!this.train.doorsOpen && Math.abs(this.train.v) > 0.6) {
        const terminus = this.currentIndex >= this.stations.length - 1;
        if (terminus) {
          this.completeService();
        } else {
          this.phase = 'running';
          this.nextIndex = Math.min(this.currentIndex + 1, this.stations.length - 1);
          this.stopTimer = 0;
          this.passengers.clear();
        }
      }
    }

    // First departure after initial boarding
    if (this.phase === 'boarding' && this.nextIndex <= this.currentIndex) this.nextIndex = Math.min(this.currentIndex + 1, this.stations.length - 1);

    // Speed enforcement
    const limit = this.path.limitAt(this.train.s);
    const over = this.train.speedKph - limit;
    this.overspeedCooldown = Math.max(0, this.overspeedCooldown - dt);
    if (over > 5) {
      this.overspeedTimer += dt;
      if (this.overspeedTimer > 2.2 && this.overspeedCooldown <= 0) {
        this.overspeedCooldown = 4;
        this.stats.overspeedEvents++;
        this.stats.penalties += 45;
        this.stats.satisfaction = clamp(this.stats.satisfaction - 2, 30, 100);
        this.hooks.toast(`Overspeed · limit ${limit} km/h`, 'bad');
      }
      if (over > 20) {
        this.atpTimer += dt;
        if (this.atpTimer > 2.4) {
          this.train.setBrake(0.55);
          this.hooks.toast('ATP: automatic brake intervention', 'bad');
          this.atpTimer = 0;
        }
      } else {
        this.atpTimer = 0;
      }
    } else {
      this.overspeedTimer = 0;
      this.atpTimer = 0;
    }

    // Comfort
    this.harshCooldown = Math.max(0, this.harshCooldown - dt);
    if (this.train.harshBrakeTimer > 0.45 && this.harshCooldown <= 0) {
      this.harshCooldown = 8;
      this.stats.harshBrakes++;
      this.stats.penalties += 22;
      this.stats.satisfaction = clamp(this.stats.satisfaction - 1.6, 30, 100);
      this.hooks.toast('Harsh braking — passengers disturbed', 'bad');
    }

    // Crew: no driver input while moving? (throttle left on)
    this.passengers.update(dt);
    this.stats.distanceKm = this.train.distance / 1000;
    this.stationFocus = this.nearestStationIndex();

    // Lighting / ambience updates (sky work is throttled)
    this.skyTimer += dt;
    if (this.skyTimer > 8) {
      this.skyTimer = 0;
      this.sky.setHour(this.clock / 3600);
      if (Math.abs(this.sky.night - this.displayNight) > 0.06) {
        this.displayNight = this.sky.night;
        for (const st of this.stations) st.setNight(this.sky.night);
      }
    }
    this.night = this.sky.night;

    const atStationNow = (this.phase === 'arrived' || this.phase === 'boarding') && this.aligned;
    if (atStationNow !== this.lastAtStation) {
      this.lastAtStation = atStationNow;
    }

    this.trainMesh.update(this.train, this.path, dt, {
      lineCode: this.line.code,
      lineColor: this.line.color,
      destination: this.plan.stations[this.plan.stations.length - 1].name,
      night: this.sky.night,
      cabView: true,
    });
    this.trainMesh.group.updateMatrixWorld(true);
    const focus = this.path.sample(this.train.s - this.train.length * 0.4);
    this.sky.focus(new THREE.Vector3(focus.x, focus.y, focus.z));
    this.scenery.update(dt, this.clock);
    this.trackView.update(this.train.s);
  }

  private nearestStationIndex(): number {
    let best = 0;
    let bestDist = Infinity;
    for (const st of this.plan.stations) {
      const d = Math.abs(st.s - this.train.s);
      if (d < bestDist) {
        bestDist = d;
        best = st.index;
      }
    }
    return best;
  }

  get focusStation(): StationView {
    return this.stations[clamp(this.stationFocus, 0, this.stations.length - 1)];
  }

  hudState(extra: { money: number; level: number; xpFraction: number; viewMode: string; showHints: boolean }): HudState {
    const route: RouteItemState[] = this.plan.stations.map((st, i) => {
      let state: RouteItemState['state'] = 'upcoming';
      if (this.train.s > this.stations[i].stopS + 30) state = 'passed';
      else if (Math.abs(this.train.s - this.stations[i].stopS) <= 30) state = 'current';
      else if (i === this.nextIndex && this.phase === 'running') state = 'next';
      return { name: st.name, state };
    });
    const next = this.nextStation;
    const scheduled = next ? this.timetable[this.nextIndex] : null;
    const limit = this.path.limitAt(this.train.s);
    const advisory = this.path.advisoryLimit(this.train.s, 600);
    const nextRestriction = this.path.nextRestriction(this.train.s, 1400);
    const delay = next ? this.clock - this.timetable[this.nextIndex].arrival : this.clock - this.timetable[this.timetable.length - 1].arrival;
    const stopTarget = this.phase === 'arrived' || this.phase === 'boarding' ? this.currentStation.stopS : (next?.stopS ?? this.train.s);
    const stopDist = Math.abs(this.train.s - stopTarget);
    let hint = '';
    if (this.phase === 'boarding') hint = 'Close doors (D) when boarding is complete, then take power.';
    else if (this.phase === 'arrived') {
      if (this.train.doorsOpen) hint = this.currentIndex >= this.stations.length - 1 ? 'Terminus — close doors to complete the service.' : 'Doors open — close them once boarding is complete.';
      else hint = 'Align with the stop board, then press D to open the doors.';
    }
    else if (this.phase === 'running' && next) {
      if (this.train.s > next.stopS + 34 && Math.abs(this.train.v) < 0.4) hint = 'Overshot — reverse and creep back to the stop board.';
      else if (stopDist < 40) hint = 'Stop on the board. Doors will align.';
      else if (stopDist < 250) hint = `Brake gently — stop in ${Math.round(stopDist)} m.`;
      else if (stopDist < 900) hint = `Next stop ${next.plan.name} — ${Math.round(stopDist)} m.`;
      else hint = `Next stop ${next.plan.name}.`;
    }
    if (this.phase === 'complete') hint = 'Service complete.';
    const overspeed = this.train.speedKph > limit + 5;
    let signal: 'clear' | 'caution' = 'clear';
    if (next && next.stopS - this.train.s < 500 && this.train.speedKph > 85) signal = 'caution';
    if (overspeed) signal = 'caution';
    const delaySec = next ? this.clock - this.timetable[this.nextIndex].arrival : 0;
    const hintText = extra.showHints
      ? 'W/S power & brake · Z coast · X release · D doors · SPACE horn · C camera · ESC pause'
      : 'W/S power & brake · D doors · SPACE horn · C camera';
    return {
      clock: this.clock,
      delaySec: this.phase === 'running' ? delaySec : (this.phase === 'arrived' ? this.arriveClock - this.timetable[this.currentIndex].arrival : 0),
      money: extra.money,
      level: extra.level,
      xpFraction: extra.xpFraction,
      speedKph: this.train.speedKph,
      maxSpeedKph: this.trainDef.maxSpeedKph,
      limit,
      advisory,
      nextRestriction,
      nextRestrictionDist: nextRestriction ? Math.max(0, nextRestriction.s - this.train.s) : 0,
      powerNotch: this.train.powerNotch,
      brakeNotch: this.train.brakeNotch,
      throttle: this.train.throttle,
      brake: this.train.brakeApplied,
      doorsOpen: this.train.doorsOpen,
      doorsMoving: Math.abs(this.train.doors - this.train.doorsTarget) > 0.02,
      doorAligned: this.aligned,
      emergency: this.train.emergency,
      headlights: this.train.headlights,
      stationName: this.phase === 'running' && this.nextStation ? this.nextStation.plan.name : this.currentStation.plan.name,
      nextStationName: next ? next.plan.name : '',
      nextStationScheduled: scheduled ? scheduled.arrival : 0,
      distanceToNext: this.phase === 'running' ? Math.max(0, (next?.stopS ?? 0) - this.train.s) : 0,
      passengers: this.occupancy,
      capacity: this.capacity,
      waiting: this.waiting[clamp(this.phase === 'running' ? this.nextIndex : this.currentIndex, 0, this.waiting.length - 1)] ?? 0,
      stopHint: hint,
      stopAccuracy: this.stopAccuracy,
      viewMode: extra.viewMode,
      overspeed,
      slip: this.train.slip > 0.2,
      wet: this.wet,
      route,
      progress: this.train.s / this.path.length,
      hint: hintText,
      boarding: this.exchange.active,
      serviceComplete: this.phase === 'complete',
      signal,
    };
  }

  dispose(): void {
    this.passengers.dispose();
    this.trainMesh.dispose();
    this.trackView.dispose();
    this.scenery.dispose();
    for (const st of this.stations) st.dispose();
    this.sky.dispose();
    this.scene.clear();
  }
}

function formatClockShort(sec: number): string {
  const s = Math.floor(sec) % 86400;
  return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}`;
}

export function trainById(id: string): TrainDef {
  return getTrain(id);
}

export { formatHM };
