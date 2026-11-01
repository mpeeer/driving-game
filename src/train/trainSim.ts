import { TrainDef } from '../content/data';
import { clamp, signOr } from '../core/util';
import { TrackPath } from '../world/trackPlan';

export interface TrainEnvironment {
  wet: boolean;
  occupancy: number;
}

export class TrainSim {
  readonly def: TrainDef;
  readonly path: TrackPath;
  s: number;
  v = 0;
  throttle = 0;
  brakeCmd = 0;
  brakeApplied = 0;
  reverser: -1 | 0 | 1 = 1;
  doors = 0;
  doorsTarget = 0;
  emergency = false;
  headlights: 0 | 1 | 2 = 1;
  wipers = false;
  horn = false;
  wheelSpeed = 0;
  distance = 0;
  energyKWh = 0;
  fuelL = 0;
  slip = 0;
  atpBraking = false;
  harshBrakeTimer = 0;
  readonly length: number;
  readonly gap = 0.7;
  private tractionRamp = 0;
  private lastBrake = 0;
  private occupiedMass = 0;

  constructor(def: TrainDef, path: TrackPath, startS: number) {
    this.def = def;
    this.path = path;
    this.s = startS;
    this.length = def.cars * def.carLength + (def.cars - 1) * this.gap;
  }

  get massEmptyKg(): number {
    return this.def.cars * this.def.massPerCar * 1000;
  }

  get massKg(): number {
    return this.massEmptyKg + this.occupiedMass;
  }

  get speedKph(): number {
    return Math.abs(this.v) * 3.6;
  }

  get maxSpeedMs(): number {
    return this.def.maxSpeedKph / 3.6;
  }

  get powerNotch(): number {
    return Math.ceil(this.throttle * 4 - 1e-6);
  }

  get brakeNotch(): number {
    return Math.ceil(this.brakeApplied * 5 - 1e-6);
  }

  get doorsOpen(): boolean {
    return this.doors > 0.02;
  }

  setThrottle(v: number): void {
    this.throttle = clamp(v, 0, 1);
    if (this.throttle > 0) this.brakeCmd = 0;
  }

  setBrake(v: number): void {
    this.brakeCmd = clamp(v, 0, 1);
    if (this.brakeCmd > 0) this.throttle = 0;
  }

  toggleDoors(): void {
    if (Math.abs(this.v) > 0.2) return;
    this.doorsTarget = this.doorsTarget > 0.5 ? 0 : 1;
  }

  setDoorsOpen(open: boolean): void {
    if (Math.abs(this.v) > 0.2 && open) return;
    this.doorsTarget = open ? 1 : 0;
  }

  setReverser(dir: -1 | 0 | 1): void {
    if (Math.abs(this.v) > 0.25) return;
    this.reverser = dir;
    this.throttle = 0;
    this.brakeCmd = 0;
  }

  emergencyBrake(): void {
    this.emergency = true;
    this.throttle = 0;
    this.brakeCmd = 1;
  }

  releaseEmergency(): void {
    this.emergency = false;
    this.brakeCmd = 0;
  }

  notifyPassengers(n: number): void {
    this.occupiedMass = Math.max(0, n) * 80;
  }

  update(dt: number, env: TrainEnvironment): void {
    let remaining = Math.min(dt, 0.1);
    const step = 1 / 120;
    while (remaining > 0) {
      const h = Math.min(step, remaining);
      this.integrate(h, env);
      remaining -= h;
    }
  }

  private integrate(dt: number, env: TrainEnvironment): void {
    // Door mechanism (2.1 s cycle)
    const doorSpeed = 1 / 2.1;
    if (this.doors < this.doorsTarget) this.doors = Math.min(this.doorsTarget, this.doors + doorSpeed * dt);
    else if (this.doors > this.doorsTarget) this.doors = Math.max(this.doorsTarget, this.doors - doorSpeed * dt);

    // Brake application / release lag
    const targetBrake = this.emergency ? 1 : this.brakeCmd;
    const brakeRate = targetBrake > this.brakeApplied ? 1 / 0.85 : 1 / 1.7;
    if (this.brakeApplied < targetBrake) this.brakeApplied = Math.min(targetBrake, this.brakeApplied + brakeRate * dt);
    else if (this.brakeApplied > targetBrake) this.brakeApplied = Math.max(targetBrake, this.brakeApplied - brakeRate * dt);
    if (this.emergency && this.brakeApplied > 0.95) this.brakeApplied = 1;

    const dir = this.reverser;
    const speed = Math.abs(this.v);
    const mass = this.massKg;
    const g = 9.81;
    const powerW = this.def.powerKW * 1000;

    // Inverter ramp and power/effort envelope
    const powerDemand = this.reverser !== 0 && !this.doorsOpen && !this.emergency ? this.throttle : 0;
    this.tractionRamp += clamp(powerDemand - this.tractionRamp, -dt * 3.2, dt * 2.4);
    let force = 0;
    if (this.tractionRamp > 0.001) {
      const maxTE = this.def.maxTEkN * 1000;
      const speedLimited = powerW / Math.max(speed, 2.2);
      const effort = Math.min(maxTE, speedLimited) * this.tractionRamp;
      force = effort * (dir as number);
    }
    if (this.reverser === -1 && this.v < -7) force = Math.min(force, 0);
    if (this.reverser === 1 && this.v > this.maxSpeedMs) force = Math.min(force, 0);

    // Adhesion
    const mu = env.wet ? 0.24 : 0.34;
    const adhesion = mu * mass * g * 0.92;
    if (Math.abs(force) > adhesion) {
      this.slip = Math.min(1, this.slip + dt * 3);
      force = Math.sign(force) * adhesion * 0.78;
    } else {
      this.slip = Math.max(0, this.slip - dt * 2);
    }

    const grade = this.path.gradeAt(this.s);
    const gradeAccel = -g * Math.sin(Math.atan(grade));
    const rolling = 0.045 + 0.00062 * speed + 0.00019 * speed * speed;

    // Friction + dynamic brake, service rate scaled by passenger comfort load
    const brakeDecel = this.def.brakeDecel * (this.emergency ? 1.28 : 1);
    const brakeAccel = this.brakeApplied * brakeDecel;

    let accel = force / mass + gradeAccel;
    if (speed > 0.02) {
      accel -= Math.sign(this.v) * rolling;
      accel -= Math.sign(this.v) * brakeAccel;
    }
    if (this.emergency) accel = Math.min(accel, 0);

    const oldV = this.v;
    if (Math.abs(this.v) < 0.04 && brakeAccel > 0.02) {
      this.v = 0;
      if (this.emergency) this.emergency = false;
    } else if (Math.abs(this.v) < 0.04 && this.throttle < 0.02 && Math.abs(grade) < 0.004) {
      this.v = 0;
    } else {
      this.v += accel * dt;
      if (oldV !== 0 && Math.sign(this.v) !== Math.sign(oldV)) this.v = 0;
      if (oldV === 0 && brakeAccel > 0.02) this.v = 0;
    }

    if (this.v > this.maxSpeedMs) this.v = this.maxSpeedMs;
    if (this.v < -7) this.v = -7;

    // Hard braking detection for comfort scoring
    const decel = (oldV - this.v) / dt;
    if (decel > 1.42 && speed > 2) this.harshBrakeTimer += dt;
    else this.harshBrakeTimer = Math.max(0, this.harshBrakeTimer - dt);

    const ds = this.v * dt;
    this.s += ds;
    this.distance += Math.abs(ds);
    this.wheelSpeed = this.v * 2.1;

    // Keep the whole train between the buffer stops.
    const minS = this.length + 26;
    const maxS = this.path.length - 26;
    if (this.s < minS) {
      this.s = minS;
      this.v = Math.max(0, this.v);
    }
    if (this.s > maxS) {
      this.s = maxS;
      this.v = Math.min(0, this.v);
    }

    // Energy / fuel
    const powerNow = Math.max(0, force * this.v) / 1000;
    if (powerNow > 0) {
      const eff = this.def.traction === 'diesel' ? this.def.energyCost * 1.6 : this.def.energyCost;
      this.energyKWh += (powerNow * dt) / 3600 * eff;
      if (this.def.traction === 'diesel') this.fuelL += (powerNow * dt) / 3600 / 3.6;
    } else if (this.def.traction === 'electric' && this.brakeApplied > 0.1) {
      // Regenerative credit
      const regen = this.brakeApplied * 0.22 * (mass / 1000) * Math.abs(this.v) / 1000;
      this.energyKWh = Math.max(0, this.energyKWh - (regen * dt) / 3600 * 0.8);
    }

    if (Math.abs(this.brakeApplied - this.lastBrake) > 0.2) this.lastBrake = this.brakeApplied;
  }

  /** World position (centre) of car `i`. */
  carCenterS(i: number): number {
    return this.s - (this.def.carLength / 2 + i * (this.def.carLength + this.gap));
  }

  doorS(i: number, sideIndex: number): number {
    const center = this.carCenterS(i);
    const offsets = [-0.28, 0.28];
    return center + offsets[sideIndex] * this.def.carLength;
  }

  stopDistanceTo(target: number): number {
    return target - this.s;
  }
}
